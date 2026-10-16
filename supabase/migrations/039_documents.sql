-- Private, account-scoped documents. All writes pass through authenticated
-- server routes; browser clients can only read their own account's records.
BEGIN;

CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  source_path TEXT,
  source_sha256 TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed')),
  signature JSONB,
  signed_path TEXT,
  signed_sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'draft' AND signature IS NULL AND signed_path IS NULL AND signed_sha256 IS NULL)
      OR (status = 'signed' AND signature IS NOT NULL AND signed_path IS NOT NULL AND signed_sha256 IS NOT NULL)),
  CHECK ((snapshot->>'kind' = 'text' AND source_path IS NULL AND source_sha256 IS NULL)
      OR (snapshot->>'kind' = 'pdf' AND source_path IS NOT NULL AND source_sha256 IS NOT NULL))
);
CREATE INDEX documents_account_updated ON public.documents(account_id, updated_at DESC);

CREATE TABLE public.document_versions (
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  snapshot JSONB NOT NULL,
  status TEXT NOT NULL,
  signature JSONB,
  actor_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, revision)
);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_read ON public.documents FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY document_versions_read ON public.document_versions FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
REVOKE ALL ON public.documents, public.document_versions FROM anon, authenticated;
GRANT SELECT ON public.documents, public.document_versions TO authenticated;
GRANT ALL ON public.documents, public.document_versions TO service_role;

CREATE FUNCTION public.guard_document_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'signed' THEN RAISE EXCEPTION 'Signed documents are immutable'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.source_path IS DISTINCT FROM OLD.source_path OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
     OR NEW.snapshot->>'kind' IS DISTINCT FROM OLD.snapshot->>'kind' THEN
    RAISE EXCEPTION 'Document identity and source are immutable';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'Invalid revision'; END IF;
  IF NEW.status = 'signed' AND NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
    RAISE EXCEPTION 'Save and review changes before signing';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER documents_guard BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_document_update();

CREATE FUNCTION public.record_document_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.document_versions(document_id, revision, account_id, snapshot, status, signature, actor_id)
  VALUES(NEW.id, NEW.revision, NEW.account_id, NEW.snapshot, NEW.status, NEW.signature, NEW.updated_by);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_document_version() FROM PUBLIC;
CREATE TRIGGER documents_history AFTER INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.record_document_version();

-- No public URLs or browser write policies: downloads are authenticated API
-- responses. Each uploaded original and signed result gets a unique path.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documents', 'documents', false, 15728640, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

COMMIT;
