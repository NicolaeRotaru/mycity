// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna, aspetta } from './aiuti/cabina-admin';

// R09-017 — Con la rete caduta la pagina del controllo del credito di un rimborso mostrava
// «Failed to fetch», il messaggio del browser, e nessun modo di riprovare.
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('ref=cod_refund_123&atteso=500') }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; vi.unstubAllGlobals(); });

describe('R09-017 · senza rete il controllo del credito parla italiano e si può riprovare', () => {
  // next-intl qui restituisce la chiave: il pulsante «Riprova» si legge «retry».
  it('fetch che cade: frase italiana e pulsante «Riprova» che rilegge', async () => {
    let chiamate = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { chiamate++; throw new TypeError('Failed to fetch'); }));
    const mod = (await import('@/app/admin/credito-del-rimborso/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    await aspetta(20);
    expect(r.host.textContent).not.toContain('Failed to fetch');
    expect(r.host.textContent).toContain('Non riesco a collegarmi');
    const bottone = [...r.host.querySelectorAll('button')].find((b) => /Riprova|retry/i.test(b.textContent ?? ''));
    expect(bottone).toBeTruthy();
    const prima = chiamate;
    bottone!.click();
    await aspetta(20);
    expect(chiamate).toBeGreaterThan(prima);
  });
});
