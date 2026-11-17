// @vitest-environment jsdom
/**
 * R01-001 — Nella chat il registro dei messaggi (role="log", aria-live) si accendeva un commit di
 * React dopo il caricamento del filo: pochi millisecondi, nello stesso frame. Il browser aggiorna
 * l'albero di accessibilità al frame, quindi vedeva un registro già «polite» con dentro tutto il
 * filo appena entrato, e il lettore di schermo lo leggeva tutto: all'apertura, quando i messaggi
 * arrivano dopo la conversazione, e dopo «Riprova».
 *
 * Qui i frame li comanda la prova (requestAnimationFrame finto): il filo deve essere disegnato
 * almeno una volta a registro spento, e il registro si accende solo al frame dopo. Poi un
 * messaggio nuovo dal vivo entra a registro acceso, e si annuncia.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { monta } from './aiuti/monta-componente';

const globali = globalThis as Record<string, unknown>;
globali.IS_REACT_ACT_ENVIRONMENT = true;

const CONVERSAZIONE = {
  id: 'c1', buyer_id: 'u1', seller_id: 'v1',
  buyer: { full_name: 'Marta Rossi', store_name: null },
  seller: { full_name: null, store_name: 'Pane Quotidiano' },
  insegna: 'Pane Quotidiano', insegnaNonLetta: false, cliente: null,
};
const FILO = [
  { id: 'm1', conversation_id: 'c1', sender_id: 'u1', body: 'È pronto il pane?', created_at: '2026-11-12T08:00:00Z', read_at: null },
  { id: 'm2', conversation_id: 'c1', sender_id: 'v1', body: 'Sì, alle nove.', created_at: '2026-11-12T08:01:00Z', read_at: null },
];
const NUOVO = { id: 'm3', conversation_id: 'c1', sender_id: 'v1', body: 'Te lo tengo da parte.', created_at: '2026-11-12T08:05:00Z', read_at: null };
const eMessaggi = (o: { queryKey: unknown[] }) => o.queryKey.length === 2 && o.queryKey[0] === 'messages';

/** I frame del browser, a mano: ogni `frame()` esegue i callback chiesti fino a quel momento. */
let coda: Array<{ id: number; cb: FrameRequestCallback }> = [];
let prossimo = 1;
async function frame() {
  const giro = coda;
  coda = [];
  await act(async () => { giro.forEach(({ cb }) => cb(performance.now())); });
}

let radice: Root | null = null;
let div: HTMLDivElement | null = null;
let Pagina: unknown;

type Stato = 'arriva' | 'caduta' | 'caricato';
let messaggi: unknown[] = FILO;
function stato(s: Stato) {
  globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) => {
    if (!eMessaggi(o)) return undefined;
    if (s === 'arriva') return { isSuccess: false, isPending: true, isLoading: true, data: undefined };
    if (s === 'caduta') return { isSuccess: false, isError: true, data: undefined };
    return undefined;
  };
}
async function disegna() {
  await act(async () => {
    (radice as Root).render(createElement(Pagina as never, { params: { id: 'c1' } }));
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}
const registro = () => div!.querySelector<HTMLElement>('[role="log"]')!;

beforeEach(async () => {
  coda = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = prossimo++; coda.push({ id, cb }); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { coda = coda.filter((f) => f.id !== id); });
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }));
  // jsdom non fa scorrere: la pagina porta in fondo il filo a ogni messaggio nuovo.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  globali.__UTENTE__ = { id: 'u1' };
  messaggi = FILO;
  globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (eMessaggi(o) ? messaggi : CONVERSAZIONE);
  const mod = await monta('app/messages/[id]/page.tsx');
  Pagina = mod.default;
  div = document.createElement('div');
  document.body.appendChild(div);
  radice = createRoot(div);
});

afterEach(() => {
  act(() => radice?.unmount());
  div?.remove();
  vi.unstubAllGlobals();
  globali.__UTENTE__ = undefined; globali.__DATI_QUERY__ = undefined; globali.__ESITO_QUERY__ = undefined;
});

/** Il filo è a video: deve restare spento finché non è stato disegnato un frame, poi si accende. */
async function siAccendeSoloDopoIlFrame() {
  expect(registro().textContent).toContain('Sì, alle nove.');
  // Tutti i commit e gli effetti di React sono passati, ma nessun frame: il filo non è ancora disegnato.
  expect(registro().getAttribute('aria-live'), 'il registro è acceso prima che il filo sia disegnato').toBe('off');
  // Il frame in cui il filo viene disegnato: ancora spento.
  await frame();
  expect(registro().getAttribute('aria-live'), 'il registro è acceso nel frame che disegna il filo').toBe('off');
  // Il frame dopo: adesso sì, per i messaggi che arriveranno.
  await frame();
  expect(registro().getAttribute('aria-live')).toBe('polite');
}

describe('R01-001 · il registro della chat non legge tutto il filo quando si carica', () => {
  it('all apertura, con il filo già pronto', async () => {
    stato('caricato');
    await disegna();
    await siAccendeSoloDopoIlFrame();
  }, 60000);

  it('quando i messaggi arrivano dopo la conversazione', async () => {
    stato('arriva');
    await disegna();
    await frame(); await frame(); await frame();
    expect(registro().getAttribute('aria-live')).toBe('off');
    stato('caricato');
    await disegna();
    await siAccendeSoloDopoIlFrame();
  }, 60000);

  it('dopo «Riprova»: il filo riletto entra a registro spento, non come una raffica di aggiunte', async () => {
    stato('caricato');
    await disegna();
    await frame(); await frame();
    expect(registro().getAttribute('aria-live')).toBe('polite');
    // La rilettura cade: «Riprova» a video, registro spento.
    stato('caduta');
    await disegna();
    expect(div!.textContent).toContain('Riprova');
    expect(registro().getAttribute('aria-live')).toBe('off');
    // «Riprova» riesce: il filo torna, e il registro aspetta il frame.
    stato('caricato');
    await disegna();
    await siAccendeSoloDopoIlFrame();
  }, 60000);

  it('un messaggio nuovo dal vivo, a filo caricato, entra a registro acceso', async () => {
    stato('caricato');
    await disegna();
    await frame(); await frame();
    messaggi = [...FILO, NUOVO];
    await disegna();
    expect(registro().textContent).toContain('Te lo tengo da parte.');
    expect(registro().getAttribute('aria-live')).toBe('polite');
  }, 60000);
});
