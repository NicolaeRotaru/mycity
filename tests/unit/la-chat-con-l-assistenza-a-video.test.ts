/**
 * @vitest-environment jsdom
 */

/**
 * 25/10/2026 (scheda 1360) — COSA LEGGE IL CLIENTE SULLO SCHERMO.
 *
 * La logica la prova `la-chat-con-l-assistenza-si-chiama-assistenza-mycity.test.ts`.
 * Qui si montano le due pagine vere: l'elenco /messages e il filo /messages/[id].
 * Prima la riga diceva «Utente» e la testata «Utente · Negozio». Adesso devono dire
 * «Assistenza MyCity» e «Assistenza»; un negozio vero resta «Negozio»; e mentre la
 * pagina sta ancora chiedendo chi è l'Assistenza non deve comparire «Utente».
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

const eIdAssistenza = (k: unknown[]) => k.length === 2 && k[0] === 'support-account';
const eMessaggi = (k: unknown[]) => k.length === 2 && k[0] === 'messages';

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

function testata(s: { radice: HTMLElement }) {
  return {
    nome: s.radice.querySelector('h2')?.textContent ?? '',
    sotto: (s.radice.querySelector('h2 + p')?.textContent ?? '').trim(),
  };
}

beforeEach(() => {
  globali.__UTENTE__ = { id: 'u1', email: 'm@p.it' };
  globali.__ESITO_QUERY__ = undefined;
});

afterEach(() => {
  document.body.innerHTML = '';
  globali.__UTENTE__ = undefined;
  globali.__DATI_QUERY__ = undefined;
  globali.__ESITO_QUERY__ = undefined;
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

  it('un negozio che si chiama «Assistenza MyCity» non ha il segno dell\'Assistenza vera', async () => {
    const finto = { ...CON_ASSISTENZA, id: 'c3', seller_id: 'furbo', insegna: 'Assistenza MyCity', last_message_preview: 'Offerta!' };
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (eIdAssistenza(o.queryKey) ? 'adm' : [CON_ASSISTENZA, finto]);
    const s = await apriElenco();
    const riga = (anteprima: string) =>
      Array.from(s.radice.querySelectorAll('a')).find((a) => (a.textContent ?? '').includes(anteprima))!;
    const vera = riga('Il mio ordine?');
    const falsa = riga('Offerta!');
    expect(vera.querySelector('svg'), 'l\'Assistenza vera ha perso l\'icona').not.toBeNull();
    expect(vera.textContent).toContain('Ufficiale');
    expect(vera.textContent).toContain('Account ufficiale di MyCity');
    expect(falsa.querySelector('svg'), 'un negozio qualunque ha preso il segno dell\'Assistenza').toBeNull();
    expect(falsa.textContent).not.toContain('Ufficiale');
    s.smonta();
  }, 60000);

  it('IL CASO CHE ROMPEVA — nel filo la testata dice «Assistenza MyCity · Assistenza»', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
      (eIdAssistenza(o.queryKey) ? 'adm' : eMessaggi(o.queryKey) ? [] : CON_ASSISTENZA);
    const s = await apriFilo();
    expect(testata(s)).toEqual({ nome: 'Assistenza MyCity', sotto: 'Assistenza' });
    s.smonta();
  }, 60000);

  it('un negozio vero resta «Negozio»', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
      (eIdAssistenza(o.queryKey) ? 'adm' : eMessaggi(o.queryKey) ? [] : CON_NEGOZIO);
    const s = await apriFilo();
    expect(testata(s)).toEqual({ nome: 'Pane Quotidiano', sotto: 'Negozio' });
    s.smonta();
  }, 60000);

  it('mentre la pagina chiede chi è l\'Assistenza, la testata non dice «Utente · Negozio»', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
      (eIdAssistenza(o.queryKey) ? undefined : eMessaggi(o.queryKey) ? [] : CON_ASSISTENZA);
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) =>
      (eIdAssistenza(o.queryKey) ? { data: undefined, isLoading: true, isPending: true, isSuccess: false } : undefined);
    const s = await apriFilo();
    expect(testata(s)).toEqual({ nome: '…', sotto: '' });
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
      for (let i = 0; i < 20 && (globali.__CACHE_SCRITTA__ as unknown[]).length === 0; i += 1) await attendi();
      expect(chiamate[0]?.[0]).toBe('/api/support/conversation');
      expect(chiamate[0]?.[1]?.method).toBe('POST');
      expect(globali.__CACHE_SCRITTA__).toEqual([[['support-account', 'u1'], 'adm']]);
      s.smonta();
    } finally {
      globalThis.fetch = fetchDiPrima;
      globali.__CACHE_SCRITTA__ = undefined;
    }
  }, 60000);
});
