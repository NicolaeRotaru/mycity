/**
 * @vitest-environment jsdom
 */
/**
 * R04-016 (onda 2, 28/11/2026) — SE LE EMAIL NON ARRIVANO, LO DICONO ANCHE RICERCA, FILE E SCHEDA.
 *
 * L'elenco dei più recenti, con la funzione delle email caduta, mostrava già la riga «Le email degli
 * utenti non sono arrivate». Il resto della pagina no:
 *  · la ricerca riceveva un elenco di contatti vuoto e mostrava i risultati senza email, senza avviso;
 *  · «Esporta CSV» scriveva il file con la colonna Email vuota per tutti e diceva «Esportati N utenti»;
 *  · la scheda dell'utente scriveva «—», cioè «nessuna email».
 * Qui gira la pagina vera contro un database finto in cui la funzione delle email non risponde.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

const avvisi = vi.hoisted(() => ({ errori: [] as string[], riusciti: [] as string[] }));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn((m: string) => { avvisi.riusciti.push(m); }),
    error: vi.fn((m: string) => { avvisi.errori.push(m); }),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(), info: vi.fn(),
  }),
}));

const globale = globalThis as Record<string, unknown>;
type Riga = Record<string, unknown>;
type Opzioni = { queryKey?: unknown[]; queryFn?: () => Promise<unknown> };

const PROFILI: Riga[] = [1, 2].map((n) => ({
  id: `utente-${n}`, role: 'buyer', is_approved: true, approval_status: null, approval_requested_at: null,
  approved_at: null, rejection_reason: null, store_name: null, full_name: `Cliente ${n}`, phone: null,
  store_address: null, legal_first_name: null, legal_last_name: null, business_legal_name: null,
  business_form: null, business_address: null, business_city: null, business_pec: null,
  created_at: '2026-11-01T09:00:00Z',
}));
const CONTATTI = PROFILI.map((p) => ({ id: p.id, email: `${p.id}@piacenza.it`, phone: null, last_sign_in_at: null, email_confirmed_at: null, created_at: p.created_at }));

/** Profili sempre leggibili (con ogni filtro); la funzione delle email risponde o cade. */
function databaseFinto(o: { emailArrivano: boolean }) {
  return {
    from: () => {
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q, order: () => q, limit: () => q, or: () => q, in: () => q, eq: () => q, range: () => q,
        then: (ok: (x: unknown) => unknown) => Promise.resolve({ data: PROFILI.map((p) => ({ ...p })), error: null }).then(ok),
      });
      return q;
    },
    rpc: async (nome: string) => {
      if (nome !== 'admin_list_user_emails') return { data: null, error: { message: `rpc ${nome} non prevista` } };
      return o.emailArrivano
        ? { data: CONTATTI.map((c) => ({ ...c })), error: null }
        : { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    },
  };
}

const chiave = (q: Opzioni) => ((q.queryKey ?? [])[2] ?? {}) as Riga;
const eLElenco = (k: unknown[] | undefined) =>
  Array.isArray(k) && k.length === 3 && k[1] === 'users' && Object.keys((k[2] ?? {}) as Riga).length === 0;

let schermo: ReturnType<typeof accendi> | null = null;

beforeEach(() => {
  avvisi.errori = [];
  avvisi.riusciti = [];
});
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  delete globale.__DATI_QUERY__;
  delete globale.__OPZIONI_QUERY__;
  delete globale.__CLIENT_SUPABASE__;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

/** Scrive nella casella di ricerca come una persona (React ascolta l'evento `input`). */
async function scriviNellaRicerca(testo: string) {
  const casella = schermo!.radice.querySelector('input[placeholder^="Cerca nome"]') as HTMLInputElement;
  expect(casella, 'la casella di ricerca non c’è').toBeTruthy();
  const imposta = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    imposta.call(casella, testo);
    casella.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // La ricerca parte dopo 300 ms di silenzio (useDebounce).
  await act(async () => { await new Promise((r) => setTimeout(r, 380)); });
  await attendi();
}

describe('R04-016 · le email non arrivate, oltre l’elenco dei più recenti', () => {
  it('IL CASO CHE ROMPEVA — la ricerca: i risultati sono senza email e la pagina lo dice', async () => {
    globale.__CLIENT_SUPABASE__ = databaseFinto({ emailArrivano: false });
    globale.__OPZIONI_QUERY__ = [];
    let risultato: unknown;
    globale.__DATI_QUERY__ = (q: Opzioni) => {
      const f = chiave(q);
      if (f.conteggio === 'totale') return PROFILI.length;
      if (typeof f.cerca === 'string') return risultato;
      return eLElenco(q.queryKey) ? CONTATTI.map((c, i) => ({ ...PROFILI[i], email: c.email })) : undefined;
    };
    const mod = await monta('app/admin/users/page.tsx');
    schermo = accendi(mod.default as ComponentType);
    await scriviNellaRicerca('cliente');
    const lettura = [...(globale.__OPZIONI_QUERY__ as Opzioni[])].reverse().find((q) => chiave(q).cerca === 'cliente');
    expect(lettura?.queryFn, 'la lettura della ricerca non si trova').toBeTypeOf('function');
    risultato = await lettura!.queryFn!();
    const righe = (risultato as { righe: Array<Riga> }).righe;
    expect(righe.map((r) => r.full_name)).toEqual(['Cliente 1', 'Cliente 2']);
    expect(righe.every((r) => r.email_non_letta === true), 'le righe della ricerca non sanno che le email mancano').toBe(true);

    // La pagina col risultato della ricerca: la riga che lo dice c'è.
    await scriviNellaRicerca('client');
    const testo = schermo.radice.textContent ?? '';
    expect(testo).toContain('Cliente 1');
    expect(testo, 'i risultati della ricerca sono senza email e nessuno lo dice').toContain('Le email degli utenti non sono arrivate');
    expect(testo).toContain('la ricerca non ha potuto guardare fra le email');
  });

  it('IL CASO CHE ROMPEVA — «Esporta CSV» con le email cadute non scrive un file con la colonna vuota', async () => {
    globale.__CLIENT_SUPABASE__ = databaseFinto({ emailArrivano: false });
    globale.__DATI_QUERY__ = (q: Opzioni) => (chiave(q).conteggio === 'totale' ? PROFILI.length : eLElenco(q.queryKey) ? PROFILI.map((p) => ({ ...p, email_non_letta: true })) : undefined);
    const creaUrl = vi.fn(() => 'blob:finto');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: creaUrl, revokeObjectURL: vi.fn() }));
    const mod = await monta('app/admin/users/page.tsx');
    schermo = accendi(mod.default as ComponentType);
    const esporta = [...schermo.radice.querySelectorAll('button')].find((b) => /Esporta CSV/.test(b.textContent ?? ''));
    expect(esporta).toBeTruthy();
    await act(async () => { clicca(esporta!); });
    for (let i = 0; i < 5; i++) await attendi();
    expect(creaUrl, 'il file è uscito con la colonna Email vuota per tutti').not.toHaveBeenCalled();
    expect(avvisi.riusciti.join(' ')).not.toMatch(/Esportati/);
    expect(avvisi.errori.join(' ')).toMatch(/email degli utenti non sono arrivate/);
  });

  it('IL CASO CHE ROMPEVA — la scheda dell’utente non scrive «—» come se l’email non ci fosse', async () => {
    globale.__CLIENT_SUPABASE__ = databaseFinto({ emailArrivano: false });
    globale.__DATI_QUERY__ = (q: Opzioni) => (chiave(q).conteggio === 'totale' ? PROFILI.length : eLElenco(q.queryKey) ? PROFILI.map((p) => ({ ...p, email_non_letta: true })) : undefined);
    const mod = await monta('app/admin/users/page.tsx');
    schermo = accendi(mod.default as ComponentType);
    // «Modifica» sulla prima riga apre la scheda con Email, verifica e ultimo accesso.
    const modifica = [...schermo.radice.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Modifica');
    expect(modifica, 'il pulsante «Modifica» non c’è').toBeTruthy();
    await act(async () => { clicca(modifica!); });
    await attendi();
    expect(document.body.textContent ?? '').toContain('non arrivata: ricarica la pagina');
  });

  it('controprova: con le email arrivate il file esce con le email', async () => {
    globale.__CLIENT_SUPABASE__ = databaseFinto({ emailArrivano: true });
    globale.__DATI_QUERY__ = (q: Opzioni) => (chiave(q).conteggio === 'totale' ? PROFILI.length : eLElenco(q.queryKey) ? PROFILI.map((p) => ({ ...p })) : undefined);
    const parti: string[] = [];
    vi.stubGlobal('Blob', class { constructor(p: string[]) { parti.push(...p); } });
    const creaUrl = vi.fn(() => 'blob:finto');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: creaUrl, revokeObjectURL: vi.fn() }));
    const mod = await monta('app/admin/users/page.tsx');
    schermo = accendi(mod.default as ComponentType);
    const esporta = [...schermo.radice.querySelectorAll('button')].find((b) => /Esporta CSV/.test(b.textContent ?? ''));
    await act(async () => { clicca(esporta!); });
    for (let i = 0; i < 5; i++) await attendi();
    expect(creaUrl).toHaveBeenCalledTimes(1);
    expect(parti.join('')).toContain('utente-1@piacenza.it');
  });
});
