"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CskhModule = void 0;
const common_1 = require("@nestjs/common");
const cskh_controller_1 = require("./cskh.controller");
const cskh_service_1 = require("./cskh.service");
const cskh_inbox_service_1 = require("./cskh-inbox.service");
const cskh_inbox_realtime_service_1 = require("./cskh-inbox-realtime.service");
const facebook_graph_service_1 = require("./facebook-graph.service");
const sapo_product_service_1 = require("./sapo-product.service");
const sapo_oauth_service_1 = require("./sapo-oauth.service");
const cskh_cron_service_1 = require("./cskh-cron.service");
const ai_module_1 = require("../ai/ai.module");
let CskhModule = class CskhModule {
};
exports.CskhModule = CskhModule;
exports.CskhModule = CskhModule = __decorate([
    (0, common_1.Module)({
        imports: [ai_module_1.AiModule],
        controllers: [cskh_controller_1.CskhController],
        providers: [
            cskh_service_1.CskhService,
            cskh_inbox_service_1.CskhInboxService,
            cskh_inbox_realtime_service_1.CskhInboxRealtimeService,
            facebook_graph_service_1.FacebookGraphService,
            sapo_product_service_1.SapoProductService,
            sapo_oauth_service_1.SapoOAuthService,
            cskh_cron_service_1.CskhCronService,
        ],
        exports: [cskh_service_1.CskhService, cskh_inbox_service_1.CskhInboxService],
    })
], CskhModule);
//# sourceMappingURL=cskh.module.js.map