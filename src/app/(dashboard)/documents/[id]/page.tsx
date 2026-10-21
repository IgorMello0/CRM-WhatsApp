'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, Download, PenLine, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useCan } from '@/hooks/use-can';
import {
  documentRequest,
  downloadDocument,
} from '@/components/documents/client';
import { PdfPreview } from '@/components/documents/pdf-preview';
import { SignaturePad } from '@/components/documents/signature-pad';
import { PaperTextEditor } from '@/components/documents/paper-text-editor';
import {
  SigningControls,
  emptySigning,
} from '@/components/documents/signing-controls';
import { constrainPlacement } from '@/lib/documents/placement';
import {
  formatPdfFieldValue,
  formatStoredPdfFields,
  pdfFieldFormat,
  pdfFieldInputProps,
} from '@/lib/documents/field-format';
import { ReuseDocumentDialog } from '@/components/documents/reuse-document-dialog';
import { assertReadyDocument } from '@/lib/documents/templates';
import {
  SIGNING_CONSENT,
  type CrmDocument,
  type DocumentSnapshot,
  type DocumentVersion,
  type PdfFieldInfo,
  type Stroke,
} from '@/lib/documents/types';

export default function DocumentEditor({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations('Documents');
  const locale = useLocale();
  const canEdit = useCan('send-messages');
  const [placing, setPlacing] = useState<'client' | 'owner' | null>(null);
  const [doc, setDoc] = useState<CrmDocument | null>(null);
  const [draft, setDraft] = useState<DocumentSnapshot | null>(null);
  const [fields, setFields] = useState<PdfFieldInfo[]>([]);
  const [pageCount, setPageCount] = useState(1);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [hash, setHash] = useState('');
  const [retry, setRetry] = useState(0);
  const [step, setStep] = useState<'edit' | 'prepare' | 'review'>('edit');
  const [reuse, setReuse] = useState<'template' | 'instantiate' | null>(null);
  const dirty =
    !!doc && !!draft && JSON.stringify(doc.snapshot) !== JSON.stringify(draft);
  const editable = canEdit && doc?.status === 'draft' && !busy;
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void documentRequest(`/api/documents/${id}`, { signal: controller.signal })
      .then((body) => {
        setDoc(body.document);
        setStep('edit');
        setPlacing(null);
        setSignOpen(false);
        const snapshot = body.document.snapshot;
        setDraft(
          body.document.status === 'draft' && snapshot.kind === 'text'
            ? { ...snapshot, layoutVersion: 2 }
            : body.document.status === 'draft' && snapshot.kind === 'pdf'
              ? {
                  ...snapshot,
                  fields: formatStoredPdfFields(snapshot.fields),
                }
              : snapshot
        );
        setFields(body.pdf?.fields ?? []);
        setPageCount(body.pdf?.pages ?? 1);
        setVersions(body.versions);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [id, retry]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const guardLinks = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest?.('a[href]');
      if (link && !window.confirm(t('discard'))) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', guard);
    document.addEventListener('click', guardLinks, true);
    return () => {
      window.removeEventListener('beforeunload', guard);
      document.removeEventListener('click', guardLinks, true);
    };
  }, [dirty, t]);
  function failure(err: unknown) {
    toast.error(err instanceof Error ? err.message : t('error'));
  }
  async function save() {
    if (!doc || !draft) return;
    setBusy(true);
    try {
      const body = await documentRequest(`/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: doc.revision, snapshot: draft }),
      });
      setDoc(body.document);
      setDraft(body.document.snapshot);
      setHash('');
      setVersions((previous) => [
        {
          revision: body.document.revision,
          status: 'draft',
          actor_id: '',
          created_at: body.document.updated_at,
        },
        ...previous,
      ]);
      toast.success(t('saved'));
      return true;
    } catch (err) {
      failure(err);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function advance(next: 'prepare' | 'review') {
    if (!draft) return;
    try {
      assertReadyDocument(draft);
    } catch (err) {
      failure(err);
      return;
    }
    if (
      next === 'review' &&
      (!draft.signing?.clientName.trim() || !draft.signing.clientPlacement)
    ) {
      toast.error(t('prepareRequired'));
      return;
    }
    if (dirty && !(await save())) return;
    setHash('');
    setPlacing(null);
    setStep(next);
  }
  async function sign() {
    if (!doc || dirty || !hash || !consent || step !== 'review') return;
    setBusy(true);
    try {
      const body = await documentRequest(`/api/documents/${id}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: doc.revision,
          contentHash: hash,
          consent: SIGNING_CONSENT,
          strokes,
        }),
      });
      setDoc(body.document);
      setDraft(body.document.snapshot);
      setHash('');
      setSignOpen(false);
      setVersions((previous) => [
        {
          revision: body.document.revision,
          status: 'signed',
          actor_id:
            body.document.signature.collectedBy ??
            body.document.signature.userId,
          created_at: body.document.updated_at,
        },
        ...previous,
      ]);
      toast.success(t('signedSuccess'));
    } catch (err) {
      failure(err);
    } finally {
      setBusy(false);
    }
  }
  async function download(version: number) {
    setBusy(true);
    try {
      await downloadDocument(id, version);
    } catch (err) {
      failure(err);
    } finally {
      setBusy(false);
    }
  }
  if (error)
    return (
      <div role="alert" className="space-y-4 p-8">
        <p>{error}</p>
        <Button onClick={() => setRetry(retry + 1)}>{t('retry')}</Button>
        <Link href="/documents" className="ml-4 underline">
          {t('back')}
        </Link>
      </div>
    );
  if (!doc || !draft)
    return (
      <p role="status" className="p-8">
        {t('loading')}
      </p>
    );
  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/documents"
            aria-label={t('back')}
            className="rounded-md border p-2"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">
              {doc.snapshot.title}
            </h1>
            <p className="text-muted-foreground text-xs">
              {t(draft.isTemplate ? 'template' : doc.status)} ·{' '}
              {t('version', { revision: doc.revision })}
              {dirty ? ` · ${t('unsaved')}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && step === 'edit' && (
            <Button
              variant="outline"
              disabled={busy || dirty}
              onClick={() =>
                setReuse(draft.isTemplate ? 'instantiate' : 'template')
              }
            >
              {t(draft.isTemplate ? 'useTemplate' : 'saveAsTemplate')}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy || dirty}
            onClick={() => void download(doc.revision)}
          >
            <Download className="size-4" />
            {t('download')}
          </Button>
          {canEdit && doc.status === 'draft' && (
            <>
              {step !== 'edit' && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setStep('edit');
                    setPlacing(null);
                    setHash('');
                  }}
                >
                  {t('backToEditing')}
                </Button>
              )}
              {step !== 'review' && (
                <>
                  <Button
                    variant="outline"
                    disabled={!editable || !dirty}
                    onClick={() => void save()}
                  >
                    <Save className="size-4" />
                    {busy ? t('loading') : t('save')}
                  </Button>
                  {!draft.isTemplate && (
                    <Button
                      disabled={!editable}
                      onClick={() =>
                        void advance(step === 'edit' ? 'prepare' : 'review')
                      }
                    >
                      {t(step === 'edit' ? 'documentReady' : 'presentDocument')}
                    </Button>
                  )}
                </>
              )}
              {step === 'review' && (
                <>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setStep('prepare');
                      setHash('');
                    }}
                  >
                    {t('adjustSignatures')}
                  </Button>
                  <Button
                    disabled={
                      !editable ||
                      dirty ||
                      !hash ||
                      !draft.signing?.clientName.trim() ||
                      !draft.signing?.clientPlacement ||
                      (draft.kind === 'text' && !draft.content.trim())
                    }
                    onClick={() => {
                      setConsent(false);
                      setStrokes([]);
                      setSignOpen(true);
                    }}
                  >
                    <PenLine className="size-4" />
                    {t('requestSignature')}
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>
      {doc.status === 'draft' && !draft.isTemplate && (
        <div className="bg-muted/30 space-y-2 rounded-xl border p-4">
          <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {(['edit', 'prepare', 'review'] as const).map((item, index) => (
              <li
                key={item}
                aria-current={step === item ? 'step' : undefined}
                className={
                  step === item
                    ? 'text-primary font-semibold'
                    : 'text-muted-foreground'
                }
              >
                {index + 1}. {t(`step_${item}`)}
              </li>
            ))}
          </ol>
          <p className="text-muted-foreground text-sm">{t(`help_${step}`)}</p>
        </div>
      )}
      {draft.isTemplate && (
        <div className="bg-primary/5 space-y-2 rounded-xl border p-4 text-sm">
          <p>{t('templateEditingHelp')}</p>
          <p className="font-mono">
            {
              '{{nome_cliente}} · {{email_cliente}} · {{cpf}} · {{endereco}} · {{valor}}'
            }
          </p>
        </div>
      )}
      {doc.signature && (
        <div className="space-y-1 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-sm">
          <p className="font-medium">
            {t('signedBy', {
              name: doc.signature.name,
              date: new Date(doc.signature.signedAt).toLocaleString(locale),
            })}
          </p>
          <p>{t('locked')}</p>
          <p className="text-muted-foreground text-xs break-all">
            SHA-256 (PDF): {doc.signed_sha256}
          </p>
        </div>
      )}
      <div
        className={`grid items-start gap-5 ${step === 'review' || doc.status === 'signed' ? 'mx-auto max-w-4xl' : 'xl:grid-cols-2'}`}
      >
        {step !== 'review' && doc.status !== 'signed' && (
          <section className="bg-card min-w-0 space-y-5 rounded-xl border p-4">
            {step === 'edit' && (
              <>
                <label className="block space-y-2 text-sm font-medium">
                  {t('documentTitle')}
                  <Input
                    value={draft.title}
                    maxLength={160}
                    disabled={!editable}
                    onChange={(event) =>
                      setDraft({ ...draft, title: event.target.value })
                    }
                  />
                </label>
                {draft.kind === 'text' ? (
                  <>
                    <label className="block space-y-2 text-sm font-medium">
                      {t('fontSize')}
                      <Input
                        className="w-24"
                        type="number"
                        min={9}
                        max={24}
                        value={draft.fontSize}
                        disabled={!editable}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            fontSize: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <PaperTextEditor
                      value={draft}
                      disabled={!editable}
                      onChange={(content) =>
                        setDraft({ ...draft, content, layoutVersion: 2 })
                      }
                    />
                    <p className="text-muted-foreground text-xs">
                      {t('textHelp')}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-muted-foreground text-sm">
                      {t('pdfHelp')}
                    </p>
                    {fields.length > 0 && (
                      <div className="space-y-3">
                        <h2 className="font-medium">{t('formFields')}</h2>
                        {fields.map((field) => (
                          <label
                            key={field.name}
                            className="block space-y-1 text-sm"
                          >
                            <span>{field.name}</span>
                            {field.type === 'checkbox' ? (
                              <input
                                type="checkbox"
                                className="ml-3 size-4"
                                disabled={!editable}
                                checked={Boolean(
                                  draft.fields[field.name] ?? field.value
                                )}
                                onChange={(event) =>
                                  setDraft({
                                    ...draft,
                                    fields: {
                                      ...draft.fields,
                                      [field.name]: event.target.checked,
                                    },
                                  })
                                }
                              />
                            ) : field.type === 'choice' ? (
                              <select
                                className="bg-background block w-full rounded-md border p-2"
                                disabled={!editable}
                                value={String(
                                  draft.fields[field.name] ?? field.value
                                )}
                                onChange={(event) =>
                                  setDraft({
                                    ...draft,
                                    fields: {
                                      ...draft.fields,
                                      [field.name]: event.target.value,
                                    },
                                  })
                                }
                              >
                                <option value="">—</option>
                                {field.options?.map((option) => (
                                  <option key={option}>{option}</option>
                                ))}
                              </select>
                            ) : (
                              <Input
                                disabled={!editable}
                                {...pdfFieldInputProps(field.name)}
                                value={String(
                                  draft.fields[field.name] ?? field.value
                                )}
                                onChange={(event) =>
                                  setDraft({
                                    ...draft,
                                    fields: {
                                      ...draft.fields,
                                      [field.name]: formatPdfFieldValue(
                                        field.name,
                                        event.target.value
                                      ),
                                    },
                                  })
                                }
                                onBlur={(event) => {
                                  if (
                                    pdfFieldFormat(field.name) !== 'currency'
                                  ) {
                                    return;
                                  }
                                  const value = formatPdfFieldValue(
                                    field.name,
                                    event.target.value,
                                    true
                                  );
                                  setDraft((current) =>
                                    current?.kind === 'pdf'
                                      ? {
                                          ...current,
                                          fields: {
                                            ...current.fields,
                                            [field.name]: value,
                                          },
                                        }
                                      : current
                                  );
                                }}
                              />
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="font-medium">{t('addedTexts')}</h2>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!editable || draft.annotations.length >= 100}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            annotations: [
                              ...draft.annotations,
                              {
                                id: crypto.randomUUID(),
                                page: 1,
                                x: 0.1,
                                y: 0.1,
                                text: t('newText'),
                                size: 12,
                              },
                            ],
                          })
                        }
                      >
                        {t('addText')}
                      </Button>
                    </div>
                    {draft.annotations.map((annotation) => (
                      <div
                        key={annotation.id}
                        className="space-y-3 rounded-lg border p-3"
                      >
                        <label className="block space-y-1 text-sm">
                          {t('text')}
                          <textarea
                            className="bg-background w-full rounded-md border p-2"
                            disabled={!editable}
                            value={annotation.text}
                            maxLength={2000}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                annotations: draft.annotations.map((item) =>
                                  item.id === annotation.id
                                    ? { ...item, text: event.target.value }
                                    : item
                                ),
                              })
                            }
                          />
                        </label>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {(['page', 'x', 'y', 'size'] as const).map((key) => (
                            <label key={key} className="space-y-1 text-xs">
                              {t(key)}
                              <Input
                                type="number"
                                disabled={!editable}
                                min={
                                  key === 'page' ? 1 : key === 'size' ? 8 : 0
                                }
                                max={
                                  key === 'page'
                                    ? pageCount
                                    : key === 'size'
                                      ? 36
                                      : 95
                                }
                                value={
                                  key === 'x' || key === 'y'
                                    ? Math.round(annotation[key] * 100)
                                    : annotation[key]
                                }
                                onChange={(event) =>
                                  setDraft({
                                    ...draft,
                                    annotations: draft.annotations.map(
                                      (item) =>
                                        item.id === annotation.id
                                          ? {
                                              ...item,
                                              [key]:
                                                Number(event.target.value) /
                                                (key === 'x' || key === 'y'
                                                  ? 100
                                                  : 1),
                                            }
                                          : item
                                    ),
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!editable}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              annotations: draft.annotations.filter(
                                (item) => item.id !== annotation.id
                              ),
                            })
                          }
                        >
                          <Trash2 className="size-3" />
                          {t('remove')}
                        </Button>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
            {step === 'prepare' && !draft.isTemplate && (
              <SigningControls
                value={draft.signing ?? emptySigning}
                disabled={!editable}
                placing={placing}
                onPlace={setPlacing}
                onChange={(signing) => setDraft({ ...draft, signing })}
              />
            )}
            {dirty && (
              <p
                role="status"
                className="rounded-md bg-amber-500/10 p-3 text-sm"
              >
                {t('saveBeforeSign')}
              </p>
            )}
          </section>
        )}
        <section className="bg-muted/30 min-w-0 space-y-4 rounded-xl border p-4">
          <h2 className="font-medium">
            {dirty
              ? t('livePreview')
              : t('savedPreview', { revision: doc.revision })}
          </h2>
          <PdfPreview
            key={step}
            url={`/api/documents/${id}/file?revision=${doc.revision}&preview=1`}
            onReviewed={setHash}
            onPageCount={setPageCount}
            previewUrl={`/api/documents/${id}/preview`}
            draftBody={
              dirty
                ? JSON.stringify({ revision: doc.revision, snapshot: draft })
                : undefined
            }
            onPlaceSignature={
              editable && step === 'prepare' && placing
                ? (point) => {
                    const signing = draft.signing ?? emptySigning;
                    const previous = signing[`${placing}Placement`];
                    setDraft({
                      ...draft,
                      signing: {
                        ...signing,
                        [`${placing}Placement`]: constrainPlacement({
                          ...point,
                          width: previous?.width ?? 0.28,
                          height: previous?.height ?? 0.07,
                        }),
                      },
                    });
                    setPlacing(null);
                  }
                : undefined
            }
            placements={
              editable && step === 'prepare'
                ? (['client', 'owner'] as const).flatMap((role) => {
                    const placement = draft.signing?.[`${role}Placement`];
                    return placement
                      ? [
                          {
                            key: role,
                            label: t(
                              role === 'client'
                                ? 'clientSignature'
                                : 'ownerSignature'
                            ),
                            value: placement,
                            onChange: (value: typeof placement) =>
                              setDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      signing: {
                                        ...(current.signing ?? emptySigning),
                                        [`${role}Placement`]: value,
                                      },
                                    }
                                  : current
                              ),
                          },
                        ]
                      : [];
                  })
                : []
            }
            onPlace={
              editable && step === 'edit' && !placing && draft.kind === 'pdf'
                ? (point) => {
                    if (draft.annotations.length >= 100) return;
                    setDraft({
                      ...draft,
                      annotations: [
                        ...draft.annotations,
                        {
                          ...point,
                          id: crypto.randomUUID(),
                          text: t('newText'),
                          size: 12,
                        },
                      ],
                    });
                  }
                : undefined
            }
          />
        </section>
      </div>
      {step !== 'review' && (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer font-medium">
            {t('history')}
          </summary>
          <div className="mt-4 space-y-2">
            {versions.map((version) => (
              <div
                key={version.revision}
                className="bg-muted/40 flex items-center justify-between gap-3 rounded-lg p-3 text-sm"
              >
                <span>
                  {t('version', { revision: version.revision })} ·{' '}
                  {t(version.status)} ·{' '}
                  {new Date(version.created_at).toLocaleString(locale)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void download(version.revision)}
                >
                  {t('download')}
                </Button>
              </div>
            ))}
          </div>
        </details>
      )}
      {step === 'review' && doc.status === 'draft' && (
        <div className="mx-auto flex max-w-4xl justify-end">
          <Button
            disabled={!editable || dirty || !hash}
            onClick={() => {
              setConsent(false);
              setStrokes([]);
              setSignOpen(true);
            }}
          >
            <PenLine className="size-4" />
            {t('requestSignature')}
          </Button>
        </div>
      )}
      {reuse && (
        <ReuseDocumentDialog
          document={doc}
          action={reuse}
          onClose={() => setReuse(null)}
        />
      )}
      <Dialog
        open={signOpen}
        onOpenChange={(open) => {
          if (!busy) setSignOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('sign')}</DialogTitle>
            <DialogDescription>{t('signDescription')}</DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            {draft.signing?.clientName}{' '}
            {draft.signing?.clientEmail ? `· ${draft.signing.clientEmail}` : ''}
          </p>
          <p className="text-sm font-medium">
            {doc.snapshot.title} · {t('version', { revision: doc.revision })}
          </p>
          <p className="text-sm">{t('drawSignature')}</p>
          <SignaturePad value={strokes} onChange={setStrokes} />
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0"
              checked={consent}
              disabled={busy}
              onChange={(event) => setConsent(event.target.checked)}
            />
            {t('consent')}
          </label>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setSignOpen(false)}
            >
              {t('cancel')}
            </Button>
            <Button
              disabled={busy || !consent || !strokes.length || dirty || !hash}
              onClick={() => void sign()}
            >
              {busy ? t('loading') : t('confirmSign')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
