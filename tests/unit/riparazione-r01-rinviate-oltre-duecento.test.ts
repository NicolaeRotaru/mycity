/**
 * R01-003 — OLTRE 200 RICHIESTE SCADUTE, IL NEGOZIO RINVIATO RESTAVA FUORI DALL'AVVISO.
 *
 * Il giro notturno cerca le richieste di cancellazione scadute da più di 7 giorni che la funzione
 * del database non ha restituito (un negozio con ordini aperti o soldi da incassare) e ne avvisa
 * gli amministratori. Leggeva al massimo 200 profili, senza ordine, e toglieva quelli presi in
 * carico DOPO il limite: con più di 200 richieste scadute, il negozio rinviato poteva non essere
 * mai segnalato. Adesso legge a pagine, in ordine di richiesta (poi id), finché finiscono, con un
 * tetto di pagine e di tempo che si dice nel registro.
 *
 * Il finto database non ordina: le righe si scrivono già in ordine di richiesta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

const mondo = vi.hoisted(() => ({ admin: null as unknown, primaDurata: 0, prese: 0 }));
const avvertimenti = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: avvertimenti, info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: vi.fn(async () => {
    mondo.prese++;
    if (mondo.prese === 1) vi.setSystemTime(Date.now() + mondo.primaDurata);
    return { ok: true, fileRimossi: 0, erroriFile: [] };
  }),
}));

import { POST } from '@/app/api/cron/process-deletions/route';

const ADESSO = new Date('2026-11-21T04:00:00+01:00').getTime();
const INIZIO = ADESSO - 30 * 86_400_000;
const utente = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NEGOZIO = '00000000-0000-4000-8000-ffffffffffff';
const quando = (secondi: number) => new Date(INIZIO + secondi * 1000).toISOString();

/**
 * `prese` richieste scadute che la funzione restituisce (prese in carico), in ordine di richiesta,
 * e dopo di loro i negozi rinviati per ordini aperti (che la funzione non restituisce).
 */
function laNotte(prese: Array<{ id: string; chiesta: string }>, negozi: Array<{ id: string; chiesta: string }>) {
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [
        { id: 'admin-1', role: 'admin' },
        ...prese.map((p) => ({ id: p.id, role: 'customer', deletion_requested_at: p.chiesta })),
        ...negozi.map((n) => ({ id: n.id, role: 'seller', deletion_requested_at: n.chiesta })),
      ],
      notifications: [],
      cron_heartbeats: [],
      cod_reconciliations: [],
    },
    rpc: { process_expired_deletions: { data: prese.map((p) => ({ user_id: p.id, deleted_at: p.chiesta })), error: null } },
  });
  mondo.admin = giro.admin;
  return giro;
}

const unGiro = async () => {
  const r = await POST(
    new Request('http://localhost/api/cron/process-deletions?a_mano=1&cancella=1', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );
  return (await r.json()) as { rinviatePerOrdiniAperti?: number; processed?: number };
};

const avvisiDelRinvio = (giro: ReturnType<typeof laNotte>) =>
  giro.notifiche().filter((n) => /Cancellazione rinviata/.test(String(n.title)));
const nelRegistro = (cosa: RegExp) => avvertimenti.mock.calls.some((c) => cosa.test(String(c[0])));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  mondo.primaDurata = 0;
  mondo.prese = 0;
  avvertimenti.mockClear();
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R01-003 · le cancellazioni rinviate si cercano oltre le prime 200', () => {
  it('200 richieste prese in carico e il negozio rinviato dopo: il negozio è segnalato', async () => {
    const prese = Array.from({ length: 200 }, (_, i) => ({ id: utente(i + 1), chiesta: quando(i) }));
    const giro = laNotte(prese, [{ id: NEGOZIO, chiesta: quando(500) }]);
    const corpo = await unGiro();

    expect(corpo.rinviatePerOrdiniAperti, 'il negozio dopo le prime 200 richieste non è stato guardato').toBe(1);
    const avvisi = avvisiDelRinvio(giro);
    expect(avvisi).toHaveLength(1);
    expect(String(avvisi[0].body)).toContain(NEGOZIO.slice(0, 8));
  });

  it('a pari ora di richiesta, chi sta oltre il confine della pagina non si perde', async () => {
    const stessaOra = quando(10);
    const prese = Array.from({ length: 200 }, (_, i) => ({ id: utente(i + 1), chiesta: stessaOra }));
    const giro = laNotte(prese, [{ id: NEGOZIO, chiesta: stessaOra }]);
    const corpo = await unGiro();
    expect(corpo.rinviatePerOrdiniAperti).toBe(1);
    expect(avvisiDelRinvio(giro)).toHaveLength(1);
  });

  it('il tetto di pagine si dice nel registro', async () => {
    // Il primo account dura quanto il tetto del ciclo: il resto si rimanda, la prova resta veloce.
    mondo.primaDurata = 150_000;
    const prese = Array.from({ length: 5_000 }, (_, i) => ({ id: utente(i + 1), chiesta: quando(i) }));
    laNotte(prese, [{ id: NEGOZIO, chiesta: quando(9_000) }]);
    await unGiro();
    expect(nelRegistro(/tetto di pagine/), 'le richieste oltre il tetto di pagine restano fuori senza dirlo').toBe(true);
  });

  it('con tanti negozi rinviati e un database lento, il ciclo delle cancellazioni ha ancora il suo tempo', async () => {
    const negozi = Array.from({ length: 300 }, (_, i) => ({ id: utente(1_000 + i), chiesta: quando(100 + i) }));
    const presa = { id: utente(1), chiesta: quando(1) };
    const giro = laNotte([presa], negozi);
    // Ogni lettura o scrittura del database «dura» un secondo.
    mondo.admin = {
      ...giro.admin,
      from: (tabella: string) => {
        vi.setSystemTime(Date.now() + 1_000);
        return giro.admin.from(tabella);
      },
    };
    const corpo = await unGiro();
    expect(corpo.processed, 'gli avvisi dei rinvii si sono mangiati il tempo del ciclo delle cancellazioni').toBe(1);
    expect(corpo.rinviatePerOrdiniAperti).toBeGreaterThan(0);
    expect(nelRegistro(/rinviate[\s\S]*tempo/), 'gli avvisi tagliati dal tempo non sono detti nel registro').toBe(true);
  });
});
