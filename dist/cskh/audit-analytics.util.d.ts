export type TranscriptLine = {
    sender?: string;
    text?: string;
    timestamp?: string;
    type?: string;
};
export declare function trimTranscriptForAi(transcript: TranscriptLine[], maxLines: number): TranscriptLine[];
export type AuditTranscriptMetrics = {
    firstResponseSec: number | null;
    staffReplies: number;
    customerMessages: number;
    proactivePct: number;
};
export type AuditCriterionScores = {
    greeting: number;
    needs: number;
    consult: number;
    objection: number;
    closing: number;
};
export type AuditSentiment = {
    label: string;
    customer: string;
    staff: string;
    tone: 'positive' | 'neutral' | 'negative';
};
export type AuditAnalysisPayload = {
    criteriaScores?: AuditCriterionScores;
    strengths?: string[];
    weaknesses?: string[];
    keywords?: string[];
    sentiment?: AuditSentiment;
    tags?: string[];
    transcriptMetrics?: AuditTranscriptMetrics;
};
export declare function computeTranscriptMetrics(transcript: unknown): AuditTranscriptMetrics;
export declare function parseAiBulletList(value: unknown): string[];
export declare function parseAiCommaList(value: unknown): string[];
export declare function sanitizeAuditKeywords(keywords: string[]): string[];
export declare function parseCriteriaScoresFromAi(raw: Record<string, unknown>): AuditCriterionScores | undefined;
export declare function parseSentimentFromAi(raw: Record<string, unknown>): AuditSentiment | undefined;
export declare function buildAnalysisPayloadFromAi(auditResult: Record<string, unknown>, transcript: unknown): AuditAnalysisPayload;
