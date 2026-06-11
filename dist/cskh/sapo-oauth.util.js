"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAPO_DEFAULT_SCOPES = void 0;
exports.normalizeSapoStoreHost = normalizeSapoStoreHost;
exports.buildSapoAuthorizeUrl = buildSapoAuthorizeUrl;
exports.exchangeSapoAccessToken = exchangeSapoAccessToken;
const axios_1 = __importDefault(require("axios"));
exports.SAPO_DEFAULT_SCOPES = 'read_products,read_inventory';
function normalizeSapoStoreHost(store) {
    const raw = store.trim();
    if (!raw)
        return '';
    if (raw.includes('mysapo.net')) {
        return raw.replace(/^https?:\/\//, '').replace(/\/$/, '');
    }
    return `${raw.replace(/\.mysapo\.net$/i, '')}.mysapo.net`;
}
function buildSapoAuthorizeUrl(input) {
    const host = normalizeSapoStoreHost(input.store);
    const params = new URLSearchParams({
        client_id: input.clientId.trim(),
        scope: (input.scopes ?? exports.SAPO_DEFAULT_SCOPES).trim(),
        redirect_uri: input.redirectUri.trim(),
    });
    return `https://${host}/admin/oauth/authorize?${params.toString()}`;
}
async function exchangeSapoAccessToken(input) {
    const host = normalizeSapoStoreHost(input.store);
    const { data } = await axios_1.default.post(`https://${host}/admin/oauth/access_token`, {
        client_id: input.clientId.trim(),
        client_secret: input.clientSecret.trim(),
        code: input.code.trim(),
    }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30_000,
    });
    const token = (data.access_token ?? '').trim();
    if (!token) {
        throw new Error('Sapo không trả access_token — code có thể đã hết hạn hoặc redirect_uri không khớp');
    }
    return token;
}
//# sourceMappingURL=sapo-oauth.util.js.map