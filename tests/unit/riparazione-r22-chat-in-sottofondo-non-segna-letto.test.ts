/**
 * @vitest-environment jsdom
 */
/**
 * R22-012 (13/11/2026) — UNA CHAT APERTA IN SOTTOFONDO SEGNAVA COME LETTI I MESSAGGI APPENA ARRIVATI.
 *
 * Il fornaio lascia la chat aperta sul computer del negozio e va in laboratorio. Il cliente scrive,
 * il messaggio arriva dal vivo, la pagina chiama /api/chat/mark-read e il contatore torna a zero:
 * sul telefono del fornaio nessun «non letto». La pagina trattava «arrivato» come «visto».
 *
 * Qui si monta il filo vero con la scheda nascosta (document.visibilityState = 'hidden'), si fa
 * arrivare un messaggio, e si guarda se parte la chiamata che segna letto. Poi la scheda torna in
 * primo piano e la chiamata deve partire.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;

const CONVERSAZIONE = {
  id: 'c1', buyer_id: 'cliente', seller_id: 'forno',
  buyer: { full_name: 'Marta Rossi', store_name: null },
  seller: { full_name: null, store_name: 'Pane Quotidiano' },
};
const M1 = { id: 'm1', conversation_id: 'c1', sender_id: 'cliente', body: 'Avete il pane?', created_at: '2026-11-13T08:00:00Z', read_at: null };
const M2 = { id: 'm2', conversation_id: 'c1', sender_id: 'forno', body: 'Sì, tra dieci minuti', created_at: '2026-11-13T08:01:00Z', read_at: null };
const M3 = { id: 'm3', conversation_id: 'c1', sender_id: 'cliente', body: 'Me ne tenete due?', created_at: '2026-11-13T08:30:00Z', read_at: null };

let messaggi = [M1, M2];
let visibilita: 'visible' | 'hidden' = 'visible';
let fuoco = true;
let rispostaOk = true;
let chiamate: string[] = [];
const fetchDiPrima = globalThis.fetch;

const segnaLetto = () => chiamate.filter((u) => u.includes('/api/chat/mark-read')).length;

/** Fa ridisegnare la pagina come quando arriva qualcosa: si scrive una lettera nel campo. */
function scriviNelCampo(radice: HTMLElement, testo: string) {
  const campo = radice.querySelector('input[aria-label="Scrivi un messaggio"]') as HTMLInputElement;
  const imposta = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    imposta.call(campo, testo);
    campo.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

function cambiaVisibilita(v: 'visible' | 'hidden') {
  visibilita = v;
  act(() => {
    document.dispatchEvent(new window.Event('visibilitychange'));
  });
}

async function apriIlFilo() {
  const mod = await monta('app/messages/[id]/page.tsx');
  const s = accendi(mod.default, { params: { id: 'c1' } });
  await attendi();
  await attendi();
  return s;
}

beforeEach(() => {
  messaggi = [M1, M2];
  visibilita = 'visible';
  fuoco = true;
  rispostaOk = true;
  chiamate = [];
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibilita });
  document.hasFocus = () => fuoco;
  // jsdom non scorre: lo scorrimento in fondo al filo qui non ha niente da dire.
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
  globalThis.fetch = (async (url: unknown) => {
    chiamate.push(String(url));
    return { ok: rispostaOk, json: async () => ({ ok: true }) };
  }) as unknown as typeof fetch;
  globali.__UTENTE__ = { id: 'forno' };
  globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
    o.queryKey.length === 2 && o.queryKey[0] === 'messages' ? messaggi : CONVERSAZIONE;
});

afterEach(() => {
  delete (document as unknown as Record<string, unknown>).visibilityState;
  globalThis.fetch = fetchDiPrima;
  globali.__UTENTE__ = undefined;
  globali.__DATI_QUERY__ = undefined;
});

describe('R22-012 · la chat segna letto solo quando si vede', () => {
  it('con la pagina in primo piano, aprire la chat segna letto (il verde di controllo)', async () => {
    const s = await apriIlFilo();
    expect(segnaLetto(), 'aprire la chat in primo piano non segna più letto: la prova sotto non misura niente').toBeGreaterThan(0);
    s.smonta();
  }, 60000);

  it('con la scheda nascosta un messaggio che arriva NON si segna letto; si segna quando la scheda torna in primo piano', async () => {
    visibilita = 'hidden';
    const s = await apriIlFilo();
    expect(segnaLetto(), 'la chat in sottofondo ha segnato letto all\'apertura').toBe(0);

    // Il cliente scrive mentre il fornaio è in laboratorio: il messaggio arriva dal vivo.
    messaggi = [M1, M2, M3];
    scriviNelCampo(s.radice, 'x');
    await attendi();
    expect(s.radice.textContent).toContain('Me ne tenete due?');
    expect(segnaLetto(), 'il messaggio appena arrivato è stato segnato letto con la scheda nascosta').toBe(0);

    // Il fornaio torna al computer.
    cambiaVisibilita('visible');
    await attendi();
    expect(segnaLetto(), 'tornata in primo piano, la chat non segna letto').toBe(1);
    s.smonta();
  }, 60000);

  it('visibile ma senza il fuoco (browser dietro un altro programma): zero chiamate a mark-read; col fuoco parte', async () => {
    fuoco = false;
    const s = await apriIlFilo();
    expect(segnaLetto(), 'visibile ma senza fuoco ha segnato letto all\'apertura').toBe(0);
    messaggi = [M1, M2, M3];
    scriviNelCampo(s.radice, 'x');
    await attendi();
    expect(segnaLetto(), 'il messaggio arrivato con la finestra senza fuoco è stato segnato letto').toBe(0);
    fuoco = true;
    act(() => { window.dispatchEvent(new window.Event('focus')); });
    await attendi();
    expect(segnaLetto(), 'preso il fuoco, la chat non segna letto').toBe(1);
    s.smonta();
  }, 60000);

  it('se mark-read risponde non ok, si riprova al focus successivo', async () => {
    rispostaOk = false;
    const s = await apriIlFilo();
    expect(segnaLetto()).toBe(1);
    rispostaOk = true;
    fuoco = false;
    act(() => { window.dispatchEvent(new window.Event('blur')); });
    fuoco = true;
    act(() => { window.dispatchEvent(new window.Event('focus')); });
    await attendi();
    expect(segnaLetto(), 'dopo un errore la chat non riprova al focus').toBe(2);
    s.smonta();
  }, 60000);
});
