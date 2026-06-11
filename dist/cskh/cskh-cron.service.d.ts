import { CskhService } from './cskh.service';
export declare class CskhCronService {
    private readonly cskh;
    private readonly logger;
    private running;
    constructor(cskh: CskhService);
    scheduledMonitor(): Promise<void>;
}
