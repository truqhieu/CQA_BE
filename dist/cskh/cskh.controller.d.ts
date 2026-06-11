import { MessageEvent } from '@nestjs/common';
import type { Response, Request } from 'express';
import type { RawBodyRequest } from '@nestjs/common';
import { Observable } from 'rxjs';
import { CskhService } from './cskh.service';
import { CskhInboxService } from './cskh-inbox.service';
import { CskhInboxRealtimeService } from './cskh-inbox-realtime.service';
import { SapoOAuthService } from './sapo-oauth.service';
import { SapoProductService } from './sapo-product.service';
export declare class CskhController {
    private readonly cskh;
    private readonly inbox;
    private readonly inboxRealtime;
    private readonly sapoOAuth;
    private readonly sapoProducts;
    constructor(cskh: CskhService, inbox: CskhInboxService, inboxRealtime: CskhInboxRealtimeService, sapoOAuth: SapoOAuthService, sapoProducts: SapoProductService);
    oauthStart(returnUrl: string, res: Response): void;
    oauthCallback(code: string, state: string, error: string, errorDescription: string, res: Response): Promise<void>;
    listPages(): Promise<{
        pages: {
            pageId: string;
            pageName: string | null;
            enabled: boolean;
            updatedAt: Date;
            pagePictureUrl: string | null;
            metadata: import("@prisma/client/runtime/library").JsonValue;
        }[];
        oauthConnected: boolean;
        oauthUser: string | null;
        oauthUpdatedAt: Date | null;
        oauthExpiresAt: Date | null;
    }>;
    saveManualPage(body: {
        pageId?: string;
        pageName?: string;
        pageAccessToken?: string;
    }): Promise<{
        pageId: string;
        pageName: string | null;
        enabled: boolean;
        updatedAt: Date;
    }>;
    setPagesEnabledBulk(body: {
        enabled?: boolean;
        pageIds?: string[];
    }): Promise<{
        updated: number;
        enabled: boolean;
    }>;
    setPageEnabled(pageId: string, body: {
        enabled?: boolean;
    }): Promise<{
        pageId: string;
        enabled: boolean;
    }>;
    deletePage(pageId: string): Promise<{
        ok: boolean;
        pageId: string;
    }>;
    refreshOAuth(): Promise<{
        pageCount: number;
        oauthUser: string;
    }>;
    sapoOAuthStart(res: Response): void;
    sapoOAuthCallback(code: string, error: string, errorDescription: string, res: Response): Promise<void>;
    sapoStatus(): Promise<{
        oauthReady: boolean;
        apiReady: boolean;
        redirectUri: string | null;
        authorizeUrl: string | null;
        variantCount: number;
    }>;
    latestMonitor(): Promise<({
        monitorItems: {
            id: string;
            tenantId: string | null;
            updatedAt: Date | null;
            pageName: string | null;
            customerName: string | null;
            pageId: string;
            lastMessage: string | null;
            needsReply: boolean;
            jobRunId: string;
            conversationId: string;
        }[];
    } & {
        error: string | null;
        id: string;
        tenantId: string | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        type: string;
        status: string;
        startedAt: Date;
        finishedAt: Date | null;
    }) | null>;
    runMonitor(body: {
        maxConversations?: number;
    }): Promise<{
        jobId: string;
        status: string;
        alreadyRunning: boolean;
    }>;
    runAudit(body: {
        auditDate?: string;
        auditDateFrom?: string;
        auditDateTo?: string;
        maxConversations?: number;
        force?: boolean;
        pageId?: string;
    }): Promise<{
        jobId: string;
        status: string;
        alreadyRunning: boolean;
    }>;
    pauseAudit(): Promise<{
        paused: boolean;
        message: string;
        jobId?: undefined;
    } | {
        paused: boolean;
        jobId: string;
        message?: undefined;
    }>;
    cancelAudit(): Promise<{
        cancelled: number;
    }>;
    getAuditTokenStats(): Promise<{
        source: "running";
        jobId: string;
        finishedAt: Date | null;
        tokenUsage: {} | null;
    } | {
        source: "none";
        jobId: null;
        finishedAt: null;
        tokenUsage: null;
    } | {
        source: "lastJob";
        jobId: string;
        finishedAt: Date | null;
        tokenUsage: {} | null;
    }>;
    getAuditProgress(jobId: string): Promise<{
        id: string;
        status: string;
        error: string | null;
        startedAt: Date;
        finishedAt: Date | null;
        summary: {
            auditCount: number;
        };
        audits: ({
            id: string;
            agentName: string | null;
            customerName: string | null;
            channel: string | null;
            score: number;
            feedback: string | null;
            transcript: unknown;
            metadata: unknown;
            createdAt: Date;
        } & {
            customerPictureUrl: string | null;
            fromAd: boolean;
            adId: string | null;
            adTitle: string | null;
            referralSource: string | null;
        })[];
    }>;
    getRunningJob(type: string): Promise<{
        error: string | null;
        monitorItems: {
            id: string;
            tenantId: string | null;
            updatedAt: Date | null;
            pageName: string | null;
            customerName: string | null;
            pageId: string;
            lastMessage: string | null;
            needsReply: boolean;
            jobRunId: string;
            conversationId: string;
        }[];
        id: string;
        tenantId: string | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        type: string;
        status: string;
        startedAt: Date;
        finishedAt: Date | null;
    } | null> | null;
    getJob(id: string): Promise<{
        error: string | null;
        monitorItems: {
            id: string;
            tenantId: string | null;
            updatedAt: Date | null;
            pageName: string | null;
            customerName: string | null;
            pageId: string;
            lastMessage: string | null;
            needsReply: boolean;
            jobRunId: string;
            conversationId: string;
        }[];
        id: string;
        tenantId: string | null;
        summary: import("@prisma/client/runtime/library").JsonValue | null;
        type: string;
        status: string;
        startedAt: Date;
        finishedAt: Date | null;
    }>;
    listAudits(pageId?: string, jobRunId?: string, auditDate?: string, auditDateFrom?: string, auditDateTo?: string, limit?: string): Promise<({
        id: string;
        agentName: string | null;
        customerName: string | null;
        channel: string | null;
        score: number;
        feedback: string | null;
        transcript: unknown;
        metadata: unknown;
        createdAt: Date;
    } & {
        customerPictureUrl: string | null;
        fromAd: boolean;
        adId: string | null;
        adTitle: string | null;
        referralSource: string | null;
    })[]>;
    getAuditDayStats(auditDate?: string, auditDateFrom?: string, auditDateTo?: string, pageId?: string): Promise<{
        auditDate: string;
        auditDateFrom: string;
        auditDateTo: string;
        pageId: string | null;
        total: number;
        passed: number;
        failed: number;
        fromAd: number;
    }>;
    getAuditComparison(auditDate?: string, auditId?: string): Promise<{
        auditDate: string;
        auditId: string;
        staff: number;
        team: number;
        overall: number;
        staffSampleSize: number;
        teamSampleSize: number;
        daySampleSize: number;
    }>;
    getAuditScoreHistory(auditId?: string): Promise<{
        auditId: string;
        points: {
            auditId: string;
            auditDate: string;
            score: number;
            label: string;
        }[];
    }>;
    getAiBalance(): Promise<{
        isAvailable?: boolean;
        currency?: string;
        totalBalance?: number;
        grantedBalance?: number;
        toppedUpBalance?: number;
        model?: string;
        error?: boolean;
        message?: string;
    }>;
    verifyWebhook(mode: string, token: string, challenge: string): string;
    handleWebhook(req: RawBodyRequest<Request>, signature: string): Promise<{
        ok: boolean;
    }>;
    listInboxConversations(pageId?: string): Promise<{
        id: string;
        tenantId: string | null;
        createdAt: Date;
        updatedAt: Date;
        pageName: string | null;
        customerName: string | null;
        pageId: string;
        fbConversationId: string | null;
        participantPsid: string;
        customerPictureUrl: string | null;
        lastMessage: string | null;
        lastMessageAt: Date | null;
        unreadCount: number;
        fromAd: boolean;
        adId: string | null;
        adTitle: string | null;
        referralSource: string | null;
        referralAt: Date | null;
    }[]>;
    inboxStream(): Observable<MessageEvent>;
    getInboxMessages(id: string, since?: string, refresh?: string, limit?: string): Promise<{
        conversation: {
            id: string;
            tenantId: string | null;
            createdAt: Date;
            updatedAt: Date;
            pageName: string | null;
            customerName: string | null;
            pageId: string;
            fbConversationId: string | null;
            participantPsid: string;
            customerPictureUrl: string | null;
            lastMessage: string | null;
            lastMessageAt: Date | null;
            unreadCount: number;
            fromAd: boolean;
            adId: string | null;
            adTitle: string | null;
            referralSource: string | null;
            referralAt: Date | null;
        };
        messages: {
            id: string;
            tenantId: string | null;
            text: string;
            attachmentUrl: string | null;
            messageType: string;
            status: string;
            conversationId: string;
            fbMessageId: string | null;
            direction: string;
            senderType: string;
            sentAt: Date;
        }[];
    }>;
    resolveInboxMessageMedia(messageId: string): Promise<{
        id: string;
        attachmentUrl: string;
        attachmentUrls: string[] | undefined;
        messageType: string;
        text: string;
    } | {
        id: string;
        attachmentUrl: null;
        messageType: string;
        text: string;
        attachmentUrls?: undefined;
    }>;
    getInboxCustomerIntent(id: string, auditId?: string): Promise<import("./cskh-inbox-realtime.service").CustomerIntentPayload>;
    sendInboxMessage(id: string, body: {
        text?: string;
    }): Promise<{
        id: string;
        tenantId: string | null;
        text: string;
        attachmentUrl: string | null;
        messageType: string;
        status: string;
        conversationId: string;
        fbMessageId: string | null;
        direction: string;
        senderType: string;
        sentAt: Date;
    }>;
    notifyInboxTyping(id: string): Promise<void>;
    markInboxAsRead(id: string): Promise<{
        markedAsRead: number;
    }>;
    syncInbox(body: {
        pageId?: string;
    }): Promise<{
        synced: number;
        pageCount: number;
    }>;
    linkAuditInbox(body: {
        auditId?: string;
    }): Promise<{
        id: string;
        tenantId: string | null;
        createdAt: Date;
        updatedAt: Date;
        pageName: string | null;
        customerName: string | null;
        pageId: string;
        fbConversationId: string | null;
        participantPsid: string;
        customerPictureUrl: string | null;
        lastMessage: string | null;
        lastMessageAt: Date | null;
        unreadCount: number;
        fromAd: boolean;
        adId: string | null;
        adTitle: string | null;
        referralSource: string | null;
        referralAt: Date | null;
    }>;
    getInboxAuditHint(id: string): Promise<{
        id: string;
        score: number;
        feedback: string | null;
        metadata: unknown;
        transcript: unknown;
        customerName: string | null;
        agentName: string | null;
        createdAt: Date;
    } | null>;
    proxyAvatar(req: Request, res: Response): Promise<void>;
    proxyMedia(req: Request, res: Response): Promise<void>;
    pageAvatar(pageId: string, res: Response): Promise<void>;
    customerAvatar(pageId: string, psid: string, res: Response): Promise<void>;
}
