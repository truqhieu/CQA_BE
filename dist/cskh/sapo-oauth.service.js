"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var SapoOAuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SapoOAuthService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = __importDefault(require("axios"));
const sapo_oauth_util_1 = require("./sapo-oauth.util");
let SapoOAuthService = SapoOAuthService_1 = class SapoOAuthService {
    config;
    logger = new common_1.Logger(SapoOAuthService_1.name);
    constructor(config) {
        this.config = config;
    }
    getRedirectUri() {
        const explicit = (this.config.get('SAPO_OAUTH_REDIRECT_URI') ?? '').trim();
        if (explicit)
            return explicit;
        const base = (this.config.get('PUBLIC_BE_URL') ?? '').trim().replace(/\/$/, '');
        if (!base) {
            throw new common_1.BadRequestException('Thiếu PUBLIC_BE_URL hoặc SAPO_OAUTH_REDIRECT_URI');
        }
        return `${base}/cskh/sapo/oauth/callback`;
    }
    getOAuthStartUrl() {
        const store = this.requireStore();
        const clientId = this.requireClientId();
        return (0, sapo_oauth_util_1.buildSapoAuthorizeUrl)({
            store,
            clientId,
            redirectUri: this.getRedirectUri(),
            scopes: (this.config.get('SAPO_OAUTH_SCOPES') ?? sapo_oauth_util_1.SAPO_DEFAULT_SCOPES).trim(),
        });
    }
    async exchangeCode(code) {
        if (!code?.trim()) {
            throw new common_1.BadRequestException('Thiếu authorization code');
        }
        const accessToken = await (0, sapo_oauth_util_1.exchangeSapoAccessToken)({
            store: this.requireStore(),
            clientId: this.requireClientId(),
            clientSecret: this.requireClientSecret(),
            code: code.trim(),
        });
        const sampleProductTitle = await this.fetchSampleProductTitle(accessToken);
        this.logger.log(`Sapo OAuth OK — store=${this.requireStore()} sample=${sampleProductTitle ?? 'none'}`);
        return { accessToken, sampleProductTitle };
    }
    isOAuthConfigured() {
        return Boolean((this.config.get('SAPO_STORE') ?? '').trim() &&
            (this.config.get('SAPO_API_KEY') ?? '').trim() &&
            (this.config.get('SAPO_API_SECRET') ?? '').trim());
    }
    requireStore() {
        const store = (this.config.get('SAPO_STORE') ?? '').trim();
        if (!store)
            throw new common_1.BadRequestException('Thiếu SAPO_STORE (ví dụ: vienchibao)');
        return store;
    }
    requireClientId() {
        const id = (this.config.get('SAPO_API_KEY') ?? '').trim();
        if (!id)
            throw new common_1.BadRequestException('Thiếu SAPO_API_KEY (API Key trên Partner App)');
        return id;
    }
    requireClientSecret() {
        const secret = (this.config.get('SAPO_API_SECRET') ?? '').trim();
        if (!secret)
            throw new common_1.BadRequestException('Thiếu SAPO_API_SECRET (Secret Key trên Partner App)');
        return secret;
    }
    async fetchSampleProductTitle(accessToken) {
        const host = (0, sapo_oauth_util_1.normalizeSapoStoreHost)(this.requireStore());
        try {
            const { data } = await axios_1.default.get(`https://${host}/admin/products.json`, {
                headers: { 'X-Sapo-Access-Token': accessToken },
                params: { limit: 1 },
                timeout: 20_000,
            });
            return data.products?.[0]?.title?.trim() ?? null;
        }
        catch {
            return null;
        }
    }
};
exports.SapoOAuthService = SapoOAuthService;
exports.SapoOAuthService = SapoOAuthService = SapoOAuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SapoOAuthService);
//# sourceMappingURL=sapo-oauth.service.js.map