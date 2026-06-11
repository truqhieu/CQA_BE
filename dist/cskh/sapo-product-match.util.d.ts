import type { SapoCatalogVariant } from './sapo-product.service';
export type MatchedInterestedProduct = {
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
export declare function matchInterestedProducts(catalog: SapoCatalogVariant[], mentions: string[], topics: string[], summary: string, limit?: number): MatchedInterestedProduct[];
