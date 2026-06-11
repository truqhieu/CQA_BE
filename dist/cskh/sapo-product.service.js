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
var SapoProductService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SapoProductService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = __importDefault(require("axios"));
let SapoProductService = SapoProductService_1 = class SapoProductService {
    config;
    logger = new common_1.Logger(SapoProductService_1.name);
    cache = null;
    cacheTtlMs = 15 * 60_000;
    constructor(config) {
        this.config = config;
    }
    isConfigured() {
        return Boolean(this.storeHost() && this.accessToken());
    }
    storeHost() {
        const raw = (this.config.get('SAPO_STORE') ?? '').trim();
        if (!raw)
            return null;
        if (raw.includes('mysapo.net'))
            return raw.replace(/^https?:\/\//, '').replace(/\/$/, '');
        return `${raw.replace(/\.mysapo\.net$/i, '')}.mysapo.net`;
    }
    accessToken() {
        const token = (this.config.get('SAPO_ACCESS_TOKEN') ?? '').trim();
        return token || null;
    }
    async getCatalog(force = false) {
        if (!this.isConfigured())
            return [];
        if (!force && this.cache && Date.now() - this.cache.at < this.cacheTtlMs) {
            return this.cache.items;
        }
        const host = this.storeHost();
        const token = this.accessToken();
        const items = [];
        const baseUrl = `https://${host}/admin/products.json`;
        try {
            for (let page = 1; page <= 10; page++) {
                const { data } = await axios_1.default.get(baseUrl, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Sapo-Access-Token': token,
                    },
                    params: { limit: 250, page },
                    timeout: 30_000,
                });
                const products = data.products ?? [];
                if (!products.length)
                    break;
                for (const p of products) {
                    const productId = p.id ?? 0;
                    const productTitle = (p.title ?? '').trim();
                    const tags = (p.tags ?? '').trim();
                    const images = p.images ?? [];
                    const imageById = new Map(images.filter((i) => i.id).map((i) => [i.id, i.src ?? null]));
                    for (const v of p.variants ?? []) {
                        const variantId = v.id ?? 0;
                        if (!productId || !variantId)
                            continue;
                        const imageUrl = v.image_id != null ? (imageById.get(v.image_id) ?? images[0]?.src ?? null) : images[0]?.src ?? null;
                        items.push({
                            productId,
                            variantId,
                            productTitle,
                            variantTitle: (v.title ?? 'Default').trim(),
                            price: String(v.price ?? '0'),
                            compareAtPrice: v.compare_at_price ?? null,
                            sku: v.sku ?? null,
                            tags,
                            imageUrl,
                            inventoryQuantity: typeof v.inventory_quantity === 'number' ? v.inventory_quantity : null,
                        });
                    }
                }
                if (products.length < 250)
                    break;
                await new Promise((r) => setTimeout(r, 550));
            }
            this.cache = { at: Date.now(), items };
            this.logger.log(`Sapo catalog loaded: ${items.length} variants`);
            return items;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.warn(`Sapo products fetch failed: ${msg}`);
            return this.cache?.items ?? [];
        }
    }
};
exports.SapoProductService = SapoProductService;
exports.SapoProductService = SapoProductService = SapoProductService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SapoProductService);
//# sourceMappingURL=sapo-product.service.js.map