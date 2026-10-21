import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/whatsapp/encryption';

export async function POST(req: Request) {
  try {
    const { access_token } = await req.json();

    if (typeof access_token !== 'string' || !access_token.trim()) {
      return NextResponse.json(
        { error: 'Access token is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .single();

    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;

    if (!appId || !appSecret) {
      return NextResponse.json(
        { error: 'Missing Meta app credentials in environment' },
        { status: 500 }
      );
    }

    // 1. Exchange short-lived token for long-lived token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${access_token}`
    );
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('Failed to exchange token:', tokenData);
      return NextResponse.json(
        { error: 'Failed to exchange Meta access token' },
        { status: 400 }
      );
    }

    const longLivedToken = tokenData.access_token;

    // 2. Fetch User's Business Accounts
    const businessesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/businesses?access_token=${longLivedToken}`
    );
    const businessesData = await businessesRes.json();

    if (
      !businessesRes.ok ||
      !businessesData.data ||
      businessesData.data.length === 0
    ) {
      console.error(
        'Failed to fetch businesses or no businesses found:',
        businessesData
      );
      return NextResponse.json(
        { error: 'No Meta Business found for this account' },
        { status: 400 }
      );
    }

    // For simplicity, we take the first business. In a robust setup, you might need to query specifically or list them.
    const businessId = businessesData.data[0].id;

    // 3. Fetch WABAs for this Business
    const wabasRes = await fetch(
      `https://graph.facebook.com/v21.0/${businessId}/owned_whatsapp_business_accounts?access_token=${longLivedToken}`
    );
    const wabasData = await wabasRes.json();

    if (!wabasRes.ok || !wabasData.data || wabasData.data.length === 0) {
      console.error('Failed to fetch WABAs:', wabasData);
      return NextResponse.json(
        { error: 'No WhatsApp Business Account found' },
        { status: 400 }
      );
    }

    const wabaId = wabasData.data[0].id;

    // 4. Fetch Phone Numbers for this WABA
    const phonesRes = await fetch(
      `https://graph.facebook.com/v21.0/${wabaId}/phone_numbers?access_token=${longLivedToken}`
    );
    const phonesData = await phonesRes.json();

    if (!phonesRes.ok || !phonesData.data || phonesData.data.length === 0) {
      console.error('Failed to fetch Phone Numbers:', phonesData);
      return NextResponse.json(
        { error: 'No Phone Numbers found in WABA' },
        { status: 400 }
      );
    }

    const phoneNumberId = phonesData.data[0].id;

    // 5. Save everything to our DB
    const { error: upsertError } = await supabase
      .from('whatsapp_config')
      .upsert(
        {
          account_id: profile.account_id,
          user_id: user.id,
          provider: 'meta',
          access_token: encrypt(longLivedToken),
          waba_id: wabaId,
          phone_number_id: phoneNumberId,
        },
        { onConflict: 'account_id' }
      );

    if (upsertError) {
      console.error('Failed to save config:', upsertError);
      return NextResponse.json(
        { error: 'Failed to save configuration' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Embedded Signup Auth Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
