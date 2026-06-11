import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { User } from '@prisma/client';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /auth/register
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto) {
    return {
      success: true,
      message: 'Đăng ký thành công',
      data: await this.authService.register(registerDto),
    };
  }

  // POST /auth/login
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return {
      success: true,
      message: 'Đăng nhập thành công',
      data: await this.authService.login(loginDto),
    };
  }

  // POST /auth/refresh
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
    return {
      success: true,
      message: 'Làm mới token thành công',
      data: await this.authService.refreshToken(refreshTokenDto.refreshToken),
    };
  }

  // GET /auth/me
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: User) {
    return {
      success: true,
      message: 'Lấy thông tin thành công',
      data: await this.authService.getProfile(user.id),
    };
  }

  // POST /auth/logout
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@Request() req: any) {
    // In production: blacklist the token in Redis/DB
    return {
      success: true,
      message: 'Đăng xuất thành công',
    };
  }
}
