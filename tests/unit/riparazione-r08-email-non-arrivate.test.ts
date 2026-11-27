/**
 * @vitest-environment jsdom
 */
/**
 * R08-006 — nell'elenco utenti aperto senza ricerca, se la RPC delle email non
 * risponde le righe restano senza email e a schermo non c'è nessun avviso: chi
 * guarda pensa che quegli utenti un'email non ce l'abbiano. Qui si esegue la
 * lettura vera dell'elenco (la `queryFn` della pagina) contro un database finto,
 * e quello che restituisce torna a schermo: con la RPC caduta deve comparire una
 * riga che lo dice; con le email arrivate, nessun avviso.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

const globale = globalThis as Record<string, unknown>;
type Riga = Record<string, unknown>;
type Opzioni = { queryKey?: unknown[]; queryFn?: () => Promise<unknown> };

const PROFILI: Riga[] = [1, 2, 3].map((n) => ({
  id: `utente-${n}`, role: 'buyer', is_approved: true, approval_status: null, approval_requested_at: null,
  approved_at: null, rejection_reason: null, store_name: null, full_name: `Cliente ${n}`, phone: null,
  store_address: null, legal_first_name: null, legal_last_name: null, business_legal_name: null,
  business_form: null, business_address: null, business_city: null, business_pec: null,
  created_at: '2026-11-01T09:00:00Z',
}));

function databaseFinto(o: { emailArrivano: boolean }) {
  return {
    from: () => {
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q, order: () => q, limit: () => q,
        then: (ok: (x: unknown) => unknown) => Promise.resolve({ data: PROFILI.map((p) => ({ ...p })), error: null }).then(ok),
      });
      return q;
    },
    rpc: async (nome: string) => {
      if (nome !== 'admin_list_user_emails') return { data: null, error: { message: `rpc ${nome} non prevista` } };
      return o.emailArrivano
        ? { data: PROFILI.map((p) => ({ id: p.id, email: `${p.id}@piacenza.it`, phone: null, last_sign_in_at: null, email_confirmed_at: null })), error: null }
        : { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    },
  };
}

/** La lettura dell'elenco dei più recenti: chiave `['admin','users',{}]`, senza filtri. */
const eLElenco = (k: unknown[] | undefined) =>
  Array.isArray(k) && k.length === 3 && k[1] === 'users' && Object.keys((k[2] ?? {}) as Riga).length === 0;

function datiDellaPagina(elenco: unknown) {
  globale.__DATI_QUERY__ = (q: Opzioni) => {
    const filtri = ((q.queryKey ?? [])[2] ?? {}) as Riga;
    if (filtri.conteggio === 'totale') return PROFILI.length;
    if (typeof filtri.cerca === 'string') return undefined;
    return eLElenco(q.queryKey) ? elenco : undefined;
  };
}

/** Esegue la lettura dell'elenco della pagina contro il database finto, poi rimonta la pagina con quel risultato. */
async function paginaDopoLaLettura(o: { emailArrivano: boolean }) {
  globale.__CLIENT_SUPABASE__ = databaseFinto(o);
  globale.__OPZIONI_QUERY__ = [];
  datiDellaPagina([]);
  const mod = await monta('app/admin/users/page.tsx');
  const prima = accendi(mod.default as ComponentType);
  const lettura = (globale.__OPZIONI_QUERY__ as Opzioni[]).find((q) => eLElenco(q.queryKey));
  prima.smonta();
  expect(lettura?.queryFn, 'la lettura dell’elenco non si trova').toBeTypeOf('function');
  const elenco = (await lettura!.queryFn!()) as Array<Riga & { email?: string | null }>;

  datiDellaPagina(elenco);
  const s = accendi(mod.default as ComponentType);
  return { elenco, testo: s.radice.textContent ?? '', smonta: s.smonta };
}

afterEach(() => {
  delete globale.__DATI_QUERY__;
  delete globale.__OPZIONI_QUERY__;
  delete globale.__CLIENT_SUPABASE__;
  document.body.innerHTML = '';
});

describe('R08-006 — se le email non arrivano, l’elenco lo dice', () => {
  it('con la RPC delle email caduta compare una riga che dice che le email mancano', async () => {
    const p = await paginaDopoLaLettura({ emailArrivano: false });
    expect(p.elenco.every((r) => !r.email), 'le righe dovrebbero essere senza email').toBe(true);
    expect(p.testo).toContain('Cliente 1');
    expect(
      p.testo,
      'le righe sono senza email e a schermo nessuno lo dice: sembra che quegli utenti non abbiano un’email',
    ).toContain('Le email degli utenti non sono arrivate');
    p.smonta();
  });

  it('con le email arrivate nessun avviso, e le email ci sono', async () => {
    const p = await paginaDopoLaLettura({ emailArrivano: true });
    expect(p.elenco.map((r) => r.email)).toEqual(['utente-1@piacenza.it', 'utente-2@piacenza.it', 'utente-3@piacenza.it']);
    expect(p.testo).not.toContain('Le email degli utenti non sono arrivate');
    p.smonta();
  });
});
