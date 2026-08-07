import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const clientId = process.env.FACEBOOK_APP_ID
  
  if (!clientId) {
    return NextResponse.json({ error: 'FACEBOOK_APP_ID is not configured' }, { status: 500 })
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/instagram/callback`
  const scope = 'instagram_basic,instagram_manage_messages,instagram_manage_comments,pages_manage_metadata,pages_show_list,pages_read_engagement,business_management'
  const state = user.id

  const url = new URL('https://www.facebook.com/v21.0/dialog/oauth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', scope)
  url.searchParams.set('state', state)

  return NextResponse.redirect(url.toString(), 302)
}
