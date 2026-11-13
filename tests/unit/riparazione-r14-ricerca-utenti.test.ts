// @vitest-environment jsdom
/**
 * R14-001 (13/11/2026) — LA RICERCA UTENTI E LE EMAIL CHE NON ARRIVAVANO.
 *
 * Le email non stanno in `profiles`: arrivano da auth.users con la RPC admin
 * della migrazione 074. La pagina /admin/users aveva due difetti su quella
 * lettura, tutti e due silenziosi:
 *   ① se la RPC andava in errore la pagina la trattava come «nessuna email», e
 *      la ricerca rispondeva «Nessun utente corrisponde… Ho cercato su tutti gli
 *      utenti registrati» senza aver guardato nessuna email. È la risposta che
 *      si dà a chi chiede di cancellare i suoi dati: «non sei iscritto»;
 *   ② la RPC passa da PostgREST, che non rende mai più di mille righe per
 *      richiesta: dal milleunesimo iscritto in poi l'email non si trovava (né
 *      nella ricerca né nel file CSV), sempre senza dirlo.
 *
 * Qui la pagina VERA gira con react-query vero e un servizio dati finto che si
 * comporta come PostgREST: tetto di mille righe, `.order()`, `.range()`, e una
 * RPC che può cadere.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Riga = Record<string, unknown>;

const stato = vi.hoisted(() => {
  const TETTO_POSTGREST = 1000;
  const s = {
    profili: [] as Record<string, unknown>[],
    contatti: [] as Record<string, unknown>[],
    emailRotte: false,
    toast: { success: [] as string[], error: [] as string[], warning: [] as string[] },
    fileScritti: [] as string[],
  };

  const confronta = (a: unknown, b: unknown) => {
    const x = String(a ?? '');
    const y = String(b ?? '');
    return x === y ? 0 : x < y ? -1 : 1;
  };
  type Ordine = { colonna: string; crescente: boolean };
  const ordina = (righe: Record<string, unknown>[], ordini: Ordine[]) => {
    let fuori = [...righe];
    for (const o of [...ordini].reverse()) {
      fuori = [...fuori].sort((a, b) => (o.crescente ? 1 : -1) * confronta(a[o.colonna], b[o.colonna]));
    }
    return fuori;
  };

  /** Una tabella come la serve PostgREST: filtri, ordine, finestra, e mai più di mille righe. */
  function from(tabella: string) {
    const filtri: Array<(r: Record<string, unknown>) => boolean> = [];
    const ordini: Ordine[] = [];
    let finestra: [number, number] | null = null;
    let tetto: number | null = null;
    let conteggio = false;
    let soloTesta = false;
    const q = {
      select(_colonne?: string, o?: { count?: string; head?: boolean }) {
        conteggio = o?.count === 'exact';
        soloTesta = !!o?.head;
        return q;
      },
      eq(c: string, v: unknown) { filtri.push((r) => r[c] === v); return q; },
      in(c: string, vs: readonly unknown[]) { filtri.push((r) => vs.includes(r[c])); return q; },
      // `col.ilike.%testo%,col2.ilike.%testo%`: basta che una colonna contenga il testo.
      or(espressione: string) {
        const condizioni = espressione.split(',').map((pezzo) => {
          const [colonna, , ...resto] = pezzo.split('.');
          return { colonna, testo: resto.join('.').replace(/^%|%$/g, '').toLowerCase() };
        });
        filtri.push((r) => condizioni.some((c) => String(r[c.colonna] ?? '').toLowerCase().includes(c.testo)));
        return q;
      },
      order(c: string, o?: { ascending?: boolean }) { ordini.push({ colonna: c, crescente: o?.ascending !== false }); return q; },
      limit(n: number) { tetto = n; return q; },
      range(da: number, a: number) { finestra = [da, a]; return q; },
      then<T>(ok: (v: unknown) => T, ko?: (e: unknown) => unknown) {
        let righe = ordina((tabella === 'profiles' ? s.profili : []).filter((r) => filtri.every((f) => f(r))), ordini);
        const totale = righe.length;
        if (finestra) righe = righe.slice(finestra[0], finestra[1] + 1);
        if (tetto != null) righe = righe.slice(0, tetto);
        righe = righe.slice(0, TETTO_POSTGREST);
        return Promise.resolve({ data: soloTesta ? null : righe, error: null, ...(conteggio ? { count: totale } : {}) }).then(ok, ko);
      },
    };
    return q;
  }

  /**
   * La RPC delle email (migrazione 074): senza `.range()` rende le prime mille
   * righe nell'ordine in cui stanno, come il servizio vero; e può cadere.
   */
  function rpc(nome: string) {
    const ordini: Ordine[] = [];
    let finestra: [number, number] | null = null;
    const b = {
      order(c: string, o?: { ascending?: boolean }) { ordini.push({ colonna: c, crescente: o?.ascending !== false }); return b; },
      range(da: number, a: number) { finestra = [da, a]; return b; },
      then<T>(ok: (v: unknown) => T, ko?: (e: unknown) => unknown) {
        if (nome !== 'admin_list_user_emails') {
          return Promise.resolve({ data: null, error: { code: 'PGRST202', message: `funzione ${nome} sconosciuta` } }).then(ok, ko);
        }
        if (s.emailRotte) {
          return Promise.resolve({ data: null, error: { code: 'XX000', message: 'il servizio dati non ha risposto' } }).then(ok, ko);
        }
        let righe = ordina(s.contatti, ordini);
        if (finestra) righe = righe.slice(finestra[0], finestra[1] + 1);
        return Promise.resolve({ data: righe.slice(0, TETTO_POSTGREST), error: null }).then(ok, ko);
      },
    };
    return b;
  }

  return { s, client: { from, rpc } };
});

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({
  toast: {
    success: (m: string) => { stato.s.toast.success.push(String(m)); },
    error: (m: string) => { stato.s.toast.error.push(String(m)); },
    warning: (m: string) => { stato.s.toast.warning.push(String(m)); },
  },
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) => stato.client.from(t),
    rpc: (nome: string) => stato.client.rpc(nome),
    auth: {
      getUser: async () => ({ data: { user: { id: 'admin-1' } }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  },
}));

import AdminUsersPage from '@/app/admin/users/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ISCRITTI = 1500;
const EMAIL_CERCATA = 'gabriella.bertorelli@piacenza.it';

/**
 * Millecinquecento iscritti. L'ultimo, in ordine di identificativo e di
 * iscrizione, è la signora che si cerca: fuori dai cinquecento che la pagina
 * si porta in casa e fuori dalle prime mille righe della RPC.
 */
function popola(): void {
  const profili: Riga[] = [];
  const contatti: Riga[] = [];
  for (let n = 1; n <= ISCRITTI; n++) {
    const id = `u-${String(n).padStart(4, '0')}`;
    const lei = n === ISCRITTI;
    profili.push({
      id, role: 'buyer', is_approved: true, approval_status: null,
      approval_requested_at: null, approved_at: null, rejection_reason: null,
      store_name: null, full_name: lei ? 'Gabriella Bertorelli' : `Cliente ${n}`,
      phone: null, store_address: null, legal_first_name: null, legal_last_name: null,
      business_legal_name: null, business_form: null, business_address: null,
      business_city: null, business_pec: null,
      // Più è alto il numero, più è vecchia l'iscrizione.
      created_at: new Date(Date.UTC(2026, 9, 1) - n * 3_600_000).toISOString(),
    });
    contatti.push({
      id, email: lei ? EMAIL_CERCATA : `cliente${n}@piacenza.it`, phone: null,
      last_sign_in_at: null, email_confirmed_at: null,
    });
  }
  stato.s.profili = profili;
  stato.s.contatti = contatti;
}

let root: Root | null = null;
let contenitore: HTMLDivElement | null = null;
const testo = () => contenitore?.textContent ?? '';

async function attendi(condizione: () => boolean, ms = 8000): Promise<boolean> {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    if (condizione()) return true;
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
  return condizione();
}

async function apriLaPagina(): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  root = createRoot(contenitore);
  await act(async () => {
    root!.render(createElement(QueryClientProvider, { client }, createElement(AdminUsersPage)));
  });
  const pronta = await attendi(() => !!contenitore?.querySelector('input[type="search"]') && testo().includes('Cliente 500'));
  expect(pronta, `la pagina non si è aperta: la prova girerebbe a vuoto (${testo().slice(0, 300)})`).toBe(true);
}

async function cerca(parola: string): Promise<void> {
  const casella = contenitore!.querySelector('input[type="search"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(casella, parola);
    casella.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // La casella aspetta 300 ms, poi la domanda parte: si aspetta che la risposta (o l'errore) arrivi.
  await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
  await attendi(() => !testo().includes('Sto cercando'));
}

async function esporta(): Promise<void> {
  const bottone = Array.from(contenitore!.querySelectorAll('button')).find((b) => b.textContent?.includes('Esporta CSV'));
  expect(bottone, 'il pulsante Esporta CSV non è a video').toBeTruthy();
  await act(async () => { bottone!.click(); });
  await attendi(() => stato.s.toast.success.length + stato.s.toast.error.length + stato.s.toast.warning.length > 0);
}

beforeEach(() => {
  popola();
  stato.s.emailRotte = false;
  stato.s.toast = { success: [], error: [], warning: [] };
  stato.s.fileScritti = [];
  const BlobVero = globalThis.Blob;
  vi.stubGlobal('Blob', class extends BlobVero {
    constructor(parti: BlobPart[], opzioni?: BlobPropertyBag) {
      super(parti, opzioni);
      stato.s.fileScritti.push(parti.map(String).join(''));
    }
  });
  Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:prova', configurable: true, writable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true, writable: true });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  contenitore?.remove();
  root = null;
  contenitore = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('R14-001 · se la lettura delle email cade, la ricerca non dice «nessuno, ho cercato su tutti»', () => {
  it('RPC delle email in errore: niente «Ho cercato su tutti», e si dice che non vuol dire che non esista', async () => {
    stato.s.emailRotte = true;
    await apriLaPagina();
    await cerca(EMAIL_CERCATA);

    const t = testo();
    expect(
      t,
      'la lettura delle email è caduta e la pagina dichiara lo stesso di aver cercato su tutti: è il «non sei iscritto» sbagliato',
    ).not.toContain('Ho cercato su tutti');
    expect(t).not.toContain('cercati su tutti gli utenti');
    expect(t, 'chi guarda deve sapere che questo vuoto NON vuol dire «non iscritto»').toContain('NON vuol dire che quella persona non esista');
  }, 30_000);

  it('RPC delle email in errore: il file CSV non esce con la colonna Email vuota spacciata per completa', async () => {
    stato.s.emailRotte = true;
    await apriLaPagina();
    await esporta();

    expect(stato.s.fileScritti, 'è uscito un file con tutte le email vuote, senza una riga che lo dica').toHaveLength(0);
    expect(stato.s.toast.success).toHaveLength(0);
    expect(stato.s.toast.error.join(' '), 'chi esporta deve sapere che sono le email a non essere arrivate').toMatch(/email/i);
  }, 30_000);
});

describe('R14-001 · oltre mille iscritti l’email si trova', () => {
  it('l’email del millecinquecentesimo iscritto si trova con la ricerca', async () => {
    await apriLaPagina();
    expect(testo()).not.toContain('Gabriella Bertorelli');
    await cerca(EMAIL_CERCATA);

    const t = testo();
    expect(
      t,
      'la RPC delle email rende al massimo mille righe: senza leggere a finestre la signora non esiste per la ricerca',
    ).toContain('Gabriella Bertorelli');
    expect(t).toContain(EMAIL_CERCATA);
    expect(t).toContain('cercati su tutti gli utenti');
  }, 30_000);

  it('nel file CSV di tutti gli iscritti c’è anche l’email del millecinquecentesimo', async () => {
    await apriLaPagina();
    await esporta();

    expect(stato.s.fileScritti).toHaveLength(1);
    const file = stato.s.fileScritti[0];
    expect(file.split(/\r?\n/).filter((r) => /^"?u-\d{4}/.test(r)), 'il file deve avere tutti gli iscritti').toHaveLength(ISCRITTI);
    expect(file, 'la riga c’è ma l’email è vuota: è il tetto delle mille righe, in silenzio').toContain(EMAIL_CERCATA);
    expect(stato.s.toast.success.join(' ')).toContain(String(ISCRITTI));
  }, 30_000);
});
