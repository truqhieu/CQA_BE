import { ConfigService } from '@nestjs/config';
export declare class SapoOAuthService {
    private readonly config;
    private readonly logger;
    constructor(config: ConfigService);
    getRedirectUri(): string;
    getOAuthStartUrl(): string;
    exchangeCode(code: string): Promise<{
        accessToken: string;
        sampleProductTitle: string | null;
    }>;
    isOAuthConfigured(): boolean;
    private requireStore;
    private requireClientId;
    private requireClientSecret;
    private fetchSampleProductTitle;
}
