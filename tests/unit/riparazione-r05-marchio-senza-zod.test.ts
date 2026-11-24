import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brandingSchema, normalizeBranding, defaultBranding } from '@/lib/site-branding';

vi.spyOn(console, 'error').mockImplementation(() => {});

const ok = (v: unknown) => brandingSchema.safeParse(v);

describe('lib/site-branding: la validazione del marchio resta la stessa, senza zod', () => {
  it('il file non importa più zod (il pacchetto comune resta leggero)', () => {
    const src = readFileSync(join(process.cwd(), 'lib', 'site-branding.ts'), 'utf8');
    expect(src).not.toMatch(/from\s+['"]zod['"]/);
    expect(src).not.toMatch(/require\(\s*['"]zod['"]\s*\)/);
  });

  it('accetta e riempie i vuoti coi default', () => {
    const r = ok(undefined);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({
        announcement: { items: [], promoLinkEnabled: true },
        wordmark: { accent: 'My', rest: 'City' },
        footerTagline: '',
      });
    }
    const r2 = ok({});
    expect(r2.success && r2.data.wordmark.rest).toBe('City');
  });

  it('pota gli spazi, scarta i campi sconosciuti', () => {
    const r = ok({
      announcement: { items: [{ icon: 'zap', text: '  ciao  ', extra: 1 }], promoLinkEnabled: false, boh: 2 },
      wordmark: { accent: ' A ', rest: ' B ' },
      footerTagline: '  frase  ',
      altro: true,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({
        announcement: { items: [{ icon: 'zap', text: 'ciao' }], promoLinkEnabled: false },
        wordmark: { accent: 'A', rest: 'B' },
        footerTagline: 'frase',
      });
    }
  });

  it('rifiuta i casi sbagliati, con un messaggio leggibile', () => {
    const cattivi: unknown[] = [
      null,
      'testo',
      [],
      { announcement: null },
      { announcement: { items: 'x' } },
      { announcement: { items: [{ icon: 'nope', text: 'a' }] } },
      { announcement: { items: [{ icon: 'zap', text: '   ' }] } },
      { announcement: { items: [{ icon: 'zap', text: 'x'.repeat(61) }] } },
      { announcement: { items: [{ icon: 'zap' }] } },
      { announcement: { items: Array.from({ length: 6 }, () => ({ icon: 'zap', text: 'a' })) } },
      { announcement: { promoLinkEnabled: 'si' } },
      { wordmark: { accent: 'x'.repeat(21) } },
      { wordmark: { rest: 5 } },
      { footerTagline: 'x'.repeat(221) },
      { footerTagline: 3 },
    ];
    for (const c of cattivi) {
      const r = ok(c);
      expect(r.success, JSON.stringify(c)).toBe(false);
      if (!r.success) {
        expect(r.error.issues.length).toBeGreaterThan(0);
        expect(typeof r.error.issues[0].message).toBe('string');
      }
    }
  });

  it('accetta i limiti esatti', () => {
    const r = ok({
      announcement: { items: Array.from({ length: 5 }, () => ({ icon: 'clock', text: 'x'.repeat(60) })) },
      wordmark: { accent: 'x'.repeat(20), rest: 'y'.repeat(20) },
      footerTagline: 'z'.repeat(220),
    });
    expect(r.success).toBe(true);
  });

  it('normalizeBranding torna ai default su un valore non valido', () => {
    expect(normalizeBranding({ announcement: { items: 'x' } })).toEqual(defaultBranding());
    expect(normalizeBranding(null)).toEqual(defaultBranding());
    const b = normalizeBranding({ wordmark: { accent: 'Foo', rest: 'Bar' } });
    expect(b.wordmark).toEqual({ accent: 'Foo', rest: 'Bar' });
  });
});
