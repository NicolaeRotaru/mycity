import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * S10 (5/11/2026, scheda 844) — `tracking-wide` e `tracking-label` sono la
 * stessa misura del design (0.04em): il nome non inganna più.
 * (Il file di Tailwind usa require() per i plugin: si legge come testo.)
 */
describe('tracking-wide è il token delle maiuscole (844)', () => {
  it('letterSpacing ha wide e label a 0.04em', () => {
    const src = readFileSync('tailwind.config.ts', 'utf8');
    const blocco = src.match(/letterSpacing:\s*\{([\s\S]*?)\n\s*\},/)?.[1] ?? '';
    expect(blocco).toMatch(/label: '0\.04em'/);
    expect(blocco).toMatch(/wide: '0\.04em'/);
  });
});

describe('il grigio delle note si legge sul fondo panna (862)', () => {
  const lum = (h: string) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrasto = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  it('ink-400 su cream-100 ≥ 4,5:1, uguale in Tailwind e nei token', () => {
    const tw = readFileSync('tailwind.config.ts', 'utf8');
    const css = readFileSync('app/globals.css', 'utf8');
    const inkTw = tw.match(/ink:\s*\{[\s\S]*?400: '(#[0-9A-Fa-f]{6})'/)?.[1] ?? '';
    const inkCss = css.match(/--ink-400:(#[0-9A-Fa-f]{6});/)?.[1] ?? '';
    const panna = css.match(/--cream-100:(#[0-9A-Fa-f]{6});/)?.[1] ?? '#FBF7F0';
    expect(inkTw.toUpperCase()).toBe(inkCss.toUpperCase());
    expect(contrasto(inkTw, panna)).toBeGreaterThanOrEqual(4.5);
  });
});
