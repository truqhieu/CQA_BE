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
var CskhCronService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CskhCronService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const cskh_service_1 = require("./cskh.service");
let CskhCronService = CskhCronService_1 = class CskhCronService {
    cskh;
    logger = new common_1.Logger(CskhCronService_1.name);
    running = false;
    constructor(cskh) {
        this.cskh = cskh;
    }
    async scheduledMonitor() {
        if (process.env.CSKH_CRON_ENABLED !== 'true')
            return;
        if (this.running) {
            this.logger.warn('Monitor cron skipped — previous run still active');
            return;
        }
        this.running = true;
        try {
            const job = await this.cskh.createJob('monitor');
            this.logger.log(`Cron monitor started job=${job.id}`);
            await this.cskh.runMonitorJob(job.id);
        }
        catch (e) {
            this.logger.error(`Cron monitor failed: ${e.message}`);
        }
        finally {
            this.running = false;
        }
    }
};
exports.CskhCronService = CskhCronService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_30_MINUTES),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CskhCronService.prototype, "scheduledMonitor", null);
exports.CskhCronService = CskhCronService = CskhCronService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [cskh_service_1.CskhService])
], CskhCronService);
//# sourceMappingURL=cskh-cron.service.js.map