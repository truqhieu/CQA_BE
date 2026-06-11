import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CskhService } from './cskh.service';

@Injectable()
export class CskhCronService {
  private readonly logger = new Logger(CskhCronService.name);
  private running = false;

  constructor(private readonly cskh: CskhService) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduledMonitor() {
    if (process.env.CSKH_CRON_ENABLED !== 'true') return;
    if (this.running) {
      this.logger.warn('Monitor cron skipped — previous run still active');
      return;
    }
    this.running = true;
    try {
      const job = await this.cskh.createJob('monitor');
      this.logger.log(`Cron monitor started job=${job.id}`);
      await this.cskh.runMonitorJob(job.id);
    } catch (e) {
      this.logger.error(`Cron monitor failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
