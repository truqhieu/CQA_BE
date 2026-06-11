import { PrismaService } from '../prisma/prisma.service';
export declare class AiService {
    private readonly prisma;
    private readonly logger;
    private readonly aiBaseUrl;
    private readonly auditAiTimeoutMs;
    private readonly aiHttp;
    private auditAgentUserCache;
    constructor(prisma: PrismaService);
    resetAuditBatchCaches(): void;
    private resolveAuditUserId;
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
    auditChat(data: {
        transcript: unknown;
        aiTranscript?: unknown;
        agentName?: string;
        email?: string;
        customerName?: string;
        channel?: string;
        noReply?: boolean;
        metadata?: Record<string, unknown>;
    }): Promise<{
        tokenUsage: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
            model?: string;
        } | null;
        id: string;
        tenantId: string | null;
        createdAt: Date;
        updatedAt: Date;
        agentName: string | null;
        customerName: string | null;
        channel: string | null;
        score: number;
        feedback: string | null;
        transcript: import("@prisma/client/runtime/library").JsonValue | null;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
        userId: number | null;
        error?: undefined;
        message?: undefined;
        detail?: undefined;
    } | {
        error: boolean;
        message: string;
        detail: {} | undefined;
    }>;
    analyzeCustomerIntent(data: {
        messages: Array<{
            sender: string;
            text: string;
        }>;
        customerName?: string | null;
    }): Promise<{
        summary: string;
        intentLabel: string;
        topics: string[];
        productMentions: string[];
        urgency: 'low' | 'normal' | 'high';
        suggestedFocus: string;
    }>;
}
