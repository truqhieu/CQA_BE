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
var AiService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = __importDefault(require("axios"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const prisma_service_1 = require("../prisma/prisma.service");
const audit_analytics_util_1 = require("../cskh/audit-analytics.util");
function normalizeAuditListField(value) {
    if (value == null)
        return null;
    if (Array.isArray(value)) {
        const lines = value.map((item) => String(item).trim()).filter(Boolean);
        return lines.length ? lines.join('\n') : null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
    }
    return null;
}
function parseActionItemsFromAi(actionItemsRaw, violationsRaw, suggestedRaw) {
    const fromPipeText = (text) => text
        .split(/\n+/)
        .map((line) => {
        const cleaned = line.replace(/^[\s•+\-–*]+/, '').trim();
        const sep = cleaned.indexOf('||');
        if (sep < 0)
            return null;
        const issue = cleaned.slice(0, sep).trim();
        const suggestedReply = cleaned.slice(sep + 2).trim();
        if (!issue || !suggestedReply)
            return null;
        return { issue, suggestedReply };
    })
        .filter((item) => item != null);
    if (typeof actionItemsRaw === 'string' && actionItemsRaw.trim()) {
        const parsed = fromPipeText(actionItemsRaw);
        if (parsed.length)
            return parsed;
    }
    if (Array.isArray(actionItemsRaw)) {
        const parsed = actionItemsRaw
            .map((item) => {
            if (!item || typeof item !== 'object')
                return null;
            const row = item;
            const issue = String(row.issue ?? row.violation ?? '').trim();
            const suggestedReply = String(row.suggested_reply ?? row.suggestedReply ?? '').trim();
            if (!issue || !suggestedReply)
                return null;
            return { issue, suggestedReply };
        })
            .filter((item) => item != null);
        if (parsed.length)
            return parsed;
    }
    const violationLines = normalizeAuditListField(violationsRaw)?.split(/\n+/).filter(Boolean) ?? [];
    const suggestionLines = normalizeAuditListField(suggestedRaw)?.split(/\n+/).filter(Boolean) ?? [];
    if (violationLines.length && suggestionLines.length) {
        const count = Math.max(violationLines.length, suggestionLines.length);
        return Array.from({ length: count }, (_, i) => ({
            issue: violationLines[i] ?? violationLines[violationLines.length - 1] ?? 'Cần cải thiện',
            suggestedReply: suggestionLines[i] ?? suggestionLines[suggestionLines.length - 1] ?? '',
        })).filter((item) => item.suggestedReply);
    }
    if (suggestionLines.length) {
        return suggestionLines.map((suggestedReply, i) => ({
            issue: violationLines[i] ?? `Gợi ý ${i + 1}`,
            suggestedReply,
        }));
    }
    return [];
}
let AiService = AiService_1 = class AiService {
    prisma;
    logger = new common_1.Logger(AiService_1.name);
    aiBaseUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    auditAiTimeoutMs = Number(process.env.CSKH_AUDIT_AI_TIMEOUT_MS || 120_000);
    aiHttp = axios_1.default.create({
        timeout: this.auditAiTimeoutMs,
        httpAgent: new http_1.default.Agent({ keepAlive: true, maxSockets: 64 }),
        httpsAgent: new https_1.default.Agent({ keepAlive: true, maxSockets: 64 }),
    });
    auditAgentUserCache = new Map();
    constructor(prisma) {
        this.prisma = prisma;
    }
    resetAuditBatchCaches() {
        this.auditAgentUserCache.clear();
    }
    async resolveAuditUserId(email, agentName) {
        const key = (email?.trim().toLowerCase() || agentName?.trim().toLowerCase() || '').trim();
        if (!key || key === 'nhân viên')
            return null;
        if (this.auditAgentUserCache.has(key)) {
            return this.auditAgentUserCache.get(key) ?? null;
        }
        let user = null;
        if (email?.trim()) {
            user = await this.prisma.user.findFirst({
                where: { email: { contains: email.trim(), mode: 'insensitive' } },
                select: { id: true },
            });
        }
        else if (agentName?.trim() && agentName.trim() !== 'Nhân viên') {
            user = await this.prisma.user.findFirst({
                where: { fullName: { contains: agentName.trim(), mode: 'insensitive' } },
                select: { id: true },
            });
        }
        const id = user?.id ?? null;
        this.auditAgentUserCache.set(key, id);
        return id;
    }
    async getDeepSeekBalance() {
        try {
            const { data } = await axios_1.default.get(`${this.aiBaseUrl}/deepseek/balance`, {
                timeout: 15000,
            });
            if (data?.error) {
                return { error: true, message: String(data.message || 'Không lấy được số dư DeepSeek API') };
            }
            return {
                isAvailable: Boolean(data.is_available),
                currency: String(data.currency || 'USD'),
                totalBalance: Number(data.total_balance) || 0,
                grantedBalance: Number(data.granted_balance) || 0,
                toppedUpBalance: Number(data.topped_up_balance) || 0,
                model: data.model ? String(data.model) : 'deepseek-chat',
            };
        }
        catch (error) {
            const err = error;
            this.logger.warn(`DeepSeek balance fetch failed: ${err.message}`);
            return { error: true, message: 'Không lấy được số dư DeepSeek API' };
        }
    }
    async auditChat(data) {
        try {
            this.logger.log(`Sending chat transcript to AI service for audit... noReply=${data.noReply}`);
            const response = await this.aiHttp.post(`${this.aiBaseUrl}/audit`, {
                transcript: data.aiTranscript ?? data.transcript,
                no_reply: data.noReply || false,
                agent_name: data.agentName || null,
                customer_name: data.customerName || null,
            });
            const auditResult = response.data;
            const tokenUsage = auditResult.token_usage ?? null;
            const transcriptArr = Array.isArray(data.transcript) ? data.transcript : [];
            const hasStaffInTranscript = transcriptArr.some((line) => line && typeof line === 'object' && line.sender === 'Staff');
            const forceZero = Boolean(data.noReply) || !hasStaffInTranscript;
            const pageName = String(data.metadata?.pageName || '');
            const isGenericCustomer = (n) => !n?.trim() || n.trim() === 'Khách hàng' || /^facebook user$/i.test(n.trim());
            const isGenericAgent = (n) => {
                if (!n?.trim() || n.trim() === 'Nhân viên' || n.trim() === 'Page CSKH')
                    return true;
                if (pageName && n.trim().toLowerCase() === pageName.toLowerCase())
                    return true;
                return n.trim().length > 45;
            };
            const pickCustomer = (...sources) => {
                for (const s of sources) {
                    if (s?.trim() && !isGenericCustomer(s))
                        return s.trim();
                }
                return 'Khách hàng';
            };
            const pickAgent = (...sources) => {
                for (const s of sources) {
                    if (s?.trim() && !isGenericAgent(s))
                        return s.trim();
                }
                return 'Nhân viên';
            };
            const agentFromPageLabel = pageName.includes('-')
                ? (() => {
                    const m = pageName.match(/^([^-–—|/]+?)\s[-–—|/]\s+/);
                    const candidate = m?.[1]?.trim();
                    if (!candidate || candidate.length > 40)
                        return null;
                    if (/shop|store|page|official|cửa hàng/i.test(candidate))
                        return null;
                    return candidate;
                })()
                : null;
            const finalCustomerName = pickCustomer(data.customerName, auditResult.customer_name);
            const finalAgentName = pickAgent(data.agentName, agentFromPageLabel, auditResult.agent_name);
            const userId = await this.resolveAuditUserId(data.email, finalAgentName);
            const actionItems = parseActionItemsFromAi(auditResult.action_items, auditResult.violations, auditResult.suggested_replies);
            const violationsFromItems = actionItems.map((item) => item.issue).join('\n') || null;
            const repliesFromItems = actionItems.map((item) => item.suggestedReply).join('\n') || null;
            const analysis = (0, audit_analytics_util_1.buildAnalysisPayloadFromAi)(auditResult, data.transcript);
            const savedAudit = await this.prisma.chatAudit.create({
                data: {
                    userId,
                    agentName: finalAgentName,
                    customerName: finalCustomerName,
                    channel: data.channel || 'Facebook Messenger',
                    score: forceZero ? 0 : parseInt(auditResult.score) || 0,
                    feedback: auditResult.feedback,
                    transcript: data.transcript,
                    metadata: {
                        originalAgentName: data.agentName,
                        originalCustomerName: data.customerName,
                        actionItems,
                        suggestedReplies: repliesFromItems ?? normalizeAuditListField(auditResult.suggested_replies),
                        violations: violationsFromItems ?? normalizeAuditListField(auditResult.violations),
                        tokenUsage,
                        criteriaScores: analysis.criteriaScores,
                        strengths: analysis.strengths,
                        weaknesses: analysis.weaknesses,
                        keywords: analysis.keywords,
                        sentiment: analysis.sentiment,
                        tags: analysis.tags,
                        transcriptMetrics: analysis.transcriptMetrics,
                        ...(data.metadata || {}),
                    },
                },
            });
            return { ...savedAudit, tokenUsage };
        }
        catch (error) {
            const err = error;
            const errorMessage = err.response?.data || err.message;
            this.logger.error(`Audit Failed: ${errorMessage}`, err.stack);
            return {
                error: true,
                message: 'AI Service or Database Error',
                detail: errorMessage,
            };
        }
    }
    async analyzeCustomerIntent(data) {
        try {
            const { data: result } = await axios_1.default.post(`${this.aiBaseUrl}/cskh/customer-intent`, {
                messages: data.messages,
                customer_name: data.customerName ?? null,
            }, { timeout: 45_000 });
            const urgencyRaw = String(result.urgency ?? 'normal').toLowerCase();
            const urgency = urgencyRaw === 'low' || urgencyRaw === 'high' ? urgencyRaw : 'normal';
            return {
                summary: String(result.summary ?? '').trim() || 'Khách vừa nhắn tin.',
                intentLabel: String(result.intent_label ?? result.intentLabel ?? 'Chưa rõ').trim(),
                topics: Array.isArray(result.topics)
                    ? result.topics.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
                    : [],
                productMentions: Array.isArray(result.product_mentions)
                    ? result.product_mentions.map((t) => String(t).trim()).filter(Boolean).slice(0, 10)
                    : Array.isArray(result.productMentions)
                        ? result.productMentions.map((t) => String(t).trim()).filter(Boolean).slice(0, 10)
                        : [],
                urgency,
                suggestedFocus: String(result.suggested_focus ?? result.suggestedFocus ?? '').trim(),
            };
        }
        catch (error) {
            const err = error;
            this.logger.warn(`Customer intent analysis failed: ${err.message}`);
            return {
                summary: 'Chưa phân tích được tin nhắn mới.',
                intentLabel: 'Chưa rõ',
                topics: [],
                productMentions: [],
                urgency: 'normal',
                suggestedFocus: 'Đọc tin nhắn mới và phản hồi khách.',
            };
        }
    }
};
exports.AiService = AiService;
exports.AiService = AiService = AiService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AiService);
//# sourceMappingURL=ai.service.js.map