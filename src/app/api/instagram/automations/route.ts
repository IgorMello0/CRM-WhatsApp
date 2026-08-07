import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let memberData;
  try {
    memberData = await requireRole('agent')
  } catch (roleError: any) {
    return toErrorResponse(roleError)
  }

  const { data, error } = await supabase
    .from('instagram_comment_automations')
    .select('*')
    .eq('account_id', memberData.accountId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ automations: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let memberData;
  try {
    memberData = await requireRole('admin')
  } catch (roleError: any) {
    return toErrorResponse(roleError)
  }

  try {
    const body = await request.json()
    const { name, keywords, match_type, case_sensitive, reply_message, comment_reply_text, is_active } = body

    const { data, error } = await supabase
      .from('instagram_comment_automations')
      .insert({
        account_id: memberData.accountId,
        user_id: user.id,
        name,
        keywords,
        match_type: match_type || 'contains',
        case_sensitive: case_sensitive || false,
        reply_message,
        comment_reply_text: comment_reply_text || null,
        is_active: is_active !== undefined ? is_active : true,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ automation: data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let memberData;
  try {
    memberData = await requireRole('admin')
  } catch (roleError: any) {
    return toErrorResponse(roleError)
  }

  try {
    const { searchParams } = new URL(request.url)
    const urlId = searchParams.get('id')
    
    const body = await request.json()
    const id = urlId || body.id

    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 })

    const updateData: any = {}
    if (body.name !== undefined) updateData.name = body.name
    if (body.keywords !== undefined) updateData.keywords = body.keywords
    if (body.match_type !== undefined) updateData.match_type = body.match_type
    if (body.case_sensitive !== undefined) updateData.case_sensitive = body.case_sensitive
    if (body.reply_message !== undefined) updateData.reply_message = body.reply_message
    if (body.comment_reply_text !== undefined) updateData.comment_reply_text = body.comment_reply_text || null
    if (body.is_active !== undefined) updateData.is_active = body.is_active

    const { data, error } = await supabase
      .from('instagram_comment_automations')
      .update(updateData)
      .eq('id', id)
      .eq('account_id', memberData.accountId)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ automation: data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let memberData;
  try {
    memberData = await requireRole('admin')
  } catch (roleError: any) {
    return toErrorResponse(roleError)
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 })

  const { error } = await supabase
    .from('instagram_comment_automations')
    .delete()
    .eq('id', id)
    .eq('account_id', memberData.accountId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
