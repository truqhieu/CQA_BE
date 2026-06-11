"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAdReferralNoiseText = isAdReferralNoiseText;
exports.parseWebhookReferral = parseWebhookReferral;
exports.detectAdFromMessageTexts = detectAdFromMessageTexts;
exports.detectAdFromFbMessages = detectAdFromFbMessages;
const AD_NOISE_PATTERNS = [
    /đã trả lời một quảng cáo/i,
    /replied to (?:your|an?) ad/i,
    /replied to an advertisement/i,
    /^Bạn đã trả lời qua quảng cáo/i,
    /^You replied via ad/i,
    /Through Facebook ads/i,
    /Qua quảng cáo trên Facebook/i,
];
function isAdReferralNoiseText(text) {
    const t = text.trim();
    if (!t)
        return false;
    return AD_NOISE_PATTERNS.some((p) => p.test(t));
}
function parseWebhookReferral(referral) {
    if (!referral || typeof referral !== 'object') {
        return { fromAd: false, adId: null, adTitle: null, referralSource: null };
    }
    const source = typeof referral.source === 'string' ? referral.source.trim() : null;
    const adId = typeof referral.ad_id === 'string' && referral.ad_id.trim() ? referral.ad_id.trim() : null;
    const adTitle = typeof referral.ads_context_data?.ad_title === 'string' &&
        referral.ads_context_data.ad_title.trim()
        ? referral.ads_context_data.ad_title.trim()
        : null;
    const fromAd = source === 'ADS' || Boolean(adId);
    return {
        fromAd,
        adId,
        adTitle,
        referralSource: source,
    };
}
function detectAdFromMessageTexts(texts) {
    const hit = texts.some(isAdReferralNoiseText);
    return {
        fromAd: hit,
        adId: null,
        adTitle: null,
        referralSource: hit ? 'HEURISTIC' : null,
    };
}
function detectAdFromFbMessages(messages) {
    const texts = messages.map((m) => (m.message ?? '').trim()).filter(Boolean);
    return detectAdFromMessageTexts(texts);
}
//# sourceMappingURL=facebook-referral.util.js.map