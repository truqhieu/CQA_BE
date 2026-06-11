import { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
export type InboxMessagePayload = {
    id: string;
    conversationId: string;
    fbMessageId: string | null;
    direction: string;
    senderType: string;
    text: string;
    messageType: string;
    attachmentUrl: string | null;
    sentAt: string;
    status: string;
};
export type InboxConversationPayload = {
    id: string;
    pageId: string;
    pageName: string | null;
    participantPsid: string;
    customerName: string | null;
    customerPictureUrl: string | null;
    lastMessage: string | null;
    lastMessageAt: string | null;
    unreadCount: number;
    fromAd: boolean;
    adTitle: string | null;
};
export type CustomerInterestedProduct = {
    productId: number;
    variantId: number;
    name: string;
    variantTitle: string;
    price: number;
    priceLabel: string;
    compareAtPrice: number | null;
    sku: string | null;
    imageUrl: string | null;
    inStock: boolean;
    matchReason: string;
};
export type CustomerIntentPayload = {
    summary: string;
    intentLabel: string;
    topics: string[];
    urgency: 'low' | 'normal' | 'high';
    suggestedFocus: string;
    analyzedAt: string;
    productMentions?: string[];
    products?: CustomerInterestedProduct[];
    sapoConfigured?: boolean;
};
export type InboxRealtimePayload = {
    type: 'conversation' | 'message' | 'intent' | 'typing' | 'read-receipt' | 'ping';
    pageId?: string;
    conversationId?: string;
    messages?: InboxMessagePayload[];
    conversation?: InboxConversationPayload;
    intent?: CustomerIntentPayload;
};
export declare class CskhInboxRealtimeService {
    private readonly bus;
    publish(payload: InboxRealtimePayload): void;
    stream(): Observable<MessageEvent>;
}
