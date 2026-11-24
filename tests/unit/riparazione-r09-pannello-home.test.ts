import { describe, it, expect } from 'vitest';
import { HOME_SECTION_CATALOG } from '@/lib/home-site';

describe('R09-005 · il pannello della home non promette «i più amati»', () => {
  it('la voce popularProducts non parla di amati, popolari o successo', () => {
    const v = HOME_SECTION_CATALOG.find((s) => s.type === 'popularProducts')!;
    const testo = `${v.label} ${v.description}`;
    expect(testo).not.toMatch(/amati|popolari|vanno forte/i);
    expect(v.label).toBe('Appena arrivati');
  });
});
