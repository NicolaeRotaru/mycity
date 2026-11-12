import { describe, it, expect } from 'vitest';
import { eseguiPotature, potatureDiRitenzione, type ClientePotature, type Registro } from '@/lib/privacy/potature-ritenzione';

/**
 * R02-007 (12/11/2026) — Nel database vero la migrazione 171 non c'è: la vista
 * documenti_iscrizione_a_meta manca e PostgREST risponde PGRST205. Il passo si salta con un
 * avviso, invece di contare come fallito e rendere rossa (500) tutta la notte.
 */

const ADESSO = Date.parse('2026-11-12T03:00:00Z');

function finto(erroreVista: { message: string; code?: string } | null) {
  const rpc: string[] = [];
  const catena = (risposta: { error: unknown }) => {
    const c: Record<string, unknown> = {};
    for (const m of ['eq', 'lt', 'is', 'not', 'or']) c[m] = () => c;
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve(risposta).then(ok);
    return c;
  };
  const admin = {
    from: (t: string) => ({
      delete: () => catena({ error: t === 'documenti_iscrizione_a_meta' ? erroreVista : null }),
      update: () => catena({ error: null }),
    }),
    rpc: async (nome: string) => { rpc.push(nome); return { data: [], error: null }; },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  } as unknown as ClientePotature;
  return { admin, rpc };
}

function registro() {
  const righe: Array<{ livello: string; messaggio: string }> = [];
  const r: Registro = {
    info: (m) => righe.push({ livello: 'info', messaggio: m }),
    warn: (m) => righe.push({ livello: 'warn', messaggio: m }),
    error: (m) => righe.push({ livello: 'error', messaggio: m }),
  };
  return { r, righe };
}

const passo = () => potatureDiRitenzione(ADESSO).filter((p) => p.cosa === 'documenti-kyc-iscrizione-a-meta');

describe('R02-007 · la potatura dei documenti a metà iscrizione senza la migrazione 171', () => {
  it('la vista che manca (PGRST205) non fa fallire la notte: avviso e passo saltato', async () => {
    const { admin, rpc } = finto({ code: 'PGRST205', message: "Could not find the table 'public.documenti_iscrizione_a_meta' in the schema cache" });
    const { r, righe } = registro();
    const rapporto = await eseguiPotature(admin, r, ADESSO, passo());
    expect(rapporto.fallite).toBe(0);
    expect(righe.some((x) => x.livello === 'warn' && /171/.test(x.messaggio))).toBe(true);
    expect(rpc, 'senza la coda non si chiama la funzione che la svuota').not.toContain('kyc_file_da_togliere_prendi');
  });

  it('un guasto vero resta un guasto', async () => {
    const { admin } = finto({ code: '57014', message: 'canceling statement due to statement timeout' });
    const rapporto = await eseguiPotature(admin, registro().r, ADESSO, passo());
    expect(rapporto.fallite).toBe(1);
  });

  it('con la migrazione applicata il passo lavora come prima, file compresi', async () => {
    const { admin, rpc } = finto(null);
    const rapporto = await eseguiPotature(admin, registro().r, ADESSO, passo());
    expect(rapporto.fallite).toBe(0);
    expect(rpc).toContain('kyc_file_da_togliere_prendi');
  });
});

describe('R02-007 · dopo il qa: solo la 171 mancante si salta', () => {
  it('una colonna mancante o un ruolo che non esiste restano guasti', async () => {
    const { mancaLaMigrazione } = await import('@/lib/privacy/potature-ritenzione');
    expect(mancaLaMigrazione({ code: 'PGRST205', message: "Could not find the table 'public.documenti_iscrizione_a_meta' in the schema cache" })).toBe(true);
    expect(mancaLaMigrazione({ code: '42703', message: 'column caricati_at does not exist' })).toBe(false);
    expect(mancaLaMigrazione({ code: 'PGRST204', message: "Could not find the 'caricati_at' column of 'documenti_iscrizione_a_meta' in the schema cache" })).toBe(false);
    expect(mancaLaMigrazione({ code: '42704', message: 'role "x" does not exist' })).toBe(false);
    expect(mancaLaMigrazione({ code: 'PGRST205', message: "Could not find the table 'public.altra_tabella' in the schema cache" })).toBe(false);
  });
});
