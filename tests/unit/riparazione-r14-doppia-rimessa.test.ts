// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna, scrivi, aspetta } from './aiuti/cabina-admin';

/**
 * R14-006 — Un doppio clic su «Conferma i contanti ricevuti» registrava due
 * rimesse invece di una.
 *
 * ① La pagina: il bottone si spegne solo quando React ridisegna con la conferma
 *   in corso. Due invii arrivati prima (doppio clic, Invio premuto due volte)
 *   mandavano due conferme al server.
 * ② La rotta: la seconda conferma uguale, in fila dietro la prima (lucchetto
 *   della 381), non rilascia niente e non chiude la giornata. Prima scriveva lo
 *   stesso una seconda riga «cod.remittance_confirm» nel registro delle azioni.
 *   (Il «versato» riscritto dalla funzione nel database lo prova
 *   tests/sql/rls/riparazione-r14-doppia-rimessa.test.sql, migrazione 383.)
 */

const RIDER = '11111111-1111-4111-8111-111111111111';
const GIORNO = '2026-11-04';

// ── il finto client del browser per la pagina ────────────────────────────────
let righe: unknown[] = [];
function catena(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (ok: (r: unknown) => unknown) => Promise.resolve({ data: righe, error: null }).then(ok) : () => p),
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: () => catena(), auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

// ── il finto database della rotta ────────────────────────────────────────────
/**
 * La funzione confirm_cod_remittance dietro il suo lucchetto: le conferme dello
 * stesso fattorino per lo stesso giorno passano una alla volta. La prima
 * rilascia gli ordini da versare e chiude la giornata; quelle dopo trovano
 * niente da rilasciare. `conVersataOra` = la risposta della 383; senza, quella
 * della 381 (che non dice se ha chiuso la giornata).
 */
const db = vi.hoisted(() => ({
  daVersare: 0,
  versata: false,
  conVersataOra: true,
  fila: Promise.resolve() as Promise<unknown>,
  audit: [] as Array<{ action: string; metadata?: Record<string, unknown> }>,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (ctx: { req: unknown; user: { id: string } }) => unknown) => (req: unknown) =>
    h({ req, user: { id: 'admin-1' } }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/cassa/quadratura', () => ({ aggiornaQuadratura: vi.fn(async () => {}) }));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(async (r: { action: string; metadata?: Record<string, unknown> }) => {
    db.audit.push({ action: r.action, metadata: r.metadata });
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({}),
  getServerSupabase: async () => ({
    rpc: (_nome: string, _args: unknown) => {
      const turno = db.fila.then(async () => {
        await new Promise((r) => setTimeout(r, 5));
        const rilasciati = db.daVersare;
        db.daVersare = 0;
        const versataOra = !db.versata;
        db.versata = true;
        const data: Record<string, unknown> = { rilasciati, saltati_senza_incasso: 0 };
        if (db.conVersataOra) data.versata_ora = versataOra;
        return { data, error: null };
      });
      db.fila = turno.catch(() => {});
      return turno;
    },
  }),
}));

function conferma(corpo: Record<string, unknown>) {
  return import('@/app/api/admin/cod-remittance/route').then(({ POST }) =>
    (POST as unknown as (req: Request) => Promise<Response>)(
      new Request('http://localhost/api/admin/cod-remittance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      }),
    ),
  );
}

beforeEach(() => {
  db.daVersare = 2;
  db.versata = false;
  db.conVersataOra = true;
  db.fila = Promise.resolve();
  db.audit.length = 0;
});

describe('R14-006 ② — la seconda conferma uguale non registra una seconda rimessa', () => {
  const corpo = { riderId: RIDER, date: GIORNO, contatiCents: 2000, attesiCents: 2000 };

  it('due conferme partite insieme: una sola riga «rimessa confermata» nel registro', async () => {
    const [a, b] = await Promise.all([conferma(corpo), conferma(corpo)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const rimesse = db.audit.filter((r) => r.action === 'cod.remittance_confirm');
    expect(rimesse, 'il doppio clic ha registrato due rimesse').toHaveLength(1);
    expect(rimesse[0].metadata).toMatchObject({ rilasciati: 2 });
    const [ja, jb] = [await a.json(), await b.json()];
    expect(ja).toMatchObject({ ok: true, released: 2 });
    expect(jb).toMatchObject({ ok: true, released: 0 });
  });

  it('anche con la funzione della 381 (risposta senza «versata_ora»): una sola riga', async () => {
    db.conVersataOra = false;
    await Promise.all([conferma(corpo), conferma(corpo)]);
    expect(db.audit.filter((r) => r.action === 'cod.remittance_confirm')).toHaveLength(1);
  });

  it('una giornata senza ordini da rilasciare che la conferma chiude resta una rimessa registrata', async () => {
    db.daVersare = 0;
    const r = await conferma(corpo);
    expect(r.status).toBe(200);
    expect(db.audit.filter((x) => x.action === 'cod.remittance_confirm')).toHaveLength(1);
  });
});

// ── la pagina ─────────────────────────────────────────────────────────────────
function ordine(i: number) {
  return {
    id: `o${i}`, rider_id: RIDER, delivered_at: '2026-11-04T10:00:00Z', total_price: 13, shipping_cost: 3,
    rider_fee_cents: 300, pickup_in_store: false, payment_method: 'cod', delivery_status: 'DELIVERED',
    cash_confirmed_at: '2026-11-04T10:05:00Z', rider: { full_name: 'Luca' },
  };
}

const chiamate: string[] = [];
let rispondi: Array<() => void> = [];
let chiudi: (() => void) | null = null;

describe('R14-006 ① — la pagina manda una conferma sola', () => {
  beforeEach(() => {
    chiamate.length = 0;
    rispondi = [];
    // Il server risponde quando lo dice la prova: la conferma resta «in volo».
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      chiamate.push(url);
      return new Promise<Response>((ok) => {
        rispondi.push(() => ok(new Response(JSON.stringify({ ok: true, released: 1, saltatiSenzaIncasso: 0 }), { status: 200 })));
      });
    }));
  });
  afterEach(() => { chiudi?.(); chiudi = null; vi.unstubAllGlobals(); });

  async function apri() {
    const mod = (await import('@/app/admin/cod-remittance/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    return r.host;
  }
  const bottone = (host: HTMLElement, testo: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(testo)) as HTMLButtonElement | undefined;

  it('due invii prima che la pagina si ridisegni: al server arriva una conferma', async () => {
    righe = [ordine(1)];
    const host = await apri();
    await act(async () => { bottone(host, 'Conferma rimessa')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await aspetta();
    await scrivi(host.querySelector('input[inputmode="decimal"]') as HTMLInputElement, '10,00');
    const invia = bottone(host, 'Conferma i contanti ricevuti')!;
    expect(invia.disabled).toBe(false);

    await act(async () => {
      invia.form?.requestSubmit();
      invia.form?.requestSubmit();
    });
    await aspetta();

    expect(chiamate.filter((u) => u.includes('cod-remittance')), 'il doppio clic ha mandato due conferme').toHaveLength(1);

    // Arrivata la risposta, la pagina torna a poter confermare (il segno si abbassa).
    await act(async () => { rispondi.forEach((f) => f()); });
    await aspetta();
    await act(async () => { bottone(host, 'Conferma rimessa')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await aspetta();
    await scrivi(host.querySelector('input[inputmode="decimal"]') as HTMLInputElement, '10,00');
    await act(async () => { bottone(host, 'Conferma i contanti ricevuti')?.form?.requestSubmit(); });
    await aspetta();
    expect(chiamate.filter((u) => u.includes('cod-remittance'))).toHaveLength(2);
  });
});
