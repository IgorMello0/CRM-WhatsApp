'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { Stroke } from '@/lib/documents/types';

export function SignaturePad({
  value,
  onChange,
}: {
  value: Stroke[];
  onChange: (strokes: Stroke[]) => void;
}) {
  const t = useTranslations('Documents');
  const drawing = useRef<number | null>(null);
  const strokes = useRef(value);
  useEffect(() => {
    strokes.current = value;
  }, [value]);
  const commit = (next: Stroke[]) => {
    strokes.current = next;
    onChange(next);
  };
  return (
    <div className="space-y-2">
      <svg
        viewBox="0 0 600 180"
        role="img"
        aria-label={t('drawSignature')}
        className="w-full touch-none rounded-lg border border-dashed bg-white text-slate-900"
        onPointerDown={(event) => {
          if (drawing.current !== null || strokes.current.length >= 100) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = event.pointerId;
          const box = event.currentTarget.getBoundingClientRect();
          commit([
            ...strokes.current,
            [
              {
                x: Math.max(
                  0,
                  Math.min(1, (event.clientX - box.left) / box.width)
                ),
                y: Math.max(
                  0,
                  Math.min(1, (event.clientY - box.top) / box.height)
                ),
              },
            ],
          ]);
        }}
        onPointerMove={(event) => {
          if (
            drawing.current !== event.pointerId ||
            strokes.current.flat().length >= 10000
          )
            return;
          const box = event.currentTarget.getBoundingClientRect();
          const point = {
            x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
            y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
          };
          const next = [...strokes.current];
          next[next.length - 1] = [...next[next.length - 1], point];
          commit(next);
        }}
        onPointerUp={() => {
          drawing.current = null;
          commit(strokes.current.filter((stroke) => stroke.length > 1));
        }}
        onPointerCancel={() => {
          drawing.current = null;
          commit(strokes.current.filter((stroke) => stroke.length > 1));
        }}
      >
        <line x1="25" y1="150" x2="575" y2="150" stroke="#cbd5e1" />
        {value.map((stroke, i) => (
          <polyline
            key={i}
            points={stroke
              .map((point) => `${point.x * 600},${point.y * 180}`)
              .join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          drawing.current = null;
          commit([]);
        }}
      >
        {t('clearSignature')}
      </Button>
    </div>
  );
}
