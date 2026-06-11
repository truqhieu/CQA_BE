"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transcriptToIntentMessages = transcriptToIntentMessages;
exports.inboxToIntentMessages = inboxToIntentMessages;
exports.mergeTranscriptWithInboxTail = mergeTranscriptWithInboxTail;
exports.capIntentMessages = capIntentMessages;
exports.intentMessagesSignature = intentMessagesSignature;
function parseMsgTime(raw) {
    if (raw instanceof Date)
        return raw.getTime();
    if (!raw)
        return 0;
    const t = Date.parse(String(raw));
    return Number.isFinite(t) ? t : 0;
}
function transcriptToIntentMessages(transcript) {
    if (!Array.isArray(transcript))
        return [];
    const out = [];
    for (const line of transcript) {
        const text = (line.text ?? '').trim();
        if (!text)
            continue;
        out.push({
            sender: line.sender === 'Staff' ? 'Staff' : 'Customer',
            text,
        });
    }
    return out;
}
function inboxToIntentMessages(rows) {
    return rows
        .map((m) => ({
        sender: m.senderType === 'staff' ? 'Staff' : 'Customer',
        text: (m.text ?? '').trim(),
    }))
        .filter((m) => m.text.length > 0);
}
function mergeTranscriptWithInboxTail(transcript, inboxRows) {
    const base = transcriptToIntentMessages(transcript);
    if (!base.length)
        return inboxToIntentMessages(inboxRows);
    let lastTranscriptTs = 0;
    const seen = new Set();
    for (const line of transcript) {
        lastTranscriptTs = Math.max(lastTranscriptTs, parseMsgTime(line.timestamp));
        const role = line.sender === 'Staff' ? 'Staff' : 'Customer';
        const text = (line.text ?? '').trim().toLowerCase();
        if (text)
            seen.add(`${role}|${text}`);
    }
    const cutoff = lastTranscriptTs > 0 ? lastTranscriptTs - 120_000 : 0;
    const tail = [];
    for (const row of inboxRows) {
        const t = parseMsgTime(row.sentAt);
        if (lastTranscriptTs > 0 && t < cutoff)
            continue;
        const sender = row.senderType === 'staff' ? 'Staff' : 'Customer';
        const text = (row.text ?? '').trim();
        if (!text)
            continue;
        const key = `${sender}|${text.toLowerCase()}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        tail.push({ sender, text });
    }
    return [...base, ...tail];
}
function capIntentMessages(messages, max = 100) {
    return messages;
}
function intentMessagesSignature(messages) {
    if (!messages.length)
        return 'empty';
    const last = messages[messages.length - 1];
    return `${messages.length}:${last.sender}:${last.text.slice(0, 80)}`;
}
//# sourceMappingURL=cskh-intent-messages.util.js.map