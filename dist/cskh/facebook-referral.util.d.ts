export type FbWebhookReferral = {
    ref?: string;
    source?: string;
    type?: string;
    ad_id?: string;
    ads_context_data?: {
        ad_title?: string;
        photo_url?: string;
        video_url?: string;
        post_id?: string;
    };
};
export type ParsedAdReferral = {
    fromAd: boolean;
    adId: string | null;
    adTitle: string | null;
    referralSource: string | null;
};
export declare function isAdReferralNoiseText(text: string): boolean;
export declare function parseWebhookReferral(referral: FbWebhookReferral | null | undefined): ParsedAdReferral;
export declare function detectAdFromMessageTexts(texts: string[]): ParsedAdReferral;
export declare function detectAdFromFbMessages(messages: Array<{
    message?: string | null;
}>): ParsedAdReferral;
