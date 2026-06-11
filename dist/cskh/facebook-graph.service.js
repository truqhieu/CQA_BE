"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var FacebookGraphService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FacebookGraphService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = __importDefault(require("axios"));
const facebook_oauth_util_1 = require("./facebook-oauth.util");
const facebook_message_util_1 = require("./facebook-message.util");
let FacebookGraphService = FacebookGraphService_1 = class FacebookGraphService {
    logger = new common_1.Logger(FacebookGraphService_1.name);
    graphVersion = process.env.FB_GRAPH_VERSION?.trim() || 'v21.0';
    async getPagePictureUrl(pageId, pageToken) {
        try {
            const pic = await this.graphRequest(`/${pageId}/picture`, pageToken, { redirect: '0', type: 'large' });
            const fromEndpoint = pic?.data?.url;
            if (fromEndpoint)
                return fromEndpoint;
            const data = await this.graphRequest(`/${pageId}`, pageToken, { fields: 'picture.type(large)' });
            return data?.picture?.data?.url ?? null;
        }
        catch (e) {
            this.logger.warn(`Page picture ${pageId}: ${e.message}`);
            return null;
        }
    }
    async graphRequest(urlOrPath, token, params = {}) {
        const isFullUrl = String(urlOrPath).startsWith('http');
        const url = isFullUrl
            ? urlOrPath
            : `${facebook_oauth_util_1.GRAPH_BASE}${urlOrPath.startsWith('/') ? '' : '/'}${urlOrPath}`;
        try {
            const res = await axios_1.default.get(url, {
                params: isFullUrl ? undefined : { access_token: token, ...params },
                timeout: 60000,
            });
            return res.data;
        }
        catch (e) {
            const err = e;
            const fbErr = err.response?.data?.error;
            throw new Error(fbErr?.message || err.message || 'Graph API error');
        }
    }
    async verifyPage(pageId, token) {
        return this.graphRequest(`/${pageId}`, token, {
            fields: 'id,name',
        });
    }
    async fetchConversations(pageId, token, maxCount) {
        const convs = [];
        let nextUrl = null;
        let first = true;
        while (convs.length < maxCount) {
            const data = first
                ? await this.graphRequest(`/${pageId}/conversations`, token, {
                    platform: 'messenger',
                    fields: 'id,updated_time,participants',
                    limit: Math.min(50, maxCount - convs.length),
                })
                : await axios_1.default.get(nextUrl, { timeout: 60000 }).then((r) => r.data);
            first = false;
            if (Array.isArray(data.data))
                convs.push(...data.data);
            nextUrl = data.paging?.next ?? null;
            if (!nextUrl || !data.data?.length)
                break;
        }
        return convs.slice(0, maxCount);
    }
    async fetchConversationsForMonitor(pageId, token, maxCount) {
        const convs = [];
        let nextUrl = null;
        let first = true;
        const fields = `id,updated_time,participants,messages.limit(1){${facebook_message_util_1.FB_MESSAGE_FIELDS}}`;
        while (convs.length < maxCount) {
            const data = first
                ? await this.graphRequest(`/${pageId}/conversations`, token, {
                    platform: 'messenger',
                    fields,
                    limit: Math.min(50, maxCount - convs.length),
                })
                : await axios_1.default.get(nextUrl, { timeout: 60000 }).then((r) => r.data);
            first = false;
            if (Array.isArray(data.data))
                convs.push(...data.data);
            nextUrl = data.paging?.next ?? null;
            if (!nextUrl || !data.data?.length)
                break;
        }
        return convs.slice(0, maxCount);
    }
    vietnamDayRange(dateStr) {
        return this.vietnamDateRange(dateStr, dateStr);
    }
    vietnamDateRange(fromStr, toStr) {
        const start = new Date(`${fromStr}T00:00:00+07:00`);
        const end = new Date(`${toStr}T23:59:59.999+07:00`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            throw new Error(`Khoảng ngày không hợp lệ: ${fromStr} → ${toStr}`);
        }
        if (start.getTime() > end.getTime()) {
            throw new Error(`Ngày bắt đầu phải trước hoặc bằng ngày kết thúc`);
        }
        return { start, end };
    }
    isWithinDay(isoTime, start, end) {
        if (!isoTime)
            return false;
        const t = new Date(isoTime).getTime();
        return t >= start.getTime() && t <= end.getTime();
    }
    filterMessagesByDay(messages, auditDate) {
        return this.filterMessagesByDateRange(messages, auditDate, auditDate);
    }
    filterMessagesByDateRange(messages, fromStr, toStr) {
        const { start, end } = this.vietnamDateRange(fromStr, toStr);
        return messages.filter((m) => this.isWithinDay(m.created_time, start, end));
    }
    filterMessagesUpToAuditDate(messages, auditDate) {
        return this.filterMessagesUpToRangeEnd(messages, auditDate);
    }
    filterMessagesUpToRangeEnd(messages, toStr) {
        const { end } = this.vietnamDateRange(toStr, toStr);
        return messages.filter((m) => {
            if (!m.created_time)
                return false;
            return new Date(m.created_time).getTime() <= end.getTime();
        });
    }
    async runWithConcurrency(items, concurrency, fn) {
        let nextIndex = 0;
        const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, async () => {
            while (nextIndex < items.length) {
                const index = nextIndex++;
                await fn(items[index]);
            }
        });
        await Promise.all(workers);
    }
    async fetchConversationsForAuditByDate(pageId, token, auditDateFrom, auditDateTo, msgLimit = 300, onProgress, fetchConcurrency = 6, shouldAbort, convFilter, maxNewMatches = 0) {
        const auditDateToResolved = auditDateTo?.trim() || auditDateFrom;
        const { start, end } = this.vietnamDateRange(auditDateFrom, auditDateToResolved);
        const rangeLabel = auditDateFrom === auditDateToResolved
            ? auditDateFrom
            : `${auditDateFrom}→${auditDateToResolved}`;
        const matched = [];
        let scanned = 0;
        let skippedAfterDay = 0;
        let skippedNoDayMsg = 0;
        let stoppedEarly = false;
        let nextUrl = null;
        let first = true;
        const safeMsgMax = Math.min(Math.max(msgLimit, 20), 500);
        const embedPreview = Math.min(15, safeMsgMax);
        const fields = `id,updated_time,participants,messages.limit(${embedPreview}){${facebook_message_util_1.FB_MESSAGE_FIELDS}}`;
        this.logger.log(`[AuditRange] page=${pageId} range=${rangeLabel} ${start.toISOString()} → ${end.toISOString()} (VN +7)`);
        while (true) {
            if (shouldAbort && (await shouldAbort())) {
                this.logger.log(`[AuditRange] pause — dừng quét page=${pageId} range=${rangeLabel}`);
                this.logAuditDateSummary(rangeLabel, pageId, {
                    scanned,
                    matched: matched.length,
                    skippedAfterDay,
                    skippedNoDayMsg,
                    stoppedEarly: true,
                });
                return matched;
            }
            const data = first
                ? await this.graphRequest(`/${pageId}/conversations`, token, {
                    platform: 'messenger',
                    fields,
                    limit: 50,
                })
                : await axios_1.default.get(nextUrl, { timeout: 120000 }).then((r) => r.data);
            first = false;
            const batch = data.data ?? [];
            if (!batch.length)
                break;
            const batchMatchedBefore = matched.length;
            const candidates = [];
            for (const conv of batch) {
                scanned++;
                const updatedMs = conv.updated_time ? new Date(conv.updated_time).getTime() : 0;
                if (updatedMs < start.getTime()) {
                    stoppedEarly = true;
                    this.logger.log(`[AuditRange] dừng sớm tại conv #${scanned}: updated_time=${conv.updated_time} < ${start.toISOString()}`);
                    if (onProgress)
                        await onProgress(scanned, matched.length);
                    this.logAuditDateSummary(rangeLabel, pageId, {
                        scanned,
                        matched: matched.length,
                        skippedAfterDay,
                        skippedNoDayMsg,
                        stoppedEarly,
                    });
                    return matched;
                }
                const rawMsgs = conv.messages?.data ?? [];
                const dayMsgsInEmbed = this.filterMessagesByDateRange(rawMsgs, auditDateFrom, auditDateToResolved);
                if (updatedMs > end.getTime()) {
                    if (dayMsgsInEmbed.length === 0) {
                        skippedAfterDay++;
                        continue;
                    }
                }
                else if (dayMsgsInEmbed.length === 0) {
                }
                let needsFetch = true;
                if (rawMsgs.length < embedPreview) {
                    needsFetch = false;
                }
                else {
                    const oldest = rawMsgs[rawMsgs.length - 1];
                    const oldestTime = oldest?.created_time ? new Date(oldest.created_time).getTime() : 0;
                    if (oldestTime > 0 && oldestTime < start.getTime()) {
                        needsFetch = false;
                    }
                }
                candidates.push({ conv, allMsgs: rawMsgs, needsFetch });
            }
            const pendingFetches = candidates.flatMap((c, index) => c.needsFetch ? [{ index, conv: c.conv }] : []);
            await this.runWithConcurrency(pendingFetches, fetchConcurrency, async ({ index, conv }) => {
                try {
                    const fetched = await this.fetchMessagesForAuditTranscript(conv.id, token, auditDateFrom, auditDateToResolved, safeMsgMax);
                    if (fetched.length > 0)
                        candidates[index].allMsgs = fetched;
                }
                catch {
                }
            });
            for (const { conv, allMsgs, needsFetch } of candidates) {
                const transcriptMsgs = this.filterMessagesUpToRangeEnd(allMsgs, auditDateToResolved);
                const dayInTranscript = this.filterMessagesByDateRange(transcriptMsgs, auditDateFrom, auditDateToResolved);
                if (dayInTranscript.length === 0) {
                    skippedNoDayMsg++;
                    continue;
                }
                if (maxNewMatches > 0 && matched.length >= maxNewMatches) {
                    stoppedEarly = true;
                    this.logger.log(`[AuditRange] đủ ${maxNewMatches} hội thoại mới — dừng quét page=${pageId} (đã lướt ${scanned} inbox)`);
                    if (onProgress)
                        await onProgress(scanned, matched.length);
                    this.logAuditDateSummary(rangeLabel, pageId, {
                        scanned,
                        matched: matched.length,
                        skippedAfterDay,
                        skippedNoDayMsg,
                        stoppedEarly: true,
                    });
                    return matched;
                }
                if (convFilter) {
                    const decision = convFilter(conv);
                    if (decision === 'exclude')
                        continue;
                    if (decision === 'stop') {
                        stoppedEarly = true;
                        this.logger.log(`[AuditRange] dừng quét page=${pageId} range=${rangeLabel} matched=${matched.length}`);
                        if (onProgress)
                            await onProgress(scanned, matched.length);
                        this.logAuditDateSummary(rangeLabel, pageId, {
                            scanned,
                            matched: matched.length,
                            skippedAfterDay,
                            skippedNoDayMsg,
                            stoppedEarly: true,
                        });
                        return matched;
                    }
                }
                if (matched.length < 3) {
                    this.logger.log(`[AuditRange] match #${matched.length + 1}: conv=${conv.id.slice(-8)} updated=${conv.updated_time} ` +
                        `dayMsgs=${dayInTranscript.length} transcriptMsgs=${transcriptMsgs.length} extraFetch=${needsFetch} ` +
                        `firstDay=${dayInTranscript[0]?.created_time ?? '—'} lastDay=${dayInTranscript[dayInTranscript.length - 1]?.created_time ?? '—'}`);
                }
                matched.push({
                    ...conv,
                    messages: { data: transcriptMsgs },
                });
            }
            this.logger.debug(`[AuditRange] batch: +${matched.length - batchMatchedBefore} match, scanned=${scanned}, totalMatch=${matched.length}`);
            if (onProgress)
                await onProgress(scanned, matched.length);
            if (maxNewMatches > 0 && matched.length >= maxNewMatches) {
                stoppedEarly = true;
                this.logger.log(`[AuditRange] đủ ${maxNewMatches} hội thoại sau batch — dừng page=${pageId}`);
                this.logAuditDateSummary(rangeLabel, pageId, {
                    scanned,
                    matched: matched.length,
                    skippedAfterDay,
                    skippedNoDayMsg,
                    stoppedEarly: true,
                });
                return matched;
            }
            if (shouldAbort && (await shouldAbort())) {
                this.logger.log(`[AuditRange] pause — dừng sau batch page=${pageId} range=${rangeLabel}`);
                this.logAuditDateSummary(rangeLabel, pageId, {
                    scanned,
                    matched: matched.length,
                    skippedAfterDay,
                    skippedNoDayMsg,
                    stoppedEarly: true,
                });
                return matched;
            }
            nextUrl = data.paging?.next ?? null;
            if (!nextUrl)
                break;
        }
        this.logAuditDateSummary(rangeLabel, pageId, {
            scanned,
            matched: matched.length,
            skippedAfterDay,
            skippedNoDayMsg,
            stoppedEarly,
        });
        return matched;
    }
    logAuditDateSummary(auditDate, pageId, stats) {
        this.logger.log(`[AuditDate] DONE page=${pageId} date=${auditDate}: ` +
            `scanned=${stats.scanned} matched=${stats.matched} ` +
            `skipAfterDay=${stats.skippedAfterDay} skipNoMsg=${stats.skippedNoDayMsg} ` +
            `stoppedEarly=${stats.stoppedEarly}`);
    }
    async fetchAllConversationsForAudit(pageId, token, maxCount = 0, msgLimit = 25, onBatch) {
        const convs = [];
        let nextUrl = null;
        let first = true;
        const unlimited = !maxCount || maxCount <= 0;
        const safeMsgLimit = Math.min(Math.max(msgLimit, 5), 50);
        const fields = `id,updated_time,participants,messages.limit(${safeMsgLimit}){${facebook_message_util_1.FB_MESSAGE_FIELDS}}`;
        while (unlimited || convs.length < maxCount) {
            const pageLimit = unlimited ? 50 : Math.min(50, maxCount - convs.length);
            const data = first
                ? await this.graphRequest(`/${pageId}/conversations`, token, {
                    platform: 'messenger',
                    fields,
                    limit: pageLimit,
                })
                : await axios_1.default.get(nextUrl, { timeout: 120000 }).then((r) => r.data);
            first = false;
            if (Array.isArray(data.data))
                convs.push(...data.data);
            if (onBatch)
                await onBatch(convs.length);
            nextUrl = data.paging?.next ?? null;
            if (!nextUrl || !data.data?.length)
                break;
            if (!unlimited && convs.length >= maxCount)
                break;
        }
        return unlimited ? convs : convs.slice(0, maxCount);
    }
    latestMessages(conv) {
        return conv.messages?.data ?? [];
    }
    async fetchConversationById(conversationId, token) {
        try {
            return await this.graphRequest(`/${conversationId}`, token, {
                fields: 'id,updated_time,participants',
            });
        }
        catch (e) {
            this.logger.warn(`fetchConversationById ${conversationId}: ${e.message}`);
            return null;
        }
    }
    async fetchMessages(conversationId, token, limit = 50) {
        const messages = [];
        let nextUrl = null;
        let first = true;
        while (messages.length < limit) {
            const data = first
                ? await this.graphRequest(`/${conversationId}/messages`, token, {
                    fields: facebook_message_util_1.FB_MESSAGE_FIELDS,
                    limit: Math.min(50, limit - messages.length),
                })
                : await axios_1.default.get(nextUrl, { timeout: 60000 }).then((r) => r.data);
            first = false;
            if (Array.isArray(data.data))
                messages.push(...data.data);
            nextUrl = data.paging?.next ?? null;
            if (!nextUrl || !data.data?.length)
                break;
        }
        return messages;
    }
    async fetchMessagesForAuditTranscript(conversationId, token, auditDateFrom, auditDateTo, maxMessages = 300) {
        const auditDateToResolved = auditDateTo?.trim() || auditDateFrom;
        const { start, end } = this.vietnamDateRange(auditDateFrom, auditDateToResolved);
        const startMs = start.getTime();
        const endMs = end.getTime();
        const safeMax = Math.min(Math.max(maxMessages, 20), 500);
        const fetched = [];
        let nextUrl = null;
        let first = true;
        while (fetched.length < safeMax) {
            const data = first
                ? await this.graphRequest(`/${conversationId}/messages`, token, {
                    fields: facebook_message_util_1.FB_MESSAGE_FIELDS,
                    limit: Math.min(50, safeMax - fetched.length),
                })
                : await axios_1.default.get(nextUrl, { timeout: 90000 }).then((r) => r.data);
            first = false;
            const batch = data.data ?? [];
            if (!batch.length)
                break;
            fetched.push(...batch);
            const oldest = batch[batch.length - 1];
            const oldestMs = oldest?.created_time ? new Date(oldest.created_time).getTime() : 0;
            if (oldestMs > 0 && oldestMs < startMs)
                break;
            nextUrl = data.paging?.next ?? null;
            if (!nextUrl)
                break;
        }
        return fetched.filter((m) => {
            if (!m.created_time)
                return false;
            return new Date(m.created_time).getTime() <= endMs;
        });
    }
    participantInfo(participants, pageId) {
        return {
            customerName: this.resolveCustomerName(participants, pageId, []),
            participantPsid: this.resolveParticipantPsid(participants, pageId),
        };
    }
    resolveParticipantPsid(participants, pageId) {
        for (const p of participants?.data ?? []) {
            if (String(p.id) !== String(pageId) && p.id)
                return String(p.id);
        }
        return null;
    }
    async getMessengerUserProfile(psid, pageToken) {
        if (!psid || !pageToken)
            return { name: null, pictureUrl: null };
        let name = null;
        let pictureUrl = null;
        try {
            const pic = await this.graphRequest(`/${psid}/picture`, pageToken, { redirect: '0', type: 'large' });
            pictureUrl = pic?.data?.url ?? null;
        }
        catch (e) {
            this.logger.debug(`PSID picture endpoint ${psid}: ${e.message}`);
        }
        try {
            const data = await this.graphRequest(`/${psid}`, pageToken, { fields: 'name,first_name,picture.type(large)' });
            name = data.name?.trim() || data.first_name?.trim() || null;
            pictureUrl = pictureUrl ?? data.picture?.data?.url ?? null;
        }
        catch (e) {
            this.logger.warn(`PSID profile ${psid}: ${e.message}`);
        }
        return { name, pictureUrl };
    }
    async getMessengerUserName(psid, pageToken) {
        const profile = await this.getMessengerUserProfile(psid, pageToken);
        return profile.name;
    }
    resolveCustomerName(participants, pageId, messages, transcript) {
        for (const p of participants?.data ?? []) {
            if (String(p.id) !== String(pageId) && p.name?.trim()) {
                const n = this.normalizePersonName(p.name.trim());
                if (!this.isGenericCustomerName(n))
                    return n;
            }
        }
        for (const msg of messages) {
            const fromId = String(msg.from?.id || '');
            if (fromId !== String(pageId) && msg.from?.name?.trim()) {
                const n = this.normalizePersonName(msg.from.name.trim());
                if (!this.isGenericCustomerName(n))
                    return n;
            }
        }
        if (transcript?.length) {
            const parsed = this.parseNamesFromTranscript(transcript);
            if (parsed.customerName)
                return parsed.customerName;
        }
        return 'Khách hàng';
    }
    resolveAgentName(messages, pageId, pageName, transcript) {
        if (transcript.length) {
            const parsed = this.parseNamesFromTranscript(transcript);
            if (parsed.agentName)
                return parsed.agentName;
        }
        for (const msg of messages) {
            if (String(msg.from?.id || '') === String(pageId)) {
                const n = msg.from?.name?.trim();
                if (!n)
                    continue;
                if (!this.isPageOrGenericAgent(n, pageName))
                    return n;
                const fromLabel = this.extractAgentFromPageLabel(n);
                if (fromLabel)
                    return fromLabel;
            }
        }
        const fromPage = this.extractAgentFromPageLabel(pageName || '');
        if (fromPage)
            return fromPage;
        return 'Nhân viên';
    }
    extractAgentFromPageLabel(label) {
        const trimmed = label.trim();
        if (!trimmed)
            return undefined;
        const parts = trimmed.split(/\s[-–—|/]\s+/).map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
            const candidate = this.normalizePersonName(parts[0]);
            if (this.isPlausibleAgentFromLabel(candidate))
                return candidate;
        }
        return undefined;
    }
    isPlausibleAgentFromLabel(name) {
        if (!this.isPlausiblePersonName(name))
            return false;
        const n = name.toLowerCase();
        if (/(shop|store|page|official|cửa hàng|cua hang|fanpage)/i.test(n))
            return false;
        if (/\bcác\b/i.test(n))
            return false;
        return name.split(/\s+/).length <= 3;
    }
    parseNamesFromTranscript(transcript) {
        let customerName;
        let agentName;
        const person = '([a-zà-ỹA-ZÀ-Ỹ]+(?:\\s+[a-zà-ỹA-ZÀ-Ỹ]+)?)';
        const honorificName = new RegExp(`(?:chào|chao|dạ\\s+chào|hello|hi)\\s+(?:anh|chị|chi|em|bác|cô|chú|bạn)\\s+${person}`, 'iu');
        const vocativeName = new RegExp(`(?:anh|chị|chi|em|bác|cô|chú)\\s+${person}\\s*(?:ơi|oi|ạ|a|nhé|nhe|!|\\?|$)`, 'iu');
        const agentIntro = new RegExp(`(?:em\\s+là|tên em(?:\\s+là)?|em tên|mình là|tư vấn viên|nhân viên|tvv)\\s+${person}`, 'iu');
        const agentSign = new RegExp(`(?:ký tên|ky ten|trân trọng|thanks)[:\\s,]*${person}`, 'iu');
        const trailingSign = new RegExp(`[-–—]\\s*${person}\\s*$`, 'iu');
        const customerIntro = new RegExp(`(?:em\\s+là|tên em(?:\\s+là)?|em tên|mình là|tôi là|toi la)\\s+${person}`, 'iu');
        const customerThanksStaff = new RegExp(`(?:cảm ơn|cam on|thanks|thank you)\\s+(?:anh|chị|chi|em|bác|cô|chú)\\s+${person}`, 'iu');
        const pick = (raw) => {
            if (!raw?.trim())
                return undefined;
            const normalized = this.normalizePersonName(raw);
            return this.isPlausiblePersonName(normalized) ? normalized : undefined;
        };
        for (const line of transcript) {
            const text = (line.text || '').trim();
            if (!text)
                continue;
            if (line.sender === 'Staff') {
                if (!customerName) {
                    const m = text.match(honorificName) || text.match(vocativeName);
                    customerName = pick(m?.[1]);
                }
                if (!agentName) {
                    const m = text.match(agentIntro) || text.match(agentSign) || text.match(trailingSign);
                    agentName = pick(m?.[1]);
                }
            }
            if (line.sender === 'Customer') {
                if (!customerName) {
                    const m = text.match(customerIntro);
                    customerName = pick(m?.[1]);
                }
                if (!agentName) {
                    const m = text.match(customerThanksStaff);
                    agentName = pick(m?.[1]);
                }
            }
        }
        return { customerName, agentName };
    }
    normalizePersonName(name) {
        return name
            .trim()
            .split(/\s+/)
            .map((part) => {
            if (!part)
                return part;
            return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
            .join(' ');
    }
    isGenericCustomerName(name) {
        const n = name.toLowerCase().trim();
        return n === 'khách hàng' || n === 'facebook user' || n === 'người dùng facebook';
    }
    isPageOrGenericAgent(name, pageName) {
        const n = name.trim();
        if (!n || n === 'Nhân viên' || n === 'Page CSKH')
            return true;
        if (pageName && n.toLowerCase() === pageName.toLowerCase())
            return true;
        if (/page$/i.test(n) || n.length > 40)
            return true;
        return false;
    }
    isPlausiblePersonName(name) {
        const n = name.trim();
        if (n.length < 2 || n.length > 40)
            return false;
        if (/^(shop|page|facebook|khách|customer|admin)/i.test(n))
            return false;
        return true;
    }
    hasStaffMessage(messages, pageId) {
        return messages.some((m) => String(m.from?.id || '') === String(pageId));
    }
    needsFollowUpOnDay(messages, pageId) {
        if (!messages.length)
            return false;
        const ordered = [...messages].reverse();
        let lastStaffIdx = -1;
        for (let i = 0; i < ordered.length; i++) {
            if (String(ordered[i].from?.id || '') === String(pageId))
                lastStaffIdx = i;
        }
        if (lastStaffIdx < 0) {
            return ordered.some((m) => String(m.from?.id || '') !== String(pageId));
        }
        let lastCustomerText = '';
        for (let i = ordered.length - 1; i > lastStaffIdx; i--) {
            if (String(ordered[i].from?.id || '') !== String(pageId)) {
                lastCustomerText = (ordered[i].message || '').trim();
                break;
            }
        }
        if (!lastCustomerText)
            return false;
        if (this.isClosingMessage(lastCustomerText))
            return false;
        return true;
    }
    isClosingMessage(text) {
        const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
        return /^(ok|oke|okay|dạ|vâng|cảm ơn|cam on|thanks|thank you|nhé|nhe|hiểu rồi|đã hiểu|received)[!.?\s]*$/.test(t);
    }
    messagesToTranscript(messages, pageId) {
        const normalized = (0, facebook_message_util_1.dedupeChatMessages)(messages
            .slice()
            .reverse()
            .map((msg) => (0, facebook_message_util_1.normalizeFbMessage)(msg, pageId))
            .filter((msg) => msg != null));
        return normalized.map((msg) => ({
            sender: msg.sender,
            type: msg.messageType,
            text: msg.text,
            timestamp: msg.timestamp,
            attachmentUrl: msg.attachmentUrl ?? null,
            attachmentUrls: msg.attachmentUrls,
            imageUrl: msg.messageType === 'image'
                ? (msg.attachmentUrls?.[0] ?? msg.attachmentUrl ?? null)
                : null,
            videoUrl: msg.messageType === 'video'
                ? (msg.attachmentUrls?.[0] ?? msg.attachmentUrl ?? null)
                : null,
        }));
    }
    isStoredMessageNoise(text) {
        return (0, facebook_message_util_1.isNoiseMessageText)(text);
    }
    normalizeMessageForInbox(msg, pageId) {
        return (0, facebook_message_util_1.normalizeFbMessage)(msg, pageId);
    }
    mediaKindFromAttachment(att, url) {
        if (att?.type === 'video' ||
            att?.mime_type?.startsWith('video/') ||
            /\.mp4(\?|$)/i.test(url)) {
            return 'video';
        }
        return 'image';
    }
    async fetchFirstAttachmentFromMessage(messageId, token) {
        try {
            const detail = await this.graphRequest(`/${messageId}`, token, { fields: `attachments{${facebook_message_util_1.FB_ATTACHMENT_FIELDS}}` });
            const att = detail.attachments?.data?.[0];
            if (att)
                return att;
        }
        catch (e) {
            this.logger.debug(`fetchFirstAttachmentFromMessage ${messageId}: ${e.message}`);
        }
        try {
            const edge = await this.graphRequest(`/${messageId}/attachments`, token, {
                fields: facebook_message_util_1.FB_ATTACHMENT_FIELDS,
            });
            return edge.data?.[0] ?? null;
        }
        catch (e) {
            this.logger.debug(`fetchAttachmentEdge ${messageId}: ${e.message}`);
            return null;
        }
    }
    async resolveAllMessageMediaUrls(messageId, token) {
        const id = messageId.trim();
        if (!id || !token)
            return [];
        try {
            const detail = await this.graphRequest(`/${id}`, token, { fields: `attachments{${facebook_message_util_1.FB_ATTACHMENT_FIELDS}}` });
            const attachments = detail.attachments?.data ?? [];
            const results = [];
            for (const att of attachments) {
                let url = (0, facebook_message_util_1.pickAttachmentUrl)(att);
                if (!url && att?.id) {
                    url = await this.fetchAttachmentMediaById(att.id, token);
                }
                if (url) {
                    results.push({ url, messageType: this.mediaKindFromAttachment(att, url) });
                }
            }
            const deduped = (0, facebook_message_util_1.dedupeMediaUrls)(results.map((r) => r.url));
            if (deduped.length) {
                return deduped.map((url) => {
                    const hit = results.find((r) => r.url === url || r.url.split('?')[0] === url.split('?')[0]);
                    return { url, messageType: hit?.messageType ?? 'image' };
                });
            }
        }
        catch (e) {
            this.logger.debug(`resolveAllMessageMediaUrls ${id}: ${e.message}`);
        }
        const single = await this.resolveMessageMediaUrl(id, token);
        if (single.url) {
            return [{ url: single.url, messageType: single.messageType ?? 'image' }];
        }
        return [];
    }
    async resolveMessageMediaUrl(messageOrAttachmentId, token) {
        const id = messageOrAttachmentId.trim();
        if (!id || !token)
            return { url: null, messageType: null };
        const att = await this.fetchFirstAttachmentFromMessage(id, token);
        let url = (0, facebook_message_util_1.pickAttachmentUrl)(att ?? undefined);
        if (!url && att?.id) {
            url = await this.fetchAttachmentMediaById(att.id, token);
        }
        if (url) {
            return { url, messageType: this.mediaKindFromAttachment(att ?? undefined, url) };
        }
        try {
            const directUrl = await this.fetchAttachmentMediaById(id, token);
            if (directUrl) {
                return {
                    url: directUrl,
                    messageType: /\.mp4(\?|$)/i.test(directUrl) ? 'video' : 'image',
                };
            }
        }
        catch (e) {
            this.logger.debug(`resolveMessageMediaUrl ${id}: ${e.message}`);
        }
        return { url: null, messageType: null };
    }
    async fetchAttachmentMediaById(attachmentId, token) {
        const data = await this.graphRequest(`/${attachmentId}`, token, {
            fields: facebook_message_util_1.FB_ATTACHMENT_FIELDS,
        });
        return (0, facebook_message_util_1.pickAttachmentUrl)(data);
    }
    async enrichMessageWithMedia(msg, token) {
        if (!(0, facebook_message_util_1.messageNeedsMediaResolve)(msg))
            return msg;
        try {
            if (msg.id) {
                const detail = await this.graphRequest(`/${msg.id}`, token, { fields: `attachments{${facebook_message_util_1.FB_ATTACHMENT_FIELDS}}` });
                if (detail.attachments?.data?.length) {
                    const enriched = [];
                    for (const att of detail.attachments.data) {
                        if ((0, facebook_message_util_1.pickAttachmentUrl)(att)) {
                            enriched.push(att);
                            continue;
                        }
                        if (att?.id) {
                            try {
                                const full = await this.graphRequest(`/${att.id}`, token, {
                                    fields: facebook_message_util_1.FB_ATTACHMENT_FIELDS,
                                });
                                enriched.push({ ...att, ...full });
                                continue;
                            }
                            catch {
                            }
                        }
                        enriched.push(att);
                    }
                    return { ...msg, attachments: { data: enriched } };
                }
            }
            const attId = msg.attachments?.data?.[0]?.id;
            if (attId) {
                const att = await this.graphRequest(`/${attId}`, token, {
                    fields: facebook_message_util_1.FB_ATTACHMENT_FIELDS,
                });
                return {
                    ...msg,
                    attachments: { data: [{ ...msg.attachments.data[0], ...att }] },
                };
            }
        }
        catch (e) {
            this.logger.debug(`enrichMessageWithMedia ${msg.id}: ${e.message}`);
        }
        return msg;
    }
    async enrichMessagesWithMedia(messages, token) {
        const result = [];
        for (const msg of messages) {
            result.push(await this.enrichMessageWithMedia(msg, token));
        }
        return result;
    }
    extractAgentName(messages, pageId, pageName) {
        const transcript = this.messagesToTranscript(messages, pageId);
        return this.resolveAgentName(messages, pageId, pageName, transcript);
    }
    needsReply(messages, pageId) {
        return this.needsFollowUpOnDay(messages, pageId);
    }
    sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }
    async graphPost(path, token, body) {
        const url = `${facebook_oauth_util_1.GRAPH_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
        try {
            const res = await axios_1.default.post(url, body, {
                params: { access_token: token },
                timeout: 60000,
            });
            return res.data;
        }
        catch (e) {
            const err = e;
            const fbErr = err.response?.data?.error;
            throw new Error(fbErr?.message || err.message || 'Graph API POST error');
        }
    }
    async sendPageMessage(pageId, token, recipientPsid, text) {
        return this.graphPost(`/${pageId}/messages`, token, {
            recipient: { id: recipientPsid },
            messaging_type: 'RESPONSE',
            message: { text },
        });
    }
};
exports.FacebookGraphService = FacebookGraphService;
exports.FacebookGraphService = FacebookGraphService = FacebookGraphService_1 = __decorate([
    (0, common_1.Injectable)()
], FacebookGraphService);
//# sourceMappingURL=facebook-graph.service.js.map