"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CskhController = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const cskh_service_1 = require("./cskh.service");
const cskh_inbox_service_1 = require("./cskh-inbox.service");
const cskh_inbox_realtime_service_1 = require("./cskh-inbox-realtime.service");
const facebook_oauth_util_1 = require("./facebook-oauth.util");
const facebook_message_util_1 = require("./facebook-message.util");
const sapo_oauth_service_1 = require("./sapo-oauth.service");
const sapo_product_service_1 = require("./sapo-product.service");
let CskhController = class CskhController {
    cskh;
    inbox;
    inboxRealtime;
    sapoOAuth;
    sapoProducts;
    constructor(cskh, inbox, inboxRealtime, sapoOAuth, sapoProducts) {
        this.cskh = cskh;
        this.inbox = inbox;
        this.inboxRealtime = inboxRealtime;
        this.sapoOAuth = sapoOAuth;
        this.sapoProducts = sapoProducts;
    }
    oauthStart(returnUrl, res) {
        const url = this.cskh.getOAuthStartUrl(returnUrl);
        return res.redirect(url);
    }
    async oauthCallback(code, state, error, errorDescription, res) {
        if (error) {
            const msg = encodeURIComponent(errorDescription || error);
            return res.redirect(`${this.cskh.defaultOAuthReturnUrl()}&oauth_error=${msg}`);
        }
        try {
            const result = await this.cskh.handleOAuthCallback(code, state);
            const base = result.returnUrl || this.cskh.defaultOAuthReturnUrl();
            const sep = base.includes('?') ? '&' : '?';
            return res.redirect(`${base}${sep}fb_connected=${result.pageCount}`);
        }
        catch (e) {
            const msg = encodeURIComponent(e instanceof Error ? e.message : 'OAuth failed');
            return res.redirect(`${this.cskh.defaultOAuthReturnUrl()}&oauth_error=${msg}`);
        }
    }
    listPages() {
        return this.cskh.listPages();
    }
    saveManualPage(body) {
        return this.cskh.savePageConfig({
            pageId: body.pageId?.trim() ?? '',
            pageName: body.pageName,
            pageAccessToken: body.pageAccessToken ?? '',
        });
    }
    setPagesEnabledBulk(body) {
        return this.cskh.setPagesEnabledBulk(Boolean(body.enabled), body.pageIds);
    }
    setPageEnabled(pageId, body) {
        return this.cskh.setPageEnabled(pageId, Boolean(body.enabled));
    }
    deletePage(pageId) {
        return this.cskh.deletePage(pageId);
    }
    refreshOAuth() {
        return this.cskh.refreshPagesFromOAuth();
    }
    sapoOAuthStart(res) {
        const url = this.sapoOAuth.getOAuthStartUrl();
        return res.redirect(url);
    }
    async sapoOAuthCallback(code, error, errorDescription, res) {
        if (error) {
            const msg = errorDescription || error;
            res.type('html').send(`<h1>Sapo OAuth lỗi</h1><p>${msg}</p>`);
            return;
        }
        try {
            const result = await this.sapoOAuth.exchangeCode(code);
            res.type('html').send(`<h1>Sapo OAuth thành công</h1>
         <p>Shop đã cấp quyền cho Partner App.</p>
         <p>SP mẫu: ${result.sampleProductTitle ?? '(chưa đọc được — kiểm tra scope read_products)'}</p>
         <p><strong>Thêm vào env Cloud Run / .env BE:</strong></p>
         <pre>SAPO_ACCESS_TOKEN=${result.accessToken}</pre>
         <p>Sau đó restart BE. Không commit token vào git.</p>`);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'OAuth failed';
            res.type('html').send(`<h1>Sapo OAuth lỗi</h1><pre>${msg}</pre>`);
        }
    }
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
    latestMonitor() {
        return this.cskh.getLatestMonitor();
    }
    async runMonitor(body) {
        const running = await this.cskh.findRunningJob('monitor');
        if (running) {
            return { jobId: running.id, status: 'running', alreadyRunning: true };
        }
        const job = await this.cskh.createJob('monitor');
        void this.cskh.runMonitorJob(job.id, body.maxConversations);
        return { jobId: job.id, status: 'running', alreadyRunning: false };
    }
    async runAudit(body) {
        const auditDateFrom = (body.auditDateFrom || body.auditDate || '').trim();
        const auditDateTo = (body.auditDateTo || body.auditDateFrom || body.auditDate || '').trim();
        if (!auditDateFrom || !/^\d{4}-\d{2}-\d{2}$/.test(auditDateFrom)) {
            throw new common_1.BadRequestException('Bắt buộc chọn ngày bắt đầu (YYYY-MM-DD)');
        }
        if (!auditDateTo || !/^\d{4}-\d{2}-\d{2}$/.test(auditDateTo)) {
            throw new common_1.BadRequestException('Bắt buộc chọn ngày kết thúc (YYYY-MM-DD)');
        }
        if (auditDateFrom > auditDateTo) {
            throw new common_1.BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
        }
        const pageId = body.pageId?.trim();
        if (!pageId) {
            throw new common_1.BadRequestException('Bắt buộc chọn kênh (page) để chấm điểm');
        }
        const maxConversations = body.maxConversations != null && body.maxConversations > 0
            ? Math.floor(body.maxConversations)
            : undefined;
        if (body.force) {
            await this.cskh.cancelRunningJobs('audit');
        }
        else {
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
    pauseAudit() {
        return this.cskh.requestAuditPause();
    }
    async cancelAudit() {
        const n = await this.cskh.cancelRunningJobs('audit');
        return { cancelled: n };
    }
    getAuditTokenStats() {
        return this.cskh.getAuditTokenStats();
    }
    getAuditProgress(jobId) {
        return this.cskh.getAuditProgress(jobId);
    }
    getRunningJob(type) {
        if (type !== 'monitor' && type !== 'audit') {
            return null;
        }
        return this.cskh.getRunningJob(type);
    }
    getJob(id) {
        return this.cskh.getJob(id);
    }
    listAudits(pageId, jobRunId, auditDate, auditDateFrom, auditDateTo, limit) {
        return this.cskh.listAudits({
            pageId: pageId?.trim(),
            jobRunId: jobRunId?.trim(),
            auditDate: auditDate?.trim(),
            auditDateFrom: auditDateFrom?.trim(),
            auditDateTo: auditDateTo?.trim(),
            limit: limit ? Number(limit) : undefined,
        });
    }
    getAuditDayStats(auditDate, auditDateFrom, auditDateTo, pageId) {
        const from = (auditDateFrom || auditDate)?.trim();
        if (!from)
            throw new common_1.BadRequestException('Bắt buộc auditDateFrom hoặc auditDate (YYYY-MM-DD)');
        return this.cskh.getAuditDayStats(from, auditDateTo?.trim(), pageId?.trim());
    }
    getAuditComparison(auditDate, auditId) {
        const day = auditDate?.trim();
        const id = auditId?.trim();
        if (!day)
            throw new common_1.BadRequestException('Bắt buộc auditDate (YYYY-MM-DD)');
        if (!id)
            throw new common_1.BadRequestException('Bắt buộc auditId');
        return this.cskh.getAuditComparisonStats(day, id);
    }
    getAuditScoreHistory(auditId) {
        const id = auditId?.trim();
        if (!id)
            throw new common_1.BadRequestException('Bắt buộc auditId');
        return this.cskh.getAuditScoreHistory(id);
    }
    getAiBalance() {
        return this.cskh.getDeepSeekBalance();
    }
    verifyWebhook(mode, token, challenge) {
        return this.inbox.verifyWebhookToken(mode, token, challenge);
    }
    handleWebhook(req, signature) {
        const raw = req.rawBody;
        if (!raw || !(0, facebook_oauth_util_1.verifyFacebookWebhookSignature)(raw, signature)) {
            throw new common_1.UnauthorizedException('Invalid webhook signature');
        }
        return this.inbox.handleWebhookPayload(req.body);
    }
    listInboxConversations(pageId) {
        return this.inbox.listConversations(pageId?.trim());
    }
    inboxStream() {
        const heartbeat = (0, rxjs_1.interval)(25_000).pipe((0, rxjs_1.map)(() => ({ data: { type: 'ping' } })));
        return (0, rxjs_1.merge)(this.inboxRealtime.stream(), heartbeat);
    }
    getInboxMessages(id, since, refresh, limit) {
        const forceRefresh = refresh === '1' || refresh === 'true';
        const parsedLimit = limit ? Number(limit) : undefined;
        return this.inbox.getMessages(id, since?.trim(), forceRefresh, Number.isFinite(parsedLimit) ? parsedLimit : undefined);
    }
    resolveInboxMessageMedia(messageId) {
        return this.inbox.resolveInboxMessageMedia(messageId);
    }
    getInboxCustomerIntent(id, auditId) {
        return this.inbox.getCustomerIntent(id.trim(), auditId?.trim());
    }
    sendInboxMessage(id, body) {
        return this.inbox.sendMessage(id, body.text ?? '');
    }
    notifyInboxTyping(id) {
        return this.inbox.notifyTyping(id);
    }
    markInboxAsRead(id) {
        return this.inbox.markAsRead(id);
    }
    syncInbox(body) {
        return this.inbox.syncFromGraph(body.pageId?.trim());
    }
    linkAuditInbox(body) {
        return this.inbox.linkFromAudit(body.auditId?.trim() ?? '');
    }
    getInboxAuditHint(id) {
        return this.inbox.getLatestAuditForConversation(id);
    }
    proxyAvatar(req, res) {
        const url = (0, facebook_message_util_1.parseMediaProxyUrlFromRequest)(req.originalUrl || req.url || '', req.query.url);
        return this.cskh.proxyMediaUrl(url, res);
    }
    proxyMedia(req, res) {
        const url = (0, facebook_message_util_1.parseMediaProxyUrlFromRequest)(req.originalUrl || req.url || '', req.query.url);
        return this.cskh.proxyMediaUrl(url, res);
    }
    pageAvatar(pageId, res) {
        return this.cskh.streamPageAvatar(pageId, res);
    }
    customerAvatar(pageId, psid, res) {
        return this.cskh.streamCustomerAvatar(pageId, psid, res);
    }
};
exports.CskhController = CskhController;
__decorate([
    (0, common_1.Get)('oauth/start'),
    __param(0, (0, common_1.Query)('returnUrl')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "oauthStart", null);
__decorate([
    (0, common_1.Get)('oauth/callback'),
    __param(0, (0, common_1.Query)('code')),
    __param(1, (0, common_1.Query)('state')),
    __param(2, (0, common_1.Query)('error')),
    __param(3, (0, common_1.Query)('error_description')),
    __param(4, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, Object]),
    __metadata("design:returntype", Promise)
], CskhController.prototype, "oauthCallback", null);
__decorate([
    (0, common_1.Get)('pages'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "listPages", null);
__decorate([
    (0, common_1.Put)('pages/manual'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "saveManualPage", null);
__decorate([
    (0, common_1.Patch)('pages/bulk-enabled'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "setPagesEnabledBulk", null);
__decorate([
    (0, common_1.Patch)('pages/:pageId/enabled'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('pageId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "setPageEnabled", null);
__decorate([
    (0, common_1.Delete)('pages/:pageId'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('pageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "deletePage", null);
__decorate([
    (0, common_1.Post)('oauth/refresh'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "refreshOAuth", null);
__decorate([
    (0, common_1.Get)('sapo/oauth/start'),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "sapoOAuthStart", null);
__decorate([
    (0, common_1.Get)('sapo/oauth/callback'),
    __param(0, (0, common_1.Query)('code')),
    __param(1, (0, common_1.Query)('error')),
    __param(2, (0, common_1.Query)('error_description')),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, Object]),
    __metadata("design:returntype", Promise)
], CskhController.prototype, "sapoOAuthCallback", null);
__decorate([
    (0, common_1.Get)('sapo/status'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CskhController.prototype, "sapoStatus", null);
__decorate([
    (0, common_1.Get)('monitor/latest'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "latestMonitor", null);
__decorate([
    (0, common_1.Post)('monitor/run'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CskhController.prototype, "runMonitor", null);
__decorate([
    (0, common_1.Post)('audit/run'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CskhController.prototype, "runAudit", null);
__decorate([
    (0, common_1.Post)('audit/pause'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "pauseAudit", null);
__decorate([
    (0, common_1.Post)('audit/cancel'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CskhController.prototype, "cancelAudit", null);
__decorate([
    (0, common_1.Get)('audit/token-stats'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "getAuditTokenStats", null);
__decorate([
    (0, common_1.Get)('audit/progress/:jobId'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('jobId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "getAuditProgress", null);
__decorate([
    (0, common_1.Get)('jobs/running/:type'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('type')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "getRunningJob", null);
__decorate([
    (0, common_1.Get)('jobs/:id'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "getJob", null);
__decorate([
    (0, common_1.Get)('audits'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Query)('pageId')),
    __param(1, (0, common_1.Query)('jobRunId')),
    __param(2, (0, common_1.Query)('auditDate')),
    __param(3, (0, common_1.Query)('auditDateFrom')),
    __param(4, (0, common_1.Query)('auditDateTo')),
    __param(5, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "listAudits", null);
__decorate([
    (0, common_1.Get)('audits/day-stats'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Query)('auditDate')),
    __param(1, (0, common_1.Query)('auditDateFrom')),
    __param(2, (0, common_1.Query)('auditDateTo')),
    __param(3, (0, common_1.Query)('pageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "getAuditDayStats", null);
__decorate([
    (0, common_1.Get)('audits/comparison'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Query)('auditDate')),
    __param(1, (0, common_1.Query)('auditId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "getAuditComparison", null);
__decorate([
    (0, common_1.Get)('audits/score-history'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Query)('auditId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "getAuditScoreHistory", null);
__decorate([
    (0, common_1.Get)('ai/balance'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "getAiBalance", null);
__decorate([
    (0, common_1.Get)('webhook'),
    __param(0, (0, common_1.Query)('hub.mode')),
    __param(1, (0, common_1.Query)('hub.verify_token')),
    __param(2, (0, common_1.Query)('hub.challenge')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "verifyWebhook", null);
__decorate([
    (0, common_1.Post)('webhook'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Headers)('x-hub-signature-256')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "handleWebhook", null);
__decorate([
    (0, common_1.Get)('inbox/conversations'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Query)('pageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "listInboxConversations", null);
__decorate([
    (0, common_1.Sse)('inbox/stream'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", rxjs_1.Observable)
], CskhController.prototype, "inboxStream", null);
__decorate([
    (0, common_1.Get)('inbox/conversations/:id/messages'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('since')),
    __param(2, (0, common_1.Query)('refresh')),
    __param(3, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "getInboxMessages", null);
__decorate([
    (0, common_1.Post)('inbox/messages/:messageId/resolve-media'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('messageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "resolveInboxMessageMedia", null);
__decorate([
    (0, common_1.Get)('inbox/conversations/:id/intent'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('auditId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "getInboxCustomerIntent", null);
__decorate([
    (0, common_1.Post)('inbox/conversations/:id/send'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "sendInboxMessage", null);
__decorate([
    (0, common_1.Post)('inbox/conversations/:id/typing'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "notifyInboxTyping", null);
__decorate([
    (0, common_1.Post)('inbox/conversations/:id/mark-as-read'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "markInboxAsRead", null);
__decorate([
    (0, common_1.Post)('inbox/sync'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "syncInbox", null);
__decorate([
    (0, common_1.Post)('inbox/link-audit'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "linkAuditInbox", null);
__decorate([
    (0, common_1.Get)('inbox/conversations/:id/audit-hint'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "getInboxAuditHint", null);
__decorate([
    (0, common_1.Get)('media/avatar'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "proxyAvatar", null);
__decorate([
    (0, common_1.Get)('media/proxy'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "proxyMedia", null);
__decorate([
    (0, common_1.Get)('media/page-avatar'),
    __param(0, (0, common_1.Query)('pageId')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "pageAvatar", null);
__decorate([
    (0, common_1.Get)('media/customer-avatar'),
    __param(0, (0, common_1.Query)('pageId')),
    __param(1, (0, common_1.Query)('psid')),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], CskhController.prototype, "customerAvatar", null);
exports.CskhController = CskhController = __decorate([
    (0, common_1.Controller)('cskh'),
    __metadata("design:paramtypes", [cskh_service_1.CskhService,
        cskh_inbox_service_1.CskhInboxService,
        cskh_inbox_realtime_service_1.CskhInboxRealtimeService,
        sapo_oauth_service_1.SapoOAuthService,
        sapo_product_service_1.SapoProductService])
], CskhController);
//# sourceMappingURL=cskh.controller.js.map