import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';
declare const LocalStrategy_base: new (...args: [] | [options: import("passport-local").IStrategyOptionsWithRequest] | [options: import("passport-local").IStrategyOptions]) => Strategy & {
    validate(...args: any[]): unknown;
};
export declare class LocalStrategy extends LocalStrategy_base {
    private readonly authService;
    constructor(authService: AuthService);
    validate(email: string, password: string): Promise<{
        fullName: string;
        email: string;
        password: string;
        phoneNumber: string | null;
        avatarUrl: string | null;
        role: string;
        isActive: boolean;
        id: number;
        tenantId: string | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
}
export {};
