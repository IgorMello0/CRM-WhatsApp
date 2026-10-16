'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import type { SignaturePlacement } from '@/lib/documents/types';
import { SignatureOverlay } from './signature-overlay';

export function PdfPreview({
  url,
  onReviewed,
  onPlace,
  draftBody,
  previewUrl,
  onPageCount,
  onPlaceSignature,
  placements = [],
}: {
  url: string;
  onReviewed: (hash: string) => void;
  onPlace?: (point: { page: number; x: number; y: number }) => void;
  draftBody?: string;
  previewUrl?: string;
  onPageCount?: (count: number) => void;
  onPlaceSignature?: (point: { page: number; x: number; y: number }) => void;
  placements?: {
    key: string;
    label: string;
    value: SignaturePlacement;
    onChange: (value: SignaturePlacement) => void;
  }[];
}) {
  const t = useTranslations('Documents');
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<PageViewport | null>(null);
  const loadedHash = useRef('');
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reviewed = useRef(onReviewed);
  const pageCount = useRef(onPageCount);
  useEffect(() => {
    pageCount.current = onPageCount;
  }, [onPageCount]);
  useEffect(() => {
    reviewed.current = onReviewed;
  }, [onReviewed]);
  useEffect(() => {
    let disposed = false;
    let task: ReturnType<typeof import('pdfjs-dist').getDocument> | undefined;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setPdf(null);
    reviewed.current('');
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            const response = await fetch(
              draftBody && previewUrl ? previewUrl : url,
              {
                cache: 'no-store',
                signal: controller.signal,
                ...(draftBody
                  ? {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: draftBody,
                    }
                  : {}),
              }
            );
            if (!response.ok)
              throw new Error(
                (await response.json()).error || t('previewError')
              );
            const bytes = await response.arrayBuffer();
            const pdfjs = await import('pdfjs-dist');
            if (disposed) return;
            pdfjs.GlobalWorkerOptions.workerSrc = new URL(
              'pdfjs-dist/build/pdf.worker.min.mjs',
              import.meta.url
            ).toString();
            task = pdfjs.getDocument({ data: bytes });
            const document = await task.promise;
            if (disposed) return;
            setPdf(document);
            setPageNumber((current) => Math.min(current, document.numPages));
            pageCount.current?.(document.numPages);
            loadedHash.current =
              response.headers.get('X-Document-Content-Hash') ?? '';
          } catch (err) {
            if (!disposed) {
              setError(err instanceof Error ? err.message : t('previewError'));
              setLoading(false);
            }
          }
        })();
      },
      draftBody ? 450 : 0
    );
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      void task?.destroy();
    };
  }, [url, t, draftBody, previewUrl]);
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let task:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>
      | undefined;
    setLoading(true);
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled || !canvas.current) return;
        const view = page.getViewport({ scale: 1.3 });
        viewport.current = view;
        const target = canvas.current;
        target.width = view.width;
        target.height = view.height;
        task = page.render({ canvas: target, viewport: view });
        await task.promise;
        if (!cancelled) {
          setLoading(false);
          reviewed.current(loadedHash.current);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('previewError'));
          setLoading(false);
          reviewed.current('');
        }
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, t]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <Button
          variant="outline"
          size="sm"
          disabled={!pdf || pageNumber === 1 || loading}
          onClick={() => setPageNumber(pageNumber - 1)}
        >
          {t('previous')}
        </Button>
        <span>
          {pdf
            ? t('pageOf', { page: pageNumber, total: pdf.numPages })
            : t('preview')}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!pdf || pageNumber === pdf.numPages || loading}
          onClick={() => setPageNumber(pageNumber + 1)}
        >
          {t('next')}
        </Button>
      </div>
      {onPlace && (
        <p className="text-muted-foreground text-xs">{t('placeHelp')}</p>
      )}
      {loading && (
        <p role="status" className="text-muted-foreground text-sm">
          {t('loading')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="relative">
        <canvas
          ref={canvas}
          aria-label={t('preview')}
          className={`block h-auto w-full rounded border bg-white shadow-sm ${onPlace || onPlaceSignature ? 'cursor-crosshair' : ''} ${error ? 'hidden' : ''} ${loading ? 'opacity-50' : ''}`}
          onClick={(event) => {
            if (loading || !viewport.current || !pdf) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (onPlaceSignature) {
              onPlaceSignature({
                page: pageNumber,
                x: (event.clientX - bounds.left) / bounds.width,
                y: (event.clientY - bounds.top) / bounds.height,
              });
              return;
            }
            if (!onPlace) return;
            const view = viewport.current;
            const [x, y] = view.convertToPdfPoint(
              ((event.clientX - bounds.left) / bounds.width) * view.width,
              ((event.clientY - bounds.top) / bounds.height) * view.height
            );
            const box = view.viewBox;
            onPlace({
              page: pageNumber,
              x: Math.min(0.95, Math.max(0, (x - box[0]) / (box[2] - box[0]))),
              y: Math.min(
                0.95,
                Math.max(0, 1 - (y - box[1]) / (box[3] - box[1]))
              ),
            });
          }}
        />
        {!error &&
          viewport.current &&
          placements
            .filter((item) => item.value.page === pageNumber)
            .map((item) => (
              <SignatureOverlay
                key={item.key}
                value={item.value}
                label={item.label}
                onChange={item.onChange}
              />
            ))}
      </div>
    </div>
  );
}
