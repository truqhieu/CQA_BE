export type FbMessage = {
    id?: string;
    message?: string;
    from?: {
        id?: string;
        name?: string;
    };
    created_time?: string;
    sticker?: unknown;
    attachments?: {
        data?: Array<{
            id?: string;
            mime_type?: string;
            type?: string;
            url?: string;
            image_data?: {
                url?: string;
                preview_url?: string;
                width?: number;
                height?: number;
            };
            video_data?: {
                url?: string;
                preview_url?: string;
            };
            file_url?: string;
            payload?: {
                url?: string;
                template_type?: string;
                elements?: Array<{
                    image_url?: string;
                    title?: string;
                    subtitle?: string;
                }>;
            };
        }>;
    };
};
export type FbConversation = {
    id: string;
    updated_time?: string;
    participants?: {
        data?: Array<{
            id?: string;
            name?: string;
            email?: string;
        }>;
    };
    link?: string;
    messages?: {
        data?: FbMessage[];
    };
};
export type TranscriptLine = {
    sender: 'Staff' | 'Customer';
    type: string;
    text: string;
    timestamp: string;
    imageUrl?: string | null;
    videoUrl?: string | null;
    attachmentUrl?: string | null;
    attachmentUrls?: string[];
};
export declare class FacebookGraphService {
    private readonly logger;
    private readonly graphVersion;
    getPagePictureUrl(pageId: string, pageToken: string): Promise<string | null>;
    graphRequest<T>(urlOrPath: string, token: string, params?: Record<string, string | number>): Promise<T>;
    verifyPage(pageId: string, token: string): Promise<{
        id: string;
        name: string;
    }>;
    fetchConversations(pageId: string, token: string, maxCount: number): Promise<FbConversation[]>;
    fetchConversationsForMonitor(pageId: string, token: string, maxCount: number): Promise<FbConversation[]>;
    vietnamDayRange(dateStr: string): {
        start: Date;
        end: Date;
    };
    vietnamDateRange(fromStr: string, toStr: string): {
        start: Date;
        end: Date;
    };
    isWithinDay(isoTime: string | undefined, start: Date, end: Date): boolean;
    filterMessagesByDay(messages: FbMessage[], auditDate: string): FbMessage[];
    filterMessagesByDateRange(messages: FbMessage[], fromStr: string, toStr: string): FbMessage[];
    filterMessagesUpToAuditDate(messages: FbMessage[], auditDate: string): FbMessage[];
    filterMessagesUpToRangeEnd(messages: FbMessage[], toStr: string): FbMessage[];
    private runWithConcurrency;
    fetchConversationsForAuditByDate(pageId: string, token: string, auditDateFrom: string, auditDateTo?: string, msgLimit?: number, onProgress?: (scanned: number, matched: number) => void | Promise<void>, fetchConcurrency?: number, shouldAbort?: () => boolean | Promise<boolean>, convFilter?: (conv: FbConversation) => 'include' | 'exclude' | 'stop', maxNewMatches?: number): Promise<FbConversation[]>;
    private logAuditDateSummary;
    fetchAllConversationsForAudit(pageId: string, token: string, maxCount?: number, msgLimit?: number, onBatch?: (fetchedOnPage: number) => void | Promise<void>): Promise<FbConversation[]>;
    latestMessages(conv: FbConversation): FbMessage[];
    fetchConversationById(conversationId: string, token: string): Promise<FbConversation | null>;
    fetchMessages(conversationId: string, token: string, limit?: number): Promise<FbMessage[]>;
    fetchMessagesForAuditTranscript(conversationId: string, token: string, auditDateFrom: string, auditDateTo?: string, maxMessages?: number): Promise<FbMessage[]>;
    participantInfo(participants: FbConversation['participants'], pageId: string): {
        customerName: string;
        participantPsid: string | null;
    };
    resolveParticipantPsid(participants: FbConversation['participants'], pageId: string): string | null;
    getMessengerUserProfile(psid: string, pageToken: string): Promise<{
        name: string | null;
        pictureUrl: string | null;
    }>;
    getMessengerUserName(psid: string, pageToken: string): Promise<string | null>;
    resolveCustomerName(participants: FbConversation['participants'], pageId: string, messages: FbMessage[], transcript?: TranscriptLine[]): string;
    resolveAgentName(messages: FbMessage[], pageId: string, pageName: string | null | undefined, transcript: TranscriptLine[]): string;
    extractAgentFromPageLabel(label: string): string | undefined;
    private isPlausibleAgentFromLabel;
    parseNamesFromTranscript(transcript: TranscriptLine[]): {
        customerName?: string;
        agentName?: string;
    };
    private normalizePersonName;
    private isGenericCustomerName;
    private isPageOrGenericAgent;
    private isPlausiblePersonName;
    hasStaffMessage(messages: FbMessage[], pageId: string): boolean;
    needsFollowUpOnDay(messages: FbMessage[], pageId: string): boolean;
    private isClosingMessage;
    messagesToTranscript(messages: FbMessage[], pageId: string): TranscriptLine[];
    isStoredMessageNoise(text: string): boolean;
    normalizeMessageForInbox(msg: FbMessage, pageId: string): import("./facebook-message.util").NormalizedChatMessage | null;
    private mediaKindFromAttachment;
    private fetchFirstAttachmentFromMessage;
    resolveAllMessageMediaUrls(messageId: string, token: string): Promise<Array<{
        url: string;
        messageType: 'image' | 'video';
    }>>;
    resolveMessageMediaUrl(messageOrAttachmentId: string, token: string): Promise<{
        url: string | null;
        messageType: 'image' | 'video' | null;
    }>;
    private fetchAttachmentMediaById;
    enrichMessageWithMedia(msg: FbMessage, token: string): Promise<FbMessage>;
    enrichMessagesWithMedia(messages: FbMessage[], token: string): Promise<FbMessage[]>;
    extractAgentName(messages: FbMessage[], pageId: string, pageName?: string | null): string;
    needsReply(messages: FbMessage[], pageId: string): boolean;
    sleep(ms: number): Promise<unknown>;
    graphPost<T>(path: string, token: string, body: Record<string, unknown>): Promise<T>;
    sendPageMessage(pageId: string, token: string, recipientPsid: string, text: string): Promise<{
        message_id?: string;
        recipient_id?: string;
    }>;
}
