/**
 * R15-007 — col testo al 200% il voto «★ 4,5 (128)» della scheda negozio usciva ed era tagliato.
 * Prova leggera sulle classi che lo fanno andare a capo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const leggi = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('R15-007 · il voto nella scheda del negozio può andare a capo', () => {
  it('il contenitore del voto ha flex-wrap, min-w-0 e max-w-full', () => {
    const src = leggi('components', 'StorePreviewCard.tsx');
    const i = src.indexOf('reviews.avg.toFixed');
    const aperto = src.lastIndexOf('<span className="', i);
    const classi = src.slice(aperto, src.indexOf('>', aperto));
    expect(classi).toContain('inline-flex');
    expect(classi).toContain('flex-wrap');
    expect(classi).toContain('min-w-0');
    expect(classi).toContain('max-w-full');
  });
});
