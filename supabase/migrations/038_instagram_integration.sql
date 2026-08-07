-- 038_instagram_integration.sql

-- ==========================================
-- 1. Modify conversations table
-- ==========================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'platform') THEN
        ALTER TABLE public.conversations ADD COLUMN platform TEXT NOT NULL DEFAULT 'whatsapp';
        ALTER TABLE public.conversations ADD CONSTRAINT conversations_platform_check CHECK (platform IN ('whatsapp', 'instagram'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_account_platform ON public.conversations(account_id, platform);

-- ==========================================
-- 2. Modify messages table
-- ==========================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'platform') THEN
        ALTER TABLE public.messages ADD COLUMN platform TEXT NOT NULL DEFAULT 'whatsapp';
        ALTER TABLE public.messages ADD CONSTRAINT messages_platform_check CHECK (platform IN ('whatsapp', 'instagram'));
    END IF;
END $$;

-- ==========================================
-- 3. Create instagram_config table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.instagram_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    ig_account_id TEXT,
    fb_page_id TEXT,
    fb_page_name TEXT,
    ig_username TEXT,
    access_token TEXT,
    token_expires_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
    connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(account_id)
);

ALTER TABLE public.instagram_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view instagram config for their accounts" ON public.instagram_config;
CREATE POLICY "Users can view instagram config for their accounts"
    ON public.instagram_config FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.account_id = instagram_config.account_id AND p.id = auth.uid()));

DROP POLICY IF EXISTS "Users can manage instagram config for their accounts" ON public.instagram_config;
CREATE POLICY "Users can manage instagram config for their accounts"
    ON public.instagram_config FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.account_id = instagram_config.account_id AND p.id = auth.uid()));

-- ==========================================
-- 4. Create instagram_comment_automations table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.instagram_comment_automations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    keywords TEXT[] NOT NULL,
    match_type TEXT NOT NULL DEFAULT 'contains' CHECK (match_type IN ('exact', 'contains')),
    case_sensitive BOOLEAN NOT NULL DEFAULT false,
    reply_message TEXT NOT NULL,
    comment_reply_text TEXT,
    post_ids TEXT[],
    is_active BOOLEAN NOT NULL DEFAULT true,
    execution_count INTEGER NOT NULL DEFAULT 0,
    last_executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.instagram_comment_automations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view instagram comment automations for their accounts" ON public.instagram_comment_automations;
CREATE POLICY "Users can view instagram comment automations for their accounts"
    ON public.instagram_comment_automations FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.account_id = instagram_comment_automations.account_id AND p.id = auth.uid()));

DROP POLICY IF EXISTS "Users can manage instagram comment automations for their accounts" ON public.instagram_comment_automations;
CREATE POLICY "Users can manage instagram comment automations for their accounts"
    ON public.instagram_comment_automations FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.account_id = instagram_comment_automations.account_id AND p.id = auth.uid()));

-- ==========================================
-- 5. Create instagram_posts table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.instagram_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ig_media_id TEXT,
    media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'carousel', 'reel')),
    media_url TEXT NOT NULL,
    caption TEXT,
    permalink TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed')),
    scheduled_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.instagram_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view instagram posts for their accounts" ON public.instagram_posts;
CREATE POLICY "Users can view instagram posts for their accounts"
    ON public.instagram_posts FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.account_id = instagram_posts.account_id AND p.id = auth.uid()));

DROP POLICY IF EXISTS "Users can manage instagram posts for their accounts" ON public.instagram_posts;
CREATE POLICY "Users can manage instagram posts for their accounts"
    ON public.instagram_posts FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.account_id = instagram_posts.account_id AND p.id = auth.uid()));

-- ==========================================
-- Triggers for updated_at
-- ==========================================
-- Create trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS set_instagram_config_updated_at ON public.instagram_config;
CREATE TRIGGER set_instagram_config_updated_at
    BEFORE UPDATE ON public.instagram_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_instagram_comment_automations_updated_at ON public.instagram_comment_automations;
CREATE TRIGGER set_instagram_comment_automations_updated_at
    BEFORE UPDATE ON public.instagram_comment_automations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_instagram_posts_updated_at ON public.instagram_posts;
CREATE TRIGGER set_instagram_posts_updated_at
    BEFORE UPDATE ON public.instagram_posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
