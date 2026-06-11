import type { FbMessage } from './facebook-graph.service';
export type ChatMessageType = 'text' | 'image' | 'video' | 'sticker';
export type NormalizedChatMessage = {
    text: string;
    attachmentUrl?: string | null;
    attachmentUrls?: string[];
    messageType: ChatMessageType;
    sender: 'Staff' | 'Customer';
    timestamp: string;
};
export declare function isNoiseMessageText(text: string): boolean;
export declare function isFbMediaUrl(url: string): boolean;
export declare function isVideoMediaUrl(url: string): boolean;
export declare function isImageMediaUrl(url: string): boolean;
export declare function looksLikeFbMediaFragment(text: string): boolean;
export declare function looksLikeEmbeddedMediaText(text: string): boolean;
export declare function parseMediaFromText(text: string): {
    displayText: string;
    attachmentUrl: string | null;
    messageType: ChatMessageType;
};
export declare function repairStoredMessage(text: string, attachmentUrl?: string | null, messageType?: string | null): {
    changed: boolean;
    text: string;
    attachmentUrl: string | null;
    messageType: ChatMessageType;
};
type FbAttachment = {
    mime_type?: string;
    type?: string;
    id?: string;
    url?: string;
    image_url?: string;
    image_data?: {
        url?: string;
        preview_url?: string;
        media_url?: string;
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
};
export declare function pickAttachmentUrl(att: FbAttachment | null | undefined): string | null;
export declare function dedupeMediaUrls(urls: (string | null | undefined)[]): string[];
export declare function attachmentMediaKind(att: FbAttachment | null | undefined): 'video' | 'image' | null;
export declare function messageNeedsMediaResolve(msg: FbMessage): boolean;
export declare function extractAllMessageAttachments(msg: FbMessage): Array<{
    attachmentUrl: string | null;
    messageType: ChatMessageType;
    label: string;
}>;
export declare function extractMessageAttachment(msg: FbMessage): {
    attachmentUrl?: string | null;
    messageType: ChatMessageType;
    label: string;
};
export declare function normalizeFbMessage(msg: FbMessage, pageId: string): NormalizedChatMessage | null;
export declare function dedupeChatMessages(messages: NormalizedChatMessage[]): NormalizedChatMessage[];
export declare const FB_ATTACHMENT_FIELDS = "type,mime_type,id,url,image_url,image_data{url,preview_url,media_url,width,height},video_data{url,preview_url},file_url,payload{url,template_type,elements{image_url,title,subtitle}}";
export declare const FB_MESSAGE_ATTACHMENT_FIELDS = "attachments{type,mime_type,id,url,image_url,image_data{url,preview_url,media_url,width,height},video_data{url,preview_url},file_url,payload{url,template_type,elements{image_url,title,subtitle}}}";
export declare const FB_MESSAGE_FIELDS = "id,message,from,created_time,sticker,attachments{type,mime_type,id,url,image_url,image_data{url,preview_url,media_url,width,height},video_data{url,preview_url},file_url,payload{url,template_type,elements{image_url,title,subtitle}}}";
export declare function isAllowedFacebookMediaUrl(raw: string): boolean;
export declare function parseMediaProxyUrlFromRequest(rawUrl: string, queryUrl: unknown): string;
export {};
