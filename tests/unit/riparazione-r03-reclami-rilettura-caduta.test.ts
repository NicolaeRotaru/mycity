// @vitest-environment jsdom
/**
 * R03-007 — Se la rilettura dei reclami cade mentre la finestra «Risolvi reclamo» è aperta, React
 * Query tiene i dati di prima: la finestra restava su quelli e i tre pulsanti di decisione restavano
 * accesi, cioè si poteva rimborsare o rifiutare un reclamo che nel frattempo poteva essere già chiuso.
 * Adesso la finestra lo dice, offre «Riprova», e la decisione resta spenta finché una rilettura non
 * riesce. (Banco di prova come minori-s05-reclami-pagina e riparazione-r09-reclami.)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { focusManager } from '@tanstack/react-query';
import { disegna, aspetta, scrivi } from './aiuti/cabina-admin';

const stato = vi.hoisted(() => ({
  reclami: [] as unknown[] | null,
}));
function catena(tabella: string): unknown {
  const risposta = () =>
    tabella === 'disputes'
      ? (stato.reclami === null ? { data: null, error: { message: 'giù' } } : { data: stato.reclami, error: null })
      : { data: [], error: null };
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (ok: (r: unknown) => unknown) => Promise.resolve(risposta()).then(ok) : () => p),
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: (t: string) => catena(t), auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const RECLAMO = {
  id: 'rec-1', order_id: 'ord-rec-1-0000', opener_id: 'cliente-1', reason: 'damaged', description: 'Arrivata rotta',
  status: 'open', resolution_notes: null, refund_cents: null, created_at: '2026-11-01T10:00:00Z',
  opener: { full_name: 'Mario' }, against: { store_name: 'Forno', full_name: null },
};

let chiudi: (() => void) | null = null;
afterEach(() => {
  chiudi?.();
  chiudi = null;
  focusManager.setFocused(undefined);
});

const bottone = (testo: string) =>
  [...document.body.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === testo) as HTMLButtonElement | undefined;
const decisioni = () => ['A favore del cliente', 'A favore del venditore', 'Rifiuta'].map((t) => bottone(t));
const clic = async (el: Element | undefined) => {
  await act(async () => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await aspetta();
};

/** La pagina con la finestra aperta sul reclamo e una motivazione già scritta. */
async function finestraAperta() {
  stato.reclami = [RECLAMO];
  const mod = (await import('@/app/admin/disputes/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  await clic(bottone('Decidi'));
  const motivo = document.body.querySelector('textarea[aria-label="Motivazione della decisione"]') as HTMLTextAreaElement;
  await scrivi(motivo, 'Foto della torta rotta allegata dal cliente.');
  await aspetta();
}

/** La scheda torna in primo piano: React Query rilegge i reclami (dati già vecchi). */
async function tornaSullaScheda() {
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await aspetta(10);
}

describe('R03-007 — rilettura dei reclami caduta a finestra aperta', () => {
  it('controprova: con le letture riuscite i tre pulsanti di decisione sono accesi', async () => {
    await finestraAperta();
    expect(decisioni().map((b) => b?.disabled)).toEqual([false, false, false]);
    await tornaSullaScheda();
    expect(decisioni().map((b) => b?.disabled)).toEqual([false, false, false]);
    expect(document.body.textContent).not.toContain('Non riesco a rileggere questo reclamo');
  });

  it('se la rilettura cade la decisione si spegne e la finestra lo dice; «Riprova» riuscito la riaccende', async () => {
    await finestraAperta();
    stato.reclami = null; // la prossima lettura cade
    await tornaSullaScheda();
    expect(decisioni().every((b) => b !== undefined), 'la finestra si è chiusa: la prova non misura niente').toBe(true);
    expect(decisioni().map((b) => b?.disabled), 'con i dati vecchi si può ancora decidere').toEqual([true, true, true]);
    const avviso = [...document.body.querySelectorAll('[role="alert"]')].find((el) => (el.textContent ?? '').includes('Non riesco a rileggere questo reclamo'));
    expect(avviso, 'la finestra non dice che i dati possono essere vecchi').toBeTruthy();
    const riprova = [...(avviso?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === 'Riprova');
    expect(riprova, 'manca «Riprova»').toBeTruthy();

    stato.reclami = [RECLAMO]; // la rete torna
    await clic(riprova);
    await aspetta(10);
    expect(decisioni().map((b) => b?.disabled)).toEqual([false, false, false]);
    expect(document.body.textContent).not.toContain('Non riesco a rileggere questo reclamo');
  });
});
