import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { decrypt } from '@/lib/whatsapp/encryption';

async function resolveAccountId(supabase: any, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data?.account_id) return null;
  return data.account_id as string;
}

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_account',
          message: 'Your profile is not linked to an account.',
        },
        { status: 200 }
      );
    }

    const { data: config, error: configError } = await supabase
      .from('instagram_config')
      .select('instagram_id, username, page_id, page_name, access_token, created_at')
      .eq('account_id', accountId)
      .maybeSingle();

    if (configError || !config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No Instagram configuration found.',
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      connected: true,
      username: config.username,
      pageName: config.page_name,
      connectedAt: config.created_at,
    });
  } catch (error) {
    console.error('Error in Instagram config GET:', error);
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }

    const { error: deleteError } = await supabase
      .from('instagram_config')
      .delete()
      .eq('account_id', accountId);

    if (deleteError) {
      console.error('Error deleting instagram_config:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete configuration' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in Instagram config DELETE:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
