'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { constrainPlacement } from '@/lib/documents/placement';
import type { SignaturePlacement } from '@/lib/documents/types';

export function SignatureOverlay({
  value,
  label,
  onChange,
}: {
  value: SignaturePlacement;
  label: string;
  onChange: (value: SignaturePlacement) => void;
}) {
  const t = useTranslations('Documents');
  const drag = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    start: SignaturePlacement;
    resize: boolean;
  } | null>(null);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label}. ${t('dragSignature')}`}
      title={t('dragSignature')}
      className="absolute flex touch-none items-center justify-center border-2 border-dashed border-blue-600 bg-blue-100/30 text-center text-[10px] font-medium text-blue-900 outline-offset-2"
      style={{
        left: `${value.x * 100}%`,
        top: `${value.y * 100}%`,
        width: `${value.width * 100}%`,
        height: `${value.height * 100}%`,
        cursor: 'move',
      }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        const box = event.currentTarget.parentElement!.getBoundingClientRect();
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          width: box.width,
          height: box.height,
          start: value,
          resize: (event.target as HTMLElement).dataset.resize === 'true',
        };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const d = drag.current,
          dx = (event.clientX - d.x) / d.width,
          dy = (event.clientY - d.y) / d.height;
        onChange(
          constrainPlacement({
            ...d.start,
            ...(d.resize
              ? { width: d.start.width + dx, height: d.start.height + dy }
              : { x: d.start.x + dx, y: d.start.y + dy }),
          })
        );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const delta = event.shiftKey ? 0.02 : 0.005;
        const direction = {
          ArrowLeft: [-delta, 0],
          ArrowRight: [delta, 0],
          ArrowUp: [0, -delta],
          ArrowDown: [0, delta],
        }[event.key];
        if (!direction) return;
        event.preventDefault();
        onChange(
          constrainPlacement({
            ...value,
            ...(event.altKey
              ? {
                  width: value.width + direction[0],
                  height: value.height + direction[1],
                }
              : { x: value.x + direction[0], y: value.y + direction[1] }),
          })
        );
      }}
    >
      <span className="pointer-events-none rounded bg-white/90 px-1">
        {label}
      </span>
      <span
        data-resize="true"
        title={t('resizeSignature')}
        className="absolute -right-1 -bottom-1 size-4 cursor-se-resize rounded-sm border border-white bg-blue-600"
      />
    </div>
  );
}
