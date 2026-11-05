import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';

/**
 * S10 (5/11/2026, scheda 434) — sotto accesso e iscrizione niente pulsanti SPID
 * e SMS che non funzionano, e una sola spunta dei Termini nell'iscrizione.
 */
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { signInWithOAuth: vi.fn() } } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { AuthAlternatives } from '@/components/ui/AuthShell';

describe('i modi alternativi di entrare sono veri (434)', () => {
  it('niente SPID né SMS', () => {
    const html = renderToStaticMarkup(createElement(AuthAlternatives));
    expect(html).not.toMatch(/SPID/);
    expect(html).not.toMatch(/SMS/);
    expect(html).toMatch(/Google/);
  });
  it('sulla pagina di accesso la spunta dei Termini resta', () => {
    const html = renderToStaticMarkup(createElement(AuthAlternatives));
    expect(html).toMatch(/type="checkbox"/);
  });
  it('nell\'iscrizione vale la spunta del modulo: nessuna seconda casella', () => {
    const html = renderToStaticMarkup(createElement(AuthAlternatives as (p: { condizioniDalModulo?: boolean }) => JSX.Element, { condizioniDalModulo: false }));
    expect(html).not.toMatch(/type="checkbox"/);
    expect(readFileSync('app/sign-up/page.tsx', 'utf8')).toMatch(/<AuthAlternatives condizioniDalModulo=\{acceptTos\} \/>/);
  });
});
