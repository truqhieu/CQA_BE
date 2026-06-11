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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let UsersService = class UsersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createUserDto) {
        return this.prisma.user.create({
            data: createUserDto,
        });
    }
    async findAll() {
        return this.prisma.user.findMany({
            select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
                isActive: true,
                avatarUrl: true,
                phoneNumber: true,
                tenantId: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    }
    async findById(id) {
        return this.prisma.user.findUnique({
            where: { id },
        });
    }
    async findByEmail(email) {
        return this.prisma.user.findUnique({
            where: { email },
        });
    }
    async update(id, updateUserDto) {
        const user = await this.findById(id);
        if (!user) {
            throw new common_1.NotFoundException(`Không tìm thấy người dùng với id ${id}`);
        }
        return this.prisma.user.update({
            where: { id },
            data: updateUserDto,
        });
    }
    async remove(id) {
        const user = await this.findById(id);
        if (!user) {
            throw new common_1.NotFoundException(`Không tìm thấy người dùng với id ${id}`);
        }
        await this.prisma.user.delete({
            where: { id },
        });
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], UsersService);
//# sourceMappingURL=users.service.js.map