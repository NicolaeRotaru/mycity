// @vitest-environment jsdom
/**
 * Onda 2 · R06-004 — Se il fattorino sparisce con la consegna in contanti in strada, l'amministratore
 * la chiude dalla pagina dell'ordine.
 *
 * La funzione del database (admin_chiudi_consegna, migrazione 360) e la strada del sito
 * (chiudiConsegnaDaAmministratore) c'erano, ma nessuna rotta né pulsante le chiamava: l'allarme
 * «rider fermo» portava alla pagina dell'ordine e lì c'era solo «Annulla». Qui gira la catena vera:
 * la pagina dell'ordine montata, il modulo «Chiudi la consegna», la rotta /api/admin/chiudi-consegna
 * e lib/cassa/registra-incasso.ts. Finti sono solo il database e l'involucro dell'autenticazione.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fake, disegna, scrivi, aspetta, type Domanda } from './aiuti/cabina-admin';

const ID = '11111111-2222-4333-8444-555555555555';
const RIDER = '22222222-3333-4444-8555-666666666666';

const stato = vi.hoisted(() => ({
  rpc: [] as Array<{ nome: string; argomenti: unknown }>,
  rispostaRpc: { data: { ok: true, incasso_registrato: true }, error: null } as { data: unknown; error: unknown },
  quadrature: [] as unknown[][],
  errori: [] as unknown[][],
}));

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children),
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: ID }), useRouter: () => ({ push: () => {} }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/cassa/quadratura', () => ({
  aggiornaQuadratura: async (...a: unknown[]) => {
    stato.quadrature.push(a);
  },
}));
vi.mock('@/lib/activity', () => ({ recordActivity: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...a: unknown[]) => {
      stato.errori.push(a);
    },
    warn: vi.fn(),
    info: vi.fn(),
    spesa: vi.fn(),
  },
}));

/** La sessione dell'amministratore: dentro la 360 is_admin() guarda lei. */
const sessione = {
  rpc: async (nome: string, argomenti: unknown) => {
    stato.rpc.push({ nome, argomenti });
    return stato.rispostaRpc;
  },
};
/** Il client di servizio: rilegge l'ordine chiuso per la giornata di cassa. */
const servizio = {
  from: () => {
    const b: Record<string, unknown> = {};
    const catena = () => b;
    Object.assign(b, {
      select: catena,
      eq: catena,
      maybeSingle: async () => ({ data: { rider_id: RIDER, delivered_at: '2026-11-28T18:00:00Z' }, error: null }),
    });
    return b;
  },
};
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => servizio }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuthRateLimit:
    (_opts: unknown, h: (c: unknown) => Promise<Response>) =>
    (req: Request) =>
      h({ req, user: { id: 'admin-1' }, profile: { role: 'admin' }, supaUtente: sessione, params: {} }),
}));

const ORDINE = {
  id: ID, user_id: 'u', seller_id: 's', rider_id: RIDER, total_price: 25, shipping_cost: 3, rider_fee_cents: 300,
  discount_amount: 0, coupon_code: null, payment_method: 'cod', payment_status: 'PENDING',
  delivery_status: 'OUT_FOR_DELIVERY', pickup_in_store: false, delivery_slot: null, cash_confirmed_at: null,
  created_at: '2026-11-28T15:00:00Z', accepted_at: '2026-11-28T15:05:00Z', ready_at: '2026-11-28T15:30:00Z',
  picked_up_at: '2026-11-28T15:40:00Z', delivered_at: null, canceled_at: null,
  delivery_full_name: 'Maria', delivery_phone: null, delivery_address: 'Via Roma 1', delivery_city: 'Piacenza',
  delivery_zip: '29121', delivery_notes: null, refunded_amount_cents: 0, payout_status: 'AWAITING_REMITTANCE',
  dispute_status: null, internal_dispute_status: null, seller: { store_name: 'Forno' }, rider: { full_name: 'Gino' },
  order_items: [],
};

let chiudi: (() => void) | null = null;
const chiamate: Array<{ url: string; corpo: unknown; stato: number; risposta: unknown }> = [];

beforeEach(() => {
  stato.rpc = [];
  stato.rispostaRpc = { data: { ok: true, incasso_registrato: true }, error: null };
  stato.quadrature = [];
  stato.errori = [];
  chiamate.length = 0;
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url !== '/api/admin/chiudi-consegna') throw new Error(`rete non prevista: ${url}`);
    const { POST } = await import('@/app/api/admin/chiudi-consegna/route');
    const res = await (POST as unknown as (r: Request) => Promise<Response>)(
      new Request('http://localhost/api/admin/chiudi-consegna', init),
    );
    const risposta = await res.clone().json();
    chiamate.push({ url, corpo: JSON.parse(String(init?.body)), stato: res.status, risposta });
    return res;
  });
});
afterEach(() => {
  chiudi?.();
  chiudi = null;
  fake.azzera();
  vi.unstubAllGlobals();
});

async function apri(ordine: Record<string, unknown>): Promise<HTMLElement> {
  fake.rispondi = (q: Domanda) => (q.tabella === 'orders' ? { data: ordine, error: null } : { data: [], error: null });
  const mod = (await import('@/app/admin/orders/[id]/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

function pulsante(host: HTMLElement, testo: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === testo) as HTMLButtonElement | undefined;
}

async function premi(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
  });
  await aspetta();
}

describe('R06-004 — la consegna in contanti del fattorino sparito si chiude dalla pagina dell’ordine', () => {
  it('«Chiudi la consegna» manda contanti e motivo alla rotta, che chiama la 360 con la sessione dell’amministratore', async () => {
    const host = await apri(ORDINE);
    const apriModulo = pulsante(host, 'Chiudi la consegna');
    expect(apriModulo, 'sulla pagina dell’ordine in strada il pulsante deve esserci').toBeTruthy();
    await premi(apriModulo!);

    const contanti = host.querySelector('input[name="incassato"]') as HTMLInputElement;
    // Precompilato con il contante da rimettere: 25 € meno i 3 € del fattorino.
    expect(contanti.value).toBe('22.00');
    const conferma = pulsante(host, 'Chiudi come consegnata')!;
    expect(conferma.disabled, 'senza motivo non si chiude').toBe(true);
    await scrivi(host.querySelector('input[name="motivo"]') as HTMLInputElement, 'Fattorino irraggiungibile da tre giorni');
    await act(async () => {
      (host.querySelector('form[aria-label="Chiudi la consegna"]') as HTMLFormElement).requestSubmit();
    });
    await vi.waitFor(() => expect(chiamate).toHaveLength(1), { timeout: 3000 });
    await aspetta();

    expect(chiamate[0].corpo).toEqual({ orderId: ID, incassatoCents: 2200, motivo: 'Fattorino irraggiungibile da tre giorni' });
    expect(chiamate[0].stato).toBe(200);
    expect(chiamate[0].risposta).toEqual({ ok: true, incassoRegistrato: true });
    expect(stato.rpc).toEqual([
      {
        nome: 'admin_chiudi_consegna',
        argomenti: { p_order_id: ID, p_incassato_cents: 2200, p_motivo: 'Fattorino irraggiungibile da tre giorni' },
      },
    ]);
    // La giornata di cassa del fattorino si riallinea sul giorno della consegna.
    expect(stato.quadrature).toEqual([[servizio, RIDER, '2026-11-28']]);
  });

  it('se il fattorino aveva già dichiarato i contanti, si chiude e basta (incasso null)', async () => {
    stato.rispostaRpc = { data: { ok: true, incasso_registrato: false }, error: null };
    const host = await apri({ ...ORDINE, cash_confirmed_at: '2026-11-28T16:00:00Z' });
    await premi(pulsante(host, 'Chiudi la consegna')!);
    expect(host.querySelector('input[name="incassato"]')).toBeNull();
    await scrivi(host.querySelector('input[name="motivo"]') as HTMLInputElement, 'Il fattorino non chiude la consegna');
    await act(async () => {
      (host.querySelector('form[aria-label="Chiudi la consegna"]') as HTMLFormElement).requestSubmit();
    });
    await vi.waitFor(() => expect(chiamate).toHaveLength(1), { timeout: 3000 });
    await aspetta();
    expect(chiamate.map((c) => c.corpo)).toEqual([
      { orderId: ID, incassatoCents: null, motivo: 'Il fattorino non chiude la consegna' },
    ]);
  });

  it.each([
    ['ritirato e non ancora in strada (si annulla)', { delivery_status: 'PICKED_UP' }],
    ['pagato con la carta', { payment_method: 'card' }],
    ['ritiro in negozio', { pickup_in_store: true }],
    ['senza fattorino', { rider_id: null }],
    ['già consegnato', { delivery_status: 'DELIVERED' }],
  ])('niente pulsante dove la 360 rifiuterebbe: %s', async (_nome, cambio) => {
    const host = await apri({ ...ORDINE, ...cambio });
    expect(pulsante(host, 'Chiudi la consegna')).toBeUndefined();
  });
});

describe('R06-004 — la rotta /api/admin/chiudi-consegna', () => {
  async function chiama(corpo: unknown): Promise<{ status: number; body: { ok: boolean; error?: { code: string; message: string } } }> {
    const { POST } = await import('@/app/api/admin/chiudi-consegna/route');
    const res = await (POST as unknown as (r: Request) => Promise<Response>)(
      new Request('http://localhost/api/admin/chiudi-consegna', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      }),
    );
    return { status: res.status, body: await res.json() };
  }

  it('il rifiuto della funzione arriva con il suo stato e il suo codice (PICKED_UP: si annulla, non si chiude)', async () => {
    stato.rispostaRpc = { data: { ok: false, reason: 'WRONG_STATUS', status: 'PICKED_UP' }, error: null };
    const r = await chiama({ orderId: ID, incassatoCents: 2200, motivo: 'Fattorino irraggiungibile' });
    expect(r.status).toBe(409);
    expect(r.body.error?.code).toBe('WRONG_STATUS');
    expect(r.body.error?.message).toMatch(/si annulla, non si chiude/);
    expect(stato.quadrature).toHaveLength(0);
  });

  it('un motivo troppo corto o un id che non è un ordine non arrivano al database', async () => {
    expect((await chiama({ orderId: ID, incassatoCents: 2200, motivo: 'boh' })).status).toBe(400);
    expect((await chiama({ orderId: 'non-un-id', incassatoCents: 2200, motivo: 'Fattorino irraggiungibile' })).status).toBe(400);
    expect(stato.rpc).toHaveLength(0);
  });
});

describe('R06-004 — 42501 da un trigger dentro la 360 è un guasto, non «solo un amministratore»', () => {
  it('il guardiano degli ordini che alza 42501 resta un 500 scritto nel registro', async () => {
    const { chiudiConsegnaDaAmministratore } = await import('@/lib/cassa/registra-incasso');
    const s = {
      rpc: async () => ({ data: null, error: { code: '42501', message: 'scrittura su orders non autorizzata (guardiano)' } }),
    } as unknown as SupabaseClient;
    const esito = await chiudiConsegnaDaAmministratore(s, servizio as unknown as SupabaseClient, {
      ordineId: ID,
      incassatoCents: 2200,
      motivo: 'Fattorino irraggiungibile da tre giorni',
    });
    expect(esito).toMatchObject({ ok: false, motivo: 'ERRORE', stato: 500 });
    expect(stato.errori, 'un guasto vero si scrive').toHaveLength(1);
  });

  it('il permesso negato sulla funzione (chiamata senza sessione) resta 403', async () => {
    const { chiudiConsegnaDaAmministratore } = await import('@/lib/cassa/registra-incasso');
    const s = {
      rpc: async () => ({ data: null, error: { code: '42501', message: 'permission denied for function admin_chiudi_consegna' } }),
    } as unknown as SupabaseClient;
    const esito = await chiudiConsegnaDaAmministratore(s, servizio as unknown as SupabaseClient, {
      ordineId: ID,
      incassatoCents: 2200,
      motivo: 'Fattorino irraggiungibile da tre giorni',
    });
    expect(esito).toMatchObject({ ok: false, motivo: 'NOT_ADMIN', stato: 403 });
    expect(stato.errori).toHaveLength(0);
  });
});
