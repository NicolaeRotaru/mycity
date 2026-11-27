import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IL PRIMO MESE A METÀ RESTA DOPO IL «SÌ» DELL'AGENTE — collaudo del 27/11/2026.
 *
 * Al «Sì» dell'agente nasce una riga «in contanti» che sblocca la pagina del negozio. Il preventivo contava
 * «nessuna riga = primo mese a metà», quindi quella riga toglieva dal link il «Il primo mese …» a ogni
 * attività aggiunta. Ora: l'abbonamento in contanti in corso è il primo, lo sconto resta; uno già fermato,
 * o uno pagato online, è già stato avuto.
 */

const tabelle: Record<string, unknown> = {};
function query(tabella: string) {
  const righe = () => { const v = tabelle[tabella]; return Array.isArray(v) ? v : v ? [v] : []; };
  const q: Record<string, unknown> = {};
  for (const m of ['eq', 'in', 'order', 'limit', 'not', 'select']) q[m] = () => q;
  q.maybeSingle = async () => ({ data: righe()[0] ?? null, error: null });
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve({ data: righe(), error: null }).then(ok, ko);
  return q;
}
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({ from: (t: string) => query(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: () => undefined, warn: () => undefined, info: () => undefined } }));

const { leggiPreventivo } = await import('@/lib/agenzia/leggi-preventivo');
const { primoMeseAncoraScontato } = await import('@/lib/agenzia/abbonamento-contanti');

const ID = '0de1905e-7000-4000-8000-0000000000ee';
const sconto = async (righe: unknown[]) => {
  tabelle.abbonamenti_servizi = righe;
  return (await leggiPreventivo(ID, undefined, { pubblico: true })).preventivo.primoMeseScontato;
};

beforeEach(() => {
  for (const k of Object.keys(tabelle)) delete tabelle[k];
  tabelle.profiles = { id: ID, role: 'seller', store_name: 'El Tropico Latino', business_type: 'bar', store_customization: { socials: {} } };
  tabelle.products = [];
});

describe('il primo mese a metà nel preventivo del link', () => {
  it('resta dopo il «Sì» (abbonamento in contanti in corso), come prima', async () => {
    expect(await sconto([])).toBe(true);
    expect(await sconto([{ fascia: 'premium', stato: 'active', origine: 'contanti', rinnovo_il: null }])).toBe(true);
  });

  it('non c è più per chi l abbonamento l ha già avuto: fermato in contanti, o pagato online', async () => {
    expect(await sconto([{ fascia: 'base', stato: 'canceled', origine: 'contanti', rinnovo_il: null }])).toBe(false);
    expect(await sconto([{ fascia: 'base', stato: 'active', origine: 'stripe', rinnovo_il: null }])).toBe(false);
    expect(await sconto([
      { fascia: 'base', stato: 'active', origine: 'contanti', rinnovo_il: null },
      { fascia: 'base', stato: 'canceled', origine: 'contanti', rinnovo_il: null },
    ])).toBe(false);
  });

  it('la regola da sola: una riga senza origine (di prima della 999) è Stripe', () => {
    expect(primoMeseAncoraScontato([{ stato: 'active' }])).toBe(false);
    expect(primoMeseAncoraScontato([{ stato: 'past_due', origine: 'contanti' }])).toBe(true);
  });
});
