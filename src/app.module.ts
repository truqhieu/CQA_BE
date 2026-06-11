import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TenantsModule } from './tenants/tenants.module';
import jwtConfig from './config/jwt.config';
import { PrismaModule } from './prisma/prisma.module';
import { CskhModule } from './cskh/cskh.module';
import { AiModule } from './ai/ai.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    // ─── Schedule ───────────────────────────────────────────────────────────────
    ScheduleModule.forRoot(),

    // ─── Config ─────────────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [jwtConfig],
    }),

    // ─── Feature Modules ─────────────────────────────────────────────────────────
    PrismaModule,
    TenantsModule,
    AuthModule,
    UsersModule,
    CskhModule,
    AiModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
