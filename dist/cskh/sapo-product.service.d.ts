import { ConfigService } from '@nestjs/config';
export type SapoCatalogVariant = {
    productId: number;
    variantId: number;
    productTitle: string;
    variantTitle: string;
    price: string;
    compareAtPrice: string | null;
    sku: string | null;
    tags: string;
    imageUrl: string | null;
    inventoryQuantity: number | null;
};
export declare class SapoProductService {
    private readonly config;
    private readonly logger;
    private cache;
    private readonly cacheTtlMs;
    constructor(config: ConfigService);
    isConfigured(): boolean;
    private storeHost;
    private accessToken;
    getCatalog(force?: boolean): Promise<SapoCatalogVariant[]>;
}
