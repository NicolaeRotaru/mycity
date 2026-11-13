/**
 * @vitest-environment jsdom
 */
/**
 * R22-003 (13/11/2026) — IL SECONDO MESSAGGIO SPARIVA MENTRE IL PRIMO PARTIVA.
 *
 * In chat si scrive «Ciao», si invia, e mentre la richiesta è in volo si continua: « arrivo
 * subito». Quando arrivava la risposta, la pagina svuotava il campo intero: partiva solo «Ciao»
 * e il resto spariva senza essere inviato, e senza avviso. Il cliente riceveva un messaggio solo.
 *
 * Qui si monta il filo vero, l'invio gira davvero (mutationFn e poi onSuccess) contro una fetch
 * che risponde quando lo decide la prova.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;

const CONVERSAZIONE = {
  id: 'c1', buyer_id: 'cliente', seller_id: 'assistenza',
  buyer: { full_name: 'Marta Rossi', store_name: null },
  seller: { full_name: null, store_name: 'Pane Quotidiano' },
};

const fetchDiPrima = globalThis.fetch;
let inviati: string[] = [];
let rispondi: (() => void) | null = null;
let fallisci: (() => void) | null = null;

function campo(radice: HTMLElement) {
  return radice.querySelector('input[aria-label="Scrivi un messaggio"]') as HTMLInputElement;
}

function scrivi(radice: HTMLElement, testo: string) {
  const c = campo(radice);
  const imposta = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    imposta.call(c, testo);
    c.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

function invia(radice: HTMLElement) {
  const modulo = radice.querySelector('form') as HTMLFormElement;
  act(() => {
    modulo.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  inviati = [];
  rispondi = null;
  fallisci = null;
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
  globalThis.fetch = ((url: unknown, init?: { body?: string }) => {
    if (!String(url).includes('/api/chat/messages')) return Promise.resolve({ ok: true, json: async () => ({}) });
    inviati.push(JSON.parse(init?.body ?? '{}').body);
    // La risposta del server arriva quando lo dice la prova: nel frattempo si scrive.
    return new Promise((ok) => {
      rispondi = () => ok({ ok: true, json: async () => ({ id: 'm9', createdAt: '2026-11-13T09:00:00Z' }) });
      fallisci = () => ok({ ok: false, json: async () => ({ error: 'no' }) });
    });
  }) as unknown as typeof fetch;
  globali.__UTENTE__ = { id: 'assistenza' };
  globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
    o.queryKey.length === 2 && o.queryKey[0] === 'messages' ? [] : CONVERSAZIONE;
  globali.__MUTAZIONI_VERE__ = true;
  globali.__MUTAZIONI_IN_VOLO__ = [];
});

afterEach(() => {
  globalThis.fetch = fetchDiPrima;
  globali.__UTENTE__ = undefined;
  globali.__DATI_QUERY__ = undefined;
  globali.__MUTAZIONI_VERE__ = undefined;
  globali.__MUTAZIONI_IN_VOLO__ = undefined;
});

describe('R22-003 · quello che si scrive mentre il primo messaggio parte non sparisce', () => {
  it('«Ciao» parte; « arrivo subito», scritto nel frattempo, resta nel campo pronto da inviare', async () => {
    const mod = await monta('app/messages/[id]/page.tsx');
    const s = accendi(mod.default, { params: { id: 'c1' } });
    await attendi();
    await attendi();

    scrivi(s.radice, 'Ciao');
    invia(s.radice);
    await attendi();
    expect(inviati).toEqual(['Ciao']);

    // Il campo si è svuotato all'invio. Il primo è ancora in volo: si continua a scrivere.
    expect(campo(s.radice).value).toBe('');
    scrivi(s.radice, 'arrivo subito');

    // Arriva la risposta del primo.
    await act(async () => {
      rispondi?.();
      await Promise.all(globali.__MUTAZIONI_IN_VOLO__ as Promise<unknown>[]);
    });

    expect(campo(s.radice).value, 'il testo scritto mentre il primo partiva è sparito dal campo senza essere inviato').toBe(
      'arrivo subito',
    );
    s.smonta();
  }, 60000);

  it('campo riscritto con lo stesso inizio del messaggio partito: a invio riuscito il nuovo testo resta intero', async () => {
    const mod = await monta('app/messages/[id]/page.tsx');
    const s = accendi(mod.default, { params: { id: 'c1' } });
    await attendi();
    await attendi();
    scrivi(s.radice, 'Sì');
    invia(s.radice);
    await attendi();
    scrivi(s.radice, 'Sì, alle 10 va bene');
    await act(async () => {
      rispondi?.();
      await Promise.all(globali.__MUTAZIONI_IN_VOLO__ as Promise<unknown>[]);
    });
    expect(campo(s.radice).value, 'il nuovo messaggio con lo stesso inizio è stato mutilato').toBe('Sì, alle 10 va bene');
    s.smonta();
  }, 60000);

  it('se l\'invio fallisce il testo torna nel campo, senza sovrascrivere quello nuovo', async () => {
    const mod = await monta('app/messages/[id]/page.tsx');
    const s = accendi(mod.default, { params: { id: 'c1' } });
    await attendi();
    await attendi();
    scrivi(s.radice, 'Ciao');
    invia(s.radice);
    await attendi();
    scrivi(s.radice, 'arrivo subito');
    await act(async () => {
      fallisci?.();
      await Promise.all(globali.__MUTAZIONI_IN_VOLO__ as Promise<unknown>[]);
    });
    expect(campo(s.radice).value).toBe('Ciao arrivo subito');
    s.smonta();
  }, 60000);

  it('secondo Invio durante il volo: non parte e il testo resta nel campo; dopo, un nuovo Invio lo manda', async () => {
    // Il finto di react-query non tiene `isPending`: qui si usa quello vero, con la memoria
    // già piena (nessuna lettura parte) e un utente finto che arriva da `supabase` finto.
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { queryKeys } = await import('@/lib/queries/keys');
    const { createElement } = await import('react');
    const mod = await monta('app/messages/[id]/page.tsx', { veri: ['@tanstack/react-query'] });
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    qc.setQueryData(queryKeys.messages.conversationByParam('c1'), CONVERSAZIONE);
    qc.setQueryData(queryKeys.messages.byParam('c1'), []);
    qc.setQueryData(queryKeys.messages.idAssistenza('assistenza'), 'assistenza');
    const Pagina = mod.default as React.ComponentType<{ params: Promise<{ id: string }> }>;
    const s = accendi(
      (p: { params: { id: string } }) => createElement(QueryClientProvider, { client: qc }, createElement(Pagina, p as never)),
      { params: { id: 'c1' } },
    );
    await attendi();
    await attendi();
    scrivi(s.radice, 'Ciao');
    invia(s.radice);
    await attendi();
    scrivi(s.radice, 'arrivo subito');
    invia(s.radice);
    await attendi();
    expect(inviati, 'il secondo non deve partire mentre il primo è in volo').toEqual(['Ciao']);
    expect(campo(s.radice).value, 'il testo del secondo Invio ignorato deve restare nel campo').toBe('arrivo subito');
    await act(async () => {
      rispondi?.();
      await new Promise((r) => setTimeout(r, 20));
    });
    await attendi();
    expect(campo(s.radice).value).toBe('arrivo subito');
    invia(s.radice);
    await attendi();
    expect(inviati).toEqual(['Ciao', 'arrivo subito']);
    expect(campo(s.radice).value).toBe('');
    s.smonta();
  }, 60000);

  it('senza niente scritto nel frattempo, a invio riuscito il campo si svuota (come prima)', async () => {
    const mod = await monta('app/messages/[id]/page.tsx');
    const s = accendi(mod.default, { params: { id: 'c1' } });
    await attendi();
    await attendi();

    scrivi(s.radice, 'Ciao');
    invia(s.radice);
    await attendi();
    await act(async () => {
      rispondi?.();
      await Promise.all(globali.__MUTAZIONI_IN_VOLO__ as Promise<unknown>[]);
    });
    expect(inviati).toEqual(['Ciao']);
    expect(campo(s.radice).value).toBe('');
    s.smonta();
  }, 60000);
});
