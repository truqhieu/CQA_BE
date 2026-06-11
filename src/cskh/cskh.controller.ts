import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  Req,
  Headers,
  UseGuards,
  BadRequestException,
  UnauthorizedException,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import type { RawBodyRequest } from '@nestjs/common';
import { merge, interval, map, Observable } from 'rxjs';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CskhService } from './cskh.service';
import { CskhInboxService } from './cskh-inbox.service';
import { CskhInboxRealtimeService } from './cskh-inbox-realtime.service';
import { verifyFacebookWebhookSignature } from './facebook-oauth.util';
import { parseMediaProxyUrlFromRequest } from './facebook-message.util';
import { SapoOAuthService } from './sapo-oauth.service';
import { SapoProductService } from './sapo-product.service';

@Controller('cskh')
export class CskhController {
  constructor(
    private readonly cskh: CskhService,
    private readonly inbox: CskhInboxService,
    private readonly inboxRealtime: CskhInboxRealtimeService,
    private readonly sapoOAuth: SapoOAuthService,
    private readonly sapoProducts: SapoProductService,
  ) {}

  /** OAuth — không cần JWT (redirect browser). */
  @Get('oauth/start')
  oauthStart(@Query('returnUrl') returnUrl: string, @Res() res: Response) {
    const url = this.cskh.getOAuthStartUrl(returnUrl);
    return res.redirect(url);
  }

  @Get('oauth/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    if (error) {
      const msg = encodeURIComponent(errorDescription || error);
      return res.redirect(`${this.cskh.defaultOAuthReturnUrl()}&oauth_error=${msg}`);
    }
    try {
      const result = await this.cskh.handleOAuthCallback(code, state);
      const base = result.returnUrl || this.cskh.defaultOAuthReturnUrl();
      const sep = base.includes('?') ? '&' : '?';
      return res.redirect(`${base}${sep}fb_connected=${result.pageCount}`);
    } catch (e) {
      const msg = encodeURIComponent(e instanceof Error ? e.message : 'OAuth failed');
      return res.redirect(`${this.cskh.defaultOAuthReturnUrl()}&oauth_error=${msg}`);
    }
  }

  @Get('pages')
  @UseGuards(JwtAuthGuard)
  listPages() {
    return this.cskh.listPages();
  }

  @Put('pages/manual')
  @UseGuards(JwtAuthGuard)
  saveManualPage(
    @Body()
    body: {
      pageId?: string;
      pageName?: string;
      pageAccessToken?: string;
    },
  ) {
    return this.cskh.savePageConfig({
      pageId: body.pageId?.trim() ?? '',
      pageName: body.pageName,
      pageAccessToken: body.pageAccessToken ?? '',
    });
  }

  @Patch('pages/bulk-enabled')
  @UseGuards(JwtAuthGuard)
  setPagesEnabledBulk(@Body() body: { enabled?: boolean; pageIds?: string[] }) {
    return this.cskh.setPagesEnabledBulk(Boolean(body.enabled), body.pageIds);
  }

  @Patch('pages/:pageId/enabled')
  @UseGuards(JwtAuthGuard)
  setPageEnabled(@Param('pageId') pageId: string, @Body() body: { enabled?: boolean }) {
    return this.cskh.setPageEnabled(pageId, Boolean(body.enabled));
  }

  @Delete('pages/:pageId')
  @UseGuards(JwtAuthGuard)
  deletePage(@Param('pageId') pageId: string) {
    return this.cskh.deletePage(pageId);
  }

  @Post('oauth/refresh')
  @UseGuards(JwtAuthGuard)
  refreshOAuth() {
    return this.cskh.refreshPagesFromOAuth();
  }

  /** Sapo Partner OAuth — redirect browser (cài Client lên shop). */
  @Get('sapo/oauth/start')
  sapoOAuthStart(@Res() res: Response) {
    const url = this.sapoOAuth.getOAuthStartUrl();
    return res.redirect(url);
  }

  @Get('sapo/oauth/callback')
  async sapoOAuthCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    if (error) {
      const msg = errorDescription || error;
      res.type('html').send(`<h1>Sapo OAuth lỗi</h1><p>${msg}</p>`);
      return;
    }
    try {
      const result = await this.sapoOAuth.exchangeCode(code);
      res.type('html').send(
        `<h1>Sapo OAuth thành công</h1>
         <p>Shop đã cấp quyền cho Partner App.</p>
         <p>SP mẫu: ${result.sampleProductTitle ?? '(chưa đọc được — kiểm tra scope read_products)'}</p>
         <p><strong>Thêm vào env Cloud Run / .env BE:</strong></p>
         <pre>SAPO_ACCESS_TOKEN=${result.accessToken}</pre>
         <p>Sau đó restart BE. Không commit token vào git.</p>`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'OAuth failed';
      res.type('html').send(`<h1>Sapo OAuth lỗi</h1><pre>${msg}</pre>`);
    }
  }

  @Get('sapo/status')
  @UseGuards(JwtAuthGuard)
  async sapoStatus() {
    const oauthReady = this.sapoOAuth.isOAuthConfigured();
    const apiReady = this.sapoProducts.isConfigured();
    let variantCount = 0;
    if (apiReady) {
      const catalog = await this.sapoProducts.getCatalog();
      variantCount = catalog.length;
    }
    return {
      oauthReady,
      apiReady,
      redirectUri: oauthReady ? this.sapoOAuth.getRedirectUri() : null,
      authorizeUrl: oauthReady ? this.sapoOAuth.getOAuthStartUrl() : null,
      variantCount,
    };
  }

  @Get('monitor/latest')
  @UseGuards(JwtAuthGuard)
  latestMonitor() {
    return this.cskh.getLatestMonitor();
  }

  @Post('monitor/run')
  @UseGuards(JwtAuthGuard)
  async runMonitor(@Body() body: { maxConversations?: number }) {
    const running = await this.cskh.findRunningJob('monitor');
    if (running) {
      return { jobId: running.id, status: 'running', alreadyRunning: true };
    }
    const job = await this.cskh.createJob('monitor');
    void this.cskh.runMonitorJob(job.id, body.maxConversations);
    return { jobId: job.id, status: 'running', alreadyRunning: false };
  }

  @Post('audit/run')
  @UseGuards(JwtAuthGuard)
  async runAudit(
    @Body()
    body: {
      auditDate?: string;
      auditDateFrom?: string;
      auditDateTo?: string;
      maxConversations?: number;
      force?: boolean;
      pageId?: string;
    },
  ) {
    const auditDateFrom = (body.auditDateFrom || body.auditDate || '').trim();
    const auditDateTo = (body.auditDateTo || body.auditDateFrom || body.auditDate || '').trim();
    if (!auditDateFrom || !/^\d{4}-\d{2}-\d{2}$/.test(auditDateFrom)) {
      throw new BadRequestException('Bắt buộc chọn ngày bắt đầu (YYYY-MM-DD)');
    }
    if (!auditDateTo || !/^\d{4}-\d{2}-\d{2}$/.test(auditDateTo)) {
      throw new BadRequestException('Bắt buộc chọn ngày kết thúc (YYYY-MM-DD)');
    }
    if (auditDateFrom > auditDateTo) {
      throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
    }
    const pageId = body.pageId?.trim();
    if (!pageId) {
      throw new BadRequestException('Bắt buộc chọn kênh (page) để chấm điểm');
    }
    const maxConversations =
      body.maxConversations != null && body.maxConversations > 0
        ? Math.floor(body.maxConversations)
        : undefined;
    if (body.force) {
      await this.cskh.cancelRunningJobs('audit');
    } else {
      await this.cskh.releaseStaleJobs('audit', 5 * 60 * 1000);
    }
    const running = await this.cskh.findRunningJob('audit');
    if (running) {
      return { jobId: running.id, status: 'running', alreadyRunning: true };
    }
    const job = await this.cskh.createJob('audit');
    void this.cskh.runAuditJob(job.id, {
      auditDateFrom,
      auditDateTo,
      maxConversations,
      force: Boolean(body.force),
      pageId,
    });
    return { jobId: job.id, status: 'running', alreadyRunning: false };
  }

  @Post('audit/pause')
  @UseGuards(JwtAuthGuard)
  pauseAudit() {
    return this.cskh.requestAuditPause();
  }

  @Post('audit/cancel')
  @UseGuards(JwtAuthGuard)
  async cancelAudit() {
    const n = await this.cskh.cancelRunningJobs('audit');
    return { cancelled: n };
  }

  @Get('audit/token-stats')
  @UseGuards(JwtAuthGuard)
  getAuditTokenStats() {
    return this.cskh.getAuditTokenStats();
  }

  @Get('audit/progress/:jobId')
  @UseGuards(JwtAuthGuard)
  getAuditProgress(@Param('jobId') jobId: string) {
    return this.cskh.getAuditProgress(jobId);
  }

  @Get('jobs/running/:type')
  @UseGuards(JwtAuthGuard)
  getRunningJob(@Param('type') type: string) {
    if (type !== 'monitor' && type !== 'audit') {
      return null;
    }
    return this.cskh.getRunningJob(type);
  }

  @Get('jobs/:id')
  @UseGuards(JwtAuthGuard)
  getJob(@Param('id') id: string) {
    return this.cskh.getJob(id);
  }

  @Get('audits')
  @UseGuards(JwtAuthGuard)
  listAudits(
    @Query('pageId') pageId?: string,
    @Query('jobRunId') jobRunId?: string,
    @Query('auditDate') auditDate?: string,
    @Query('auditDateFrom') auditDateFrom?: string,
    @Query('auditDateTo') auditDateTo?: string,
    @Query('limit') limit?: string,
  ) {
    return this.cskh.listAudits({
      pageId: pageId?.trim(),
      jobRunId: jobRunId?.trim(),
      auditDate: auditDate?.trim(),
      auditDateFrom: auditDateFrom?.trim(),
      auditDateTo: auditDateTo?.trim(),
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('audits/day-stats')
  @UseGuards(JwtAuthGuard)
  getAuditDayStats(
    @Query('auditDate') auditDate?: string,
    @Query('auditDateFrom') auditDateFrom?: string,
    @Query('auditDateTo') auditDateTo?: string,
    @Query('pageId') pageId?: string,
  ) {
    const from = (auditDateFrom || auditDate)?.trim();
    if (!from) throw new BadRequestException('Bắt buộc auditDateFrom hoặc auditDate (YYYY-MM-DD)');
    return this.cskh.getAuditDayStats(from, auditDateTo?.trim(), pageId?.trim());
  }

  @Get('audits/comparison')
  @UseGuards(JwtAuthGuard)
  getAuditComparison(
    @Query('auditDate') auditDate?: string,
    @Query('auditId') auditId?: string,
  ) {
    const day = auditDate?.trim();
    const id = auditId?.trim();
    if (!day) throw new BadRequestException('Bắt buộc auditDate (YYYY-MM-DD)');
    if (!id) throw new BadRequestException('Bắt buộc auditId');
    return this.cskh.getAuditComparisonStats(day, id);
  }

  @Get('audits/score-history')
  @UseGuards(JwtAuthGuard)
  getAuditScoreHistory(@Query('auditId') auditId?: string) {
    const id = auditId?.trim();
    if (!id) throw new BadRequestException('Bắt buộc auditId');
    return this.cskh.getAuditScoreHistory(id);
  }

  @Get('ai/balance')
  @UseGuards(JwtAuthGuard)
  getAiBalance() {
    return this.cskh.getDeepSeekBalance();
  }

  /** Meta Webhook verify — không JWT. */
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.inbox.verifyWebhookToken(mode, token, challenge);
  }

  /** Meta Webhook events — không JWT. */
  @Post('webhook')
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    const raw = req.rawBody;
    if (!raw || !verifyFacebookWebhookSignature(raw, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    return this.inbox.handleWebhookPayload(req.body);
  }

  @Get('inbox/conversations')
  @UseGuards(JwtAuthGuard)
  listInboxConversations(@Query('pageId') pageId?: string) {
    return this.inbox.listConversations(pageId?.trim());
  }

  /** SSE — push realtime khi webhook/send có tin mới (FE không cần bấm đồng bộ). */
  @Sse('inbox/stream')
  @UseGuards(JwtAuthGuard)
  inboxStream(): Observable<MessageEvent> {
    const heartbeat = interval(25_000).pipe(
      map(() => ({ data: { type: 'ping' } }) as MessageEvent),
    );
    return merge(this.inboxRealtime.stream(), heartbeat);
  }

  @Get('inbox/conversations/:id/messages')
  @UseGuards(JwtAuthGuard)
  getInboxMessages(
    @Param('id') id: string,
    @Query('since') since?: string,
    @Query('refresh') refresh?: string,
    @Query('limit') limit?: string,
  ) {
    const forceRefresh = refresh === '1' || refresh === 'true';
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.inbox.getMessages(
      id,
      since?.trim(),
      forceRefresh,
      Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    );
  }

  @Post('inbox/messages/:messageId/resolve-media')
  @UseGuards(JwtAuthGuard)
  resolveInboxMessageMedia(@Param('messageId') messageId: string) {
    return this.inbox.resolveInboxMessageMedia(messageId);
  }

  @Get('inbox/conversations/:id/intent')
  @UseGuards(JwtAuthGuard)
  getInboxCustomerIntent(@Param('id') id: string, @Query('auditId') auditId?: string) {
    return this.inbox.getCustomerIntent(id.trim(), auditId?.trim());
  }

  @Post('inbox/conversations/:id/send')
  @UseGuards(JwtAuthGuard)
  sendInboxMessage(@Param('id') id: string, @Body() body: { text?: string }) {
    return this.inbox.sendMessage(id, body.text ?? '');
  }

  @Post('inbox/conversations/:id/typing')
  @UseGuards(JwtAuthGuard)
  notifyInboxTyping(@Param('id') id: string) {
    return this.inbox.notifyTyping(id);
  }

  @Post('inbox/conversations/:id/mark-as-read')
  @UseGuards(JwtAuthGuard)
  markInboxAsRead(@Param('id') id: string) {
    return this.inbox.markAsRead(id);
  }

  @Post('inbox/sync')
  @UseGuards(JwtAuthGuard)
  syncInbox(@Body() body: { pageId?: string }) {
    return this.inbox.syncFromGraph(body.pageId?.trim());
  }

  @Post('inbox/link-audit')
  @UseGuards(JwtAuthGuard)
  linkAuditInbox(@Body() body: { auditId?: string }) {
    return this.inbox.linkFromAudit(body.auditId?.trim() ?? '');
  }

  @Get('inbox/conversations/:id/audit-hint')
  @UseGuards(JwtAuthGuard)
  getInboxAuditHint(@Param('id') id: string) {
    return this.inbox.getLatestAuditForConversation(id);
  }

  /** Proxy avatar Facebook CDN — public (img không gửi JWT). */
  @Get('media/avatar')
  proxyAvatar(@Req() req: Request, @Res() res: Response) {
    const url = parseMediaProxyUrlFromRequest(req.originalUrl || req.url || '', req.query.url);
    return this.cskh.proxyMediaUrl(url, res);
  }

  /** Proxy ảnh/video Facebook CDN — public. */
  @Get('media/proxy')
  proxyMedia(@Req() req: Request, @Res() res: Response) {
    const url = parseMediaProxyUrlFromRequest(req.originalUrl || req.url || '', req.query.url);
    return this.cskh.proxyMediaUrl(url, res);
  }

  /** Avatar Page — fetch Graph + stream (public). */
  @Get('media/page-avatar')
  pageAvatar(@Query('pageId') pageId: string, @Res() res: Response) {
    return this.cskh.streamPageAvatar(pageId, res);
  }

  /** Avatar khách — fetch Graph + stream (public). */
  @Get('media/customer-avatar')
  customerAvatar(
    @Query('pageId') pageId: string,
    @Query('psid') psid: string,
    @Res() res: Response,
  ) {
    return this.cskh.streamCustomerAvatar(pageId, psid, res);
  }
}
