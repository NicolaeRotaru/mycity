/**
 * @vitest-environment jsdom
 */
/**
 * R08-003 — ogni ricerca nel pannello utenti rileggeva tutte le email degli
 * iscritti: la pagina chiamava la RPC admin senza argomenti (tutto auth.users)
 * e filtrava nel browser. Qui la pagina si monta davvero, si scrive nella
 * casella, e si esegue la lettura della ricerca contro un database finto che
 * risponde come la RPC: senza argomenti tutte le email, con il testo solo chi
 * corrisponde. La ricerca deve chiedere al database solo le corrispondenze, e
 * continuare a funzionare finché la migrazione non è applicata (PGRST202).
 * La prova SQL accanto (tests/sql/rls/riparazione-r08-…) prova la funzione e i
 * suoi permessi.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

const globale = globalThis as Record<string, unknown>;
type Riga = Record<string, unknown>;

function profilo(id: string, nome: string): Riga {
  return {
    id, role: 'buyer', is_approved: true, approval_status: null, approval_requested_at: null,
    approved_at: null, rejection_reason: null, store_name: null, full_name: nome, phone: null,
    store_address: null, legal_first_name: null, legal_last_name: null, business_legal_name: null,
    business_form: null, business_address: null, business_city: null, business_pec: null,
    created_at: '2026-02-01T09:00:00Z',
  };
}

/** Gli iscritti: in auth.users ci sono tutti, coi loro contatti. */
const PROFILI = [
  profilo('gabriella', 'Gabriella Bertorelli'),
  profilo('mario', 'Mario Rossi'),
  ...Array.from({ length: 40 }, (_, i) => profilo(`altro-${i}`, `Cliente ${i}`)),
];
const CONTATTI = PROFILI.map((p) => ({
  id: p.id as string,
  email: p.id === 'gabriella' ? 'gabriella@piacenza.it' : p.id === 'mario' ? 'mario.rossi@piacenza.it' : `cliente-${p.id}@piacenza.it`,
  phone: null, last_sign_in_at: null, email_confirmed_at: null,
}));

/** Le chiamate alla RPC delle email, come le fa la pagina. */
let chiamate: Array<{ nome: string; args: Riga | undefined }> = [];

/** Il database finto: `profiles` per nome e per id, e la RPC delle email nelle sue due forme. */
function databaseFinto(o: { ricercaNelDatabase: boolean }) {
  return {
    from: () => {
      let perNome: string | null = null;
      let perId: string[] | null = null;
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q, order: () => q, limit: () => q,
        or: (filtro: string) => {
          const m = /full_name\.ilike\.%([^%]*)%/.exec(filtro);
          perNome = (m?.[1] ?? '').toLowerCase();
          return q;
        },
        in: (_c: string, ids: string[]) => ((perId = ids), q),
        then: (ok: (x: unknown) => unknown) => {
          const righe = PROFILI.filter((p) =>
            perId ? perId.includes(p.id as string)
              : perNome !== null ? String(p.full_name).toLowerCase().includes(perNome) : true);
          return Promise.resolve({ data: righe, error: null }).then(ok);
        },
      });
      return q;
    },
    rpc: async (nome: string, args?: Riga) => {
      chiamate.push({ nome, args });
      if (nome !== 'admin_list_user_emails') return { data: null, error: { message: `rpc ${nome} non prevista` } };
      if (!args || Object.keys(args).length === 0) return { data: CONTATTI, error: null };
      if (!o.ricercaNelDatabase) {
        return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_list_user_emails(p_ids, p_termine)' } };
      }
      const t = String(args.p_termine ?? '').trim().toLowerCase();
      const ids = (args.p_ids as string[] | undefined) ?? [];
      return {
        data: CONTATTI.filter((c) => (t.length >= 2 && (c.email ?? '').toLowerCase().includes(t)) || ids.includes(c.id)),
        error: null,
      };
    },
  };
}

function scriviNelCampo(campo: HTMLInputElement, valore: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(campo, valore);
  campo.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/** Monta la pagina, scrive nella casella e restituisce la lettura della ricerca, pronta da eseguire. */
async function letturaDellaRicerca(testo: string) {
  globale.__OPZIONI_QUERY__ = [];
  globale.__DATI_QUERY__ = (q: { queryKey?: unknown[] }) => {
    const filtri = ((q.queryKey ?? [])[2] ?? {}) as Riga;
    if (filtri.conteggio === 'totale') return PROFILI.length;
    if (typeof filtri.cerca === 'string') return undefined;
    return [];
  };
  const mod = await monta('app/admin/users/page.tsx');
  const s = accendi(mod.default as ComponentType);
  const casella = s.radice.querySelector('input[type="search"]') as HTMLInputElement;
  expect(casella, 'la casella di ricerca non è a video').toBeTruthy();
  s.agisci(() => scriviNelCampo(casella, testo));
  await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
  const opzioni = (globale.__OPZIONI_QUERY__ as Array<{ queryKey?: unknown[]; enabled?: boolean; queryFn?: () => Promise<unknown> }>)
    .filter((q) => ((q.queryKey ?? [])[2] as Riga | undefined)?.cerca === testo && q.enabled !== false);
  const ultima = opzioni[opzioni.length - 1];
  expect(ultima?.queryFn, 'la lettura della ricerca non è partita').toBeTypeOf('function');
  s.smonta();
  return ultima!.queryFn as () => Promise<{ righe: Array<Riga & { email?: string | null }>; troncato: boolean }>;
}

afterEach(() => {
  delete globale.__OPZIONI_QUERY__;
  delete globale.__DATI_QUERY__;
  delete globale.__CLIENT_SUPABASE__;
  chiamate = [];
  document.body.innerHTML = '';
});

describe('R08-003 — la ricerca per email la fa il database', () => {
  it('cercando un’email la pagina non chiede più tutte le email degli iscritti', async () => {
    globale.__CLIENT_SUPABASE__ = databaseFinto({ ricercaNelDatabase: true });
    const leggi = await letturaDellaRicerca('gabriella@piacenza.it');
    const esito = await leggi();

    const tutte = chiamate.filter((c) => !c.args || c.args.p_termine === undefined);
    expect(
      tutte.length,
      'la ricerca chiama ancora la RPC senza testo: a ogni ricerca arrivano nel browser le email di tutti gli iscritti',
    ).toBe(0);
    expect(chiamate.some((c) => c.args?.p_termine === 'gabriella@piacenza.it')).toBe(true);
    expect(esito.righe.map((r) => r.id)).toEqual(['gabriella']);
    expect(esito.righe[0].email).toBe('gabriella@piacenza.it');
  });

  it('chi è trovato per nome ha comunque la sua email accanto', async () => {
    globale.__CLIENT_SUPABASE__ = databaseFinto({ ricercaNelDatabase: true });
    const leggi = await letturaDellaRicerca('Rossi');
    const esito = await leggi();
    expect(esito.righe.find((r) => r.id === 'mario')?.email).toBe('mario.rossi@piacenza.it');
    expect(chiamate.filter((c) => !c.args || c.args.p_termine === undefined)).toEqual([]);
  });

  it('finché la migrazione non è applicata (PGRST202) la ricerca per email funziona come prima', async () => {
    globale.__CLIENT_SUPABASE__ = databaseFinto({ ricercaNelDatabase: false });
    const leggi = await letturaDellaRicerca('gabriella@piacenza.it');
    const esito = await leggi();
    expect(esito.righe.map((r) => r.id)).toEqual(['gabriella']);
    expect(esito.righe[0].email).toBe('gabriella@piacenza.it');
  });
});
