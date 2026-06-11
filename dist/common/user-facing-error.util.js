"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTechnicalError = isTechnicalError;
exports.toUserFacingError = toUserFacingError;
const TECHNICAL_PATTERNS = [
    /prisma/i,
    /invocation/i,
    /can't reach database/i,
    /database server/i,
    /connection pool/i,
    /ECONNREFUSED/i,
    /ETIMEDOUT/i,
    /ENOTFOUND/i,
    /EAI_AGAIN/i,
    /socket hang up/i,
    /Invalid `/,
    /GraphMethodException/i,
    /Unsupported get request/i,
    /Internal server error/i,
    /Unexpected token/i,
    /SyntaxError/i,
    /TypeError/i,
    /at \/Users\//,
    /at .*\.ts:\d+/,
    /at .*\.js:\d+/,
    /fbtrace_id/i,
    /stack trace/i,
];
function isTechnicalError(message) {
    const msg = message.trim();
    if (!msg)
        return false;
    return TECHNICAL_PATTERNS.some((re) => re.test(msg));
}
function toUserFacingError(raw) {
    const msg = (raw ?? '').trim();
    if (!msg)
        return 'Đã có lỗi xảy ra. Vui lòng thử lại sau.';
    const lower = msg.toLowerCase();
    if (lower.includes("can't reach database") || lower.includes('database server') || /prisma/i.test(msg)) {
        return 'Hệ thống không kết nối được cơ sở dữ liệu. Vui lòng thử lại sau vài phút.';
    }
    if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(msg)) {
        return 'Mất kết nối tới máy chủ. Kiểm tra mạng và thử lại.';
    }
    if (/deepseek|ai service|openai|fetch failed/i.test(lower)) {
        return 'Dịch vụ AI tạm thời không phản hồi. Vui lòng thử lại sau vài phút.';
    }
    if (/graph api|oauthexception|graphmethod/i.test(lower)) {
        if (msg.includes('Meta App') || msg.includes('OAuth') || msg.includes('quyền'))
            return msg;
        return 'Không kết nối được Facebook. Thử làm mới token Page và chạy lại.';
    }
    if (isTechnicalError(msg)) {
        return 'Đã có lỗi hệ thống. Vui lòng thử lại sau.';
    }
    if (msg.length > 220) {
        return 'Đã có lỗi hệ thống. Vui lòng thử lại sau.';
    }
    return msg;
}
//# sourceMappingURL=user-facing-error.util.js.map