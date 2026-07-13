import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { uazapiConnect } from '@/lib/whatsapp/uazapi-api'
import { decrypt } from '@/lib/whatsapp/encryption'

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Resolve account
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account found' }, { status: 403 })
    }

    // Load UAZAPI config
    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('uazapi_base_url, uazapi_instance_token, provider')
      .eq('account_id', accountId)
      .maybeSingle()

    if (!config || config.provider !== 'uazapi') {
      return NextResponse.json(
        { error: 'UAZAPI is not configured. Save your UAZAPI credentials first.' },
        { status: 400 }
      )
    }

    if (!config.uazapi_base_url || !config.uazapi_instance_token) {
      return NextResponse.json(
        { error: 'UAZAPI base URL or instance token is missing.' },
        { status: 400 }
      )
    }

    const instanceToken = decrypt(config.uazapi_instance_token)

    const result = await uazapiConnect({
      baseUrl: config.uazapi_base_url,
      instanceToken,
    })

    // Save instance ID if returned
    if (result.instanceId) {
      await supabase
        .from('whatsapp_config')
        .update({ uazapi_instance_id: result.instanceId })
        .eq('account_id', accountId)
    }

    return NextResponse.json({
      qrcode: result.qrcode,
      pairingCode: result.pairingCode,
    })
  } catch (error) {
    console.error('Error in UAZAPI connect:', error)
    const message = error instanceof Error ? error.message : 'Failed to connect'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
