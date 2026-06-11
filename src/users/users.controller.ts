import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from './entities/user.entity';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // GET /users
  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async findAll() {
    return {
      success: true,
      data: await this.usersService.findAll(),
    };
  }

  // GET /users/:id
  @Get(':id')
  @Roles(UserRole.ADMIN)
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return {
      success: true,
      data: await this.usersService.findById(id),
    };
  }

  // PATCH /users/:id
  @Patch(':id')
  @Roles(UserRole.ADMIN)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return {
      success: true,
      message: 'Cập nhật thành công',
      data: await this.usersService.update(id, updateUserDto),
    };
  }

  // DELETE /users/:id
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.usersService.remove(id);
    return {
      success: true,
      message: 'Xóa người dùng thành công',
    };
  }
}
