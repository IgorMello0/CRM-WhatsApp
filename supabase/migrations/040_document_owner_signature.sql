BEGIN;
CREATE TABLE public.account_document_signatures (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  version UUID NOT NULL DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  strokes JSONB NOT NULL CHECK (jsonb_typeof(strokes) = 'array'),
  enabled BOOLEAN NOT NULL DEFAULT false,
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.account_document_signatures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_document_signatures FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.account_document_signatures TO service_role;

-- Serialize finalization against revocation/replacement of the owner's default.
-- Old signed PDFs are unaffected by changes to the reusable signature.
CREATE FUNCTION public.check_document_owner_signature() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE stamp JSONB; current_signature public.account_document_signatures;
BEGIN
  IF NEW.status <> 'signed' OR OLD.status = 'signed' THEN RETURN NEW; END IF;
  stamp := NEW.snapshot->'signing'->'ownerStamp';
  IF stamp IS NULL OR stamp = 'null'::jsonb THEN RETURN NEW; END IF;
  SELECT s.* INTO current_signature FROM public.account_document_signatures s
    JOIN public.accounts a ON a.id = s.account_id AND a.owner_user_id = s.owner_user_id
    WHERE s.account_id = NEW.account_id FOR SHARE OF s, a;
  IF NOT FOUND OR NOT current_signature.enabled
      OR current_signature.version::text IS DISTINCT FROM stamp->>'version'
      OR current_signature.owner_user_id::text IS DISTINCT FROM stamp->>'userId'
      OR current_signature.strokes IS DISTINCT FROM stamp->'strokes'
      OR current_signature.name IS DISTINCT FROM stamp->>'name'
      OR current_signature.email IS DISTINCT FROM stamp->>'email' THEN
    RAISE EXCEPTION 'Owner signature authorization changed' USING ERRCODE = 'P0409';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER documents_owner_signature_guard BEFORE UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.check_document_owner_signature();
COMMIT;
