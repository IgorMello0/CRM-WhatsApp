/**
 * Resolve the WhatsApp provider for an account's config row.
 *
 * Returns a `WhatsAppProvider` implementation that the send core calls
 * without knowing the underlying transport. Meta sends go through
 * `meta-api.ts`; UAZAPI sends go through `uazapi-api.ts`.
 */

import type { WhatsAppProvider } from './provider';
import { createUazapiProvider } from './uazapi-api';
import {
  sendTextMessage,
  sendMediaMessage,
  type MediaKind,
} from './meta-api';
import type { SendTextArgs, SendMediaArgs, SendResult } from './provider';

export interface ProviderConfig {
  provider: 'meta' | 'uazapi';
  // Meta fields
  phone_number_id?: string;
  access_token?: string; // already decrypted
  // UAZAPI fields
  uazapi_base_url?: string;
  uazapi_instance_token?: string; // already decrypted
}

/**
 * Create a `WhatsAppProvider` from a config row. Tokens must already
 * be decrypted before calling.
 */
export function resolveProvider(config: ProviderConfig): WhatsAppProvider {
  if (config.provider === 'uazapi') {
    if (!config.uazapi_base_url || !config.uazapi_instance_token) {
      throw new Error('UAZAPI config is missing base_url or instance_token');
    }
    return createUazapiProvider(config.uazapi_base_url, config.uazapi_instance_token);
  }

  // Meta (default)
  if (!config.phone_number_id || !config.access_token) {
    throw new Error('Meta config is missing phone_number_id or access_token');
  }

  const phoneNumberId = config.phone_number_id;
  const accessToken = config.access_token;

  return {
    async sendText(args: SendTextArgs): Promise<SendResult> {
      return sendTextMessage({
        phoneNumberId,
        accessToken,
        to: args.to,
        text: args.text,
        contextMessageId: args.contextMessageId,
      });
    },
    async sendMedia(args: SendMediaArgs): Promise<SendResult> {
      return sendMediaMessage({
        phoneNumberId,
        accessToken,
        to: args.to,
        kind: args.kind as MediaKind,
        link: args.link,
        caption: args.caption,
        filename: args.filename,
        contextMessageId: args.contextMessageId,
      });
    },
  };
}
