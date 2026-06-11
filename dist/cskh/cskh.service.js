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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var CskhService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CskhService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = __importDefault(require("axios"));
const prisma_service_1 = require("../prisma/prisma.service");
const ai_service_1 = require("../ai/ai.service");
const facebook_graph_service_1 = require("./facebook-graph.service");
const facebook_oauth_util_1 = require("./facebook-oauth.util");
const facebook_message_util_1 = require("./facebook-message.util");
const facebook_referral_util_1 = require("./facebook-referral.util");
const audit_analytics_util_1 = require("./audit-analytics.util");
const user_facing_error_util_1 = require("../common/user-facing-error.util");
let CskhService = CskhService_1 = class CskhService {
    prisma;
    aiService;
    graph;
    config;
    logger = new common_1.Logger(CskhService_1.name);
    delayBetweenMs = Number(process.env.CSKH_DELAY_BETWEEN_MS || 800);
    monitorMax = Number(process.env.CSKH_MONITOR_MAX_CONVERSATIONS || 10);
    auditMax = Number(process.env.CSKH_AUDIT_MAX_CONVERSATIONS || 0);
    auditConcurrency = Number(process.env.CSKH_AUDIT_CONCURRENCY || 24);
    auditFetchConcurrency = Number(process.env.CSKH_AUDIT_FETCH_CONCURRENCY || 18);
    auditPageConcurrency = Number(process.env.CSKH_AUDIT_PAGE_CONCURRENCY || 2);
    auditMsgLimit = Number(process.env.CSKH_AUDIT_MSG_LIMIT || 300);
    auditAiTranscriptMax = Number(process.env.CSKH_AUDIT_AI_TRANSCRIPT_MAX || 100);
    auditProgressEvery = Math.max(1, Number(process.env.CSKH_AUDIT_PROGRESS_EVERY || 40));
    monitorMaxPages = Number(process.env.CSKH_MONITOR_MAX_PAGES || 10);
    monitorPageConcurrency = Number(process.env.CSKH_MONITOR_PAGE_CONCURRENCY || 3);
    monitorMsgConcurrency = Number(process.env.CSKH_MONITOR_MSG_CONCURRENCY || 8);
    constructor(prisma, aiService, graph, config) {
        this.prisma = prisma;
        this.aiService = aiService;
        this.graph = graph;
        this.config = config;
    }
    async onModuleInit() {
        const n = await this.prisma.cskhJobRun.updateMany({
            where: { status: 'running' },
            data: {
                status: 'failed',
                error: 'Server khởi động lại — vui lòng chạy job mới',
                finishedAt: new Date(),
            },
        });
        if (n.count > 0) {
            this.logger.warn(`Đã hủy ${n.count} CSKH job kẹt do server restart`);
        }
    }
    async cancelRunningJobs(type, reason = 'Đã hủy bởi người dùng') {
        const result = await this.prisma.cskhJobRun.updateMany({
            where: { type, status: 'running' },
            data: { status: 'failed', error: reason, finishedAt: new Date() },
        });
        return result.count;
    }
    async requestAuditPause() {
        const job = await this.findRunningJob('audit');
        if (!job) {
            return { paused: false, message: 'Không có job audit đang chạy' };
        }
        await this.updateJobProgress(job.id, { pauseRequested: true });
        this.logger.log(`Audit pause requested job=${job.id.slice(0, 8)}`);
        return { paused: true, jobId: job.id };
    }
    async isAuditJobCancelled(jobId) {
        const job = await this.prisma.cskhJobRun.findUnique({
            where: { id: jobId },
            select: { status: true },
        });
        return !job || job.status !== 'running';
    }
    async shouldStopAuditJob(jobId) {
        const job = await this.prisma.cskhJobRun.findUnique({
            where: { id: jobId },
            select: { status: true, summary: true },
        });
        if (!job || job.status !== 'running')
            return true;
        return Boolean(job.summary?.pauseRequested);
    }
    async loadAuditedConversationKeys(auditDateFrom, auditDateTo, pageIds) {
        if (!pageIds.length)
            return new Set();
        const rows = await this.prisma.$queryRaw `
      SELECT
        metadata->>'conversationId' AS "conversationId",
        metadata->>'pageId' AS "pageId",
        metadata->>'participantPsid' AS "participantPsid"
      FROM chat_audits
      WHERE metadata->>'pageId' = ANY(${pageIds}::text[])
        AND (
          (
            metadata->>'auditDateFrom' = ${auditDateFrom}
            AND metadata->>'auditDateTo' = ${auditDateTo}
          )
          OR (
            ${auditDateFrom} = ${auditDateTo}
            AND metadata->>'auditDate' = ${auditDateFrom}
            AND COALESCE(metadata->>'auditDateFrom', '') = ''
          )
        )
    `;
        const keys = new Set();
        for (const row of rows) {
            const pageId = row.pageId?.trim();
            if (!pageId)
                continue;
            const convId = row.conversationId?.trim();
            const psid = row.participantPsid?.trim();
            if (convId)
                keys.add(`${pageId}:conv:${convId}`);
            if (psid)
                keys.add(`${pageId}:psid:${psid}`);
        }
        return keys;
    }
    isConversationAlreadyAudited(keys, pageId, conv) {
        if (keys.has(`${pageId}:conv:${conv.id}`))
            return true;
        const psid = this.graph.resolveParticipantPsid(conv.participants, pageId);
        return Boolean(psid && keys.has(`${pageId}:psid:${psid}`));
    }
    async loadInboxAdMaps(pageIds) {
        const byPage = new Map();
        if (!pageIds.length)
            return byPage;
        const rows = await this.prisma.cskhInboxConversation.findMany({
            where: { pageId: { in: pageIds } },
            select: {
                pageId: true,
                participantPsid: true,
                fromAd: true,
                adId: true,
                adTitle: true,
                referralSource: true,
            },
        });
        for (const row of rows) {
            const psid = row.participantPsid?.trim();
            if (!psid)
                continue;
            let map = byPage.get(row.pageId);
            if (!map) {
                map = new Map();
                byPage.set(row.pageId, map);
            }
            map.set(psid, {
                fromAd: row.fromAd,
                adId: row.adId,
                adTitle: row.adTitle,
                referralSource: row.referralSource,
            });
        }
        return byPage;
    }
    async failGhostJobIfNeeded(job, auditCount) {
        if (job.status !== 'running')
            return false;
        const ageMs = Date.now() - job.startedAt.getTime();
        const summary = job.summary ?? {};
        const phase = String(summary.phase ?? '');
        const total = Number(summary.total ?? 0);
        const processed = Number(summary.processed ?? 0);
        const fetched = Number(summary.fetched ?? 0);
        if (phase === 'audit' && total > 0) {
            if (ageMs > 60 * 60_000 && processed === 0 && auditCount === 0) {
                await this.prisma.cskhJobRun.update({
                    where: { id: job.id },
                    data: {
                        status: 'failed',
                        error: 'Job quá hạn — AI không phản hồi',
                        finishedAt: new Date(),
                    },
                });
                this.logger.warn(`Hủy audit job ${job.id.slice(0, 8)} — AI timeout (${Math.round(ageMs / 1000)}s)`);
                return true;
            }
            return false;
        }
        if (ageMs < 120_000)
            return false;
        const noProgress = auditCount === 0 && fetched === 0 && processed === 0;
        if (!noProgress)
            return false;
        await this.prisma.cskhJobRun.update({
            where: { id: job.id },
            data: {
                status: 'failed',
                error: 'Job treo — không có tiến trình (thử Chạy lại)',
                finishedAt: new Date(),
            },
        });
        this.logger.warn(`Hủy ghost job ${job.id.slice(0, 8)} (phase=${phase}, age ${Math.round(ageMs / 1000)}s)`);
        return true;
    }
    frontendUrl() {
        return this.config.get('FRONTEND_URL', 'http://localhost:5173').replace(/\/$/, '');
    }
    defaultOAuthReturnUrl() {
        return `${this.frontendUrl()}/cskh-quality?tab=config`;
    }
    getOAuthStartUrl(returnUrl) {
        if (!(0, facebook_oauth_util_1.getFacebookAppId)() || !(0, facebook_oauth_util_1.getFacebookAppSecret)()) {
            throw new common_1.ServiceUnavailableException('Chưa cấu hình FB_APP_ID và FB_APP_SECRET trên BE');
        }
        return (0, facebook_oauth_util_1.buildFacebookOAuthUrl)(returnUrl?.trim() || this.defaultOAuthReturnUrl());
    }
    async listPages() {
        const pageListSelect = {
            pageId: true,
            pageName: true,
            enabled: true,
            updatedAt: true,
            metadata: true,
        };
        let rows = await this.prisma.facebookCskhConfig.findMany({
            orderBy: [{ enabled: 'desc' }, { pageName: 'asc' }],
            select: pageListSelect,
        });
        const missingPictureIds = rows
            .filter((r) => !this.pagePictureUrl(r.metadata))
            .map((r) => r.pageId);
        if (missingPictureIds.length) {
            void this.enrichPagePictures(missingPictureIds).catch((e) => this.logger.warn(`enrichPagePictures: ${e.message}`));
        }
        const oauth = await this.prisma.facebookOAuthSession.findFirst({
            orderBy: { updatedAt: 'desc' },
            select: { fbUserId: true, fbUserName: true, tokenExpiresAt: true, updatedAt: true },
        });
        return {
            pages: rows.map((row) => ({
                pageId: row.pageId,
                pageName: row.pageName,
                enabled: row.enabled,
                updatedAt: row.updatedAt,
                pagePictureUrl: this.pagePictureUrl(row.metadata),
                metadata: row.metadata,
            })),
            oauthConnected: Boolean(oauth),
            oauthUser: oauth?.fbUserName || oauth?.fbUserId || null,
            oauthUpdatedAt: oauth?.updatedAt || null,
            oauthExpiresAt: oauth?.tokenExpiresAt || null,
        };
    }
    pagePictureUrl(metadata) {
        if (!metadata || typeof metadata !== 'object')
            return null;
        const url = metadata.pictureUrl;
        return typeof url === 'string' && url.startsWith('http') ? url : null;
    }
    async enrichPagePictures(pageIds) {
        if (!pageIds.length)
            return;
        const batchSize = 12;
        for (let i = 0; i < pageIds.length; i += batchSize) {
            const chunk = pageIds.slice(i, i + batchSize);
            const configs = await this.prisma.facebookCskhConfig.findMany({
                where: { pageId: { in: chunk } },
                select: { pageId: true, pageAccessToken: true, metadata: true },
            });
            await Promise.all(configs.map(async (cfg) => {
                const url = await this.graph.getPagePictureUrl(cfg.pageId, cfg.pageAccessToken);
                if (!url)
                    return;
                const prev = cfg.metadata || {};
                await this.prisma.facebookCskhConfig.update({
                    where: { pageId: cfg.pageId },
                    data: {
                        metadata: { ...prev, pictureUrl: url },
                    },
                });
            }));
        }
    }
    async savePageConfig(data) {
        const pageId = data.pageId?.trim();
        const token = data.pageAccessToken?.trim();
        if (!pageId || !/^\d+$/.test(pageId)) {
            throw new common_1.BadRequestException('pageId phải là số (Facebook Page ID)');
        }
        if (!token || token.length < 20) {
            throw new common_1.BadRequestException('pageAccessToken không hợp lệ');
        }
        const metadataJson = data.metadata === undefined ? undefined : data.metadata;
        const row = await this.prisma.facebookCskhConfig.upsert({
            where: { pageId },
            create: {
                pageId,
                pageName: data.pageName?.trim() || null,
                pageAccessToken: token,
                enabled: true,
                metadata: metadataJson,
            },
            update: {
                pageName: data.pageName?.trim() || undefined,
                pageAccessToken: token,
                metadata: metadataJson,
            },
        });
        await this.subscribePageToWebhook(pageId, token).catch((e) => {
            this.logger.error(`Auto subscribe failed for page ${pageId}: ${e.message}`);
        });
        return {
            pageId: row.pageId,
            pageName: row.pageName,
            enabled: row.enabled,
            updatedAt: row.updatedAt,
        };
    }
    async setPageEnabled(pageId, enabled) {
        const row = await this.prisma.facebookCskhConfig.update({
            where: { pageId },
            data: { enabled },
        });
        return { pageId: row.pageId, enabled: row.enabled };
    }
    async setPagesEnabledBulk(enabled, pageIds) {
        const where = pageIds?.length ? { pageId: { in: pageIds.map((id) => id.trim()) } } : {};
        const result = await this.prisma.facebookCskhConfig.updateMany({
            where,
            data: { enabled },
        });
        return { updated: result.count, enabled };
    }
    async deletePage(pageId) {
        await this.prisma.facebookCskhConfig.delete({ where: { pageId } });
        return { ok: true, pageId };
    }
    async exchangeCodeForUserToken(code) {
        const redirectUri = (0, facebook_oauth_util_1.getFacebookOAuthRedirectUri)();
        const shortRes = await axios_1.default.get(`${facebook_oauth_util_1.GRAPH_BASE}/oauth/access_token`, {
            params: {
                client_id: (0, facebook_oauth_util_1.getFacebookAppId)(),
                client_secret: (0, facebook_oauth_util_1.getFacebookAppSecret)(),
                redirect_uri: redirectUri,
                code,
            },
            timeout: 30000,
        });
        const shortToken = shortRes.data?.access_token;
        if (!shortToken)
            throw new common_1.BadRequestException('Meta không trả access_token');
        const longRes = await axios_1.default.get(`${facebook_oauth_util_1.GRAPH_BASE}/oauth/access_token`, {
            params: {
                grant_type: 'fb_exchange_token',
                client_id: (0, facebook_oauth_util_1.getFacebookAppId)(),
                client_secret: (0, facebook_oauth_util_1.getFacebookAppSecret)(),
                fb_exchange_token: shortToken,
            },
            timeout: 30000,
        });
        const longToken = longRes.data?.access_token;
        if (!longToken)
            throw new common_1.BadRequestException('Không đổi được long-lived token');
        return longToken;
    }
    async fetchManagedPages(userAccessToken) {
        const pages = [];
        let nextUrl = `${facebook_oauth_util_1.GRAPH_BASE}/me/accounts`;
        let useParams = true;
        const params = {
            fields: 'id,name,access_token,tasks,picture{url}',
            limit: 100,
            access_token: userAccessToken,
        };
        while (nextUrl) {
            const res = await axios_1.default.get(nextUrl, {
                params: useParams ? params : undefined,
                timeout: 60000,
            });
            useParams = false;
            const body = res.data;
            if (Array.isArray(body.data))
                pages.push(...body.data);
            nextUrl = body.paging?.next ?? null;
        }
        return pages;
    }
    async upsertPagesFromAccounts(accounts, source) {
        let saved = 0;
        for (const acc of accounts) {
            if (!acc.id || !acc.access_token)
                continue;
            const canMessage = !acc.tasks?.length || acc.tasks.includes('MESSAGING');
            const pictureUrl = acc.picture?.data?.url ?? null;
            const existing = await this.prisma.facebookCskhConfig.findUnique({
                where: { pageId: acc.id },
                select: { metadata: true },
            });
            const prevMeta = existing?.metadata || {};
            const meta = {
                ...prevMeta,
                connectedVia: source,
                tasks: acc.tasks || [],
                ...(pictureUrl ? { pictureUrl } : {}),
                refreshedAt: new Date().toISOString(),
            };
            await this.prisma.facebookCskhConfig.upsert({
                where: { pageId: acc.id },
                create: {
                    pageId: acc.id,
                    pageName: acc.name || null,
                    pageAccessToken: acc.access_token,
                    enabled: canMessage,
                    metadata: {
                        connectedVia: source,
                        tasks: acc.tasks || [],
                        ...(pictureUrl ? { pictureUrl } : {}),
                    },
                },
                update: {
                    pageName: acc.name || undefined,
                    pageAccessToken: acc.access_token,
                    enabled: canMessage,
                    metadata: meta,
                },
            });
            await this.subscribePageToWebhook(acc.id, acc.access_token).catch((e) => {
                this.logger.error(`Auto subscribe failed for page ${acc.id} via OAuth: ${e.message}`);
            });
            saved++;
        }
        return saved;
    }
    async handleOAuthCallback(code, state) {
        const parsed = (0, facebook_oauth_util_1.verifyOAuthState)(state);
        if (!parsed)
            throw new common_1.BadRequestException('OAuth state không hợp lệ');
        const userAccessToken = await this.exchangeCodeForUserToken(code);
        const meRes = await axios_1.default.get(`${facebook_oauth_util_1.GRAPH_BASE}/me`, {
            params: { fields: 'id,name', access_token: userAccessToken },
            timeout: 30000,
        });
        const fbUserId = String(meRes.data?.id || '');
        const fbUserName = meRes.data?.name || null;
        if (!fbUserId)
            throw new common_1.BadRequestException('Không lấy được Facebook user id');
        const accounts = await this.fetchManagedPages(userAccessToken);
        if (!accounts.length) {
            throw new common_1.BadRequestException('Tài khoản Facebook không có Page nào — cần quyền quản trị Page trong Business Manager');
        }
        await this.prisma.facebookOAuthSession.upsert({
            where: { fbUserId },
            create: {
                fbUserId,
                fbUserName,
                userAccessToken,
                metadata: { pageCount: accounts.length },
            },
            update: {
                fbUserName,
                userAccessToken,
                metadata: {
                    pageCount: accounts.length,
                    reconnectedAt: new Date().toISOString(),
                },
            },
        });
        const saved = await this.upsertPagesFromAccounts(accounts, 'oauth');
        this.logger.log(`Facebook OAuth: ${saved} pages for user ${fbUserName || fbUserId}`);
        return {
            returnUrl: parsed.returnUrl || this.defaultOAuthReturnUrl(),
            pageCount: saved,
            fbUserName,
        };
    }
    async refreshPagesFromOAuth() {
        const session = await this.prisma.facebookOAuthSession.findFirst({
            orderBy: { updatedAt: 'desc' },
        });
        if (!session) {
            throw new common_1.NotFoundException('Chưa kết nối OAuth — bấm "Kết nối Facebook" trước');
        }
        const accounts = await this.fetchManagedPages(session.userAccessToken);
        const saved = await this.upsertPagesFromAccounts(accounts, 'refresh');
        return { pageCount: saved, oauthUser: session.fbUserName || session.fbUserId };
    }
    async enabledPages() {
        return this.prisma.facebookCskhConfig.findMany({
            where: { enabled: true },
            orderBy: { pageName: 'asc' },
            select: { pageId: true, pageName: true, pageAccessToken: true },
        });
    }
    async allPages() {
        return this.prisma.facebookCskhConfig.findMany({
            orderBy: { pageName: 'asc' },
            select: { pageId: true, pageName: true, pageAccessToken: true },
        });
    }
    async createJob(type) {
        const initialSummary = type === 'audit'
            ? { phase: 'fetch', fetched: 0, pagesProcessed: 0, pagesTotal: 0 }
            : undefined;
        return this.prisma.cskhJobRun.create({
            data: { type, status: 'running', summary: initialSummary },
        });
    }
    async releaseStaleJobs(type, maxAgeMs = 30 * 60 * 1000) {
        const cutoff = new Date(Date.now() - maxAgeMs);
        await this.prisma.cskhJobRun.updateMany({
            where: { type, status: 'running', startedAt: { lt: cutoff } },
            data: {
                status: 'failed',
                error: 'Job quá hạn — đã hủy tự động (có thể do AI service bị tắt)',
                finishedAt: new Date(),
            },
        });
    }
    async findRunningJob(type) {
        return this.prisma.cskhJobRun.findFirst({
            where: { type, status: 'running' },
            orderBy: { startedAt: 'desc' },
        });
    }
    async getRunningJob(type) {
        const running = await this.findRunningJob(type);
        if (!running)
            return null;
        return this.getJob(running.id);
    }
    async updateJobProgress(jobId, summary) {
        const existing = await this.prisma.cskhJobRun.findUnique({
            where: { id: jobId },
            select: { summary: true, status: true },
        });
        if (!existing || existing.status !== 'running')
            return existing;
        const merged = {
            ...(existing.summary ?? {}),
            ...summary,
        };
        return this.prisma.cskhJobRun.update({
            where: { id: jobId },
            data: { summary: merged },
        });
    }
    async runWithConcurrency(items, concurrency, fn) {
        await this.runWithConcurrencyStoppable(items, concurrency, fn, async () => false);
    }
    async runWithConcurrencyStoppable(items, concurrency, fn, shouldStop) {
        if (!items.length)
            return { stoppedEarly: false };
        let stoppedEarly = false;
        let nextIndex = 0;
        const workerCount = Math.min(Math.max(concurrency, 1), items.length);
        const workers = Array.from({ length: workerCount }, async () => {
            while (true) {
                if (await shouldStop()) {
                    stoppedEarly = true;
                    return;
                }
                if (nextIndex >= items.length)
                    return;
                const index = nextIndex++;
                await fn(items[index], index);
            }
        });
        await Promise.all(workers);
        if (!stoppedEarly && (await shouldStop()))
            stoppedEarly = true;
        return { stoppedEarly };
    }
    async finishJob(jobId, status, summary, error) {
        const existing = await this.prisma.cskhJobRun.findUnique({
            where: { id: jobId },
            select: { summary: true },
        });
        const merged = {
            ...(existing?.summary ?? {}),
            ...(summary ?? {}),
        };
        return this.prisma.cskhJobRun.update({
            where: { id: jobId },
            data: {
                status,
                summary: merged,
                error: error ? (0, user_facing_error_util_1.toUserFacingError)(error) : null,
                finishedAt: new Date(),
            },
        });
    }
    async getJob(jobId) {
        const job = await this.prisma.cskhJobRun.findUnique({
            where: { id: jobId },
            include: {
                monitorItems: {
                    where: { needsReply: true },
                    orderBy: { updatedAt: 'desc' },
                },
            },
        });
        if (!job)
            throw new common_1.NotFoundException('Job không tồn tại');
        return {
            ...job,
            error: job.error ? (0, user_facing_error_util_1.toUserFacingError)(job.error) : null,
        };
    }
    async getLatestMonitor() {
        const job = await this.prisma.cskhJobRun.findFirst({
            where: { type: 'monitor', status: 'done' },
            orderBy: { finishedAt: 'desc' },
            include: {
                monitorItems: { where: { needsReply: true }, orderBy: { updatedAt: 'desc' } },
            },
        });
        return job;
    }
    buildMonitorItem(config, pageName, conv, messages) {
        let { customerName } = this.graph.participantInfo(conv.participants, config.pageId);
        if (customerName === 'Khách hàng' && messages.length) {
            const fromCustomer = messages.find((m) => String(m.from?.id) !== String(config.pageId));
            customerName = fromCustomer?.from?.name || customerName;
        }
        const noReply = this.graph.needsReply(messages, config.pageId);
        return {
            pageId: config.pageId,
            pageName,
            conversationId: conv.id,
            customerName,
            lastMessage: messages[0]?.message || null,
            needsReply: noReply,
            updatedAt: conv.updated_time ? new Date(conv.updated_time) : null,
        };
    }
    async fetchMonitorConversations(pageId, token, maxCount) {
        try {
            return await this.graph.fetchConversationsForMonitor(pageId, token, maxCount);
        }
        catch (e) {
            this.logger.warn(`Monitor fallback N+1 cho Page ${pageId}: ${e.message}`);
            const conversations = await this.graph.fetchConversations(pageId, token, maxCount);
            await this.runWithConcurrency(conversations, this.monitorMsgConcurrency, async (conv) => {
                try {
                    const messages = await this.graph.fetchMessages(conv.id, token, 1);
                    conv.messages = { data: messages };
                }
                catch (err) {
                    this.logger.warn(`Không đọc messages ${conv.id}: ${err.message}`);
                    conv.messages = { data: [] };
                }
            });
            return conversations;
        }
    }
    async runMonitorJob(jobId, maxConversations) {
        const maxFetch = maxConversations ?? this.monitorMax;
        try {
            const pages = await this.enabledPages();
            if (!pages.length) {
                throw new common_1.BadRequestException('Chưa có Page nào được bật');
            }
            if (pages.length > this.monitorMaxPages) {
                throw new common_1.BadRequestException(`Đang bật ${pages.length} Page — tối đa ${this.monitorMaxPages} Page/lần. Vào tab Cấu hình, tắt Page không cần monitor.`);
            }
            let totalConversations = 0;
            let totalNoReply = 0;
            const items = [];
            let pageErrors = 0;
            let pagesProcessed = 0;
            await this.updateJobProgress(jobId, {
                phase: 'scanning',
                pagesTotal: pages.length,
                pagesProcessed: 0,
                maxConversationsPerPage: maxFetch,
            });
            await this.runWithConcurrency(pages, this.monitorPageConcurrency, async (config) => {
                try {
                    const pageName = config.pageName;
                    const conversations = await this.fetchMonitorConversations(config.pageId, config.pageAccessToken, maxFetch);
                    totalConversations += conversations.length;
                    const pageItems = conversations.map((conv) => {
                        const messages = this.graph.latestMessages(conv);
                        const item = this.buildMonitorItem(config, pageName, conv, messages);
                        if (item.needsReply)
                            totalNoReply++;
                        return item;
                    });
                    items.push(...pageItems);
                    if (pageItems.length) {
                        await this.prisma.cskhMonitorItem.createMany({
                            data: pageItems.map((item) => ({
                                jobRunId: jobId,
                                pageId: item.pageId,
                                pageName: item.pageName,
                                conversationId: item.conversationId,
                                customerName: item.customerName,
                                lastMessage: item.lastMessage,
                                needsReply: item.needsReply,
                                updatedAt: item.updatedAt,
                            })),
                        });
                    }
                }
                catch (e) {
                    pageErrors++;
                    this.logger.warn(`Monitor bỏ qua Page ${config.pageName || config.pageId}: ${e.message}`);
                }
                finally {
                    pagesProcessed++;
                    await this.updateJobProgress(jobId, {
                        phase: 'scanning',
                        pagesTotal: pages.length,
                        pagesProcessed,
                        currentPage: config.pageName || config.pageId,
                        totalConversations,
                        totalNoReply,
                        pageErrors,
                        maxConversationsPerPage: maxFetch,
                    });
                    this.logger.log(`Monitor job ${jobId.slice(0, 8)}: ${pagesProcessed}/${pages.length} Page (${config.pageName || config.pageId})`);
                }
            });
            if (!items.length && pageErrors > 0) {
                throw new common_1.BadRequestException(`Không đọc được inbox — thiếu quyền pages_read_engagement. Meta App → Permissions → bật quyền, rồi OAuth lại.`);
            }
            await this.finishJob(jobId, 'done', {
                totalConversations,
                totalNoReply,
                pageCount: pages.length,
                pageErrors,
                maxConversationsPerPage: maxFetch,
            });
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await this.finishJob(jobId, 'failed', undefined, msg);
            this.logger.error(`Monitor job ${jobId} failed: ${msg}`);
        }
    }
    async runAuditJob(jobId, options) {
        const auditDateFrom = (options.auditDateFrom || options.auditDate || '').trim();
        const auditDateTo = (options.auditDateTo || options.auditDateFrom || options.auditDate || '')
            .trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(auditDateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(auditDateTo)) {
            throw new common_1.BadRequestException('Ngày bắt đầu / kết thúc không hợp lệ (YYYY-MM-DD)');
        }
        if (auditDateFrom > auditDateTo) {
            throw new common_1.BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
        }
        const maxConversations = options.maxConversations;
        const force = Boolean(options.force);
        const pageId = options.pageId;
        const cap = maxConversations && maxConversations > 0
            ? maxConversations
            : this.auditMax > 0
                ? this.auditMax
                : 0;
        try {
            let pages = await this.allPages();
            if (!pageId?.trim()) {
                throw new common_1.BadRequestException('Bắt buộc chọn kênh (page) để chấm điểm');
            }
            pages = pages.filter((p) => p.pageId === pageId.trim());
            if (!pages.length) {
                throw new common_1.BadRequestException('Kênh không tồn tại — kết nối lại Facebook ở tab Cài đặt');
            }
            const pageIds = pages.map((p) => p.pageId);
            const auditedKeys = force
                ? new Set()
                : await this.loadAuditedConversationKeys(auditDateFrom, auditDateTo, pageIds);
            const tasks = [];
            let skippedAlready = 0;
            let pausedDuringFetch = false;
            const rangeLabel = auditDateFrom === auditDateTo
                ? auditDateFrom
                : `${auditDateFrom} → ${auditDateTo}`;
            await this.updateJobProgress(jobId, {
                phase: 'fetch',
                auditDate: auditDateFrom,
                auditDateFrom,
                auditDateTo,
                pageId: pageId.trim(),
                maxConversations: cap > 0 ? cap : null,
                fetched: 0,
                scanned: 0,
                pagesTotal: pages.length,
                pagesProcessed: 0,
                skippedAlready,
                force,
            });
            const pageOutcomes = new Array(pages.length);
            let pagesFetchDone = 0;
            let lastFetchProgressMs = 0;
            const reportFetchProgress = async (patch, force = false) => {
                const now = Date.now();
                if (!force && now - lastFetchProgressMs < 2500)
                    return;
                lastFetchProgressMs = now;
                await this.updateJobProgress(jobId, {
                    phase: 'fetch',
                    auditDate: auditDateFrom,
                    auditDateFrom,
                    auditDateTo,
                    pagesTotal: pages.length,
                    skippedAlready,
                    ...patch,
                });
            };
            const { stoppedEarly: pausedDuringFetchPages } = await this.runWithConcurrencyStoppable(pages.map((config, pageIndex) => ({ config, pageIndex })), this.auditPageConcurrency, async ({ config, pageIndex }) => {
                const pageName = config.pageName || config.pageId;
                await reportFetchProgress({
                    fetched: tasks.length,
                    pagesProcessed: pagesFetchDone,
                    currentPage: pageName,
                });
                let skippedOnPage = 0;
                const conversations = await this.graph.fetchConversationsForAuditByDate(config.pageId, config.pageAccessToken, auditDateFrom, auditDateTo, this.auditMsgLimit, async (scanned, matchedOnPage) => {
                    const queuedSoFar = pageOutcomes.reduce((n, o) => n + (o?.tasks.length ?? 0), 0);
                    await reportFetchProgress({
                        fetched: queuedSoFar + matchedOnPage,
                        scanned,
                        pagesProcessed: pagesFetchDone,
                        currentPage: pageName,
                        skippedAlready,
                        maxConversations: cap > 0 ? cap : null,
                    });
                }, this.auditFetchConcurrency, () => this.shouldStopAuditJob(jobId), (conv) => {
                    if (this.isConversationAlreadyAudited(auditedKeys, config.pageId, conv)) {
                        skippedOnPage++;
                        return 'exclude';
                    }
                    return 'include';
                }, cap > 0 ? cap : 0);
                const pageTaskList = conversations.map((conv) => ({ config, conv }));
                pageOutcomes[pageIndex] = { tasks: pageTaskList, skippedOnPage };
                pagesFetchDone++;
                this.logger.log(`Audit job ${jobId.slice(0, 8)}: Page ${pageName} — ${rangeLabel}: chấm ${pageTaskList.length} cuộc mới` +
                    (cap > 0 ? ` (giới hạn ${cap})` : '') +
                    `, bỏ qua ${skippedOnPage} đã chấm`);
                const fetchedQueued = pageOutcomes.reduce((n, o) => n + (o?.tasks.length ?? 0), 0);
                await reportFetchProgress({
                    fetched: fetchedQueued,
                    pagesProcessed: pagesFetchDone,
                    currentPage: pageName,
                }, true);
            }, () => this.shouldStopAuditJob(jobId));
            pausedDuringFetch = pausedDuringFetchPages;
            if (await this.isAuditJobCancelled(jobId)) {
                this.logger.log(`Audit job ${jobId.slice(0, 8)}: đã hủy khi quét inbox`);
                return;
            }
            for (const outcome of pageOutcomes) {
                if (!outcome)
                    continue;
                tasks.push(...outcome.tasks);
                skippedAlready += outcome.skippedOnPage;
            }
            if (!tasks.length) {
                if (skippedAlready > 0) {
                    await this.finishJob(jobId, 'done', {
                        auditDate: auditDateFrom,
                        auditDateFrom,
                        auditDateTo,
                        skippedAlready,
                        allAlreadyAudited: true,
                        pageCount: pages.length,
                    });
                    return;
                }
                if (pausedDuringFetch) {
                    await this.finishJob(jobId, 'done', {
                        auditDate: auditDateFrom,
                        auditDateFrom,
                        auditDateTo,
                        paused: true,
                        partial: true,
                        audited: 0,
                        skippedAlready,
                        pageCount: pages.length,
                    });
                    return;
                }
                throw new common_1.BadRequestException(`Không có hội thoại nào trong khoảng ${rangeLabel}`);
            }
            let audited = 0;
            let errors = 0;
            let processed = 0;
            const scores = [];
            let totalPromptTokens = 0;
            let totalCompletionTokens = 0;
            let totalTokens = 0;
            let tokenModel = 'deepseek-chat';
            const inboxAdMaps = await this.loadInboxAdMaps(pageIds);
            this.aiService.resetAuditBatchCaches();
            await this.updateJobProgress(jobId, {
                phase: 'audit',
                auditDate: auditDateFrom,
                auditDateFrom,
                auditDateTo,
                pagesTotal: pages.length,
                pagesProcessed: pages.length,
                fetched: tasks.length,
                total: tasks.length,
                processed: 0,
                audited: 0,
                errors: 0,
                skippedAlready,
                pauseRequested: false,
            });
            const auditOne = async ({ config, conv }) => {
                if (await this.shouldStopAuditJob(jobId))
                    return;
                const pageName = config.pageName || 'Facebook Page';
                const messages = this.graph.latestMessages(conv);
                const rangeMessages = this.graph.filterMessagesByDateRange(messages, auditDateFrom, auditDateTo);
                const dayMessages = rangeMessages;
                const staffAbsent = !this.graph.hasStaffMessage(rangeMessages, config.pageId);
                const needsFollowUp = this.graph.needsFollowUpOnDay(rangeMessages, config.pageId);
                const noReplyForAi = staffAbsent;
                const transcript = this.graph.messagesToTranscript(rangeMessages, config.pageId);
                const customerName = this.graph.resolveCustomerName(conv.participants, config.pageId, messages, transcript);
                const agentName = this.graph.resolveAgentName(messages, config.pageId, pageName, transcript);
                const participantPsid = this.graph.resolveParticipantPsid(conv.participants, config.pageId);
                const inboxAd = participantPsid
                    ? (inboxAdMaps.get(config.pageId)?.get(participantPsid) ?? null)
                    : null;
                const graphAd = (0, facebook_referral_util_1.detectAdFromFbMessages)(messages);
                const fromAd = Boolean(inboxAd?.fromAd || graphAd.fromAd);
                const adId = inboxAd?.adId ?? graphAd.adId ?? null;
                const adTitle = inboxAd?.adTitle ?? graphAd.adTitle ?? null;
                const referralSource = inboxAd?.referralSource ?? graphAd.referralSource ?? null;
                const fullTranscript = transcript.length > 0
                    ? transcript
                    : [{ sender: 'Customer', type: 'text', text: '(Không có tin nhắn)', timestamp: '' }];
                const aiTranscript = (0, audit_analytics_util_1.trimTranscriptForAi)(fullTranscript, this.auditAiTranscriptMax);
                const result = await this.aiService.auditChat({
                    transcript: fullTranscript,
                    aiTranscript,
                    agentName,
                    customerName,
                    channel: 'Facebook Messenger',
                    noReply: noReplyForAi,
                    metadata: {
                        jobRunId: jobId,
                        conversationId: conv.id,
                        pageId: config.pageId,
                        pageName,
                        participantPsid,
                        auditDate: auditDateFrom,
                        auditDateFrom,
                        auditDateTo,
                        auditDayMessageCount: dayMessages.length,
                        transcriptMessageCount: rangeMessages.length,
                        noReply: needsFollowUp || staffAbsent,
                        staffAbsent,
                        needsFollowUp,
                        fromAd,
                        adId,
                        adTitle,
                        referralSource,
                    },
                });
                if (result && typeof result === 'object' && 'error' in result && result.error) {
                    errors++;
                }
                else if (result && 'id' in result) {
                    audited++;
                    scores.push(Number(result.score) || 0);
                    const tu = result.tokenUsage;
                    if (tu) {
                        totalPromptTokens += Number(tu.prompt_tokens) || 0;
                        totalCompletionTokens += Number(tu.completion_tokens) || 0;
                        totalTokens += Number(tu.total_tokens) || 0;
                        if (tu.model)
                            tokenModel = tu.model;
                    }
                }
                processed++;
                const shouldUpdateProgress = processed === tasks.length || processed % this.auditProgressEvery === 0;
                if (shouldUpdateProgress) {
                    const tokenUsageSummary = {
                        model: tokenModel,
                        promptTokens: totalPromptTokens,
                        completionTokens: totalCompletionTokens,
                        totalTokens,
                        perAuditAvg: processed > 0 ? Math.round(totalTokens / processed) : 0,
                    };
                    await this.updateJobProgress(jobId, {
                        phase: 'audit',
                        auditDate: auditDateFrom,
                        auditDateFrom,
                        auditDateTo,
                        total: tasks.length,
                        processed,
                        audited,
                        errors,
                        skippedAlready,
                        avgScore: scores.length
                            ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
                            : 0,
                        currentCustomer: customerName,
                        tokenUsage: tokenUsageSummary,
                    });
                }
            };
            const { stoppedEarly: pausedDuringAudit } = await this.runWithConcurrencyStoppable(tasks, this.auditConcurrency, auditOne, () => this.shouldStopAuditJob(jobId));
            if (await this.isAuditJobCancelled(jobId)) {
                this.logger.log(`Audit job ${jobId.slice(0, 8)}: đã hủy khi chấm điểm`);
                return;
            }
            const paused = pausedDuringFetch || pausedDuringAudit;
            const avgScore = scores.length
                ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
                : 0;
            await this.finishJob(jobId, 'done', {
                audited,
                errors,
                avgScore,
                pageCount: pages.length,
                total: tasks.length,
                processed,
                auditDate: auditDateFrom,
                auditDateFrom,
                auditDateTo,
                skippedAlready,
                paused,
                partial: paused,
                remaining: paused ? Math.max(0, tasks.length - processed) : 0,
                tokenUsage: {
                    model: tokenModel,
                    promptTokens: totalPromptTokens,
                    completionTokens: totalCompletionTokens,
                    totalTokens,
                    perAuditAvg: processed > 0 ? Math.round(totalTokens / processed) : 0,
                },
            });
        }
        catch (e) {
            if (await this.isAuditJobCancelled(jobId)) {
                this.logger.log(`Audit job ${jobId.slice(0, 8)}: đã hủy (bỏ qua lỗi hậu kỳ)`);
                return;
            }
            const msg = e instanceof Error ? e.message : String(e);
            await this.finishJob(jobId, 'failed', undefined, msg);
            this.logger.error(`Audit job ${jobId} failed: ${msg}`);
        }
    }
    getDeepSeekBalance() {
        return this.aiService.getDeepSeekBalance();
    }
    async getAuditTokenStats() {
        const running = await this.findRunningJob('audit');
        if (running) {
            const summary = running.summary ?? {};
            const tokenUsage = summary.tokenUsage ?? null;
            return {
                source: 'running',
                jobId: running.id,
                finishedAt: running.finishedAt,
                tokenUsage,
            };
        }
        const lastDone = await this.prisma.cskhJobRun.findFirst({
            where: { type: 'audit', status: 'done' },
            orderBy: { finishedAt: 'desc' },
        });
        if (!lastDone) {
            return { source: 'none', jobId: null, finishedAt: null, tokenUsage: null };
        }
        const summary = lastDone.summary ?? {};
        return {
            source: 'lastJob',
            jobId: lastDone.id,
            finishedAt: lastDone.finishedAt,
            tokenUsage: summary.tokenUsage ?? null,
        };
    }
    async listAudits(params) {
        const limit = Math.min(params.limit ?? 100, 2000);
        if (params.jobRunId) {
            return this.listAuditsByJobRunId(params.jobRunId, limit);
        }
        const auditDateFrom = (params.auditDateFrom || params.auditDate || '').trim();
        const auditDateTo = (params.auditDateTo || params.auditDateFrom || params.auditDate || '').trim();
        const pageId = params.pageId?.trim();
        if (auditDateFrom && auditDateTo) {
            const rows = pageId
                ? await this.prisma.$queryRaw `
            SELECT id, agent_name AS "agentName", customer_name AS "customerName",
              channel, score, feedback, transcript, metadata, created_at AS "createdAt"
            FROM chat_audits
            WHERE metadata->>'pageId' = ${pageId}
              AND (
                (metadata->>'auditDateFrom' = ${auditDateFrom} AND metadata->>'auditDateTo' = ${auditDateTo})
                OR (
                  ${auditDateFrom} = ${auditDateTo}
                  AND metadata->>'auditDate' = ${auditDateFrom}
                  AND COALESCE(metadata->>'auditDateFrom', '') = ''
                )
              )
            ORDER BY created_at DESC
            LIMIT ${limit}
          `
                : await this.prisma.$queryRaw `
            SELECT id, agent_name AS "agentName", customer_name AS "customerName",
              channel, score, feedback, transcript, metadata, created_at AS "createdAt"
            FROM chat_audits
            WHERE (
                (metadata->>'auditDateFrom' = ${auditDateFrom} AND metadata->>'auditDateTo' = ${auditDateTo})
                OR (
                  ${auditDateFrom} = ${auditDateTo}
                  AND metadata->>'auditDate' = ${auditDateFrom}
                  AND COALESCE(metadata->>'auditDateFrom', '') = ''
                )
              )
            ORDER BY created_at DESC
            LIMIT ${limit}
          `;
            return this.attachAuditInboxContext(rows);
        }
        const filters = [
            ...(pageId ? [{ metadata: { path: ['pageId'], equals: pageId } }] : []),
        ];
        const rows = await this.prisma.chatAudit.findMany({
            where: filters.length ? { AND: filters } : undefined,
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
                id: true,
                agentName: true,
                customerName: true,
                channel: true,
                score: true,
                feedback: true,
                transcript: true,
                metadata: true,
                createdAt: true,
            },
        });
        return this.attachAuditInboxContext(rows);
    }
    async getAuditDayStats(auditDateFrom, auditDateTo, pageId) {
        const from = auditDateFrom.trim();
        const to = (auditDateTo?.trim() || from).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
            throw new common_1.BadRequestException('Ngày không hợp lệ (YYYY-MM-DD)');
        }
        const pid = pageId?.trim();
        const rows = pid
            ? await this.prisma.$queryRaw `
          SELECT
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE score >= 70)::bigint AS passed,
            COUNT(*) FILTER (WHERE score < 70)::bigint AS failed,
            COUNT(*) FILTER (WHERE COALESCE(metadata->>'fromAd', 'false') = 'true')::bigint AS from_ad
          FROM chat_audits
          WHERE metadata->>'pageId' = ${pid}
            AND (
              (metadata->>'auditDateFrom' = ${from} AND metadata->>'auditDateTo' = ${to})
              OR (
                ${from} = ${to}
                AND metadata->>'auditDate' = ${from}
                AND COALESCE(metadata->>'auditDateFrom', '') = ''
              )
            )
        `
            : await this.prisma.$queryRaw `
          SELECT
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE score >= 70)::bigint AS passed,
            COUNT(*) FILTER (WHERE score < 70)::bigint AS failed,
            COUNT(*) FILTER (WHERE COALESCE(metadata->>'fromAd', 'false') = 'true')::bigint AS from_ad
          FROM chat_audits
          WHERE (
              (metadata->>'auditDateFrom' = ${from} AND metadata->>'auditDateTo' = ${to})
              OR (
                ${from} = ${to}
                AND metadata->>'auditDate' = ${from}
                AND COALESCE(metadata->>'auditDateFrom', '') = ''
              )
            )
        `;
        const row = rows[0];
        return {
            auditDate: from,
            auditDateFrom: from,
            auditDateTo: to,
            pageId: pid ?? null,
            total: Number(row?.total ?? 0),
            passed: Number(row?.passed ?? 0),
            failed: Number(row?.failed ?? 0),
            fromAd: Number(row?.from_ad ?? 0),
        };
    }
    async getAuditComparisonStats(auditDate, auditId) {
        const day = auditDate.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
            throw new common_1.BadRequestException('Ngày audit không hợp lệ (YYYY-MM-DD)');
        }
        const audit = await this.prisma.chatAudit.findUnique({
            where: { id: auditId },
            select: { id: true, score: true, agentName: true, metadata: true },
        });
        if (!audit)
            throw new common_1.NotFoundException('Không tìm thấy audit');
        const meta = audit.metadata ?? {};
        const auditDay = String(meta.auditDate ?? '');
        if (auditDay && auditDay !== day) {
            throw new common_1.BadRequestException('auditDate không khớp với audit được chọn');
        }
        const pageName = typeof meta.pageName === 'string' ? meta.pageName : null;
        const agentName = audit.agentName?.trim() || null;
        const rows = await this.prisma.$queryRaw `
      SELECT
        score,
        agent_name,
        metadata->>'pageName' AS page_name
      FROM chat_audits
      WHERE metadata->>'auditDate' = ${day}
    `;
        const scores = rows.map((r) => r.score);
        const overall = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : audit.score;
        const staffRows = agentName && agentName !== 'Nhân viên'
            ? rows.filter((r) => (r.agent_name ?? '').trim() === agentName)
            : [audit];
        const staff = staffRows.length > 0
            ? Math.round(staffRows.reduce((a, r) => a + r.score, 0) / staffRows.length)
            : audit.score;
        const teamRows = pageName
            ? rows.filter((r) => (r.page_name ?? '').trim() === pageName)
            : rows;
        const team = teamRows.length > 0
            ? Math.round(teamRows.reduce((a, r) => a + r.score, 0) / teamRows.length)
            : overall;
        return {
            auditDate: day,
            auditId: audit.id,
            staff,
            team,
            overall,
            staffSampleSize: staffRows.length,
            teamSampleSize: teamRows.length,
            daySampleSize: scores.length,
        };
    }
    async getAuditScoreHistory(auditId) {
        const audit = await this.prisma.chatAudit.findUnique({
            where: { id: auditId },
            select: { id: true, score: true, metadata: true, createdAt: true },
        });
        if (!audit)
            throw new common_1.NotFoundException('Không tìm thấy audit');
        const meta = audit.metadata ?? {};
        const pageId = typeof meta.pageId === 'string' ? meta.pageId.trim() : '';
        const conversationId = typeof meta.conversationId === 'string' ? meta.conversationId.trim() : '';
        const participantPsid = typeof meta.participantPsid === 'string' ? meta.participantPsid.trim() : '';
        let rows = [];
        if (pageId && (conversationId || participantPsid)) {
            rows = await this.prisma.$queryRaw `
        SELECT
          id,
          score,
          metadata->>'auditDate' AS audit_date,
          created_at
        FROM chat_audits
        WHERE metadata->>'pageId' = ${pageId}
          AND (
            (${conversationId} <> '' AND metadata->>'conversationId' = ${conversationId})
            OR (${participantPsid} <> '' AND metadata->>'participantPsid' = ${participantPsid})
          )
        ORDER BY COALESCE(metadata->>'auditDate', '') ASC, created_at ASC
      `;
        }
        if (!rows.length) {
            const day = typeof meta.auditDate === 'string' ? meta.auditDate : '';
            return {
                auditId: audit.id,
                points: [
                    {
                        auditId: audit.id,
                        auditDate: day || audit.createdAt.toISOString().slice(0, 10),
                        score: audit.score,
                        label: day || 'Hiện tại',
                    },
                ],
            };
        }
        const byDay = new Map();
        for (const row of rows) {
            const auditDate = row.audit_date?.trim() || row.created_at.toISOString().slice(0, 10);
            byDay.set(auditDate, {
                auditId: row.id,
                auditDate,
                score: row.score,
            });
        }
        const points = [...byDay.values()].map((p) => ({
            ...p,
            label: p.auditDate,
        }));
        return { auditId: audit.id, points };
    }
    customerPictureFromMetadata(metadata) {
        if (!metadata || typeof metadata !== 'object')
            return null;
        const url = metadata.customerPictureUrl;
        return typeof url === 'string' && url.startsWith('http') ? url : null;
    }
    auditAdFromMetadata(metadata) {
        if (!metadata || typeof metadata !== 'object') {
            return { fromAd: false, adId: null, adTitle: null, referralSource: null };
        }
        const m = metadata;
        return {
            fromAd: Boolean(m.fromAd),
            adId: typeof m.adId === 'string' ? m.adId : null,
            adTitle: typeof m.adTitle === 'string' ? m.adTitle : null,
            referralSource: typeof m.referralSource === 'string' ? m.referralSource : null,
        };
    }
    async attachAuditInboxContext(rows) {
        const needInbox = [];
        const pictures = rows.map((row, index) => {
            const fromMeta = this.customerPictureFromMetadata(row.metadata);
            if (fromMeta)
                return fromMeta;
            const meta = row.metadata;
            if (meta?.pageId && meta?.participantPsid) {
                needInbox.push({ pageId: meta.pageId, psid: meta.participantPsid, index });
            }
            return null;
        });
        const adContext = rows.map((row) => this.auditAdFromMetadata(row.metadata));
        if (needInbox.length) {
            const inboxRows = await this.prisma.cskhInboxConversation.findMany({
                where: {
                    OR: needInbox.map((k) => ({
                        pageId: k.pageId,
                        participantPsid: k.psid,
                    })),
                },
                select: {
                    pageId: true,
                    participantPsid: true,
                    customerPictureUrl: true,
                    fromAd: true,
                    adId: true,
                    adTitle: true,
                    referralSource: true,
                },
            });
            const inboxMap = new Map(inboxRows.map((r) => [`${r.pageId}:${r.participantPsid}`, r]));
            for (const k of needInbox) {
                const inbox = inboxMap.get(`${k.pageId}:${k.psid}`);
                if (!inbox)
                    continue;
                const url = inbox.customerPictureUrl;
                if (typeof url === 'string' && url.startsWith('http')) {
                    pictures[k.index] = url;
                }
                if (!adContext[k.index].fromAd && inbox.fromAd) {
                    adContext[k.index] = {
                        fromAd: true,
                        adId: inbox.adId,
                        adTitle: inbox.adTitle,
                        referralSource: inbox.referralSource,
                    };
                }
            }
            const stillMissing = needInbox.filter((k) => !pictures[k.index]).slice(0, 20);
            await Promise.all(stillMissing.map(async (k) => {
                const url = await this.fetchAndCacheCustomerPicture(k.pageId, k.psid);
                if (url)
                    pictures[k.index] = url;
            }));
        }
        return rows.map((row, index) => ({
            ...row,
            customerPictureUrl: pictures[index],
            fromAd: adContext[index].fromAd,
            adId: adContext[index].adId,
            adTitle: adContext[index].adTitle,
            referralSource: adContext[index].referralSource,
        }));
    }
    async attachCustomerPictures(rows) {
        return this.attachAuditInboxContext(rows);
    }
    async fetchAndCacheCustomerPicture(pageId, psid) {
        const config = await this.prisma.facebookCskhConfig.findUnique({ where: { pageId } });
        if (!config?.pageAccessToken)
            return null;
        const profile = await this.graph.getMessengerUserProfile(psid, config.pageAccessToken);
        if (!profile.pictureUrl?.startsWith('http'))
            return null;
        await this.prisma.cskhInboxConversation
            .updateMany({
            where: { pageId, participantPsid: psid },
            data: {
                customerPictureUrl: profile.pictureUrl,
                customerName: profile.name ?? undefined,
            },
        })
            .catch(() => undefined);
        return profile.pictureUrl;
    }
    async proxyMediaUrl(rawUrl, res) {
        let url = (rawUrl || '').trim();
        if (!url) {
            throw new common_1.BadRequestException('Thiếu tham số url — URL phải encode đầy đủ (encodeURIComponent)');
        }
        if (!(0, facebook_message_util_1.isAllowedFacebookMediaUrl)(url)) {
            throw new common_1.BadRequestException('URL media không hợp lệ');
        }
        if (url.startsWith('http://')) {
            url = `https://${url.slice('http://'.length)}`;
        }
        const axios = (await import('axios')).default;
        const upstream = await axios.get(url, {
            responseType: 'stream',
            timeout: 30000,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'TalentManagement-CSKH/1.0',
                Referer: 'https://www.facebook.com/',
            },
        });
        res.set('Cache-Control', 'public, max-age=3600');
        res.set('Cross-Origin-Resource-Policy', 'cross-origin');
        const contentType = upstream.headers['content-type'];
        res.set('Content-Type', typeof contentType === 'string' ? contentType : 'application/octet-stream');
        upstream.data.pipe(res);
    }
    async proxyAvatarUrl(rawUrl, res) {
        return this.proxyMediaUrl(rawUrl, res);
    }
    async streamPageAvatar(pageId, res) {
        const pid = (pageId || '').trim();
        if (!pid || !/^\d+$/.test(pid)) {
            throw new common_1.BadRequestException('pageId không hợp lệ');
        }
        const config = await this.prisma.facebookCskhConfig.findUnique({ where: { pageId: pid } });
        if (!config?.pageAccessToken) {
            throw new common_1.NotFoundException('Page chưa liên kết');
        }
        const pictureUrl = await this.graph.getPagePictureUrl(pid, config.pageAccessToken);
        if (!pictureUrl?.startsWith('http')) {
            throw new common_1.NotFoundException('Không lấy được avatar Page');
        }
        const prev = config.metadata || {};
        await this.prisma.facebookCskhConfig
            .update({
            where: { pageId: pid },
            data: {
                metadata: { ...prev, pictureUrl },
            },
        })
            .catch(() => undefined);
        return this.proxyMediaUrl(pictureUrl, res);
    }
    async streamCustomerAvatar(pageId, psid, res) {
        const pid = (pageId || '').trim();
        const uid = (psid || '').trim();
        if (!pid || !uid)
            throw new common_1.BadRequestException('Thiếu pageId hoặc psid');
        const config = await this.prisma.facebookCskhConfig.findUnique({ where: { pageId: pid } });
        if (!config?.pageAccessToken)
            throw new common_1.NotFoundException('Page chưa liên kết');
        const profile = await this.graph.getMessengerUserProfile(uid, config.pageAccessToken);
        if (!profile.pictureUrl?.startsWith('http')) {
            throw new common_1.NotFoundException('Không lấy được avatar khách');
        }
        await this.prisma.cskhInboxConversation
            .updateMany({
            where: { pageId: pid, participantPsid: uid },
            data: {
                customerPictureUrl: profile.pictureUrl,
                customerName: profile.name ?? undefined,
            },
        })
            .catch(() => undefined);
        return this.proxyMediaUrl(profile.pictureUrl, res);
    }
    async listAuditsByJobRunId(jobRunId, limit) {
        const rows = await this.prisma.$queryRaw `
      SELECT
        id,
        agent_name AS "agentName",
        customer_name AS "customerName",
        channel,
        score,
        feedback,
        transcript,
        metadata,
        created_at AS "createdAt"
      FROM chat_audits
      WHERE metadata->>'jobRunId' = ${jobRunId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
        return this.attachCustomerPictures(rows);
    }
    async getAuditProgress(jobId) {
        let job = await this.prisma.cskhJobRun.findUnique({ where: { id: jobId } });
        if (!job)
            throw new common_1.NotFoundException('Job không tồn tại');
        let audits = await this.listAuditsByJobRunId(jobId, 500);
        if (await this.failGhostJobIfNeeded(job, audits.length)) {
            job = await this.prisma.cskhJobRun.findUnique({ where: { id: jobId } });
            if (!job)
                throw new common_1.NotFoundException('Job không tồn tại');
        }
        audits = await this.listAuditsByJobRunId(jobId, 500);
        const summary = job.summary ?? {};
        return {
            id: job.id,
            status: job.status,
            error: job.error ? (0, user_facing_error_util_1.toUserFacingError)(job.error) : null,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
            summary: {
                ...summary,
                auditCount: audits.length,
            },
            audits,
        };
    }
    async subscribePageToWebhook(pageId, pageAccessToken) {
        try {
            const url = `${facebook_oauth_util_1.GRAPH_BASE}/${pageId}/subscribed_apps`;
            const res = await axios_1.default.post(url, null, {
                params: {
                    subscribed_fields: 'messages,messaging_postbacks,messaging_optins,message_deliveries,message_reads,messaging_referrals',
                    access_token: pageAccessToken,
                },
                timeout: 10000,
            });
            this.logger.log(`Subscribed page ${pageId} to webhook successfully: ${JSON.stringify(res.data)}`);
            return res.data;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Unknown error';
            this.logger.error(`Failed to subscribe page ${pageId} to webhook: ${msg}`);
            if (axios_1.default.isAxiosError(e) && e.response) {
                this.logger.error(`Facebook error response for page ${pageId}: ${JSON.stringify(e.response.data)}`);
            }
            throw e;
        }
    }
};
exports.CskhService = CskhService;
exports.CskhService = CskhService = CskhService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        ai_service_1.AiService,
        facebook_graph_service_1.FacebookGraphService,
        config_1.ConfigService])
], CskhService);
//# sourceMappingURL=cskh.service.js.map