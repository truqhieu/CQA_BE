import { Controller, Post, Body } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('audit-chat')
  async auditChat(@Body() body: any) {
    return this.aiService.auditChat(body);
  }
}
