/**
 * @vitest-environment jsdom
 */

/**
 * 25/10/2026 (scheda 1360) — COSA LEGGE IL CLIENTE SULLO SCHERMO.
 *
 * La logica la prova `la-chat-con-l-assistenza-si-chiama-assistenza-mycity.test.ts`.
 * Qui si montano le due pagine vere: l'elenco /messages e il filo /messages/[id].
 * Prima la riga diceva «Utente» e la testata «Utente · Negozio». Adesso devono dire
 * «Assistenza MyCity» e «Account ufficiale di MyCity»; un negozio vero resta «Negozio»;
 * e mentre la pagina sta ancora chiedendo chi è l'Assistenza non deve comparire «Utente».
 *
 * Il React Query qui è finto: non calcola stati, li mette la prova. Che gli stati usati
 * (in lettura, un tentativo fallito, errore) siano quelli del React Query vero l'ha
 * controllato a mano il collaudo del 25/10, non questa prova.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;

const CON_ASSISTENZA = {
  id: 'c1',
  buyer_id: 'u1',
  seller_id: 'adm',
  last_message_at: new Date().toISOString(),
  last_message_preview: 'Il mio ordine?',
  buyer_unread_count: 0,
  seller_unread_count: 0,
  buyer: { id: 'u1', full_name: 'Marta', store_name: null },
  seller: null,
  insegna: null,
};
const CON_NEGOZIO = { ...CON_ASSISTENZA, id: 'c2', seller_id: 'pane', insegna: 'Pane Quotidiano' };
const IMPOSTORE = { ...CON_ASSISTENZA, id: 'c3', seller_id: 'furbo', insegna: 'Assistenza MyCity', last_message_preview: 'Offerta!' };

// La chiave giusta, per l'utente giusto: una pagina che chiedesse con un uid sbagliato non riceve l'id.
const eIdAssistenza = (k: unknown[]) => k.length === 2 && k[0] === 'support-account' && k[1] === 'u1';
const eMessaggi = (k: unknown[]) => k.length === 2 && k[0] === 'messages';

type Opzioni = { queryKey: unknown[]; enabled?: boolean; queryFn?: (c: { signal: AbortSignal }) => unknown; staleTime?: unknown };
const opzioniAssistenza = () =>
  (globali.__OPZIONI_QUERY__ as Opzioni[]).filter((o) => o.queryKey[0] === 'support-account').at(-1);

async function apriElenco() {
  const mod = await monta('app/messages/page.tsx');
  const s = accendi(mod.default);
  await attendi();
  await attendi();
  return s;
}

async function apriFilo() {
  const mod = await monta('app/messages/[id]/page.tsx');
  const s = accendi(mod.default, { params: { id: 'c1' } });
  await attendi();
  await attendi();
  return s;
}

/** Il testo che si VEDE (senza le parti solo per il lettore di schermo). */
function visibile(el: Element | null) {
  if (!el) return '';
  const copia = el.cloneNode(true) as Element;
  copia.querySelectorAll('.sr-only').forEach((n) => n.remove());
  return (copia.textContent ?? '').trim();
}

function testata(s: { radice: HTMLElement }) {
  return {
    nome: visibile(s.radice.querySelector('h2')),
    sotto: (s.radice.querySelector('h2 + p')?.textContent ?? '').trim(),
  };
}

beforeEach(() => {
  globali.__UTENTE__ = { id: 'u1', email: 'm@p.it' };
  globali.__ESITO_QUERY__ = undefined;
  globali.__OPZIONI_QUERY__ = [];
});

afterEach(() => {
  document.body.innerHTML = '';
  globali.__UTENTE__ = undefined;
  globali.__DATI_QUERY__ = undefined;
  globali.__ESITO_QUERY__ = undefined;
  globali.__OPZIONI_QUERY__ = undefined;
});

describe('la chat con l\'Assistenza, a video', () => {
  it('IL CASO CHE ROMPEVA — nell\'elenco la riga dice «Assistenza MyCity», non «Utente»', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (eIdAssistenza(o.queryKey) ? 'adm' : [CON_ASSISTENZA, CON_NEGOZIO]);
    const s = await apriElenco();
    const testo = s.radice.textContent ?? '';
    expect(testo).toContain('Assistenza MyCity');
    expect(testo).toContain('Pane Quotidiano');
    expect(testo).not.toContain('Utente');
    s.smonta();
  }, 60000);

  it('il segno «Ufficiale» sta fuori dal titolo che si accorcia, e si dice una volta sola', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (eIdAssistenza(o.queryKey) ? 'adm' : [CON_ASSISTENZA, IMPOSTORE]);
    const s = await apriElenco();
    const riga = (anteprima: string) =>
      Array.from(s.radice.querySelectorAll('a')).find((a) => (a.textContent ?? '').includes(anteprima))!;
    const vera = riga('Il mio ordine?');
    const falsa = riga('Offerta!');
    expect(vera.querySelector('svg'), 'l\'Assistenza vera ha perso l\'icona').not.toBeNull();
    expect(vera.textContent).toContain('Ufficiale');
    // Dentro l'h3 (che ha `truncate`) sui telefoni si leggeva «Assistenza MyCity Uff…».
    expect(vera.querySelector('h3')?.textContent ?? '', 'il segno è dentro il titolo che si taglia').not.toContain('Ufficiale');
    expect((vera.textContent ?? '').match(/ufficiale/gi)?.length, 'il lettore di schermo diceva «ufficiale» due volte').toBe(1);
    expect(falsa.querySelector('svg'), 'un negozio qualunque ha preso il segno dell\'Assistenza').toBeNull();
    expect(falsa.textContent).not.toContain('Ufficiale');
    s.smonta();
  }, 60000);

  it('mentre l\'elenco chiede chi è l\'Assistenza, la riga mostra «…» e dice a voce che sta caricando', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (eIdAssistenza(o.queryKey) ? undefined : [CON_ASSISTENZA, CON_NEGOZIO]);
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) =>
      (eIdAssistenza(o.queryKey) ? { data: undefined, isLoading: true, isPending: true, isSuccess: false, failureCount: 0 } : undefined);
    const s = await apriElenco();
    const titoli = Array.from(s.radice.querySelectorAll('h3'));
    expect(titoli.map(visibile)).toEqual(['…', 'Pane Quotidiano']);
    expect(titoli[0].querySelector('.sr-only')?.textContent).toBe('Caricamento del nome');
    expect(s.radice.textContent).not.toContain('Utente');
    s.smonta();
  }, 60000);

  it('IL CASO CHE ROMPEVA — nel filo la testata dice «Assistenza MyCity · Account ufficiale di MyCity»', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
      (eIdAssistenza(o.queryKey) ? 'adm' : eMessaggi(o.queryKey) ? [] : CON_ASSISTENZA);
    const s = await apriFilo();
    expect(testata(s)).toEqual({ nome: 'Assistenza MyCity', sotto: 'Account ufficiale di MyCity' });
    expect((s.radice.textContent ?? '').match(/ufficiale/gi)?.length).toBe(1);
    // Controprova del selettore usato per l'impostore: qui l'icona delle cuffie DEVE trovarsi.
    expect(s.radice.querySelector('h2')?.closest('div')?.parentElement?.querySelector('svg.lucide-headset')).toBeTruthy();
    s.smonta();
  }, 60000);

  it('un negozio vero resta «Negozio»', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
      (eIdAssistenza(o.queryKey) ? 'adm' : eMessaggi(o.queryKey) ? [] : CON_NEGOZIO);
    const s = await apriFilo();
    expect(testata(s)).toEqual({ nome: 'Pane Quotidiano', sotto: 'Negozio' });
    s.smonta();
  }, 60000);

  it('un negozio che si chiama «Assistenza MyCity» resta un negozio anche nella testata', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
      (eIdAssistenza(o.queryKey) ? 'adm' : eMessaggi(o.queryKey) ? [] : IMPOSTORE);
    const s = await apriFilo();
    expect(testata(s)).toEqual({ nome: 'Assistenza MyCity', sotto: 'Negozio' });
    expect(s.radice.querySelector('h2')?.closest('div')?.parentElement?.querySelector('svg.lucide-headset')).toBeFalsy();
    expect(s.radice.textContent).not.toMatch(/ufficiale/i);
    s.smonta();
  }, 60000);

  it('mentre la pagina chiede chi è l\'Assistenza, la testata non dice «Utente · Negozio»', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
      (eIdAssistenza(o.queryKey) ? undefined : eMessaggi(o.queryKey) ? [] : CON_ASSISTENZA);
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) =>
      (eIdAssistenza(o.queryKey) ? { data: undefined, isLoading: true, isPending: true, isSuccess: false, failureCount: 0 } : undefined);
    const s = await apriFilo();
    expect(testata(s)).toEqual({ nome: '…', sotto: '' });
    expect(s.radice.querySelector('h2 .sr-only')?.textContent).toBe('Caricamento del nome');
    s.smonta();
  }, 60000);

  it('se la prima domanda è fallita e si sta riprovando, la testata non resta sui puntini', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
      (eIdAssistenza(o.queryKey) ? undefined : eMessaggi(o.queryKey) ? [] : CON_ASSISTENZA);
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) =>
      (eIdAssistenza(o.queryKey) ? { data: undefined, isLoading: true, isPending: true, isSuccess: false, failureCount: 1 } : undefined);
    const s = await apriFilo();
    expect(testata(s)).toEqual({ nome: 'Utente', sotto: 'Negozio' });
    s.smonta();
  }, 60000);

  it('se la domanda fallisce la chat si apre lo stesso, col nome di prima', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
      (eIdAssistenza(o.queryKey) ? undefined : eMessaggi(o.queryKey) ? [] : CON_ASSISTENZA);
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) =>
      (eIdAssistenza(o.queryKey) ? { data: undefined, isError: true, error: new Error('503'), isSuccess: false } : undefined);
    const s = await apriFilo();
    expect(testata(s)).toEqual({ nome: 'Utente', sotto: 'Negozio' });
    s.smonta();
  }, 60000);
});

describe('la domanda «chi è l\'Assistenza?» parte solo quando serve', () => {
  it('nell\'elenco: con soli negozi che hanno l\'insegna non parte', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (eIdAssistenza(o.queryKey) ? undefined : [CON_NEGOZIO]);
    const s = await apriElenco();
    expect(opzioniAssistenza()?.enabled).toBe(false);
    s.smonta();
  }, 60000);

  it('nell\'elenco: con una riga senza nome parte', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (eIdAssistenza(o.queryKey) ? 'adm' : [CON_NEGOZIO, CON_ASSISTENZA]);
    const s = await apriElenco();
    expect(opzioniAssistenza()?.enabled).toBe(true);
    s.smonta();
  }, 60000);

  it('nell\'elenco del negoziante, che vede i suoi clienti, non parte', async () => {
    globali.__UTENTE__ = { id: 'pane', email: 'p@p.it' };
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (o.queryKey[0] === 'support-account' ? undefined : [CON_NEGOZIO]);
    const s = await apriElenco();
    expect(opzioniAssistenza()?.enabled).toBe(false);
    s.smonta();
  }, 60000);

  it('nel filo con un negozio che ha l\'insegna non parte; con l\'Assistenza sì', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
      (eIdAssistenza(o.queryKey) ? undefined : eMessaggi(o.queryKey) ? [] : CON_NEGOZIO);
    let s = await apriFilo();
    expect(opzioniAssistenza()?.enabled).toBe(false);
    s.smonta();
    globali.__OPZIONI_QUERY__ = [];
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
      (eIdAssistenza(o.queryKey) ? 'adm' : eMessaggi(o.queryKey) ? [] : CON_ASSISTENZA);
    s = await apriFilo();
    expect(opzioniAssistenza()?.enabled).toBe(true);
    s.smonta();
  }, 60000);

  it.each([
    ['l\'elenco', apriElenco, (k: unknown[]) => (eIdAssistenza(k) ? 'adm' : [CON_ASSISTENZA])],
    ['il filo', apriFilo, (k: unknown[]) => (eIdAssistenza(k) ? 'adm' : eMessaggi(k) ? [] : CON_ASSISTENZA)],
  ] as const)('in %s la domanda si ferma quando React Query la annulla, e un «non c\'è» invecchia presto', async (_dove, apri, dati) => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => dati(o.queryKey);
    const s = await apri();
    const o = opzioniAssistenza()!;
    let segnaleVisto: AbortSignal | undefined;
    const fetchDiPrima = globalThis.fetch;
    globalThis.fetch = ((_: unknown, i?: RequestInit) => {
      segnaleVisto = i?.signal ?? undefined;
      return new Promise((_r, rifiuta) => segnaleVisto?.addEventListener('abort', () => rifiuta(new Error('annullata'))));
    }) as typeof fetch;
    try {
      const annulla = new AbortController();
      const domanda = Promise.resolve(o.queryFn!({ signal: annulla.signal }));
      domanda.catch(() => {});
      annulla.abort();
      // SUBITO, non dopo: senza il segnale di React Query la richiesta si ferma lo stesso, ma solo
      // allo scadere del tetto di attesa, e una prova che aspetta non vede la differenza.
      expect(segnaleVisto?.aborted, 'la pagina non passa il segnale di React Query').toBe(true);
      await expect(domanda).rejects.toThrow('annullata');
    } finally {
      globalThis.fetch = fetchDiPrima;
    }
    const validita = o.staleTime as (q: { state: { data: unknown } }) => number;
    expect(validita({ state: { data: 'adm' } })).toBe(60 * 60 * 1000);
    expect(validita({ state: { data: null } })).toBeLessThanOrEqual(30 * 1000);
    s.smonta();
  }, 60000);
});

describe('il pulsante Assistenza', () => {
  it('la chat appena aperta sa già di essere con l\'Assistenza', async () => {
    globali.__CACHE_SCRITTA__ = [];
    const chiamate: Array<[string, RequestInit | undefined]> = [];
    const fetchDiPrima = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, o?: RequestInit) => {
      chiamate.push([String(url), o]);
      return new Response(JSON.stringify({ conversationId: 'c1', supportId: 'adm' }), { status: 200 });
    }) as typeof fetch;
    try {
      const mod = await monta('components/SupportChatModal.tsx');
      const s = accendi(mod.default as never, { open: true, onClose: () => {}, role: 'buyer' });
      await attendi();
      const preset = Array.from(s.radice.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('Dov\'è il mio ordine?'))!;
      s.agisci(() => clicca(preset));
      for (let i = 0; i < 20 && (globali.__CACHE_SCRITTA__ as unknown[]).length < 2; i += 1) await attendi();
      expect(chiamate[0]?.[0]).toBe('/api/support/conversation');
      expect(chiamate[0]?.[1]?.method).toBe('POST');
      // Prima si ferma la lettura in volo (che direbbe ancora «non c'è»), POI si scrive l'id.
      expect(globali.__CACHE_SCRITTA__).toEqual([
        ['annulla', ['support-account', 'u1']],
        [['support-account', 'u1'], 'adm'],
      ]);
      s.smonta();
    } finally {
      globalThis.fetch = fetchDiPrima;
      globali.__CACHE_SCRITTA__ = undefined;
    }
  }, 60000);
});
