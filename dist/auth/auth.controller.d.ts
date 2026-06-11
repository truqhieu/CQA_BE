import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import type { User } from '@prisma/client';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    register(registerDto: RegisterDto): Promise<{
        success: boolean;
        message: string;
        data: {
            accessToken: string;
            refreshToken: string;
            user: {
                fullName: string;
                email: string;
                phoneNumber: string | null;
                avatarUrl: string | null;
                role: string;
                isActive: boolean;
                id: number;
                tenantId: string | null;
                createdAt: Date;
                updatedAt: Date;
            };
        };
    }>;
    login(loginDto: LoginDto): Promise<{
        success: boolean;
        message: string;
        data: {
            accessToken: string;
            refreshToken: string;
            user: {
                fullName: string;
                email: string;
                phoneNumber: string | null;
                avatarUrl: string | null;
                role: string;
                isActive: boolean;
                id: number;
                tenantId: string | null;
                createdAt: Date;
                updatedAt: Date;
            };
        };
    }>;
    refreshToken(refreshTokenDto: RefreshTokenDto): Promise<{
        success: boolean;
        message: string;
        data: {
            accessToken: string;
            refreshToken: string;
            user: {
                fullName: string;
                email: string;
                phoneNumber: string | null;
                avatarUrl: string | null;
                role: string;
                isActive: boolean;
                id: number;
                tenantId: string | null;
                createdAt: Date;
                updatedAt: Date;
            };
        };
    }>;
    getProfile(user: User): Promise<{
        success: boolean;
        message: string;
        data: {
            fullName: string;
            email: string;
            phoneNumber: string | null;
            avatarUrl: string | null;
            role: string;
            isActive: boolean;
            id: number;
            tenantId: string | null;
            createdAt: Date;
            updatedAt: Date;
        };
    }>;
    logout(req: any): Promise<{
        success: boolean;
        message: string;
    }>;
}
