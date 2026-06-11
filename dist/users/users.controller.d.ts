import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
export declare class UsersController {
    private readonly usersService;
    constructor(usersService: UsersService);
    findAll(): Promise<{
        success: boolean;
        data: Omit<{
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
        }, "password">[];
    }>;
    findOne(id: number): Promise<{
        success: boolean;
        data: {
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
        } | null;
    }>;
    update(id: number, updateUserDto: UpdateUserDto): Promise<{
        success: boolean;
        message: string;
        data: {
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
        };
    }>;
    remove(id: number): Promise<{
        success: boolean;
        message: string;
    }>;
}
