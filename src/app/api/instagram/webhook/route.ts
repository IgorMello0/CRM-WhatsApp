import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { sendPrivateReplyToComment, replyToComment } from '@/lib/instagram/api'

// The `after()` callback in POST runs within this route's max duration.
export const maxDuration = 60

// Lazy-initialized to avoid build-time crash when env vars are missing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

// GET - Webhook verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      )
    }

    // Instagram webhooks use the same Meta App webhook system.
    // We use a dedicated env var for verification.
    if (verifyToken === process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) {
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    )
  } catch (error) {
    console.error('Error in IG webhook GET verification:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Receive events from Meta
export async function POST(request: Request) {
  // Read raw body first so we can HMAC-verify the exact bytes Meta signed.
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  // Use HMAC-SHA256 verification (same app secret as WhatsApp)
  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[ig webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Process AFTER the response so we ack Meta within their timeout,
  // while still guaranteeing the work runs to completion on serverless.
  after(async () => {
    try {
      await processWebhook(body)
    } catch (error) {
      console.error('Error processing IG webhook:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processWebhook(body: any) {
  if (!body.entry) return

  for (const entry of body.entry) {
    const igAccountId = entry.id

    // Look up the instagram_config by ig_account_id matching entry.id
    const { data: config, error: configError } = await supabaseAdmin()
      .from('instagram_config')
      .select('*')
      .eq('ig_account_id', igAccountId)
      .maybeSingle()

    if (configError || !config) {
      console.error('No instagram config found for ig_account_id:', igAccountId)
      continue
    }

    let decryptedAccessToken = ''
    if (config.access_token) {
      try {
        decryptedAccessToken = decrypt(config.access_token)
      } catch (err) {
        console.error('Failed to decrypt instagram access token', err)
      }
    }

    // Process Direct Messages
    if (entry.messaging) {
      for (const msgEvent of entry.messaging) {
        await processDirectMessage(msgEvent, config)
      }
    }

    // Process Comments
    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field === 'comments') {
          await processComment(change.value, config, decryptedAccessToken)
        }
      }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processDirectMessage(msgEvent: any, config: any) {
  const senderId = msgEvent.sender?.id
  const message = msgEvent.message
  if (!senderId || !message) return

  // Use the IGSID as the phone field (since Instagram users don't have phone numbers exposed)
  // Set the contact name from the username when available
  const phone = senderId
  const contactName = msgEvent.sender?.username || 'Instagram User'

  // Find or create contact
  let { data: contact } = await supabaseAdmin()
    .from('contacts')
    .select('*')
    .eq('account_id', config.account_id)
    .eq('phone', phone)
    .maybeSingle()

  if (!contact) {
    const { data: newContact, error: insertError } = await supabaseAdmin()
      .from('contacts')
      .insert({
        account_id: config.account_id,
        user_id: config.user_id,
        phone,
        name: contactName,
        platform: 'instagram'
      })
      .select()
      .single()
      
    if (insertError) {
      console.error('Error creating IG contact:', insertError)
      return
    }
    contact = newContact
  }

  // Find or create conversation with platform='instagram'
  let { data: conversation } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', config.account_id)
    .eq('contact_id', contact.id)
    .eq('platform', 'instagram')
    .maybeSingle()

  if (!conversation) {
    const { data: newConv, error: convError } = await supabaseAdmin()
      .from('conversations')
      .insert({
        account_id: config.account_id,
        user_id: config.user_id,
        contact_id: contact.id,
        platform: 'instagram',
        status: 'open'
      })
      .select()
      .single()
      
    if (convError) {
      console.error('Error creating IG conversation:', convError)
      return
    }
    conversation = newConv
  }

  // Insert message into messages table with platform='instagram'
  const { error: msgError } = await supabaseAdmin()
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: 'text',
      content_text: message.text || '',
      message_id: message.mid,
      status: 'delivered',
      platform: 'instagram'
    })

  if (msgError) {
    console.error('Error inserting IG message:', msgError)
  }

  // Update conversation
  const timestamp = msgEvent.timestamp 
    ? new Date(parseInt(msgEvent.timestamp)).toISOString() 
    : new Date().toISOString()

  await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: message.text || '[Message]',
      last_message_at: timestamp,
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString()
    })
    .eq('id', conversation.id)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processComment(comment: any, config: any, accessToken: string) {
  const { id: commentId, text, from } = comment
  if (!text) return

  // Check instagram_comment_automations table for matching keywords
  const { data: automations, error: automationsError } = await supabaseAdmin()
    .from('instagram_comment_automations')
    .select('*')
    .eq('ig_account_id', config.ig_account_id)
    .eq('is_active', true)

  if (automationsError || !automations) {
    console.error('Error fetching IG automations:', automationsError)
    return
  }

  for (const automation of automations) {
    let isMatch = false
    if (Array.isArray(automation.keywords)) {
      isMatch = automation.keywords.some((kw: string) => 
        text.toLowerCase().includes(kw.toLowerCase())
      )
    }

    if (isMatch) {
      // If match found, send private reply
      if (automation.reply_message && accessToken) {
        await sendPrivateReplyToComment({
          igAccountId: config.ig_account_id,
          accessToken,
          commentId,
          text: automation.reply_message
        });
      }
      
      // Optionally post a public reply
      if (automation.comment_reply_text && accessToken) {
        await replyToComment({
          accessToken,
          commentId,
          message: automation.comment_reply_text
        });
      }

      // Increment execution_count on the automation
      const count = (automation.execution_count || 0) + 1
      await supabaseAdmin()
        .from('instagram_comment_automations')
        .update({ execution_count: count })
        .eq('id', automation.id)
      
      // Typically we only want one automation to fire per comment
      break
    }
  }
}
