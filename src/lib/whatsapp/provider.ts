/**
 * WhatsApp provider abstraction.
 *
 * Each provider (Meta Cloud API, UAZAPI) implements this interface so
 * the send core, automations, and flows can dispatch outbound messages
 * without knowing which transport is active.
 */

export type MediaKind = 'image' | 'video' | 'document' | 'audio';

export interface SendTextArgs {
  to: string;
  text: string;
  contextMessageId?: string;
}

export interface SendMediaArgs {
  to: string;
  kind: MediaKind;
  link: string;
  caption?: string;
  filename?: string;
  contextMessageId?: string;
}

export interface SendResult {
  messageId: string;
}

/**
 * Minimal contract every WhatsApp transport must satisfy.
 *
 * Template sends and interactive messages are Meta-only (UAZAPI has no
 * template concept, and interactive messages work differently). The send
 * core checks for their presence before calling.
 */
export interface WhatsAppProvider {
  /** Send a free-form text message. */
  sendText(args: SendTextArgs): Promise<SendResult>;
  /** Send a media message (image, video, document, audio). */
  sendMedia(args: SendMediaArgs): Promise<SendResult>;
}
