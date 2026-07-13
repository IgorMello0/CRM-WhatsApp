import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { processMessage } from '../route'; // import from Meta route

export const maxDuration = 60;

// Lazy-initialized admin client for webhook processing
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // 1. We must find which account this webhook belongs to.
    // UAZAPI sends the token in the payload. We need to match it.
    const token = body.token || (request.headers.get('token'));
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const { data: configs, error: configError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id, user_id, uazapi_instance_token')
      .eq('provider', 'uazapi');

    if (configError || !configs) {
      return NextResponse.json({ error: 'Config error' }, { status: 500 });
    }

    let matchedConfig = null;
    for (const config of configs) {
      if (!config.uazapi_instance_token) continue;
      try {
        if (decrypt(config.uazapi_instance_token) === token) {
          matchedConfig = config;
          break;
        }
      } catch (e) {
        // Ignore decryption errors for individual rows
      }
    }

    if (!matchedConfig) {
      return NextResponse.json({ error: 'Unauthorized token' }, { status: 401 });
    }

    // 2. Process in background
    after(async () => {
      try {
        if (body.EventType === 'messages' && body.message) {
          // UAZAPI sends messages from us as well, skip them if we don't want echoes, 
          // but we usually rely on `fromMe` to mark them as sent? 
          // Meta webhook only sends inbound. Let's ignore fromMe=true for inbound inbox.
          if (body.message.fromMe) return;

          const senderPhone = body.message.sender_pn.replace('@s.whatsapp.net', '');
          const contactName = body.chat?.wa_name || body.chat?.name || senderPhone;

          const metaMessage = {
            id: body.message.messageid,
            from: senderPhone,
            timestamp: Math.floor(body.message.messageTimestamp / 1000).toString(),
            type: body.message.type === 'chat' ? 'text' : body.message.type,
            text: (body.message.type === 'text' || body.message.type === 'chat') ? { body: body.message.text || body.message.content } : undefined,
            // TODO: Map media payloads here once we know UAZAPI media format
          };

          const contact = {
            profile: { name: contactName },
            wa_id: senderPhone,
          };

          await processMessage(
            metaMessage as any,
            contact,
            matchedConfig.account_id,
            matchedConfig.user_id,
            '' // no access token needed for text
          );
        }
      } catch (err) {
        console.error('Error processing UAZAPI webhook:', err);
      }
    });

    return NextResponse.json({ success: true, message: 'Webhook received' }, { status: 200 });
  } catch (error) {
    console.error('Error in UAZAPI webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET - Some providers use GET for webhook validation (like Meta does)
export async function GET(request: Request) {
  return NextResponse.json({ status: 'UAZAPI webhook endpoint is active' }, { status: 200 });
}
