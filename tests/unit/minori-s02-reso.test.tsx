// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Sessione S02 (5/11/2026) — il modulo del reso, montato davvero.
 *  · 177:  nessun motivo già scelto, e «Invia» spento finché non se ne sceglie uno;
 *  · 1653: con la foto in caricamento «Invia» è spento e il reso non parte senza la foto;
 *  · 1654: dopo la scelta il campo file si azzera (la stessa foto si può riscegliere);
 *  · 1621: una foto allegata si può togliere;
 *  · 1620: una lettura caduta mostra «Riprova», non «Ordine non trovato».
 */
const stato = vi.hoisted(() => ({
  lettura: { data: null as unknown, error: null as unknown },
  caricamento: null as null | { risolvi: (v: { publicUrl: string }) => void },
  chiamate: [] as Array<{ url: string; corpo: Record<string, unknown> }>,
}));
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'o1' }), useRouter: () => router }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ConfirmDialog', () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock('@/lib/storage/carica-immagine', () => ({
  caricaImmagine: () => new Promise((risolvi) => { stato.caricamento = { risolvi }; }),
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'b1' } } }), getSession: async () => ({ data: { session: null } }) },
    from: (t: string) =>
      t === 'orders'
        ? { select: () => ({ eq: () => ({ single: async () => stato.lettura }) }) }
        : { select: () => ({ eq: () => ({ in: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) },
  },
}));

import NewReturnPage from '@/app/orders/[id]/return/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let c: HTMLDivElement;
const ORDINE = {
  id: 'o1', total_price: 30, delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  payment_method: 'card', stripe_payment_intent: 'pi_1', wallet_applied_cents: 0,
};
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function monta() {
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  await act(async () => root.render(createElement(NewReturnPage)));
  await pausa();
  await pausa();
}
const invia = () => Array.from(c.querySelectorAll('button')).find((b) => /Invia richiesta|Attendi la foto|Scegli il motivo/.test(b.textContent ?? '')) as HTMLButtonElement;
const campoFile = () => c.querySelector('input[type=file]') as HTMLInputElement;
async function scegliMotivo(v = 'CHANGED_MIND') {
  await act(async () => { (c.querySelector(`input[type=radio][value=${v}]`) as HTMLInputElement).click(); });
}
async function scegliFoto() {
  const f = new File(['x'], 'vaso.jpg', { type: 'image/jpeg' });
  const input = campoFile();
  Object.defineProperty(input, 'files', { value: [f], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  return input;
}

beforeEach(() => {
  stato.lettura = { data: ORDINE, error: null };
  stato.caricamento = null;
  stato.chiamate = [];
  router.push.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    stato.chiamate.push({ url, corpo: init?.body ? JSON.parse(init.body) : {} });
    return new Response(JSON.stringify({ id: 'r1' }), { status: 201 });
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  c.remove();
  vi.unstubAllGlobals();
});

describe('il modulo del reso', () => {
  it('177 · nessun motivo scelto all apertura, e «Invia» resta spento finché non se ne sceglie uno', async () => {
    await monta();
    expect(Array.from(c.querySelectorAll('input[type=radio]')).some((r) => (r as HTMLInputElement).checked)).toBe(false);
    expect(invia().disabled).toBe(true);
    await scegliMotivo();
    expect(invia().disabled).toBe(false);
  });

  it('1653 · foto in caricamento: «Invia» spento e nessun reso parte senza la foto', async () => {
    await monta();
    await scegliMotivo('DAMAGED');
    await scegliFoto();
    expect(stato.caricamento).not.toBeNull();
    expect(invia().disabled).toBe(true);
    await act(async () => { invia().click(); });
    expect(stato.chiamate).toHaveLength(0);
    await act(async () => { stato.caricamento!.risolvi({ publicUrl: 'https://x/foto1.jpg' }); });
    await pausa();
    await act(async () => { invia().click(); });
    await pausa();
    expect(stato.chiamate).toHaveLength(1);
    expect(stato.chiamate[0].corpo.photoUrls).toEqual(['https://x/foto1.jpg']);
  });

  it('1654 · dopo la scelta il campo file si azzera', async () => {
    await monta();
    const input = campoFile();
    let azzerato = false;
    Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: (v: string) => { if (v === '') azzerato = true; } });
    await scegliFoto();
    expect(azzerato).toBe(true);
  });

  it('1621 · una foto allegata si può togliere', async () => {
    await monta();
    await scegliFoto();
    await act(async () => { stato.caricamento!.risolvi({ publicUrl: 'https://x/sbagliata.jpg' }); });
    await pausa();
    expect(c.querySelectorAll('img')).toHaveLength(1);
    const togli = c.querySelector('button[aria-label="Togli la foto 1"]') as HTMLButtonElement;
    expect(togli).toBeTruthy();
    await act(async () => { togli.click(); });
    expect(c.querySelectorAll('img')).toHaveLength(0);
  });

  it('1620 · lettura caduta: «Non riesco a caricare» con Riprova, non «Ordine non trovato»', async () => {
    stato.lettura = { data: null, error: { code: '08006', message: 'fetch failed' } };
    await monta();
    expect(c.textContent).toContain('Non riesco a caricare');
    expect(c.textContent).not.toContain('Ordine non trovato');
  });

  it('1620 · nessuna riga (PGRST116): resta «Ordine non trovato»', async () => {
    stato.lettura = { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    await monta();
    expect(c.textContent).toContain('Ordine non trovato');
  });
});
