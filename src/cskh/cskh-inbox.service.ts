import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CskhInboxConversation, CskhInboxMessage } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { FacebookGraphService, type FbMessage } from './facebook-graph.service';
import { dedupeMediaUrls, repairStoredMessage } from './facebook-message.util';
import {
  detectAdFromFbMessages,
  type FbWebhookReferral,
  parseWebhookReferral,
} from './facebook-referral.util';
import { getFacebookWebhookVerifyToken } from './facebook-oauth.util';
import {
  CskhInboxRealtimeService,
  type CustomerIntentPayload,
  type InboxConversationPayload,
  type InboxMessagePayload,
} from './cskh-inbox-realtime.service';
import {
  capIntentMessages,
  inboxToIntentMessages,
  intentMessagesSignature,
  mergeTranscriptWithInboxTail,
} from './cskh-intent-messages.util';
import { matchInterestedProducts } from './sapo-product-match.util';
import { SapoProductService } from './sapo-product.service';

type WebhookMessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  referral?: FbWebhookReferral;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    sticker_id?: number;
    referral?: FbWebhookReferral;
    attachments?: Array<{
      type?: string;
      payload?: { url?: string; sticker_id?: number };
    }>;
  };
};

@Injectable()
export class CskhInboxService {
  private readonly logger = new Logger(CskhInboxService.name);
  private readonly syncLimit = Number(process.env.CSKH_INBOX_SYNC_LIMIT || 30);
  private readonly msgLimit = Number(process.env.CSKH_INBOX_MSG_LIMIT || 50);
  /** Khi recheck audit — tải nhiều tin hơn để so khớp transcript. */
  private readonly auditRecheckMsgLimit = Number(
    process.env.CSKH_INBOX_AUDIT_RECHECK_LIMIT || 200,
  );
  /** Tránh gọi Graph mỗi lần FE poll — gây nhảy UI. */
  private readonly graphRefreshCooldownMs = Number(
    process.env.CSKH_GRAPH_REFRESH_COOLDOWN_MS || 60_000,
  );
  private readonly lastGraphRefresh = new Map<string, number>();
  private readonly intentCache = new Map<
    string,
    { signature: string; at: number; data: CustomerIntentPayload }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: FacebookGraphService,
    private readonly realtime: CskhInboxRealtimeService,
    private readonly ai: AiService,
    private readonly sapoProducts: SapoProductService,
  ) {}

  private formatMessageRow(row: CskhInboxMessage): InboxMessagePayload {
    return {
      id: row.id,
      conversationId: row.conversationId,
      fbMessageId: row.fbMessageId,
      direction: row.direction,
      senderType: row.senderType,
      text: row.text,
      messageType: row.messageType,
      attachmentUrl: row.attachmentUrl,
      sentAt: row.sentAt.toISOString(),
      status: row.status,
    };
  }

  private formatConversationRow(conv: CskhInboxConversation): InboxConversationPayload {
    return {
      id: conv.id,
      pageId: conv.pageId,
      pageName: conv.pageName,
      participantPsid: conv.participantPsid,
      customerName: conv.customerName,
      customerPictureUrl: conv.customerPictureUrl,
      lastMessage: conv.lastMessage,
      lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
      unreadCount: conv.unreadCount,
      fromAd: conv.fromAd,
      adTitle: conv.adTitle,
    };
  }

  private async publishMessageRealtime(
    pageId: string,
    conversationId: string,
    messages: CskhInboxMessage[],
    analyzeIntent = false,
    tenantId?: string,
  ) {
    if (!messages.length) return;
    const freshConv = await this.prisma.cskhInboxConversation.findUnique({
      where: { id: conversationId },
    });
    const finalTenantId = tenantId || freshConv?.tenantId || undefined;
    this.realtime.publish({
      type: 'message',
      pageId,
      conversationId,
      messages: messages.map((m) => this.formatMessageRow(m)),
      conversation: freshConv ? this.formatConversationRow(freshConv) : undefined,
      tenantId: finalTenantId,
    });
    if (analyzeIntent && messages.some((m) => m.senderType === 'customer')) {
      void this.analyzeAndBroadcastIntent(conversationId, finalTenantId).catch((e) => {
        this.logger.warn(`Intent broadcast failed: ${(e as Error).message}`);
      });
    }
  }

  async getCustomerIntent(
    conversationId: string,
    auditId?: string,
    tenantId?: string,
  ): Promise<CustomerIntentPayload> {
    const conv = await this.prisma.cskhInboxConversation.findFirst({
      where: tenantId ? { id: conversationId, tenantId } : { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Hội thoại không tồn tại hoặc không có quyền');

    const rows = await this.prisma.cskhInboxMessage.findMany({
      where: { conversationId },
      orderBy: { sentAt: 'asc' },
      take: 200,
    });

    let aiMessages: Array<{ sender: string; text: string }>;
    const auditKey = auditId?.trim() || '';
    if (auditKey) {
      const audit = await this.prisma.chatAudit.findFirst({
        where: tenantId ? { id: auditKey, tenantId } : { id: auditKey },
        select: { transcript: true },
      });
      if (audit?.transcript) {
        aiMessages = capIntentMessages(mergeTranscriptWithInboxTail(audit.transcript, rows));
      } else {
        aiMessages = capIntentMessages(inboxToIntentMessages(rows));
      }
    } else {
      aiMessages = capIntentMessages(inboxToIntentMessages(rows));
    }

    const signature = `${auditKey}|${intentMessagesSignature(aiMessages)}`;
    const cacheKey = auditKey ? `${conversationId}:${auditKey}` : conversationId;
    const cached = this.intentCache.get(cacheKey);
    if (cached && cached.signature === signature && Date.now() - cached.at < 120_000) {
      return cached.data;
    }
    const analyzed = await this.ai.analyzeCustomerIntent({
      messages: aiMessages,
      customerName: conv.customerName,
    });

    const sapoConfigured = this.sapoProducts.isConfigured();
    let products: CustomerIntentPayload['products'];
    if (sapoConfigured) {
      const catalog = await this.sapoProducts.getCatalog();
      products = matchInterestedProducts(
        catalog,
        analyzed.productMentions ?? [],
        analyzed.topics,
        analyzed.summary,
      );
    }

    const payload: CustomerIntentPayload = {
      summary: analyzed.summary,
      intentLabel: analyzed.intentLabel,
      topics: analyzed.topics,
      urgency: analyzed.urgency,
      suggestedFocus: analyzed.suggestedFocus,
      analyzedAt: new Date().toISOString(),
      productMentions: analyzed.productMentions,
      products,
      sapoConfigured,
    };
    this.intentCache.set(cacheKey, { signature, at: Date.now(), data: payload });
    return payload;
  }

  private async analyzeAndBroadcastIntent(conversationId: string, tenantId?: string) {
    const intent = await this.getCustomerIntent(conversationId, undefined, tenantId);
    this.realtime.publish({ type: 'intent', conversationId, intent, tenantId });
  }

  verifyWebhookToken(mode: string, token: string, challenge: string) {
    if (mode === 'subscribe' && token === getFacebookWebhookVerifyToken()) {
      return challenge;
    }
    throw new BadRequestException('Webhook verify failed');
  }

  async handleWebhookPayload(payload: unknown) {
    const body = payload as {
      object?: string;
      entry?: Array<{
        id?: string;
        messaging?: WebhookMessagingEvent[];
      }>;
    };
    if (body.object !== 'page' || !Array.isArray(body.entry)) return { ok: true };
    for (const entry of body.entry) {
      const pageId = String(entry.id || '');
      if (!pageId) continue;
      for (const event of entry.messaging ?? []) {
        await this.ingestMessagingEvent(pageId, event).catch((e) => {
          this.logger.warn(`Webhook ingest failed page=${pageId}: ${(e as Error).message}`);
        });
      }
    }
    return { ok: true };
  }

  private async ingestMessagingEvent(pageId: string, event: WebhookMessagingEvent) {
    const msg = event.message;
    const referral = event.referral ?? msg?.referral;
    if (referral) {
      await this.applyReferralFromWebhook(pageId, event, referral);
    }

    // Handle typing indicator from Facebook Webhook
    const senderAction = (event as any).sender_action;
    if (senderAction) {
      const senderPsid = String(event.sender?.id || '');
      const recipientPsid = String(event.recipient?.id || '');
      if (senderPsid) {
        const isFromPage = senderPsid === pageId;
        const customerPsid = isFromPage ? recipientPsid : senderPsid;
        if (customerPsid && customerPsid !== pageId) {
          const conv = await this.prisma.cskhInboxConversation.findUnique({
            where: { pageId_participantPsid: { pageId, participantPsid: customerPsid } },
          });
          if (conv) {
            this.realtime.publish({
              type: 'typing',
              conversationId: conv.id,
              pageId,
              tenantId: conv.tenantId || undefined,
            });
          }
        }
      }
      return;
    }

    // Handle read receipt from Facebook Webhook
    const read = (event as any).read;
    if (read) {
      const senderPsid = String(event.sender?.id || '');
      const recipientPsid = String(event.recipient?.id || '');
      if (senderPsid) {
        const isFromPage = senderPsid === pageId;
        const customerPsid = isFromPage ? recipientPsid : senderPsid;
        if (customerPsid && customerPsid !== pageId) {
          const conv = await this.prisma.cskhInboxConversation.findUnique({
            where: { pageId_participantPsid: { pageId, participantPsid: customerPsid } },
          });
          if (conv) {
            if (isFromPage) {
              await this.prisma.cskhInboxConversation.update({
                where: { id: conv.id },
                data: { unreadCount: 0 },
              });
              this.realtime.publish({
                type: 'read-receipt',
                conversationId: conv.id,
                pageId,
                tenantId: conv.tenantId || undefined,
              });
            }
          }
        }
      }
      return;
    }

    if (!msg?.text && !msg?.mid && !msg?.attachments?.length && !msg?.sticker_id) return;
    const senderPsid = String(event.sender?.id || '');
    const recipientPsid = String(event.recipient?.id || '');
    if (!senderPsid) return;

    const isEcho = Boolean(msg.is_echo);
    const isFromPage = isEcho || senderPsid === pageId;
    const customerPsid = isFromPage ? recipientPsid : senderPsid;
    if (!customerPsid || customerPsid === pageId) return;

    const config = await this.prisma.facebookCskhConfig.findUnique({ where: { pageId } });
    const pageName = config?.pageName ?? null;
    let customerName: string | null = null;
    let customerPictureUrl: string | null = null;
    if (!isFromPage && config?.pageAccessToken) {
      const profile = await this.graph.getMessengerUserProfile(customerPsid, config.pageAccessToken);
      customerName = profile.name;
      customerPictureUrl = profile.pictureUrl;
    }

    const conv = await this.prisma.cskhInboxConversation.upsert({
      where: { pageId_participantPsid: { pageId, participantPsid: customerPsid } },
      create: {
        pageId,
        pageName,
        participantPsid: customerPsid,
        customerName,
        customerPictureUrl,
        lastMessage: msg.text ?? '',
        lastMessageAt: new Date(event.timestamp ?? Date.now()),
        unreadCount: isFromPage ? 0 : 1,
        tenantId: config?.tenantId || null,
      },
      update: {
        pageName: pageName ?? undefined,
        customerName: customerName ?? undefined,
        customerPictureUrl: customerPictureUrl ?? undefined,
        lastMessage: msg.text ?? undefined,
        lastMessageAt: new Date(event.timestamp ?? Date.now()),
        unreadCount: isFromPage ? undefined : { increment: 1 },
        tenantId: config?.tenantId || undefined,
      },
    });

    if (msg.mid) {
      const existing = await this.prisma.cskhInboxMessage.findUnique({
        where: { fbMessageId: msg.mid },
      });
      const attCount = msg.attachments?.length ?? 0;
      if (existing && attCount <= 1) return;
    }

    const text = (msg.text ?? '').trim();
    if (text && this.graph.isStoredMessageNoise(text)) return;

    const sentAt = new Date(event.timestamp ?? Date.now());
    const webhookAttachments = msg.attachments ?? [];
    let mediaItems: Array<{ url: string | null; messageType: string }> = [];

    if (webhookAttachments.length > 0) {
      for (const att of webhookAttachments) {
        const url = att.payload?.url?.startsWith('http') ? att.payload.url : null;
        const messageType =
          att.type === 'video' ? 'video' : att.type === 'image' || att.type === 'file' ? 'image' : 'text';
        mediaItems.push({ url, messageType });
      }
    } else if (msg.sticker_id) {
      mediaItems.push({ url: null, messageType: 'sticker' });
    } else {
      mediaItems.push({ url: null, messageType: 'text' });
    }

    if (
      msg.mid &&
      config?.pageAccessToken &&
      mediaItems.some((m) => !m.url && m.messageType !== 'text' && m.messageType !== 'sticker')
    ) {
      const resolvedAll = await this.graph.resolveAllMessageMediaUrls(
        msg.mid,
        config.pageAccessToken,
      );
      if (resolvedAll.length) {
        mediaItems = resolvedAll.map((r) => ({ url: r.url, messageType: r.messageType }));
      } else {
        const resolved = await this.graph.resolveMessageMediaUrl(msg.mid, config.pageAccessToken);
        if (resolved.url) {
          mediaItems = [{ url: resolved.url, messageType: resolved.messageType ?? 'image' }];
        }
      }
    }

    const createdMessages: CskhInboxMessage[] = [];

    for (let i = 0; i < mediaItems.length; i++) {
      const item = mediaItems[i];
      const displayText =
        i === 0
          ? text ||
            (item.messageType === 'video'
              ? ''
              : item.messageType === 'image'
                ? '[Ảnh]'
                : item.messageType === 'sticker'
                  ? '[Sticker]'
                  : '[attachment]')
          : item.messageType === 'image' || item.messageType === 'video'
            ? ''
            : '';

      const fbMessageId = i === 0 ? (msg.mid ?? null) : null;

      if (fbMessageId) {
        const existing = await this.prisma.cskhInboxMessage.findUnique({
          where: { fbMessageId },
        });
        if (existing) {
          if (item.url && !existing.attachmentUrl) {
            const updated = await this.prisma.cskhInboxMessage.update({
              where: { id: existing.id },
              data: {
                attachmentUrl: item.url,
                messageType: item.messageType,
                text: displayText === '[Ảnh]' ? '' : displayText,
              },
            });
            createdMessages.push(updated);
          }
          continue;
        }
      } else if (item.url) {
        const sibling = await this.prisma.cskhInboxMessage.findFirst({
          where: {
            conversationId: conv.id,
            senderType: isFromPage ? 'staff' : 'customer',
            attachmentUrl: item.url,
            sentAt: {
              gte: new Date(sentAt.getTime() - 2000),
              lte: new Date(sentAt.getTime() + 2000),
            },
          },
        });
        if (sibling) continue;
      }

      const created = await this.prisma.cskhInboxMessage.create({
        data: {
          conversationId: conv.id,
          fbMessageId,
          direction: isFromPage ? 'outbound' : 'inbound',
          senderType: isFromPage ? 'staff' : 'customer',
          text: displayText,
          messageType: item.messageType,
          attachmentUrl: item.url,
          sentAt,
          status: 'sent',
          tenantId: config?.tenantId || null,
        },
      });
      createdMessages.push(created);
    }

    await this.publishMessageRealtime(
      pageId,
      conv.id,
      createdMessages,
      createdMessages.some((m) => m.senderType === 'customer'),
      conv.tenantId || undefined,
    );
  }

  /** Lưu nguồn quảng cáo từ webhook messaging_referrals / message.referral. */
  private async applyReferralFromWebhook(
    pageId: string,
    event: WebhookMessagingEvent,
    referral: FbWebhookReferral,
  ) {
    const parsed = parseWebhookReferral(referral);
    if (!parsed.fromAd) return;

    const senderPsid = String(event.sender?.id || '');
    const recipientPsid = String(event.recipient?.id || '');
    const customerPsid = senderPsid === pageId ? recipientPsid : senderPsid;
    if (!customerPsid || customerPsid === pageId) return;

    const config = await this.prisma.facebookCskhConfig.findUnique({ where: { pageId } });
    const pageName = config?.pageName ?? null;
    const referralAt = new Date(event.timestamp ?? Date.now());

    await this.prisma.cskhInboxConversation.upsert({
      where: { pageId_participantPsid: { pageId, participantPsid: customerPsid } },
      create: {
        pageId,
        pageName,
        participantPsid: customerPsid,
        fromAd: true,
        adId: parsed.adId,
        adTitle: parsed.adTitle,
        referralSource: parsed.referralSource,
        referralAt,
        tenantId: config?.tenantId || null,
      },
      update: {
        pageName: pageName ?? undefined,
        fromAd: true,
        adId: parsed.adId ?? undefined,
        adTitle: parsed.adTitle ?? undefined,
        referralSource: parsed.referralSource ?? undefined,
        referralAt,
        tenantId: config?.tenantId || undefined,
      },
    });
  }

  /** Heuristic: tin hệ thống Graph báo khách vào từ quảng cáo (không có ad_id). */
  private async markAdFromGraphMessages(
    conversationId: string,
    rawMsgs: FbMessage[],
  ): Promise<void> {
    const hint = detectAdFromFbMessages(rawMsgs);
    if (!hint.fromAd) return;

    await this.prisma.cskhInboxConversation.updateMany({
      where: { id: conversationId, fromAd: false },
      data: {
        fromAd: true,
        referralSource: hint.referralSource ?? 'HEURISTIC',
        referralAt: new Date(),
      },
    });
  }

  async listConversations(pageId?: string, tenantId?: string) {
    const where: any = {};
    if (pageId) where.pageId = pageId;
    if (tenantId) where.tenantId = tenantId;

    const rows = await this.prisma.cskhInboxConversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
    });

    const missing = rows.filter((r) => !r.customerPictureUrl).slice(0, 50);
    if (missing.length) {
      void this.enrichCustomerPictures(missing.map((r) => r.id)).catch((e) => {
        this.logger.warn(`Background picture enrichment failed: ${(e as Error).message}`);
      });
    }

    return rows;
  }

  private async enrichCustomerPictures(conversationIds: string[]) {
    const convs = await this.prisma.cskhInboxConversation.findMany({
      where: { id: { in: conversationIds } },
    });
    await Promise.all(
      convs.map(async (conv) => {
        const config = await this.prisma.facebookCskhConfig.findUnique({
          where: { pageId: conv.pageId },
        });
        if (!config?.pageAccessToken) return;
        try {
          const profile = await this.graph.getMessengerUserProfile(
            conv.participantPsid,
            config.pageAccessToken,
          );
          if (!profile.pictureUrl && !profile.name) return;
          const updatedConv = await this.prisma.cskhInboxConversation.update({
            where: { id: conv.id },
            data: {
              customerName: profile.name ?? undefined,
              customerPictureUrl: profile.pictureUrl ?? undefined,
            },
          });
          this.realtime.publish({
            type: 'conversation',
            conversationId: conv.id,
            pageId: conv.pageId,
            conversation: this.formatConversationRow(updatedConv),
          });
        } catch (e) {
          this.logger.warn(`Failed to enrich picture for conv ${conv.id}: ${(e as Error).message}`);
        }
      }),
    );
  }

  async getMessages(
    conversationId: string,
    since?: string,
    forceRefresh = false,
    limit?: number,
    tenantId?: string,
  ) {
    const conv = await this.prisma.cskhInboxConversation.findFirst({
      where: tenantId ? { id: conversationId, tenantId } : { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Hội thoại không tồn tại hoặc không có quyền');

    const fetchLimit = limit
      ? Math.min(Math.max(Math.floor(limit), 10), this.auditRecheckMsgLimit)
      : this.msgLimit;

    if (conv.fbConversationId && !since) {
      const last = this.lastGraphRefresh.get(conversationId) ?? 0;
      const cooldownExpired = Date.now() - last >= this.graphRefreshCooldownMs;
      const shouldRefresh = forceRefresh || !last || cooldownExpired;
      if (shouldRefresh) {
        const config = await this.prisma.facebookCskhConfig.findUnique({
          where: { pageId: conv.pageId },
        });
        if (config?.pageAccessToken) {
          await this.refreshConversationMessages(
            conv.id,
            conv.pageId,
            conv.fbConversationId,
            config.pageAccessToken,
            fetchLimit,
            tenantId,
          );
          this.lastGraphRefresh.set(conversationId, Date.now());
        }
      }
    }

    const sinceDate = since ? new Date(since) : undefined;
    let messages = await this.prisma.cskhInboxMessage.findMany({
      where: {
        conversationId,
        ...(sinceDate && !Number.isNaN(sinceDate.getTime()) ? { sentAt: { gt: sinceDate } } : {}),
      },
      orderBy: { sentAt: 'asc' },
      take: 500,
    });

    if (!since) {
      messages = await this.backfillMissingMediaUrls(
        conv.pageId,
        conv.id,
        conv.fbConversationId,
        messages,
      );
    }

    await this.prisma.cskhInboxConversation.update({
      where: { id: conversationId },
      data: { unreadCount: 0 },
    });

    return {
      conversation: conv,
      messages: messages.filter((m) => !this.graph.isStoredMessageNoise(m.text)),
    };
  }

  private async refreshConversationMessages(
    conversationId: string,
    pageId: string,
    fbConversationId: string,
    token: string,
    msgLimit = this.msgLimit,
    tenantId?: string,
  ) {
    try {
      const safeLimit = Math.min(Math.max(msgLimit, 10), this.auditRecheckMsgLimit);
      const rawMsgs = await this.graph.fetchMessages(fbConversationId, token, safeLimit);
      const ordered = [...rawMsgs].reverse();

      const existing = await this.prisma.cskhInboxMessage.findMany({
        where: { conversationId },
        select: { id: true, text: true },
      });
      for (const row of existing) {
        if (this.graph.isStoredMessageNoise(row.text)) {
          await this.prisma.cskhInboxMessage.delete({ where: { id: row.id } });
        }
      }

      let lastPreview: string | null = null;
      for (const msg of ordered) {
        const saved = await this.persistGraphMessage(conversationId, pageId, msg, token, tenantId);
        if (saved) lastPreview = saved.text;
      }

      await this.linkFbMessageIdsFromGraph(conversationId, pageId, fbConversationId, token);
      await this.repairLegacyInboxMessages(conversationId, token);

      if (lastPreview) {
        await this.prisma.cskhInboxConversation.update({
          where: { id: conversationId },
          data: { lastMessage: lastPreview },
        });
      }

      await this.markAdFromGraphMessages(conversationId, rawMsgs);
    } catch (e) {
      this.logger.warn(
        `refreshConversationMessages ${conversationId}: ${(e as Error).message}`,
      );
    }
  }

  private looksLikeMediaPlaceholder(row: {
    text: string;
    messageType: string;
    attachmentUrl: string | null;
  }): boolean {
    if (row.attachmentUrl?.startsWith('http')) return false;
    return (
      row.messageType === 'image' ||
      row.messageType === 'video' ||
      row.text === '[Ảnh]' ||
      row.text === '[Video]' ||
      row.text === '[attachment]'
    );
  }

  private needsMediaBackfill(row: {
    text: string;
    attachmentUrl: string | null;
    messageType: string;
    fbMessageId: string | null;
  }): boolean {
    if (row.attachmentUrl?.startsWith('http')) return false;
    if (!row.fbMessageId) return false;
    return this.looksLikeMediaPlaceholder(row);
  }

  /** Gắn fbMessageId cho tin ảnh cũ (webhook lưu sentAt lệch vài giây so với Graph). */
  private async linkFbMessageIdsFromGraph(
    conversationId: string,
    pageId: string,
    fbConversationId: string,
    token: string,
  ) {
    const missing = await this.prisma.cskhInboxMessage.findMany({
      where: {
        conversationId,
        fbMessageId: null,
        OR: [
          { text: '[Ảnh]' },
          { text: '[Video]' },
          { text: '[attachment]' },
          { messageType: 'image' },
          { messageType: 'video' },
        ],
      },
      select: { id: true, sentAt: true, senderType: true },
      take: 100,
    });
    if (!missing.length) return;

    const rawMsgs = await this.graph.fetchMessages(fbConversationId, token, this.msgLimit);
    for (const row of missing) {
      const rowTs = row.sentAt.getTime();
      const isStaff = row.senderType === 'staff';
      const match = rawMsgs.find((msg) => {
        const normalized = this.graph.normalizeMessageForInbox(msg, pageId);
        if (!normalized) return false;
        const msgStaff = normalized.sender === 'Staff';
        if (msgStaff !== isStaff) return false;
        const msgTs = msg.created_time ? new Date(msg.created_time).getTime() : 0;
        if (Math.abs(msgTs - rowTs) > 5000) return false;
        return (
          normalized.messageType === 'image' ||
          normalized.messageType === 'video' ||
          normalized.text === '[Ảnh]' ||
          normalized.text === '[Video]' ||
          Boolean(msg.attachments?.data?.length)
        );
      });
      if (match?.id) {
        await this.prisma.cskhInboxMessage.update({
          where: { id: row.id },
          data: { fbMessageId: String(match.id) },
        });
      }
    }
  }

  private async backfillMissingMediaUrls<
    T extends {
      id: string;
      text: string;
      attachmentUrl: string | null;
      messageType: string;
      fbMessageId: string | null;
    },
  >(
    pageId: string,
    conversationId: string,
    fbConversationId: string | null,
    rows: T[],
  ): Promise<T[]> {
    const config = await this.prisma.facebookCskhConfig.findUnique({ where: { pageId } });
    if (!config?.pageAccessToken) return rows;

    if (
      fbConversationId &&
      rows.some((r) => !r.fbMessageId && this.looksLikeMediaPlaceholder(r))
    ) {
      await this.linkFbMessageIdsFromGraph(
        conversationId,
        pageId,
        fbConversationId,
        config.pageAccessToken,
      );
      const linked = await this.prisma.cskhInboxMessage.findMany({
        where: { id: { in: rows.map((r) => r.id) } },
        select: { id: true, fbMessageId: true },
      });
      const byId = new Map(linked.map((r) => [r.id, r.fbMessageId]));
      for (let i = 0; i < rows.length; i++) {
        const fbId = byId.get(rows[i].id);
        if (fbId) rows[i] = { ...rows[i], fbMessageId: fbId };
      }
    }

    const result = [...rows];
    const batchSize = 40;
    for (let round = 0; round < 3; round++) {
      const missing = result.filter((r) => this.needsMediaBackfill(r)).slice(0, batchSize);
      if (!missing.length) break;
      let progress = false;
      await Promise.all(
        missing.map(async (row) => {
          try {
            const resolved = await this.graph.resolveMessageMediaUrl(
              row.fbMessageId!,
              config.pageAccessToken,
            );
            if (!resolved.url) return;
            progress = true;
            const newText =
              row.text === '[Ảnh]' || row.text === '[attachment]' ? '' : row.text;
            await this.prisma.cskhInboxMessage.update({
              where: { id: row.id },
              data: {
                attachmentUrl: resolved.url,
                messageType: resolved.messageType ?? row.messageType,
                text: newText,
              },
            });
            const idx = result.findIndex((r) => r.id === row.id);
            if (idx >= 0) {
              result[idx] = {
                ...result[idx],
                attachmentUrl: resolved.url,
                messageType: resolved.messageType ?? row.messageType,
                text: newText,
              };
            }
          } catch (e) {
            this.logger.warn(`Failed to resolve media URL for message ${row.id}: ${(e as Error).message}`);
          }
        }),
      );
      if (!progress) break;
    }
    return result;
  }

  private async repairLegacyInboxMessages(conversationId: string, token?: string) {
    const rows = await this.prisma.cskhInboxMessage.findMany({
      where: { conversationId },
      select: {
        id: true,
        text: true,
        attachmentUrl: true,
        messageType: true,
        fbMessageId: true,
      },
    });

    if (token) {
      const pageId = (
        await this.prisma.cskhInboxConversation.findUnique({
          where: { id: conversationId },
          select: { pageId: true },
        })
      )?.pageId;
      if (pageId) {
        await this.backfillMissingMediaUrls(
          pageId,
          conversationId,
          (
            await this.prisma.cskhInboxConversation.findUnique({
              where: { id: conversationId },
              select: { fbConversationId: true },
            })
          )?.fbConversationId ?? null,
          rows,
        );
      }
    }

    const fresh = await this.prisma.cskhInboxMessage.findMany({
      where: { conversationId },
      select: { id: true, text: true, attachmentUrl: true, messageType: true },
    });
    for (const row of fresh) {
      const repaired = repairStoredMessage(row.text, row.attachmentUrl, row.messageType);
      if (!repaired.changed) continue;
      await this.prisma.cskhInboxMessage.update({
        where: { id: row.id },
        data: {
          text: repaired.text,
          attachmentUrl: repaired.attachmentUrl,
          messageType: repaired.messageType,
        },
      });
    }
  }

  private async persistGraphMessage(
    conversationId: string,
    pageId: string,
    msg: FbMessage,
    token?: string,
    tenantId?: string,
  ): Promise<{ text: string } | null> {
    let enriched = msg;
    if (token) {
      enriched = await this.graph.enrichMessageWithMedia(msg, token);
    }
    let normalized = this.graph.normalizeMessageForInbox(enriched, pageId);
    if (!normalized) return null;

    const attCount = enriched.attachments?.data?.length ?? 0;
    const needsResolve =
      token &&
      enriched.id &&
      (attCount > 1 ||
        !normalized.attachmentUrl ||
        (normalized.attachmentUrls?.length ?? 0) < attCount);
    if (needsResolve) {
      const looksLikeMedia =
        normalized.messageType === 'image' ||
        normalized.messageType === 'video' ||
        normalized.text === '[Ảnh]' ||
        normalized.text === '[Video]' ||
        attCount > 0;
      if (looksLikeMedia) {
        const resolvedAll = await this.graph.resolveAllMessageMediaUrls(enriched.id!, token!);
        if (resolvedAll.length) {
          const urls = dedupeMediaUrls(resolvedAll.map((r) => r.url));
          normalized = {
            ...normalized,
            attachmentUrls: urls,
            attachmentUrl: urls[0] ?? null,
            messageType: resolvedAll[0].messageType ?? normalized.messageType,
            text:
              urls.length > 1 && resolvedAll[0].messageType === 'image'
                ? normalized.text === '[Ảnh]'
                  ? ''
                  : normalized.text
                : resolvedAll[0].messageType === 'video'
                  ? ''
                  : normalized.text === '[Ảnh]'
                    ? ''
                    : normalized.text,
          };
        }
      }
    }

    const sentAt = msg.created_time ? new Date(msg.created_time) : new Date();
    const isStaff = normalized.sender === 'Staff';
    const fbMessageId = msg.id ? String(msg.id) : null;
    const mediaUrls =
      dedupeMediaUrls(
        normalized.attachmentUrls?.length
          ? normalized.attachmentUrls
          : normalized.attachmentUrl
            ? [normalized.attachmentUrl]
            : [],
      );

    if (!mediaUrls.length) {
      let exists = fbMessageId
        ? await this.prisma.cskhInboxMessage.findUnique({ where: { fbMessageId } })
        : null;
      if (!exists) {
        exists = await this.findStoredMessageNearSentAt(conversationId, sentAt, isStaff);
      }
      const payload = {
        text: normalized.text,
        messageType: normalized.messageType,
        attachmentUrl: null as string | null,
      };
      if (exists) {
        const needsUpdate =
          exists.text !== payload.text ||
          exists.messageType !== payload.messageType ||
          (fbMessageId && !exists.fbMessageId);
        if (needsUpdate) {
          await this.prisma.cskhInboxMessage.update({
            where: { id: exists.id },
            data: {
              ...payload,
              ...(fbMessageId && !exists.fbMessageId ? { fbMessageId } : {}),
            },
          });
        }
        return { text: normalized.text };
      }
      await this.prisma.cskhInboxMessage.create({
        data: {
          conversationId,
          direction: isStaff ? 'outbound' : 'inbound',
          senderType: isStaff ? 'staff' : 'customer',
          fbMessageId,
          ...payload,
          sentAt,
          status: 'sent',
          tenantId,
        },
      });
      return { text: normalized.text };
    }

    for (let i = 0; i < mediaUrls.length; i++) {
      const attachmentUrl = mediaUrls[i];
      const rowFbMessageId = i === 0 ? fbMessageId : null;
      const rowText =
        i === 0
          ? normalized.text
          : normalized.messageType === 'image' || normalized.messageType === 'video'
            ? ''
            : normalized.text;
      const payload = {
        text: rowText,
        messageType: normalized.messageType,
        attachmentUrl,
      };

      let exists = rowFbMessageId
        ? await this.prisma.cskhInboxMessage.findUnique({ where: { fbMessageId: rowFbMessageId } })
        : null;
      if (!exists && attachmentUrl) {
        exists = await this.prisma.cskhInboxMessage.findFirst({
          where: {
            conversationId,
            senderType: isStaff ? 'staff' : 'customer',
            attachmentUrl,
            sentAt: {
              gte: new Date(sentAt.getTime() - 2000),
              lte: new Date(sentAt.getTime() + 2000),
            },
          },
        });
      }
      if (!exists && i === 0) {
        exists = await this.findStoredMessageNearSentAt(conversationId, sentAt, isStaff);
      }

      if (exists) {
        const needsUpdate =
          exists.text !== payload.text ||
          exists.messageType !== payload.messageType ||
          (exists.attachmentUrl ?? null) !== attachmentUrl ||
          (rowFbMessageId && !exists.fbMessageId) ||
          (!exists.attachmentUrl && attachmentUrl);
        if (needsUpdate) {
          await this.prisma.cskhInboxMessage.update({
            where: { id: exists.id },
            data: {
              ...payload,
              ...(rowFbMessageId && !exists.fbMessageId ? { fbMessageId: rowFbMessageId } : {}),
            },
          });
        }
        continue;
      }

      await this.prisma.cskhInboxMessage.create({
        data: {
          conversationId,
          direction: isStaff ? 'outbound' : 'inbound',
          senderType: isStaff ? 'staff' : 'customer',
          fbMessageId: rowFbMessageId,
          ...payload,
          sentAt,
          status: 'sent',
          tenantId,
        },
      });
    }

    return { text: normalized.text };
  }

  private findStoredMessageNearSentAt(
    conversationId: string,
    sentAt: Date,
    isStaff: boolean,
  ) {
    const windowMs = 5000;
    return this.prisma.cskhInboxMessage.findFirst({
      where: {
        conversationId,
        senderType: isStaff ? 'staff' : 'customer',
        sentAt: {
          gte: new Date(sentAt.getTime() - windowMs),
          lte: new Date(sentAt.getTime() + windowMs),
        },
      },
      orderBy: { sentAt: 'asc' },
    });
  }

  /** Lazy resolve URL ảnh/video cho một tin (FE gọi khi vẫn thấy [Ảnh]). */
  async resolveInboxMessageMedia(messageId: string) {
    const row = await this.prisma.cskhInboxMessage.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });
    if (!row) throw new NotFoundException('Tin nhắn không tồn tại');

    if (row.attachmentUrl?.startsWith('http')) {
      const siblings = await this.prisma.cskhInboxMessage.findMany({
        where: {
          conversationId: row.conversationId,
          senderType: row.senderType,
          attachmentUrl: { startsWith: 'http' },
          sentAt: {
            gte: new Date(row.sentAt.getTime() - 2000),
            lte: new Date(row.sentAt.getTime() + 2000),
          },
        },
        orderBy: { sentAt: 'asc' },
        select: { attachmentUrl: true },
      });
      const attachmentUrls = dedupeMediaUrls(siblings.map((s) => s.attachmentUrl));
      return {
        id: row.id,
        attachmentUrl: row.attachmentUrl,
        attachmentUrls: attachmentUrls.length > 1 ? attachmentUrls : undefined,
        messageType: row.messageType,
        text: row.text,
      };
    }

    const config = await this.prisma.facebookCskhConfig.findUnique({
      where: { pageId: row.conversation.pageId },
    });
    if (!config?.pageAccessToken) {
      throw new BadRequestException('Page chưa có access token');
    }

    let fbMessageId = row.fbMessageId;
    if (
      !fbMessageId &&
      row.conversation.fbConversationId &&
      this.looksLikeMediaPlaceholder(row)
    ) {
      await this.linkFbMessageIdsFromGraph(
        row.conversationId,
        row.conversation.pageId,
        row.conversation.fbConversationId,
        config.pageAccessToken,
      );
      const linked = await this.prisma.cskhInboxMessage.findUnique({
        where: { id: messageId },
        select: { fbMessageId: true },
      });
      fbMessageId = linked?.fbMessageId ?? null;
    }

    if (!fbMessageId) {
      return {
        id: row.id,
        attachmentUrl: null,
        messageType: row.messageType,
        text: row.text,
      };
    }

    const resolvedAll = await this.graph.resolveAllMessageMediaUrls(
      fbMessageId,
      config.pageAccessToken,
    );
    if (!resolvedAll.length) {
      return {
        id: row.id,
        attachmentUrl: null,
        messageType: row.messageType,
        text: row.text,
      };
    }

    const text =
      row.text === '[Ảnh]' || row.text === '[attachment]' ? '' : row.text;
    const primary = resolvedAll[0];
    await this.prisma.cskhInboxMessage.update({
      where: { id: messageId },
      data: {
        attachmentUrl: primary.url,
        messageType: primary.messageType ?? row.messageType,
        text,
      },
    });

    for (let i = 1; i < resolvedAll.length; i++) {
      const item = resolvedAll[i];
      const exists = await this.prisma.cskhInboxMessage.findFirst({
        where: {
          conversationId: row.conversationId,
          senderType: row.senderType,
          attachmentUrl: item.url,
          sentAt: {
            gte: new Date(row.sentAt.getTime() - 2000),
            lte: new Date(row.sentAt.getTime() + 2000),
          },
        },
      });
      if (exists) continue;
      await this.prisma.cskhInboxMessage.create({
        data: {
          conversationId: row.conversationId,
          direction: row.direction,
          senderType: row.senderType,
          text: '',
          messageType: item.messageType,
          attachmentUrl: item.url,
          sentAt: row.sentAt,
          status: 'sent',
        },
      });
    }

    const attachmentUrls = dedupeMediaUrls(resolvedAll.map((r) => r.url));
    return {
      id: row.id,
      attachmentUrl: primary.url,
      attachmentUrls: attachmentUrls.length > 1 ? attachmentUrls : undefined,
      messageType: primary.messageType ?? row.messageType,
      text,
    };
  }

  async sendMessage(conversationId: string, text: string, tenantId?: string) {
    const trimmed = text.trim();
    if (!trimmed) throw new BadRequestException('Tin nhắn trống');

    const conv = await this.prisma.cskhInboxConversation.findFirst({
      where: tenantId ? { id: conversationId, tenantId } : { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Hội thoại không tồn tại hoặc không có quyền');

    const config = await this.prisma.facebookCskhConfig.findFirst({
      where: tenantId ? { pageId: conv.pageId, tenantId } : { pageId: conv.pageId },
    });
    if (!config?.pageAccessToken) {
      throw new BadRequestException('Page chưa có access token');
    }

    const pending = await this.prisma.cskhInboxMessage.create({
      data: {
        conversationId: conv.id,
        direction: 'outbound',
        senderType: 'staff',
        text: trimmed,
        status: 'pending',
        tenantId,
      },
    });

    try {
      const result = await this.graph.sendPageMessage(
        conv.pageId,
        config.pageAccessToken,
        conv.participantPsid,
        trimmed,
      );
      const sent = await this.prisma.cskhInboxMessage.update({
        where: { id: pending.id },
        data: {
          status: 'sent',
          fbMessageId: result.message_id ?? null,
          sentAt: new Date(),
        },
      });
      await this.prisma.cskhInboxConversation.update({
        where: { id: conv.id },
        data: {
          lastMessage: trimmed,
          lastMessageAt: new Date(),
          unreadCount: 0,
        },
      });
      await this.publishMessageRealtime(conv.pageId, conv.id, [sent], false, tenantId);
      return sent;
    } catch (e) {
      await this.prisma.cskhInboxMessage.update({
        where: { id: pending.id },
        data: { status: 'failed' },
      });
      throw new BadRequestException((e as Error).message || 'Gửi tin thất bại');
    }
  }

  /** Broadcast typing indicator event qua SSE. */
  async notifyTyping(conversationId: string, tenantId?: string) {
    const conv = await this.prisma.cskhInboxConversation.findFirst({
      where: tenantId ? { id: conversationId, tenantId } : { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Hội thoại không tồn tại hoặc không có quyền');

    this.realtime.publish({
      type: 'typing',
      conversationId,
      pageId: conv.pageId,
      tenantId: conv.tenantId || undefined,
    });
  }

  /** Đánh dấu tin nhắn từ khách là đã đọc. */
  async markAsRead(conversationId: string, tenantId?: string) {
    const conv = await this.prisma.cskhInboxConversation.findFirst({
      where: tenantId ? { id: conversationId, tenantId } : { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Hội thoại không tồn tại hoặc không có quyền');

    const updatedConv = await this.prisma.cskhInboxConversation.update({
      where: { id: conversationId },
      data: { unreadCount: 0 },
    });

    const where: any = {
      conversationId,
      direction: 'inbound',
      status: { notIn: ['read', 'failed'] },
    };
    if (tenantId) where.tenantId = tenantId;
    const updated = await this.prisma.cskhInboxMessage.updateMany({
      where,
      data: { status: 'read' },
    });

    this.realtime.publish({
      type: 'read-receipt',
      conversationId,
      pageId: conv.pageId,
      conversation: this.formatConversationRow(updatedConv),
      tenantId: conv.tenantId || undefined,
    });

    return { markedAsRead: updated.count };
  }

  /** Đồng bộ inbox từ Graph API (khi chưa có webhook hoặc refresh). */
  async syncFromGraph(pageId?: string, tenantId?: string) {
    const where: any = {};
    if (pageId) where.pageId = pageId;
    if (tenantId) where.tenantId = tenantId;
    const pages = await this.prisma.facebookCskhConfig.findMany({ where });

    let synced = 0;
    for (const page of pages) {
      const convs = await this.graph.fetchConversationsForMonitor(
        page.pageId,
        page.pageAccessToken,
        this.syncLimit,
      );
      for (const fbConv of convs) {
        const participants = fbConv.participants?.data ?? [];
        const customer = participants.find((p) => String(p.id) !== String(page.pageId));
        if (!customer?.id) continue;

        const rawMsgs = await this.graph.fetchMessages(
          fbConv.id,
          page.pageAccessToken,
          this.msgLimit,
        );
        const customerName = this.graph.resolveCustomerName(
          fbConv.participants,
          page.pageId,
          rawMsgs,
        );
        let customerPictureUrl: string | null = null;
        if (page.pageAccessToken) {
          const profile = await this.graph.getMessengerUserProfile(
            String(customer.id),
            page.pageAccessToken,
          );
          customerPictureUrl = profile.pictureUrl;
        }

        const conv = await this.prisma.cskhInboxConversation.upsert({
          where: {
            pageId_participantPsid: {
              pageId: page.pageId,
              participantPsid: String(customer.id),
            },
          },
          create: {
            pageId: page.pageId,
            pageName: page.pageName,
            fbConversationId: fbConv.id,
            participantPsid: String(customer.id),
            customerName,
            customerPictureUrl,
            lastMessage: rawMsgs[0]?.message ?? null,
            lastMessageAt: fbConv.updated_time ? new Date(fbConv.updated_time) : new Date(),
            tenantId: page.tenantId,
          },
          update: {
            pageName: page.pageName ?? undefined,
            fbConversationId: fbConv.id,
            customerName,
            customerPictureUrl: customerPictureUrl ?? undefined,
            lastMessage: rawMsgs[0]?.message ?? undefined,
            lastMessageAt: fbConv.updated_time ? new Date(fbConv.updated_time) : undefined,
            tenantId: page.tenantId ?? undefined,
          },
        });

        const ordered = [...rawMsgs].reverse();
        let lastPreview: string | null = null;
        for (const msg of ordered) {
          const saved = await this.persistGraphMessage(
            conv.id,
            page.pageId,
            msg,
            page.pageAccessToken,
            page.tenantId || undefined,
          );
          if (saved) {
            lastPreview = saved.text;
            synced++;
          }
        }

        if (lastPreview) {
          await this.prisma.cskhInboxConversation.update({
            where: { id: conv.id },
            data: { lastMessage: lastPreview },
          });
        }

        await this.markAdFromGraphMessages(conv.id, rawMsgs);
      }
    }
    return { synced, pageCount: pages.length };
  }

  /** Liên kết inbox từ metadata audit — dùng PSID hoặc FB conversation id lưu trong audit. */
  async linkFromAudit(auditId: string, tenantId?: string) {
    type AuditMeta = {
      pageId?: string;
      conversationId?: string;
      participantPsid?: string;
      pageName?: string;
    };

    const audit = await this.prisma.chatAudit.findFirst({
      where: tenantId ? { id: auditId, tenantId } : { id: auditId },
    });
    if (!audit) throw new NotFoundException('Audit không tồn tại hoặc không có quyền');

    const meta = (audit.metadata as AuditMeta | null) ?? {};
    const pageId = meta.pageId?.trim();
    if (!pageId) throw new BadRequestException('Audit thiếu pageId');

    const page = await this.prisma.facebookCskhConfig.findFirst({
      where: tenantId ? { pageId, tenantId } : { pageId },
    });
    if (!page?.pageAccessToken) {
      throw new BadRequestException('Page chưa được kết nối OAuth');
    }

    let participantPsid = meta.participantPsid?.trim() || null;
    let fbConversationId = meta.conversationId?.trim() || null;
    let updatedTime: string | undefined;
    let participants = null as { data?: Array<{ id?: string; name?: string }> } | null | undefined;

    if (fbConversationId) {
      const fbConv = await this.graph.fetchConversationById(fbConversationId, page.pageAccessToken);
      if (fbConv) {
        participants = fbConv.participants;
        participantPsid =
          participantPsid || this.graph.resolveParticipantPsid(fbConv.participants, pageId);
        updatedTime = fbConv.updated_time;
      }
    }

    if (!participantPsid) {
      throw new BadRequestException(
        'Không xác định được PSID khách — chạy audit mới để gắn participantPsid.',
      );
    }

    const existing = await this.prisma.cskhInboxConversation.findFirst({
      where: tenantId ? { pageId, participantPsid, tenantId } : { pageId, participantPsid },
    });
    if (existing) return existing;

    const rawMsgs = fbConversationId
      ? await this.graph.fetchMessages(fbConversationId, page.pageAccessToken, this.msgLimit)
      : [];

    let customerName = audit.customerName;
    if (participants) {
      customerName = this.graph.resolveCustomerName(participants, pageId, rawMsgs);
    }

    let customerPictureUrl: string | null = null;
    const profile = await this.graph.getMessengerUserProfile(participantPsid, page.pageAccessToken);
    customerName = profile.name ?? customerName;
    customerPictureUrl = profile.pictureUrl;

    const conv = await this.prisma.cskhInboxConversation.upsert({
      where: { pageId_participantPsid: { pageId, participantPsid } },
      create: {
        pageId,
        pageName: page.pageName ?? meta.pageName ?? null,
        fbConversationId,
        participantPsid,
        customerName,
        customerPictureUrl,
        lastMessage: rawMsgs[0]?.message ?? null,
        lastMessageAt: updatedTime ? new Date(updatedTime) : new Date(),
        tenantId: page.tenantId,
      },
      update: {
        pageName: page.pageName ?? undefined,
        fbConversationId: fbConversationId ?? undefined,
        customerName: customerName ?? undefined,
        customerPictureUrl: customerPictureUrl ?? undefined,
        lastMessage: rawMsgs[0]?.message ?? undefined,
        lastMessageAt: updatedTime ? new Date(updatedTime) : undefined,
        tenantId: page.tenantId ?? undefined,
      },
    });

    if (fbConversationId && rawMsgs.length) {
      const ordered = [...rawMsgs].reverse();
      let lastPreview: string | null = null;
      for (const msg of ordered) {
        const saved = await this.persistGraphMessage(
          conv.id,
          pageId,
          msg,
          page.pageAccessToken,
          page.tenantId || undefined,
        );
        if (saved) lastPreview = saved.text;
      }
      if (lastPreview) {
        await this.prisma.cskhInboxConversation.update({
          where: { id: conv.id },
          data: { lastMessage: lastPreview },
        });
      }
    }

    return conv;
  }

  async getLatestAuditForConversation(conversationId: string, tenantId?: string) {
    const conv = await this.prisma.cskhInboxConversation.findFirst({
      where: tenantId ? { id: conversationId, tenantId } : { id: conversationId },
    });
    if (!conv) throw new NotFoundException('Hội thoại không tồn tại hoặc không có quyền');

    type Row = {
      id: string;
      score: number;
      feedback: string | null;
      metadata: unknown;
      transcript: unknown;
      customerName: string | null;
      agentName: string | null;
      createdAt: Date;
    };
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT id, score, feedback, metadata, transcript, customer_name AS "customerName",
             agent_name AS "agentName", created_at AS "createdAt"
      FROM chat_audits
      WHERE metadata->>'pageId' = ${conv.pageId}
        AND (${tenantId}::uuid IS NULL OR tenant_id = ${tenantId}::uuid)
      ORDER BY created_at DESC
      LIMIT 100
    `;
    if (conv.fbConversationId) {
      const byFb = rows.find(
        (r) => (r.metadata as { conversationId?: string } | null)?.conversationId === conv.fbConversationId,
      );
      if (byFb) return byFb;
    }
    if (conv.customerName) {
      return rows.find((r) => r.customerName === conv.customerName) ?? null;
    }
    return null;
  }
}
