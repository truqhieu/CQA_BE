export type IntentMessage = {
    sender: string;
    text: string;
};
export declare function transcriptToIntentMessages(transcript: unknown): IntentMessage[];
export declare function inboxToIntentMessages(rows: Array<{
    senderType: string;
    text: string;
}>): IntentMessage[];
export declare function mergeTranscriptWithInboxTail(transcript: unknown, inboxRows: Array<{
    senderType: string;
    text: string;
    sentAt: Date;
}>): IntentMessage[];
export declare function capIntentMessages(messages: IntentMessage[], max?: number): IntentMessage[];
export declare function intentMessagesSignature(messages: IntentMessage[]): string;
