'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FileText, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCan } from '@/hooks/use-can';
import { documentRequest } from '@/components/documents/client';
import { MAX_PDF_BYTES } from '@/lib/documents/types';

type Row = {
  id: string;
  title: string;
  kind: string;
  status: 'draft' | 'signed';
  revision: number;
  updated_at: string;
  is_template: string | null;
};
export default function DocumentsPage() {
  const t = useTranslations('Documents');
  const locale = useLocale();
  const canEdit = useCan('send-messages');
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [category, setCategory] = useState<'documents' | 'templates'>(
    'documents'
  );
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    const timeout = setTimeout(() => {
      void documentRequest(
        `/api/documents?page=${page}&category=${category}&search=${encodeURIComponent(search)}`,
        { signal: abort.signal }
      )
        .then((body) => {
          setRows(body.documents);
          setTotal(body.total);
          setError('');
        })
        .catch((err) => {
          if (!abort.signal.aborted) setError(err.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timeout);
      abort.abort();
    };
  }, [page, search, retry, category]);
  async function create(file?: File) {
    setBusy(true);
    try {
      let init: RequestInit;
      if (file && /\.pdf$/i.test(file.name)) {
        if (file.size > MAX_PDF_BYTES) throw new Error(t('pdfLimit'));
        const form = new FormData();
        form.set('file', file);
        form.set('isTemplate', String(category === 'templates'));
        init = { method: 'POST', body: form };
      } else {
        if (file && (!/\.txt$/i.test(file.name) || file.size > 300000))
          throw new Error(t('textLimit'));
        init = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: file
              ? file.name.replace(/\.txt$/i, '').slice(0, 160)
              : t('untitled'),
            kind: 'text',
            isTemplate: category === 'templates',
            content: file ? await file.text() : '',
            fontSize: 12,
            annotations: [],
            fields: {},
          }),
        };
      }
      const body = await documentRequest('/api/documents', init);
      router.push(`/documents/${body.document.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('error'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('description')}
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <Upload className="size-4" />
              {t('import')}
            </Button>
            <Button disabled={busy} onClick={() => void create()}>
              <Plus className="size-4" />
              {busy
                ? t('loading')
                : t(category === 'templates' ? 'newTemplate' : 'new')}
            </Button>
            <input
              ref={input}
              hidden
              type="file"
              accept=".pdf,.txt,application/pdf,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void create(file);
              }}
            />
          </div>
        )}
      </div>
      <div className="flex gap-2" aria-label={t('documentCategory')}>
        {(['documents', 'templates'] as const).map((item) => (
          <Button
            key={item}
            variant={category === item ? 'default' : 'outline'}
            aria-pressed={category === item}
            onClick={() => {
              setCategory(item);
              setPage(0);
            }}
          >
            {t(item === 'templates' ? 'templates' : 'clientDocuments')}
          </Button>
        ))}
      </div>
      {category === 'templates' && (
        <p className="text-muted-foreground text-sm">{t('templatesHelp')}</p>
      )}
      <Input
        aria-label={t('search')}
        placeholder={t('search')}
        className="max-w-md"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(0);
        }}
      />
      {error ? (
        <div
          role="alert"
          className="border-destructive/30 space-y-3 rounded-xl border p-6"
        >
          <p>{error}</p>
          <Button variant="outline" onClick={() => setRetry(retry + 1)}>
            {t('retry')}
          </Button>
        </div>
      ) : loading ? (
        <p role="status">{t('loading')}</p>
      ) : rows.length ? (
        <div className="bg-card overflow-hidden rounded-xl border">
          {rows.map((row) => (
            <Link
              key={row.id}
              href={`/documents/${row.id}`}
              className="hover:bg-muted/50 flex items-center gap-4 border-b p-5 transition-colors last:border-0"
            >
              <div className="bg-primary/10 text-primary rounded-lg p-3">
                <FileText className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-medium">{row.title}</h2>
                <p className="text-muted-foreground text-xs">
                  {row.kind === 'pdf' ? 'PDF' : t('text')} ·{' '}
                  {t('version', { revision: row.revision })} ·{' '}
                  {new Date(row.updated_at).toLocaleString(locale)}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs ${row.status === 'signed' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}
              >
                {t(row.is_template === 'true' ? 'template' : row.status)}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <FileText className="text-muted-foreground mx-auto mb-3 size-9" />
          <h2 className="font-medium">{t('empty')}</h2>
          <p className="text-muted-foreground mt-2 text-sm">{t('emptyHelp')}</p>
        </div>
      )}
      {!error && (
        <div className="text-muted-foreground flex items-center justify-between text-sm">
          <span>{t('total', { count: total })}</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!page || loading}
              onClick={() => setPage(page - 1)}
            >
              {t('previous')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(page + 1) * 30 >= total || loading}
              onClick={() => setPage(page + 1)}
            >
              {t('next')}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
