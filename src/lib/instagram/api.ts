/**
 * Instagram Graph API + Messenger API client.
 *
 * Every function takes a single options object. Throws on non-2xx.
 * Matches the `meta-api.ts` contract style so callers don't need
 * provider-specific error handling.
 */

const IG_API_VERSION = 'v21.0'
const IG_API_BASE = `https://graph.facebook.com/${IG_API_VERSION}`

interface GraphApiErrorResponse {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    fbtrace_id?: string
  }
}

async function throwGraphApiError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as GraphApiErrorResponse
    if (data.error?.message) {
      message = data.error.message
    }
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

// ── Direct Messages (Messenger API for Instagram) ──

/**
 * Send a text message to an Instagram user via the Messenger API.
 * Uses the page-scoped user ID (IGSID) to address the recipient.
 * 
 * POST /{ig_account_id}/messages
 * Body: { recipient: { id }, message: { text } }
 */
export async function sendInstagramDirectMessage(opts: {
  igAccountId: string;
  accessToken: string;
  recipientId: string;
  text: string;
}): Promise<{ messageId: string }> {
  const { igAccountId, accessToken, recipientId, text } = opts;
  const url = `${IG_API_BASE}/${igAccountId}/messages`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  if (!response.ok) {
    await throwGraphApiError(response, `Instagram API error: ${response.status}`);
  }

  const data = await response.json();
  return { messageId: data.message_id };
}

/**
 * Send a private reply to a comment via Instagram DM.
 * This is the official "Private Replies" API endpoint.
 * 
 * POST /{ig_account_id}/messages
 * Body: { recipient: { comment_id }, message: { text } }
 */
export async function sendPrivateReplyToComment(opts: {
  igAccountId: string;
  accessToken: string;
  commentId: string;
  text: string;
}): Promise<{ messageId: string }> {
  const { igAccountId, accessToken, commentId, text } = opts;
  const url = `${IG_API_BASE}/${igAccountId}/messages`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: { text },
    }),
  });

  if (!response.ok) {
    await throwGraphApiError(response, `Instagram API error: ${response.status}`);
  }

  const data = await response.json();
  return { messageId: data.message_id };
}

/**
 * Reply publicly to a comment on an Instagram post.
 * 
 * POST /{comment_id}/replies
 * Body: { message }
 */
export async function replyToComment(opts: {
  accessToken: string;
  commentId: string;
  message: string;
}): Promise<{ commentId: string }> {
  const { accessToken, commentId, message } = opts;
  const url = `${IG_API_BASE}/${commentId}/replies`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    await throwGraphApiError(response, `Instagram API error: ${response.status}`);
  }

  const data = await response.json();
  return { commentId: data.id };
}

// ── Content Publishing API ──

/**
 * Step 1 of publishing: Create a media container.
 * For images: POST /{ig_account_id}/media with image_url + caption
 * For videos/reels: POST /{ig_account_id}/media with video_url + caption + media_type=REELS
 */
export async function createMediaContainer(opts: {
  igAccountId: string;
  accessToken: string;
  mediaType: 'image' | 'video' | 'reel';
  mediaUrl: string;
  caption?: string;
}): Promise<{ containerId: string }> {
  const { igAccountId, accessToken, mediaType, mediaUrl, caption } = opts;
  const url = `${IG_API_BASE}/${igAccountId}/media`;
  
  const body: Record<string, string> = {};
  if (mediaType === 'image') {
    body.image_url = mediaUrl;
  } else if (mediaType === 'video') {
    body.video_url = mediaUrl;
    body.media_type = 'VIDEO';
  } else if (mediaType === 'reel') {
    body.video_url = mediaUrl;
    body.media_type = 'REELS';
  }
  
  if (caption) {
    body.caption = caption;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    await throwGraphApiError(response, `Instagram API error: ${response.status}`);
  }

  const data = await response.json();
  return { containerId: data.id };
}

/**
 * Step 2 of publishing: Publish the media container.
 * POST /{ig_account_id}/media_publish with creation_id
 */
export async function publishMediaContainer(opts: {
  igAccountId: string;
  accessToken: string;
  containerId: string;
}): Promise<{ mediaId: string }> {
  const { igAccountId, accessToken, containerId } = opts;
  const url = `${IG_API_BASE}/${igAccountId}/media_publish`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ creation_id: containerId }),
  });

  if (!response.ok) {
    await throwGraphApiError(response, `Instagram API error: ${response.status}`);
  }

  const data = await response.json();
  return { mediaId: data.id };
}

/**
 * Check the status of a media container (for video processing).
 * GET /{container_id}?fields=status_code
 */
export async function getContainerStatus(opts: {
  accessToken: string;
  containerId: string;
}): Promise<{ statusCode: string; errorMessage?: string }> {
  const { accessToken, containerId } = opts;
  const url = `${IG_API_BASE}/${containerId}?fields=status_code,status`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    await throwGraphApiError(response, `Instagram API error: ${response.status}`);
  }

  const data = await response.json();
  return { 
    statusCode: data.status_code,
    errorMessage: data.status,
  };
}

/**
 * Get published media details (permalink, timestamp, etc.)
 * GET /{media_id}?fields=id,timestamp,permalink,media_url,caption
 */
export async function getMediaDetails(opts: {
  accessToken: string;
  mediaId: string;
}): Promise<{
  id: string;
  timestamp: string;
  permalink: string;
  mediaUrl?: string;
  caption?: string;
}> {
  const { accessToken, mediaId } = opts;
  const url = `${IG_API_BASE}/${mediaId}?fields=id,timestamp,permalink,media_url,caption`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    await throwGraphApiError(response, `Instagram API error: ${response.status}`);
  }

  const data = await response.json();
  return {
    id: data.id,
    timestamp: data.timestamp,
    permalink: data.permalink,
    mediaUrl: data.media_url,
    caption: data.caption,
  };
}

// ── Account & Token Management ──

/**
 * Exchange a short-lived token for a long-lived one (60 days).
 * GET /oauth/access_token?grant_type=fb_exchange_token&client_id=&client_secret=&fb_exchange_token=
 */
export async function exchangeForLongLivedToken(opts: {
  appId: string;
  appSecret: string;
  shortLivedToken: string;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const { appId, appSecret, shortLivedToken } = opts;
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  });
  
  const url = `${IG_API_BASE}/oauth/access_token?${params.toString()}`;
  
  const response = await fetch(url);

  if (!response.ok) {
    await throwGraphApiError(response, `Instagram API error: ${response.status}`);
  }

  const data = await response.json();
  return { 
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Get the Instagram Business Account ID linked to a Facebook Page.
 * GET /{page_id}?fields=instagram_business_account,name
 */
export async function getInstagramBusinessAccount(opts: {
  accessToken: string;
  pageId: string;
}): Promise<{ igAccountId: string | null; pageName: string }> {
  const { accessToken, pageId } = opts;
  const url = `${IG_API_BASE}/${pageId}?fields=instagram_business_account,name`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    await throwGraphApiError(response, `Instagram API error: ${response.status}`);
  }

  const data = await response.json();
  return {
    igAccountId: data.instagram_business_account?.id ?? null,
    pageName: data.name,
  };
}

/**
 * Get Instagram account details (username, profile picture, etc.).
 * GET /{ig_account_id}?fields=username,name,profile_picture_url,followers_count,media_count
 */
export async function getInstagramAccountInfo(opts: {
  accessToken: string;
  igAccountId: string;
}): Promise<{
  username: string;
  name: string;
  profilePictureUrl: string;
  followersCount: number;
  mediaCount: number;
}> {
  const { accessToken, igAccountId } = opts;
  const url = `${IG_API_BASE}/${igAccountId}?fields=username,name,profile_picture_url,followers_count,media_count`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    await throwGraphApiError(response, `Instagram API error: ${response.status}`);
  }

  const data = await response.json();
  return {
    username: data.username,
    name: data.name,
    profilePictureUrl: data.profile_picture_url,
    followersCount: data.followers_count,
    mediaCount: data.media_count,
  };
}

/**
 * List Facebook Pages the user manages.
 * GET /me/accounts?fields=id,name,access_token,instagram_business_account
 */
export async function listUserPages(opts: {
  accessToken: string;
}): Promise<Array<{
  id: string;
  name: string;
  accessToken: string;
  igAccountId: string | null;
}>> {
  const { accessToken } = opts;
  const url = `${IG_API_BASE}/me/accounts?fields=id,name,access_token,instagram_business_account`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    await throwGraphApiError(response, `Instagram API error: ${response.status}`);
  }

  const data = await response.json();
  
  if (!Array.isArray(data.data)) {
    return [];
  }

  return data.data.map((page: any) => ({
    id: page.id,
    name: page.name,
    accessToken: page.access_token,
    igAccountId: page.instagram_business_account?.id ?? null,
  }));
}
