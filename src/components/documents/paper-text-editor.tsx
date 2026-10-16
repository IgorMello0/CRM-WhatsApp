'use client';

import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-700.css';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PAPER, textLines } from '@/lib/documents/layout';
import type { DocumentSnapshot } from '@/lib/documents/types';

export function PaperTextEditor({
  value,
  disabled,
  onChange,
}: {
  value: DocumentSnapshot;
  disabled: boolean;
  onChange: (content: string) => void;
}) {
  const t = useTranslations('Documents');
  const host = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [titleLines, setTitleLines] = useState<string[]>([value.title]);
  const [bodyLines, setBodyLines] = useState(1);
  useEffect(() => {
    const target = host.current;
    if (!target) return;
    const observer = new ResizeObserver((entries) =>
      setScale(entries[0].contentRect.width / PAPER.width)
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      document.fonts.load('400 12px Roboto'),
      document.fonts.load('700 20px Roboto'),
    ]).then(() => {
      if (cancelled) return;
      const context = document.createElement('canvas').getContext('2d')!;
      context.fontKerning = 'none';
      context.font = '700 20px Roboto';
      setTitleLines(
        textLines(
          value.title,
          (text) => context.measureText(text).width,
          PAPER.contentWidth
        )
      );
      context.font = `400 ${value.fontSize}px Roboto`;
      setBodyLines(
        textLines(
          value.content,
          (text) => context.measureText(text).width,
          PAPER.contentWidth
        ).length
      );
    });
    return () => {
      cancelled = true;
    };
  }, [value.title, value.content, value.fontSize]);
  const bodyBaseline =
    PAPER.height -
    PAPER.firstBaseline +
    titleLines.length * PAPER.titleLineHeight +
    20;
  // Roboto's hhea ascent/descent match the embedded PDF font; remove browser
  // defaults (padding, proportional container width, kerning and line spacing).
  const baselineOffset = (size: number, lineHeight: number) =>
    lineHeight / 2 + (size * (1900 - 500)) / 4096;
  const bodyTop =
    bodyBaseline -
    baselineOffset(value.fontSize, value.fontSize * PAPER.lineSpacing);
  const bodyHeight = Math.max(
    650,
    (bodyLines + 2) * value.fontSize * PAPER.lineSpacing
  );
  const height = Math.max(PAPER.height, bodyTop + bodyHeight + PAPER.margin);
  return (
    <div
      ref={host}
      className="w-full overflow-hidden rounded border bg-white shadow-sm"
      style={{ height: height * scale }}
    >
      <div
        style={{
          position: 'relative',
          width: PAPER.width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          fontFamily: 'Roboto, sans-serif',
          fontKerning: 'none',
          fontVariantLigatures: 'none',
          color: '#1f2633',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: PAPER.margin,
            top: PAPER.height - PAPER.firstBaseline - baselineOffset(20, 26),
            fontSize: 20,
            lineHeight: '26px',
            fontWeight: 700,
            whiteSpace: 'pre',
            color: '#000',
          }}
        >
          {titleLines.join('\n')}
        </div>
        <textarea
          aria-label={t('content')}
          value={value.content}
          readOnly={disabled}
          maxLength={100000}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t('contentPlaceholder')}
          style={{
            position: 'absolute',
            left: PAPER.margin,
            top: bodyTop,
            width: PAPER.contentWidth,
            height: bodyHeight,
            fontFamily: 'inherit',
            fontKerning: 'none',
            fontVariantLigatures: 'none',
            fontSize: value.fontSize,
            lineHeight: `${value.fontSize * PAPER.lineSpacing}px`,
            padding: 0,
            border: 0,
            outline: 0,
            resize: 'none',
            background: 'transparent',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
            tabSize: 4,
            fontWeight: 400,
          }}
        />
      </div>
    </div>
  );
}
