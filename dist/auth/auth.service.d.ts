import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { User } from '@prisma/client';
export declare class AuthService {
    private readonly usersService;
    private readonly jwtService;
    private readonly configService;
    constructor(usersService: UsersService, jwtService: JwtService, configService: ConfigService);
    validateUser(email: string, password: string): Promise<User | null>;
    register(registerDto: RegisterDto): Promise<{
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
    }>;
    login(loginDto: LoginDto): Promise<{
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
    }>;
    refreshToken(refreshToken: string): Promise<{
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
    }>;
    getProfile(userId: number): Promise<{
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
    }>;
    private generateTokens;
    private sanitizeUser;
}
