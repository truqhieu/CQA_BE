export declare const SAPO_DEFAULT_SCOPES = "read_products,read_inventory";
export declare function normalizeSapoStoreHost(store: string): string;
export declare function buildSapoAuthorizeUrl(input: {
    store: string;
    clientId: string;
    redirectUri: string;
    scopes?: string;
}): string;
export declare function exchangeSapoAccessToken(input: {
    store: string;
    clientId: string;
    clientSecret: string;
    code: string;
}): Promise<string>;
