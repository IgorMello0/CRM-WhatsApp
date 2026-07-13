/**
 * UAZAPI (unofficial WhatsApp API) client.
 *
 * Every function takes a single options object. Throws on non-2xx.
 * Matches the `meta-api.ts` contract style so callers don't need
 * provider-specific error handling.
 */

import type { WhatsAppProvider, SendTextArgs, SendMediaArgs, SendResult } from './provider';

// ============================================================
// Instance management
// ============================================================

export interface UazapiConnectArgs {
  baseUrl: string;
  instanceToken: string;
}

export interface UazapiConnectResult {
  qrcode?: string;     // data:image/png;base64,... or raw base64
  pairingCode?: string;
  instanceId?: string;
}

/**
 * Initiate a WhatsApp connection — returns a QR code (base64 PNG)
 * that the user scans with their phone.
 */
export async function uazapiConnect(args: UazapiConnectArgs): Promise<UazapiConnectResult> {
  const { baseUrl, instanceToken } = args;
  const url = `${baseUrl.replace(/\/$/, '')}/instance/connect`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      token: instanceToken,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`UAZAPI connect failed (${response.status}): ${text}`);
  }
  const data = await response.json();
  if (data.code && data.code !== 200) {
    throw new Error(data.message || `UAZAPI error: code ${data.code}`);
  }
  return {
    qrcode: data?.instance?.qrcode ?? data?.data?.qrcode ?? data?.qrcode ?? undefined,
    pairingCode: data?.instance?.paircode ?? data?.data?.pairingCode ?? data?.pairingCode ?? undefined,
    instanceId: data?.instance?.id ?? data?.instanceId ?? undefined,
  };
}

export interface UazapiStatusArgs {
  baseUrl: string;
  instanceToken: string;
}

export type UazapiConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'hibernated';

export interface UazapiStatusResult {
  status: UazapiConnectionStatus;
}

/**
 * Check the current connection status of a UAZAPI instance.
 */
export async function uazapiGetStatus(args: UazapiStatusArgs): Promise<UazapiStatusResult> {
  const { baseUrl, instanceToken } = args;
  const url = `${baseUrl.replace(/\/$/, '')}/instance/status`;
  const response = await fetch(url, {
    headers: { token: instanceToken },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`UAZAPI status check failed (${response.status}): ${text}`);
  }
  const data = await response.json();
  if (data.code && data.code !== 200) {
    throw new Error(data.message || `UAZAPI error: code ${data.code}`);
  }
  // The status field may be nested or at the top level depending on
  // the UAZAPI version — handle both.
  const status = data?.instance?.status ?? data?.status ?? 'disconnected';
  return { status };
}

// ============================================================
// Sending
// ============================================================

export interface UazapiSendTextArgs {
  baseUrl: string;
  instanceToken: string;
  to: string;
  text: string;
  replyId?: string;
}

/**
 * Send a text message via UAZAPI.
 */
export async function uazapiSendText(args: UazapiSendTextArgs): Promise<SendResult> {
  const { baseUrl, instanceToken, to, text, replyId } = args;
  const url = `${baseUrl.replace(/\/$/, '')}/send/text`;
  const body: Record<string, unknown> = {
    number: to,
    text,
    linkPreview: true,
    readchat: true,
    delay: 0,
  };
  if (replyId) body.replyid = replyId;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      token: instanceToken,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`UAZAPI send text failed (${response.status}): ${errText}`);
  }
  const data = await response.json();
  if (data.code && data.code !== 200) {
    throw new Error(data.message || `UAZAPI error: code ${data.code}`);
  }
  // UAZAPI returns the message key in various shapes; normalise.
  const messageId = data?.key?.id ?? data?.messageId ?? data?.id ?? '';
  return { messageId };
}

export type UazapiMediaType = 'image' | 'video' | 'audio' | 'document';

export interface UazapiSendMediaArgs {
  baseUrl: string;
  instanceToken: string;
  to: string;
  mediaType: UazapiMediaType;
  url: string;
  caption?: string;
  fileName?: string;
  mimeType?: string;
  replyId?: string;
}

const DEFAULT_MIME_TYPES: Record<UazapiMediaType, string> = {
  image: 'image/jpeg',
  video: 'video/mp4',
  audio: 'audio/ogg',
  document: 'application/pdf',
};

/**
 * Send a media message (image/video/audio/document) via UAZAPI.
 */
export async function uazapiSendMedia(args: UazapiSendMediaArgs): Promise<SendResult> {
  const { baseUrl, instanceToken, to, mediaType, url: mediaUrl, caption, fileName, mimeType, replyId } = args;
  const endpoint = `${baseUrl.replace(/\/$/, '')}/send/media`;
  const body: Record<string, unknown> = {
    number: to,
    mediatype: mediaType,
    mimetype: mimeType || DEFAULT_MIME_TYPES[mediaType] || 'application/octet-stream',
    url: mediaUrl,
    readchat: true,
    delay: 0,
  };
  if (caption && mediaType !== 'audio') body.caption = caption;
  if (fileName && mediaType === 'document') body.fileName = fileName;
  if (replyId) body.replyid = replyId;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      token: instanceToken,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`UAZAPI send media failed (${response.status}): ${errText}`);
  }
  const data = await response.json();
  if (data.code && data.code !== 200) {
    throw new Error(data.message || `UAZAPI error: code ${data.code}`);
  }
  const messageId = data?.key?.id ?? data?.messageId ?? data?.id ?? '';
  return { messageId };
}

// ============================================================
// Provider adapter
// ============================================================

/**
 * Wraps the raw UAZAPI functions into a `WhatsAppProvider` so the
 * send core can call `.sendText()` / `.sendMedia()` without knowing
 * which transport is active.
 */
export function createUazapiProvider(baseUrl: string, instanceToken: string): WhatsAppProvider {
  return {
    async sendText(args: SendTextArgs): Promise<SendResult> {
      return uazapiSendText({
        baseUrl,
        instanceToken,
        to: args.to,
        text: args.text,
        replyId: args.contextMessageId,
      });
    },
    async sendMedia(args: SendMediaArgs): Promise<SendResult> {
      return uazapiSendMedia({
        baseUrl,
        instanceToken,
        to: args.to,
        mediaType: args.kind,
        url: args.link,
        caption: args.caption,
        fileName: args.filename,
        replyId: args.contextMessageId,
      });
    },
  };
}
