"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRAPH_VERSION = exports.GRAPH_BASE = exports.FB_OAUTH_SCOPES = void 0;
exports.getFacebookAppId = getFacebookAppId;
exports.getFacebookAppSecret = getFacebookAppSecret;
exports.getFacebookOAuthRedirectUri = getFacebookOAuthRedirectUri;
exports.signOAuthState = signOAuthState;
exports.verifyOAuthState = verifyOAuthState;
exports.buildFacebookOAuthUrl = buildFacebookOAuthUrl;
exports.getFacebookWebhookVerifyToken = getFacebookWebhookVerifyToken;
exports.verifyFacebookWebhookSignature = verifyFacebookWebhookSignature;
const crypto_1 = require("crypto");
const GRAPH_VERSION = process.env.FB_GRAPH_VERSION?.trim() || 'v21.0';
exports.GRAPH_VERSION = GRAPH_VERSION;
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
exports.GRAPH_BASE = GRAPH_BASE;
exports.FB_OAUTH_SCOPES = [
    'pages_show_list',
    'pages_messaging',
    'pages_manage_metadata',
    'pages_read_engagement',
].join(',');
function getFacebookAppId() {
    return process.env.FB_APP_ID?.trim() || '';
}
function getFacebookAppSecret() {
    return process.env.FB_APP_SECRET?.trim() || '';
}
function getFacebookOAuthRedirectUri() {
    const explicit = process.env.FB_OAUTH_REDIRECT_URI?.trim();
    if (explicit)
        return explicit;
    const base = (process.env.PUBLIC_BE_URL || process.env.BE_PUBLIC_URL || 'http://localhost:3003').replace(/\/$/, '');
    return `${base}/cskh/oauth/callback`;
}
function oauthStateSecret() {
    return (process.env.FB_OAUTH_STATE_SECRET?.trim() ||
        process.env.JWT_SECRET?.trim() ||
        'dev-oauth-state-secret');
}
function signOAuthState(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = (0, crypto_1.createHmac)('sha256', oauthStateSecret()).update(body).digest('base64url');
    return `${body}.${sig}`;
}
function verifyOAuthState(state) {
    const [body, sig] = state.split('.');
    if (!body || !sig)
        return null;
    const expected = (0, crypto_1.createHmac)('sha256', oauthStateSecret()).update(body).digest('base64url');
    try {
        if (!(0, crypto_1.timingSafeEqual)(Buffer.from(sig), Buffer.from(expected)))
            return null;
        return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    }
    catch {
        return null;
    }
}
function buildFacebookOAuthUrl(returnUrl) {
    const appId = getFacebookAppId();
    if (!appId)
        throw new Error('FB_APP_ID chưa cấu hình trên BE');
    const redirectUri = getFacebookOAuthRedirectUri();
    const state = signOAuthState({
        returnUrl: returnUrl || '',
        nonce: (0, crypto_1.randomBytes)(16).toString('hex'),
    });
    const params = new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri,
        state,
        scope: exports.FB_OAUTH_SCOPES,
        response_type: 'code',
    });
    return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}
function getFacebookWebhookVerifyToken() {
    return process.env.FB_WEBHOOK_VERIFY_TOKEN?.trim() || 'cskh-webhook-verify';
}
function verifyFacebookWebhookSignature(rawBody, signatureHeader) {
    const secret = getFacebookAppSecret();
    if (!secret || !signatureHeader?.startsWith('sha256='))
        return false;
    const expected = (0, crypto_1.createHmac)('sha256', secret).update(rawBody).digest('hex');
    const received = signatureHeader.slice('sha256='.length);
    try {
        return (0, crypto_1.timingSafeEqual)(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=facebook-oauth.util.js.map