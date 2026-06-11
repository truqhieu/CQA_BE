import { AiService } from './ai.service';
export declare class AiController {
    private readonly aiService;
    constructor(aiService: AiService);
    auditChat(body: any): Promise<{
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
}
