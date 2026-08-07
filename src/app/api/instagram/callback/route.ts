import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { exchangeForLongLivedToken, listUserPages, getInstagramAccountInfo } from '@/lib/instagram/api'
import { encrypt } from '@/lib/whatsapp/encryption'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')

    if (!code || !state) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=instagram&error=missing_params`, 302)
    }

    const userId = state
    const supabase = await createClient()

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (profileError || !profile?.account_id) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=instagram&error=no_account`, 302)
    }

    const accountId = profile.account_id
    const appId = process.env.FACEBOOK_APP_ID!
    const appSecret = process.env.FACEBOOK_APP_SECRET!
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/instagram/callback`

    const tokenResponse = await fetch('https://graph.facebook.com/v21.0/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code,
      }).toString(),
    })

    if (!tokenResponse.ok) {
      console.error('Facebook token exchange failed', await tokenResponse.text())
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=instagram&error=token_exchange_failed`, 302)
    }

    const tokenData = await tokenResponse.json()
    const shortLivedToken = tokenData.access_token

    const { accessToken: longLivedToken } = await exchangeForLongLivedToken({
      appId,
      appSecret,
      shortLivedToken,
    })

    const pages = await listUserPages({ accessToken: longLivedToken })
    const targetPage = pages.find((p) => p.igAccountId !== null)

    if (!targetPage || !targetPage.igAccountId) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=instagram&error=no_ig_account`, 302)
    }

    const igAccountId = targetPage.igAccountId

    const igInfo = await getInstagramAccountInfo({
      accessToken: targetPage.accessToken,
      igAccountId,
    })
    
    let encryptedToken: string
    try {
      encryptedToken = encrypt(targetPage.accessToken)
    } catch (err) {
      console.error('Encryption failed:', err)
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=instagram&error=encryption_failed`, 302)
    }

    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const baseRow = {
      account_id: accountId,
      user_id: userId,
      ig_account_id: igAccountId,
      page_id: targetPage.id,
      access_token: encryptedToken,
      username: igInfo.username,
      name: igInfo.name,
      profile_picture_url: igInfo.profilePictureUrl,
      status: 'connected',
      updated_at: new Date().toISOString(),
    }

    const { data: existing } = await supabaseAdmin
      .from('instagram_config')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()

    if (existing) {
      const { error: updateError } = await supabaseAdmin
        .from('instagram_config')
        .update(baseRow)
        .eq('account_id', accountId)

      if (updateError) throw updateError
    } else {
      const { error: insertError } = await supabaseAdmin
        .from('instagram_config')
        .insert(baseRow)

      if (insertError) throw insertError
    }

    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=instagram&success=true`, 302)

  } catch (error) {
    console.error('Instagram callback error', error)
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=instagram&error=internal`, 302)
  }
}
