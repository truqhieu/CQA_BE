import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { PrismaService, Prisma } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { FacebookGraphService } from './facebook-graph.service';
export declare class CskhService implements OnModuleInit {
    private readonly prisma;
    private readonly aiService;
    private readonly graph;
    private readonly config;
    private readonly logger;
    private readonly delayBetweenMs;
    private readonly monitorMax;
    private readonly auditMax;
    private readonly auditConcurrency;
    private readonly auditFetchConcurrency;
    private readonly auditPageConcurrency;
    private readonly auditMsgLimit;
    private readonly auditAiTranscriptMax;
    private readonly auditProgressEvery;
    private readonly monitorMaxPages;
    private readonly monitorPageConcurrency;
    private readonly monitorMsgConcurrency;
    constructor(prisma: PrismaService, aiService: AiService, graph: FacebookGraphService, config: ConfigService);
    onModuleInit(): Promise<void>;
    cancelRunningJobs(type: 'monitor' | 'audit', reason?: string): Promise<number>;
    requestAuditPause(): Promise<{
        paused: boolean;
        message: string;
        jobId?: undefined;
    } | {
        paused: boolean;
        jobId: string;
        message?: undefined;
    }>;
    private isAuditJobCancelled;
    private shouldStopAuditJob;
    private loadAuditedConversationKeys;
    private isConversationAlreadyAudited;
    private loadInboxAdMaps;
    private failGhostJobIfNeeded;
    private frontendUrl;
    defaultOAuthReturnUrl(): string;
    getOAuthStartUrl(returnUrl?: string): string;
    listPages(): Promise<{
        pages: {
            pageId: string;
            pageName: string | null;
            enabled: boolean;
            updatedAt: Date;
            pagePictureUrl: string | null;
            metadata: Prisma.JsonValue;
        }[];
        oauthConnected: boolean;
        oauthUser: string | null;
        oauthUpdatedAt: Date | null;
        oauthExpiresAt: Date | null;
    }>;
    private pagePictureUrl;
    private enrichPagePictures;
    savePageConfig(data: {
        pageId: string;
        pageName?: string;
        pageAccessToken: string;
        metadata?: Record<string, unknown>;
    }): Promise<{
        pageId: string;
        pageName: string | null;
        enabled: boolean;
        updatedAt: Date;
    }>;
    setPageEnabled(pageId: string, enabled: boolean): Promise<{
        pageId: string;
        enabled: boolean;
    }>;
    setPagesEnabledBulk(enabled: boolean, pageIds?: string[]): Promise<{
        updated: number;
        enabled: boolean;
    }>;
    deletePage(pageId: string): Promise<{
        ok: boolean;
        pageId: string;
    }>;
    private exchangeCodeForUserToken;
    private fetchManagedPages;
    private upsertPagesFromAccounts;
    handleOAuthCallback(code: string, state: string): Promise<{
        returnUrl: string;
        pageCount: number;
        fbUserName: string | null;
    }>;
    refreshPagesFromOAuth(): Promise<{
        pageCount: number;
        oauthUser: string;
    }>;
    private enabledPages;
    private allPages;
    createJob(type: 'monitor' | 'audit'): Promise<{
        error: string | null;
        id: string;
        tenantId: string | null;
        summary: Prisma.JsonValue | null;
        type: string;
        status: string;
        startedAt: Date;
        finishedAt: Date | null;
    }>;
    releaseStaleJobs(type: 'monitor' | 'audit', maxAgeMs?: number): Promise<void>;
    findRunningJob(type: 'monitor' | 'audit'): Promise<{
        error: string | null;
        id: string;
        tenantId: string | null;
        summary: Prisma.JsonValue | null;
        type: string;
        status: string;
        startedAt: Date;
        finishedAt: Date | null;
    } | null>;
    getRunningJob(type: 'monitor' | 'audit'): Promise<{
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
        summary: Prisma.JsonValue | null;
        type: string;
        status: string;
        startedAt: Date;
        finishedAt: Date | null;
    } | null>;
    updateJobProgress(jobId: string, summary: Record<string, unknown>): Promise<{
        summary: Prisma.JsonValue;
        status: string;
    } | null>;
    private runWithConcurrency;
    private runWithConcurrencyStoppable;
    finishJob(jobId: string, status: 'done' | 'failed', summary?: Record<string, unknown>, error?: string): Promise<{
        error: string | null;
        id: string;
        tenantId: string | null;
        summary: Prisma.JsonValue | null;
        type: string;
        status: string;
        startedAt: Date;
        finishedAt: Date | null;
    }>;
    getJob(jobId: string): Promise<{
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
        summary: Prisma.JsonValue | null;
        type: string;
        status: string;
        startedAt: Date;
        finishedAt: Date | null;
    }>;
    getLatestMonitor(): Promise<({
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
        summary: Prisma.JsonValue | null;
        type: string;
        status: string;
        startedAt: Date;
        finishedAt: Date | null;
    }) | null>;
    private buildMonitorItem;
    private fetchMonitorConversations;
    runMonitorJob(jobId: string, maxConversations?: number): Promise<void>;
    runAuditJob(jobId: string, options: {
        auditDate?: string;
        auditDateFrom?: string;
        auditDateTo?: string;
        maxConversations?: number;
        force?: boolean;
        pageId?: string;
    }): Promise<void>;
    getDeepSeekBalance(): Promise<{
        isAvailable?: boolean;
        currency?: string;
        totalBalance?: number;
        grantedBalance?: number;
        toppedUpBalance?: number;
        model?: string;
        error?: boolean;
        message?: string;
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
    listAudits(params: {
        pageId?: string;
        jobRunId?: string;
        auditDate?: string;
        auditDateFrom?: string;
        auditDateTo?: string;
        limit?: number;
    }): Promise<({
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
    getAuditDayStats(auditDateFrom: string, auditDateTo?: string, pageId?: string): Promise<{
        auditDate: string;
        auditDateFrom: string;
        auditDateTo: string;
        pageId: string | null;
        total: number;
        passed: number;
        failed: number;
        fromAd: number;
    }>;
    getAuditComparisonStats(auditDate: string, auditId: string): Promise<{
        auditDate: string;
        auditId: string;
        staff: number;
        team: number;
        overall: number;
        staffSampleSize: number;
        teamSampleSize: number;
        daySampleSize: number;
    }>;
    getAuditScoreHistory(auditId: string): Promise<{
        auditId: string;
        points: {
            auditId: string;
            auditDate: string;
            score: number;
            label: string;
        }[];
    }>;
    private customerPictureFromMetadata;
    private auditAdFromMetadata;
    private attachAuditInboxContext;
    private attachCustomerPictures;
    private fetchAndCacheCustomerPicture;
    proxyMediaUrl(rawUrl: string, res: Response): Promise<void>;
    proxyAvatarUrl(rawUrl: string, res: Response): Promise<void>;
    streamPageAvatar(pageId: string, res: Response): Promise<void>;
    streamCustomerAvatar(pageId: string, psid: string, res: Response): Promise<void>;
    private listAuditsByJobRunId;
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
    subscribePageToWebhook(pageId: string, pageAccessToken: string): Promise<any>;
}
