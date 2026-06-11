declare const GRAPH_VERSION: string;
declare const GRAPH_BASE: string;
export declare const FB_OAUTH_SCOPES: string;
export declare function getFacebookAppId(): string;
export declare function getFacebookAppSecret(): string;
export declare function getFacebookOAuthRedirectUri(): string;
export declare function signOAuthState(payload: {
    returnUrl: string;
    nonce: string;
}): string;
export declare function verifyOAuthState(state: string): {
    returnUrl: string;
    nonce: string;
} | null;
export declare function buildFacebookOAuthUrl(returnUrl: string): string;
export declare function getFacebookWebhookVerifyToken(): string;
export declare function verifyFacebookWebhookSignature(rawBody: Buffer, signatureHeader?: string): boolean;
export { GRAPH_BASE, GRAPH_VERSION };
