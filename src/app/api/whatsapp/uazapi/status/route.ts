import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { uazapiGetStatus } from '@/lib/whatsapp/uazapi-api'
import { decrypt } from '@/lib/whatsapp/encryption'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account found' }, { status: 403 })
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('uazapi_base_url, uazapi_instance_token, provider, status')
      .eq('account_id', accountId)
      .maybeSingle()

    if (!config || config.provider !== 'uazapi') {
      return NextResponse.json(
        { error: 'UAZAPI is not configured' },
        { status: 400 }
      )
    }

    if (!config.uazapi_base_url || !config.uazapi_instance_token) {
      return NextResponse.json(
        { error: 'UAZAPI credentials are incomplete' },
        { status: 400 }
      )
    }

    const instanceToken = decrypt(config.uazapi_instance_token)

    const result = await uazapiGetStatus({
      baseUrl: config.uazapi_base_url,
      instanceToken,
    })

    // Sync the status back to the DB if it changed
    const dbStatus = result.status === 'connected' ? 'connected' : 'disconnected'
    if (dbStatus !== config.status) {
      await supabase
        .from('whatsapp_config')
        .update({
          status: dbStatus,
          connected_at: dbStatus === 'connected' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', accountId)
    }

    return NextResponse.json({ status: result.status })
  } catch (error) {
    console.error('Error in UAZAPI status:', error)
    const message = error instanceof Error ? error.message : 'Failed to check status'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
