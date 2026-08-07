import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  createMediaContainer,
  publishMediaContainer,
  getContainerStatus,
  getMediaDetails,
} from '@/lib/instagram/api';

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
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 });
    }

    const { data: posts, error: postsError } = await supabase
      .from('instagram_posts')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    if (postsError) {
      console.error('Error fetching instagram_posts:', postsError);
      return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 });
    }

    return NextResponse.json(posts || []);
  } catch (error) {
    console.error('Error in Instagram posts GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
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
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 });
    }

    const body = await request.json();
    const { mediaType, mediaUrl, caption } = body;

    if (!mediaType || !mediaUrl) {
      return NextResponse.json({ error: 'mediaType and mediaUrl are required' }, { status: 400 });
    }

    // Load config
    const { data: config, error: configError } = await supabase
      .from('instagram_config')
      .select('instagram_id, access_token')
      .eq('account_id', accountId)
      .maybeSingle();

    if (configError || !config) {
      return NextResponse.json({ error: 'Instagram account not connected' }, { status: 400 });
    }

    const accessToken = decrypt(config.access_token);

    // Initial DB insert as 'publishing'
    const { data: newPost, error: insertError } = await supabase
      .from('instagram_posts')
      .insert({
        account_id: accountId,
        user_id: user.id,
        media_type: mediaType,
        media_url: mediaUrl,
        caption: caption || null,
        status: 'publishing',
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating post record:', insertError);
      return NextResponse.json({ error: 'Failed to create post record' }, { status: 500 });
    }

    // Fire & forget the publishing process, or we can await it if it's quick
    // Since images are quick but videos take time, we will try to await it but with a timeout?
    // The prompt says: "For videos/reels: poll getContainerStatus until ready". Vercel functions might timeout if we do this synchronously.
    // However, I'll implement polling synchronously as requested by the flow.
    try {
      const { containerId } = await createMediaContainer({
        igAccountId: config.instagram_id,
        accessToken,
        mediaType,
        mediaUrl,
        caption,
      });

      if (mediaType === 'video' || mediaType === 'reel') {
        let isReady = false;
        let attempts = 0;
        while (!isReady && attempts < 15) {
          await new Promise(res => setTimeout(res, 3000));
          const status = await getContainerStatus({ accessToken, containerId });
          if (status.statusCode === 'FINISHED') {
            isReady = true;
          } else if (status.statusCode === 'ERROR') {
            throw new Error(status.errorMessage || 'Video processing failed');
          }
          attempts++;
        }
        if (!isReady) {
          throw new Error('Video processing timed out');
        }
      }

      const { mediaId } = await publishMediaContainer({
        igAccountId: config.instagram_id,
        accessToken,
        containerId,
      });

      const details = await getMediaDetails({ accessToken, mediaId });

      // Update DB to published
      const { data: updatedPost } = await supabase
        .from('instagram_posts')
        .update({
          status: 'published',
          media_id: mediaId,
          permalink: details.permalink,
        })
        .eq('id', newPost.id)
        .select()
        .single();

      return NextResponse.json(updatedPost || newPost);
    } catch (apiError: any) {
      console.error('Instagram publishing error:', apiError);
      // Update DB to failed
      await supabase
        .from('instagram_posts')
        .update({
          status: 'failed',
          error_message: apiError.message || 'Unknown error',
        })
        .eq('id', newPost.id);

      return NextResponse.json({ error: apiError.message || 'Failed to publish to Instagram' }, { status: 500 });
    }
  } catch (error) {
    console.error('Error in Instagram posts POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
