/**
 * @vitest-environment jsdom
 */
/**
 * Oltre mille iscritti la pagina utenti dell'amministrazione perdeva in silenzio email e ultimo
 * accesso: la RPC `admin_list_user_emails` si leggeva in una richiesta sola e PostgREST restituisce
 * al massimo `max_rows` righe (1000, supabase/config.toml), anche da una funzione.
 *
 * Qui si esegue la lettura vera dell'elenco (la `queryFn` della pagina) contro un database finto
 * che si comporta come PostgREST: senza finestra dà le prime mille righe, con `order`/`range` dà la
 * finestra chiesta, sempre al massimo mille. Gli utenti dell'elenco sono iscritti dopo i primi mille.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

const globale = globalThis as Record<string, unknown>;
type Riga = Record<string, unknown>;
type Opzioni = { queryKey?: unknown[]; queryFn?: () => Promise<unknown> };

const MAX_ROWS = 1000;
const ISCRITTI = 1500;
const iso = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 60_000).toISOString();

/** auth.users: 1500 righe, nell'ordine in cui il database le tiene (quello di iscrizione). */
const AUTH: Riga[] = Array.from({ length: ISCRITTI }, (_, i) => ({
  id: `u-${String(i).padStart(5, '0')}`,
  email: `u${i}@piacenza.it`,
  phone: null,
  last_sign_in_at: iso(i + 10_000),
  email_confirmed_at: iso(i),
  created_at: iso(i),
}));

/** I tre profili più recenti: le loro righe in auth.users stanno oltre le prime mille. */
const PROFILI: Riga[] = [ISCRITTI - 1, ISCRITTI - 2, ISCRITTI - 3].map((i) => ({
  id: AUTH[i].id, role: 'buyer', is_approved: true, approval_status: null, approval_requested_at: null,
  approved_at: null, rejection_reason: null, store_name: null, full_name: `Cliente ${i}`, phone: null,
  store_address: null, legal_first_name: null, legal_last_name: null, business_legal_name: null,
  business_form: null, business_address: null, business_city: null, business_pec: null,
  created_at: AUTH[i].created_at,
}));

/** La risposta di una RPC come la dà PostgREST: `order`, `range`, e mai più di `max_rows` righe. */
function rispostaPostgrest(righe: Riga[], cadeAllaPagina: number | null, chiamate: Array<[number, number] | null>) {
  let ordine: Array<[string, boolean]> = [];
  let finestra: [number, number] | null = null;
  const r: Record<string, unknown> = {
    order: (c: string, o?: { ascending?: boolean }) => { ordine.push([c, o?.ascending !== false]); return r; },
    range: (da: number, a: number) => { finestra = [da, a]; return r; },
    then: (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      chiamate.push(finestra);
      if (cadeAllaPagina !== null && chiamate.length - 1 === cadeAllaPagina) {
        return Promise.resolve({ data: null, error: { code: '57014', message: 'statement timeout' } }).then(ok, ko);
      }
      let dati = [...righe];
      for (const [c, su] of [...ordine].reverse()) {
        dati.sort((x, y) => String(x[c]).localeCompare(String(y[c])) * (su ? 1 : -1));
      }
      const [da, a] = finestra ?? [0, Number.MAX_SAFE_INTEGER];
      dati = dati.slice(da, a + 1).slice(0, MAX_ROWS);
      ordine = [];
      return Promise.resolve({ data: dati, error: null }).then(ok, ko);
    },
  };
  return r;
}

function databaseFinto(o: { cadeAllaPagina: number | null }) {
  const chiamate: Array<[number, number] | null> = [];
  return {
    chiamate,
    client: {
      from: () => {
        const q: Record<string, unknown> = {};
        Object.assign(q, {
          select: () => q, order: () => q, limit: () => q,
          then: (ok: (x: unknown) => unknown) => Promise.resolve({ data: PROFILI.map((p) => ({ ...p })), error: null }).then(ok),
        });
        return q;
      },
      rpc: (nome: string, argomenti?: unknown) => {
        if (nome !== 'admin_list_user_emails' || argomenti !== undefined) {
          return Promise.resolve({ data: null, error: { message: `rpc ${nome} non prevista` } });
        }
        return rispostaPostgrest(AUTH, o.cadeAllaPagina, chiamate);
      },
    },
  };
}

const eLElenco = (k: unknown[] | undefined) =>
  Array.isArray(k) && k.length === 3 && k[1] === 'users' && Object.keys((k[2] ?? {}) as Riga).length === 0;

function datiDellaPagina(elenco: unknown) {
  globale.__DATI_QUERY__ = (q: Opzioni) => {
    const filtri = ((q.queryKey ?? [])[2] ?? {}) as Riga;
    if (filtri.conteggio === 'totale') return ISCRITTI;
    if (typeof filtri.cerca === 'string') return undefined;
    return eLElenco(q.queryKey) ? elenco : undefined;
  };
}

async function paginaDopoLaLettura(o: { cadeAllaPagina: number | null }) {
  const db = databaseFinto(o);
  globale.__CLIENT_SUPABASE__ = db.client;
  globale.__OPZIONI_QUERY__ = [];
  datiDellaPagina([]);
  const mod = await monta('app/admin/users/page.tsx');
  const prima = accendi(mod.default as ComponentType);
  const lettura = (globale.__OPZIONI_QUERY__ as Opzioni[]).find((q) => eLElenco(q.queryKey));
  prima.smonta();
  expect(lettura?.queryFn, 'la lettura dell’elenco non si trova').toBeTypeOf('function');
  const elenco = (await lettura!.queryFn!()) as Array<Riga & { email?: string | null; last_sign_in_at?: string | null }>;
  datiDellaPagina(elenco);
  const s = accendi(mod.default as ComponentType);
  return { elenco, chiamate: db.chiamate, testo: s.radice.textContent ?? '', smonta: s.smonta };
}

afterEach(() => {
  delete globale.__DATI_QUERY__;
  delete globale.__OPZIONI_QUERY__;
  delete globale.__CLIENT_SUPABASE__;
  document.body.innerHTML = '';
});

describe('pagina utenti · oltre mille iscritti email e ultimo accesso arrivano a tutti', () => {
  it('i profili iscritti dopo i primi mille hanno la loro email e il loro ultimo accesso', async () => {
    const p = await paginaDopoLaLettura({ cadeAllaPagina: null });
    expect(p.elenco.map((r) => r.email)).toEqual([`u${ISCRITTI - 1}@piacenza.it`, `u${ISCRITTI - 2}@piacenza.it`, `u${ISCRITTI - 3}@piacenza.it`]);
    expect(p.elenco.map((r) => r.last_sign_in_at)).toEqual([iso(ISCRITTI - 1 + 10_000), iso(ISCRITTI - 2 + 10_000), iso(ISCRITTI - 3 + 10_000)]);
    expect(p.testo).not.toContain('Le email degli utenti non sono arrivate');
    // Nessuna richiesta chiede più righe di quante PostgREST ne dia.
    for (const f of p.chiamate) expect(f !== null && f[1] - f[0] + 1 <= MAX_ROWS).toBe(true);
    p.smonta();
  });

  it('se una pagina successiva cade, l’elenco dice che le email non sono arrivate invece di mostrarne metà', async () => {
    const p = await paginaDopoLaLettura({ cadeAllaPagina: 1 });
    expect(p.elenco.every((r) => !r.email)).toBe(true);
    expect(p.testo).toContain('Le email degli utenti non sono arrivate');
    p.smonta();
  });
});
