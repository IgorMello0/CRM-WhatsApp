import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sendInstagramDirectMessage } from '@/lib/instagram/api';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { conversationId, text } = await request.json();

    if (!conversationId || !text) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Load user's profile to get account_id
    const { data: profile } = await supabase
      .from("profiles")
      .select("account_id")
      .eq("user_id", session.user.id)
      .single();

    if (!profile?.account_id) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const accountId = profile.account_id;

    // Load instagram_config for the account
    const { data: config } = await supabase
      .from("instagram_config")
      .select("*")
      .eq("account_id", accountId)
      .single();

    if (!config || config.status !== "connected") {
      return NextResponse.json({ error: "Instagram not connected" }, { status: 400 });
    }

    // Load conversation to get contact ID
    const { data: conversation } = await supabase
      .from("conversations")
      .select("*, contact:contacts(*)")
      .eq("id", conversationId)
      .single();

    if (!conversation || !conversation.contact) {
      return NextResponse.json({ error: "Conversation or contact not found" }, { status: 404 });
    }

    const contact = Array.isArray(conversation.contact) ? conversation.contact[0] : conversation.contact;
    
    if (!contact.phone) {
      return NextResponse.json({ error: "Contact does not have an IGSID" }, { status: 400 });
    }

    // Decrypt token
    const token = await decrypt(config.access_token);

    // Send via Instagram API
    let response;
    try {
      response = await sendInstagramDirectMessage({
        igAccountId: config.ig_account_id,
        accessToken: token,
        recipientId: contact.phone,
        text
      });
    } catch (err: any) {
      throw new Error(err.message || "Failed to send Instagram message");
    }

    // Insert message into DB
    const messageId = response.messageId || `ig_${Date.now()}`;
    const { data: insertedMessage, error: insertError } = await supabase
      .from("messages")
      .insert({
        id: messageId,
        conversation_id: conversationId,
        sender_type: "agent",
        status: "sent",
        content_type: "text",
        content_text: text,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error inserting message:", insertError);
      return NextResponse.json({ error: "Message sent but failed to save to database" }, { status: 500 });
    }

    // Update conversation last_message
    await supabase
      .from("conversations")
      .update({
        last_message_text: text,
        last_message_at: new Date().toISOString(),
      })
      .eq("id", conversationId);

    return NextResponse.json(insertedMessage);
  } catch (error: any) {
    console.error("Error sending Instagram message:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
