export type Point = { x: number; y: number };
export type Stroke = Point[];
/** Coordinates relative to the visible, rotated page, with a top-left origin. */
export type SignaturePlacement = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type OwnerSignature = {
  version: string;
  userId: string;
  name: string;
  email: string;
  strokes: Stroke[];
  authorizedAt: string;
};
export type SigningSetup = {
  clientName: string;
  clientEmail: string;
  clientPlacement: SignaturePlacement | null;
  ownerPlacement: SignaturePlacement | null;
  ownerStamp: OwnerSignature | null;
};
export type PdfAnnotation = {
  id: string;
  page: number;
  x: number;
  y: number;
  text: string;
  size: number;
};
export type DocumentSnapshot = {
  title: string;
  kind: 'text' | 'pdf';
  content: string;
  fontSize: number;
  annotations: PdfAnnotation[];
  fields: Record<string, string | boolean>;
  layoutVersion?: 2;
  signing?: SigningSetup;
  isTemplate?: boolean;
};
export type DocumentSignature = {
  userId: string | null;
  name: string;
  email: string;
  signedAt: string;
  revision: number;
  contentSha256: string;
  consent: string;
  strokes: Stroke[];
  mode?: 'in_person';
  collectedBy?: string;
};
export type CrmDocument = {
  id: string;
  account_id: string;
  snapshot: DocumentSnapshot;
  source_path: string | null;
  source_sha256: string | null;
  revision: number;
  status: 'draft' | 'signed';
  signature: DocumentSignature | null;
  signed_path: string | null;
  signed_sha256: string | null;
  created_at: string;
  updated_at: string;
};
export type DocumentVersion = {
  revision: number;
  status: 'draft' | 'signed';
  actor_id: string;
  created_at: string;
};
export type PdfFieldInfo = {
  name: string;
  type: 'text' | 'checkbox' | 'choice';
  value: string | boolean;
  options?: string[];
};
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const SIGNING_CONSENT =
  'Li o documento e confirmo minha assinatura eletrônica nesta versão.';
