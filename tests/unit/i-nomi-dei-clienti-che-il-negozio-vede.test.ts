/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';
import { DOPO_LA_161, PROFILI_CHIUSI_VISTA_VECCHIA, type Mondo } from './aiuti/database-coi-permessi';
import { databaseDegliOrdini, type DatiOrdini } from './aiuti/database-degli-ordini-coi-permessi';

/**
 * 31/10/2026 (seconda ondata del sito, migrazione 181) — I NOMI DEI CLIENTI CHE IL NEGOZIO VEDE.
 *
 * La 161 e' applicata in produzione: `profiles` si legge solo per la propria riga. Quattro guasti
 * nati da li', provati montando le pagine vere contro un database finto che applica le regole di chi
 * guarda (i due mondi chiusi di `database-coi-permessi`):
 *  ① in chat il negoziante leggeva «Utente» al posto di ogni cliente (elenco e conversazione);
 *  ② la pagina delle recensioni del negozio chiedeva un collegamento che non esiste
 *    (`profiles!store_reviews_reviewer_id_fkey`) e andava sempre in errore;
 *  ③ la pagina Clienti diceva «Cliente» a ogni riga e la ricerca per nome non trovava nessuno;
 *  ④ con la vetrina dei negozi giu', il cliente leggeva «Utente» al posto di ogni negozio, senza un
 *    segno che il nome non era stato letto.
 * Il nome del cliente lo da' la funzione della 181 (`nomi_dei_clienti_del_negozio`): qui la si
 * simula con la stessa regola scritta nella migrazione — solo id e nome, solo per chi il negozio ha
 * gia' davanti (chat, ordini, recensioni). Senza la 181 le pagine devono restare in piedi.
 */
const reteDiPrima = globalThis.fetch;
vi.stubGlobal('fetch', (async (input: unknown, opzioni?: RequestInit) =>
  String(input) === '/api/support/conversation'
    ? new Response(JSON.stringify({ supportId: null }), { status: 200 })
    : reteDiPrima(input as RequestInfo, opzioni)) as typeof fetch);

const PANE = 'n-pane';
const SALUMI = 'n-salumi';
const MARIA = 'u-maria';
const GIULIA = 'u-giulia';
const ESTRANEO = 'u-estraneo';
const CONV_MARIA = 'dddddddd-4444-4444-8444-dddddddddddd';
const CONV_GIULIA = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const CONV_SALUMI = 'ffffffff-6666-4666-8666-ffffffffffff';

function dati(): DatiOrdini {
  return {
    profiles: [
      { id: PANE, role: 'seller', is_approved: true, approval_status: 'approved', store_name: 'Pane Quotidiano', full_name: 'Giovanni Forno' },
      { id: SALUMI, role: 'seller', is_approved: true, approval_status: 'approved', store_name: 'Salumeria Due', full_name: 'Paolo Salumi' },
      { id: MARIA, role: 'buyer', is_approved: false, store_name: null, full_name: 'Maria Rossi', billing_iban: 'IT60X0542811101000000123456' },
      { id: GIULIA, role: 'buyer', is_approved: false, store_name: null, full_name: 'Giulia Bianchi' },
      { id: ESTRANEO, role: 'buyer', is_approved: false, store_name: null, full_name: 'Carlo Estraneo' },
    ],
    conversations: [
      {
        id: CONV_MARIA, buyer_id: MARIA, seller_id: PANE, last_message_at: '2026-10-30T09:00:00Z',
        last_message_preview: 'A che ora chiudete?', buyer_unread_count: 0, seller_unread_count: 1,
      },
      {
        id: CONV_GIULIA, buyer_id: GIULIA, seller_id: PANE, last_message_at: '2026-10-29T18:00:00Z',
        last_message_preview: 'Avete la focaccia senza sale?', buyer_unread_count: 0, seller_unread_count: 0,
      },
      {
        id: CONV_SALUMI, buyer_id: MARIA, seller_id: SALUMI, last_message_at: '2026-10-28T18:00:00Z',
        last_message_preview: 'Avete la coppa stagionata?', buyer_unread_count: 0, seller_unread_count: 0,
      },
    ],
    messages: [
      { id: 'm1', conversation_id: CONV_MARIA, sender_id: MARIA, body: 'A che ora chiudete?', created_at: '2026-10-30T09:00:00Z', read_at: null },
    ],
    orders: [
      { id: 'o1', user_id: MARIA, seller_id: PANE, total_price: 24, created_at: '2026-10-20T10:00:00Z', delivery_full_name: 'Maria Rossi' },
      { id: 'o2', user_id: GIULIA, seller_id: PANE, total_price: 12, created_at: '2026-10-21T10:00:00Z', delivery_full_name: 'Giulia Bianchi' },
      { id: 'o3', user_id: ESTRANEO, seller_id: SALUMI, total_price: 9, created_at: '2026-10-22T10:00:00Z', delivery_full_name: 'Carlo Estraneo' },
    ],
    store_reviews: [
      {
        id: 'r1', store_id: PANE, user_id: MARIA, order_id: 'o1', rating: 5, comment: 'Focaccia ancora calda',
        created_at: '2026-10-21T08:00:00Z', seller_reply: null, seller_reply_at: null,
      },
      {
        id: 'r2', store_id: SALUMI, user_id: ESTRANEO, order_id: 'o3', rating: 2, comment: 'Coppa troppo salata',
        created_at: '2026-10-23T08:00:00Z', seller_reply: null, seller_reply_at: null,
      },
    ],
  };
}

/** La funzione della 181, con la stessa regola della migrazione. Senza la 181 la funzione non c'e'. */
function client(d: DatiOrdini, mondo: Mondo, chi: string | null, opzioni: { con181: boolean; vistaGiu?: boolean }) {
  const base = databaseDegliOrdini(d, mondo, chi, { vistaGiu: opzioni.vistaGiu }).client;
  const davanti = (id: unknown) =>
    chi !== null && (
      (d.conversations ?? []).some((c) => c.seller_id === chi && c.buyer_id === id)
      || (d.orders ?? []).some((o) => o.seller_id === chi && o.user_id === id)
      || (d.store_reviews ?? []).some((r) => r.store_id === chi && r.user_id === id)
    );
  // L'ascolto in tempo reale delle pagine dei messaggi: qui non arriva niente, ma si apre e si chiude
  // senza errori, cosi' nel registro della prova restano solo i guasti veri.
  const canale: Record<string, unknown> = {};
  Object.assign(canale, { on: () => canale, subscribe: () => canale, unsubscribe: async () => 'ok' });
  return {
    ...base,
    channel: () => canale,
    removeChannel: async () => 'ok',
    rpc: async (nome: string, argomenti: Record<string, unknown> = {}) => {
      if (nome !== 'nomi_dei_clienti_del_negozio' || !opzioni.con181) return base.rpc(nome);
      const ids = (argomenti.p_ids as unknown[]) ?? [];
      const righe = (d.profiles ?? [])
        .filter((p) => ids.includes(p.id) && p.id !== chi && davanti(p.id))
        .map((p) => ({ id: p.id, full_name: (p.full_name as string | null) ?? null }));
      return { data: righe, error: null };
    },
  };
}

const globale = globalThis as Record<string, unknown>;
type Opzioni = { queryKey: readonly unknown[]; queryFn?: (c: unknown) => Promise<unknown>; enabled?: boolean };

/** Monta la pagina, esegue le letture che la pagina stessa chiede e la rimonta con le risposte. */
async function aSchermo(
  file: string,
  props: Record<string, unknown>,
  mondo: Mondo,
  chi: string,
  opzioni: { con181: boolean; vistaGiu?: boolean },
) {
  const pagina = (await monta(file)).default;
  globale.__CLIENT_SUPABASE__ = client(dati(), mondo, chi, opzioni);
  globale.__UTENTE__ = { id: chi };
  globale.__PROFILO__ = {
    isAuthenticated: true,
    isSeller: chi === PANE || chi === SALUMI,
    profile: { id: chi, full_name: 'Chi guarda', store_name: chi === PANE ? 'Pane Quotidiano' : null },
  };
  const risposte = new Map<string, unknown>();
  const errori = new Map<string, string>();
  const chieste = new Map<string, Opzioni>();
  globale.__DATI_QUERY__ = (o: Opzioni) => {
    const k = JSON.stringify(o.queryKey);
    if (o.enabled !== false && o.queryFn && !risposte.has(k) && !errori.has(k)) chieste.set(k, o);
    return risposte.get(k);
  };
  globale.__ESITO_QUERY__ = (o: Opzioni) => {
    const k = JSON.stringify(o.queryKey);
    return errori.has(k) ? { isError: true, isSuccess: false, data: undefined, error: new Error(errori.get(k)) } : undefined;
  };
  for (let giro = 0; giro < 5; giro += 1) {
    const s = accendi(pagina, props);
    await attendi();
    await attendi();
    s.smonta();
    const nuove = [...chieste.entries()].filter(([k]) => !risposte.has(k) && !errori.has(k));
    if (nuove.length === 0) break;
    for (const [k, o] of nuove) {
      try {
        risposte.set(k, await o.queryFn!({ queryKey: o.queryKey, meta: undefined }));
      } catch (e) {
        errori.set(k, e instanceof Error ? e.message : JSON.stringify(e));
      }
    }
  }
  const s = accendi(pagina, props);
  await attendi();
  await attendi();
  return { s, errori };
}

async function attendiFinche(s: ReturnType<typeof accendi>, condizione: () => boolean) {
  for (let i = 0; i < 40 && !condizione(); i += 1) await attendi();
  return testoVisibile(s.radice);
}

/** La riga piu' stretta che contiene l'anteprima: il nome dentro deve essere quello della SUA conversazione. */
function riga(s: ReturnType<typeof accendi>, anteprima: string): string {
  const nodi = Array.from(s.radice.querySelectorAll('a, li, button, tr')).filter((n) => (n.textContent ?? '').includes(anteprima));
  return nodi.sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length)[0]?.textContent ?? '';
}

const MONDI: Array<[string, Mondo]> = [
  ['dopo la 161 (produzione)', DOPO_LA_161],
  ['profili chiusi e vista senza la 126', PROFILI_CHIUSI_VISTA_VECCHIA],
];

afterEach(() => {
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__', '__DATI_QUERY__', '__ESITO_QUERY__', '__PROFILO__']) delete globale[k];
  document.body.innerHTML = '';
});

describe('① in chat il negozio legge il nome di ogni cliente', () => {
  it.each(MONDI)('elenco: ogni conversazione porta il nome del SUO cliente — %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/messages/page.tsx', {}, mondo, PANE, { con181: true });
    expect(errori.size, [...errori.values()].join(' · ')).toBe(0);
    const testo = await attendiFinche(s, () => (s.radice.textContent ?? '').includes('A che ora chiudete?'));
    expect(testo, 'l elenco delle conversazioni non si e disegnato').toContain('Avete la focaccia senza sale?');
    expect(testo).not.toContain('Utente');
    const diMaria = riga(s, 'A che ora chiudete?');
    const diGiulia = riga(s, 'Avete la focaccia senza sale?');
    expect(diMaria, 'la conversazione di Maria non porta il suo nome').toContain('Maria Rossi');
    expect(diMaria).not.toContain('Giulia Bianchi');
    expect(diGiulia, 'la conversazione di Giulia non porta il suo nome').toContain('Giulia Bianchi');
    expect(diGiulia).not.toContain('Maria Rossi');
    s.smonta();
  }, 60000);

  it.each(MONDI)('conversazione: in testa c e il nome del cliente — %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/messages/[id]/page.tsx', { params: { id: CONV_MARIA } }, mondo, PANE, { con181: true });
    expect(errori.size, [...errori.values()].join(' · ')).toBe(0);
    await attendiFinche(s, () => !!s.radice.querySelector('h2'));
    expect(s.radice.querySelector('h2')?.textContent, 'in testa alla chat non c e il cliente').toBe('Maria Rossi');
    s.smonta();
  }, 60000);

  it.each(MONDI)('senza la 181 la chat resta in piedi e dice «Cliente», non «Utente» — %s', async (_n, mondo) => {
    const elenco = await aSchermo('app/messages/page.tsx', {}, mondo, PANE, { con181: false });
    expect(elenco.errori.size, [...elenco.errori.values()].join(' · ')).toBe(0);
    const testo = await attendiFinche(elenco.s, () => (elenco.s.radice.textContent ?? '').includes('A che ora chiudete?'));
    expect(riga(elenco.s, 'A che ora chiudete?')).toContain('Cliente');
    expect(testo).not.toContain('Utente');
    elenco.s.smonta();
    const una = await aSchermo('app/messages/[id]/page.tsx', { params: { id: CONV_MARIA } }, mondo, PANE, { con181: false });
    await attendiFinche(una.s, () => !!una.s.radice.querySelector('h2'));
    expect(una.s.radice.querySelector('h2')?.textContent).toBe('Cliente');
    una.s.smonta();
  }, 60000);
});

describe('② le recensioni del negozio si aprono', () => {
  it.each(MONDI)('il negoziante vede la recensione e chi l ha scritta — %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/seller/reviews/page.tsx', {}, mondo, PANE, { con181: true });
    expect(errori.get(JSON.stringify(['seller', 'reviews'])), 'la lettura delle recensioni e caduta').toBeUndefined();
    const testo = await attendiFinche(s, () => (s.radice.textContent ?? '').includes('Focaccia ancora calda'));
    expect(testo, 'la recensione non e a schermo').toContain('Focaccia ancora calda');
    expect(testo, 'manca il nome di chi ha scritto').toContain('Maria Rossi');
    // Solo le recensioni del SUO negozio, e nessun nome di estranei.
    expect(testo).not.toContain('Coppa troppo salata');
    expect(testo).not.toContain('Carlo Estraneo');
    s.smonta();
  }, 60000);

  it.each(MONDI)('senza la 181 la recensione resta leggibile, firmata «Cliente» — %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/seller/reviews/page.tsx', {}, mondo, PANE, { con181: false });
    expect(errori.get(JSON.stringify(['seller', 'reviews'])), 'la lettura delle recensioni e caduta').toBeUndefined();
    const testo = await attendiFinche(s, () => (s.radice.textContent ?? '').includes('Focaccia ancora calda'));
    expect(testo).toContain('Focaccia ancora calda');
    expect(testo).toContain('Cliente');
    s.smonta();
  }, 60000);
});

describe('③ la pagina Clienti dice chi sono i clienti, e la ricerca per nome li trova', () => {
  it.each(MONDI)('ogni riga porta il nome, la ricerca «giulia» trova Giulia — %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/seller/customers/page.tsx', {}, mondo, PANE, { con181: false });
    expect(errori.size, [...errori.values()].join(' · ')).toBe(0);
    const testo = await attendiFinche(s, () => (s.radice.textContent ?? '').includes('Maria Rossi'));
    expect(testo, 'la pagina non dice il nome del cliente').toContain('Maria Rossi');
    expect(testo).toContain('Giulia Bianchi');
    expect(testo).not.toContain('Carlo Estraneo');
    const campo = s.radice.querySelector('input') as HTMLInputElement | null;
    expect(campo, 'manca il campo di ricerca').toBeTruthy();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(campo, 'giulia');
    campo!.dispatchEvent(new Event('input', { bubbles: true }));
    await attendi();
    await attendi();
    const dopo = testoVisibile(s.radice);
    expect(dopo, 'la ricerca per nome non trova Giulia').toContain('Giulia Bianchi');
    expect(dopo).not.toContain('Maria Rossi');
    s.smonta();
  }, 60000);
});

describe('④ con la vetrina giu, il cliente capisce che il nome del negozio non e stato letto', () => {
  it.each(MONDI)('elenco: ogni riga dice «Nome non disponibile», non «Utente» — %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/messages/page.tsx', {}, mondo, MARIA, { con181: true, vistaGiu: true });
    expect(errori.size, [...errori.values()].join(' · ')).toBe(0);
    const testo = await attendiFinche(s, () => (s.radice.textContent ?? '').includes('Nome non disponibile'));
    expect(testo, 'un guasto della sola vista ha spento l elenco').toContain('A che ora chiudete?');
    expect(riga(s, 'A che ora chiudete?')).toContain('Nome non disponibile');
    expect(riga(s, 'Avete la coppa stagionata?')).toContain('Nome non disponibile');
    expect(testo).not.toContain('Utente');
    s.smonta();
  }, 60000);

  it.each(MONDI)('conversazione: la testata dice «Nome non disponibile» — %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/messages/[id]/page.tsx', { params: { id: CONV_MARIA } }, mondo, MARIA, { con181: true, vistaGiu: true });
    expect(errori.size, [...errori.values()].join(' · ')).toBe(0);
    await attendiFinche(s, () => (s.radice.querySelector('h2')?.textContent ?? '') === 'Nome non disponibile');
    expect(s.radice.querySelector('h2')?.textContent).toBe('Nome non disponibile');
    s.smonta();
  }, 60000);
});
