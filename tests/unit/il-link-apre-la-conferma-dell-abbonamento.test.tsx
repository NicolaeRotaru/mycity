/**
 * @vitest-environment jsdom
 */
/**
 * 27/11/2026 15:06 — Nicola, con la foto del link di Grida Caffè: «l'imprenditore non entra più nella sua
 * pagina demo ma in uno schermo che fa vedere i 3 abbonamenti al cliente e conferma l'abbonamento scelto
 * che ha detto al venditore». E: «può toccare un altro abbonamento e confermare quello e dopo il click
 * entra nella sua pagina venditore con l'abbonamento che ha scelto».
 *
 * Casi (dato → atteso):
 *  · il venditore ha segnato il Business → le tre fasce, il Business già scelto con «La tua scelta», il
 *    pulsante «Confermo il Business», niente guscio della demo, nessun link alle sue pagine;
 *  · nessuna scelta del venditore → è segnata la consigliata, con «Consigliato»;
 *  · il titolare tocca il Premium → il pulsante dice «Confermo il Premium» e la conferma manda il Premium;
 *  · senza la spunta delle condizioni → non parte niente, e lo dice;
 *  · «Confermo» chiede il codice dell'email (Nicola, 27/11: «codice dall'email»); il titolare lo scrive e
 *    la conferma parte con fascia, email e codice;
 *  · il server risponde con `entra` → il browser va lì (la pagina dell'abbonamento del negozio);
 *  · codice sbagliato → il messaggio, si resta sul codice; «rimanda il codice» e «ho sbagliato email» funzionano;
 *  · il server risponde senza `entra` → «Fatto», e il titolare entra dall'email;
 *  · il codice non può partire → il messaggio, e si resta sulla scelta.
 *
 * 27/11/2026 verso le 17:40 — Nicola: nella stessa pagina il titolare sceglie giorno e ora in cui il team
 * creativo di SDG passa da lui, e legge cosa succede dopo. Casi (oggi è venerdì 27/11, 17:45 a Piacenza):
 *  · i giorni partono da lunedì 30/11 (dopodomani è domenica), niente domenica, fino a due settimane;
 *  · un'ora già presa da un'altra attività è barrata e non si tocca;
 *  · senza l'ora non parte niente, e lo dice; «Cosa succede dopo» dice il giorno scelto;
 *  · la conferma manda l'orario scelto; «ho sbagliato email» non lo perde;
 *  · tutte le ore prese → «siamo al completo», si conferma lo stesso e la conferma parte senza visita.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const CODICE = 'b'.repeat(64);

const stato = vi.hoisted(() => ({
  pc: null as null | { sellerId: string; stato: 'aperto' | 'accettato' | 'chiuso'; fasciaScelta: string | null; nomeAttivita: string; serviziScelti?: string[] | null },
  preventivo: null as unknown,
  /** Le ore della visita già prese da altre attività (lette da preventivi_con_codice.visita_il). */
  presi: [] as string[],
}));

vi.mock('next/navigation', () => ({
  usePathname: () => `/preventivo/${CODICE}`,
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); },
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@/lib/logger', () => ({ logger: { error: () => undefined, warn: () => undefined, info: () => undefined } }));
vi.mock('@/lib/agenzia/preventivo-col-codice', async (originale) => ({
  ...(await originale<typeof import('@/lib/agenzia/preventivo-col-codice')>()),
  leggiPreventivoColCodice: async () => stato.pc,
}));
vi.mock('@/lib/agenzia/leggi-preventivo', () => ({
  leggiPreventivo: async (_id: string, _scelto: unknown, opzioni: { pubblico?: boolean }) => {
    if (!opzioni?.pubblico) throw new Error('il link deve leggere il preventivo pubblico');
    return { preventivo: stato.preventivo, telefono: null, socials: null };
  },
}));
vi.mock('@/lib/supabase/server', () => {
  const q = {
    select: () => q, eq: () => q, in: () => q, limit: async () => ({ data: [], error: null }),
    gte: async () => ({ data: stato.presi.map((visita_il) => ({ visita_il })), error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return { getAdminSupabase: () => ({ from: () => q }) };
});

import { FASCE, ABBONAMENTI, costruisciPreventivo, leggiImpostazioniAgenzia, type Preventivo } from '@/lib/agenzia/preventivo';
import ConfermaDalLink from '@/app/preventivo/[codice]/page';
import { giorniDellaVisita } from '@/lib/agenzia/visita-sdg';
import LayoutDelLink from '@/app/preventivo/[codice]/layout';

const vetrina = (): Preventivo => costruisciPreventivo({
  idAttivita: 'gc-1', nomeAttivita: 'Grida Caffè', tipoAttivita: 'bar',
  dati: { storeLogo: null, storeMedia: [], prodotti: [], socials: {} },
  impostazioni: leggiImpostazioniAgenzia({}), adesso: new Date('2026-11-27T14:00:00Z'), attivo: null,
});

const params = (codice = CODICE) => Promise.resolve({ codice });
const cerca = (q: Record<string, string> = {}) => Promise.resolve(q);

function disegna(el: ReactElement): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = renderToStaticMarkup(el);
  return div;
}

let radice: Root | null = null;
let contenitore: HTMLDivElement | null = null;

/** Monta la pagina nel browser finto, per premere davvero. */
async function monta(el: ReactElement): Promise<HTMLElement> {
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  radice = createRoot(contenitore);
  await act(async () => { radice!.render(el); });
  return contenitore;
}

const pulsante = (r: HTMLElement) => r.querySelector('button[type="submit"]') as HTMLButtonElement;
const radio = (r: HTMLElement, f: string) => r.querySelector(`input[type="radio"][value="${f}"]`) as HTMLInputElement;
const giornoVisita = (r: HTMLElement, g: string) => r.querySelector(`[data-giorno="${g}"] input`) as HTMLInputElement;
const oraVisita = (r: HTMLElement, o: string) => r.querySelector(`[data-ora="${o}"] input`) as HTMLInputElement;
/** Venerdì 27/11/2026, 17:45 a Piacenza. Lunedì 30/11 alle 10:00 di Piacenza è alle 9:00 UTC. */
const ADESSO = new Date('2026-11-27T16:45:00Z');
const LUNEDI_ALLE_10 = '2026-11-30T09:00:00.000Z';

async function scriviEmail(r: HTMLElement, email: string) {
  const campo = r.querySelector('#email-titolare') as HTMLInputElement;
  const imposta = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    imposta.call(campo, email);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 28/11/2026 — La password che il titolare sceglie sotto l'email, per rientrare da «Accedi». */
const PASSWORD = 'pane-e-caffe-26';
async function scriviPassword(r: HTMLElement, password: string) {
  const campo = r.querySelector('#password-titolare') as HTMLInputElement;
  const imposta = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    imposta.call(campo, password);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function premi(el: HTMLElement) {
  await act(async () => { el.click(); });
}

async function invia(r: HTMLElement) {
  await act(async () => {
    (r.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  // La risposta del server finto arriva in un giro dopo.
  await act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });
}

const vai = vi.fn();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // 28/11/2026 — Il venditore ha segnato anche i servizi (Gestione sito web), come fa adesso col «Sì, aggiungi».
  stato.pc = { sellerId: 'gc-1', stato: 'aperto', fasciaScelta: 'business', nomeAttivita: 'Grida Caffè', serviziScelti: ['sito_web'] };
  stato.preventivo = vetrina();
  stato.presi = [];
  // Si finge solo l'orologio: i giri di setTimeout delle prove restano veri.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  vai.mockReset();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign: vai } });
});

afterEach(() => {
  if (radice) act(() => radice!.unmount());
  contenitore?.remove();
  radice = null;
  contenitore = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('il link apre la conferma, non la demo', () => {
  it('il Business detto al venditore è già scelto, con «La tua scelta», e il pulsante lo conferma', async () => {
    const r = disegna(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    expect(r.querySelector('h1')?.textContent).toBe('Grida Caffè, ecco il tuo abbonamento');
    expect(r.textContent).toContain('Con il nostro venditore hai scelto il Business');
    for (const f of ABBONAMENTI) {
      expect(r.querySelector(`input[type="radio"][value="${f}"]`), f).not.toBeNull();
      expect(r.querySelector(`[data-fascia="${f}"]`)?.textContent, f).toContain(FASCE[f].nome);
    }
    expect(radio(r, 'business').hasAttribute('checked')).toBe(true);
    expect(radio(r, 'base').hasAttribute('checked')).toBe(false);
    expect(r.querySelector('[data-fascia="business"]')?.textContent).toContain('La tua scelta');
    expect(r.querySelector('[data-fascia="base"]')?.textContent).not.toContain('La tua scelta');
    expect(pulsante(r).textContent).toBe('Confermo il Business e la visita');
    // Niente guscio della demo, niente pagine della demo, niente area del negozio prima della conferma.
    expect(r.querySelector('[data-testid="pannello-demo"]')).toBeNull();
    expect(r.textContent).not.toContain('Demo del pannello');
    expect(r.querySelector(`a[href^="/preventivo/${CODICE}/"]`)).toBeNull();
    expect(r.querySelector('a[href^="/seller"]')).toBeNull();
    // Il marchio riporta al sito, e si dice come si paga.
    expect(r.querySelector('a[href="/"]')?.textContent).toBe('MyCity');
    expect(r.textContent).toContain('si paga in contanti');
    // Il primo mese a metà, detto una volta sola: «Il primo mese 300,00 €», non «… € al mese».
    expect(r.querySelector('[data-fascia="business"]')?.textContent).toMatch(/Il primo mese 300,00\s€(?! al mese)/);
  });

  it('vale la fascia del venditore anche quando non è la consigliata (collaudo: la prova deve vederlo)', async () => {
    const p = stato.preventivo as Preventivo;
    const diversa = ABBONAMENTI.find((f) => f !== p.consigliato)!;
    stato.pc = { sellerId: 'gc-1', stato: 'aperto', fasciaScelta: diversa, nomeAttivita: 'Grida Caffè' };
    const r = disegna(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    expect(radio(r, diversa).hasAttribute('checked')).toBe(true);
    expect(radio(r, p.consigliato).hasAttribute('checked')).toBe(false);
    expect(r.querySelector(`[data-fascia="${diversa}"]`)?.textContent).toContain('La tua scelta');
    expect(pulsante(r).textContent).toBe(`Confermo il ${FASCE[diversa].nome} e la visita`);
  });

  it('con ?fascia= (dal pulsante della vecchia pagina della demo) è scelta quella, ma «La tua scelta» resta sul venditore', async () => {
    const r = disegna(await ConfermaDalLink({ params: params(), searchParams: cerca({ fascia: 'premium' }) }));
    expect(radio(r, 'premium').hasAttribute('checked')).toBe(true);
    expect(radio(r, 'business').hasAttribute('checked')).toBe(false);
    expect(r.querySelector('[data-fascia="business"]')?.textContent).toContain('La tua scelta');
    expect(r.querySelector('[data-fascia="premium"]')?.textContent).not.toContain('La tua scelta');
    expect(pulsante(r).textContent).toBe('Confermo il Premium e la visita');
  });

  it('senza la scelta del venditore è segnata la consigliata, con «Consigliato»', async () => {
    stato.pc = { sellerId: 'gc-1', stato: 'aperto', fasciaScelta: null, nomeAttivita: 'Grida Caffè' };
    const p = stato.preventivo as Preventivo;
    const r = disegna(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    expect(radio(r, p.consigliato).hasAttribute('checked')).toBe(true);
    expect(r.querySelector(`[data-fascia="${p.consigliato}"]`)?.textContent).toContain('Consigliato');
    expect(r.textContent).not.toContain('La tua scelta');
    expect(pulsante(r).textContent).toBe(`Confermo il ${FASCE[p.consigliato].nome} e la visita`);
  });

  it('una fascia scritta male nel database non rompe la pagina: vale la consigliata', async () => {
    stato.pc = { sellerId: 'gc-1', stato: 'aperto', fasciaScelta: 'oro', nomeAttivita: 'Grida Caffè' };
    const p = stato.preventivo as Preventivo;
    const r = disegna(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    expect(radio(r, p.consigliato).hasAttribute('checked')).toBe(true);
  });

  it('il layout del link non è più il guscio della demo; un codice sbagliato non esiste', async () => {
    const r = disegna(await LayoutDelLink({ params: params(), children: <p>dentro</p> }));
    expect(r.innerHTML).toBe('<p>dentro</p>');
    await expect(LayoutDelLink({ params: params('corto'), children: null })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

/** Il server finto: /codice risponde «inviato», /conferma come gli si dice. */
function serverFinto(conferma: { status: number; corpo: unknown }) {
  const chiamate: Array<{ url: string; corpo: Record<string, unknown> }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    chiamate.push({ url, corpo: JSON.parse(String(init.body)) });
    if (url.endsWith('/codice')) return new Response(JSON.stringify({ ok: true, data: { gettone: 'gettone-firmato' } }), { status: 200 });
    return new Response(JSON.stringify(conferma.corpo), { status: conferma.status });
  }));
  return chiamate;
}

async function scriviCodice(r: HTMLElement, codice: string) {
  const campo = r.querySelector('#codice-email') as HTMLInputElement;
  const imposta = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    imposta.call(campo, codice);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Il primo passo come il titolare: l'ora della visita (sul giorno aperto), l'email, la spunta, «Confermo». */
async function primoPasso(r: HTMLElement, ora: string | null = '10:00') {
  if (ora) await premi(oraVisita(r, ora));
  await scriviEmail(r, 'titolare@grida.it');
  await scriviPassword(r, PASSWORD);
  // La spunta delle condizioni (28/11: sopra ci sono anche le caselle dei servizi).
  await premi(r.querySelector('input[type="checkbox"]:not([name="servizi"])') as HTMLInputElement);
  await invia(r);
}

describe('il titolare tocca un altro abbonamento, conferma col codice dell email, ed entra', () => {
  it('tocca il Premium, chiede il codice, lo scrive: la conferma manda il Premium e il browser entra nella sua pagina', async () => {
    const chiamate = serverFinto({ status: 200, corpo: { ok: true, data: { url: null, entra: '/seller/abbonamento', accessoInviato: true } } });
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    expect(pulsante(r).textContent).toBe('Confermo il Business e la visita');
    await premi(radio(r, 'premium'));
    expect(radio(r, 'premium').checked).toBe(true);
    expect(pulsante(r).textContent).toBe('Confermo il Premium e la visita');
    // «La tua scelta» resta sul Business: dice cosa aveva detto al venditore.
    expect(r.querySelector('[data-fascia="business"]')?.textContent).toContain('La tua scelta');

    await primoPasso(r);
    expect(chiamate).toEqual([{ url: `/api/preventivo/${CODICE}/codice`, corpo: { email: 'titolare@grida.it', abbonamento: 'premium' } }]);
    // Il secondo passo: il riepilogo della scelta e il campo del codice.
    expect(r.textContent).toContain('Hai scelto il Premium');
    expect(r.textContent).toContain('È arrivato a titolare@grida.it');
    expect(pulsante(r).disabled).toBe(true);
    await scriviCodice(r, '12 34 56');
    expect((r.querySelector('#codice-email') as HTMLInputElement).value).toBe('123456');
    await invia(r);
    expect(chiamate[1]).toEqual({ url: `/api/preventivo/${CODICE}/accetta`, corpo: { email: 'titolare@grida.it', password: PASSWORD, abbonamento: 'premium', accettoCondizioni: true, codice: '123456', gettone: 'gettone-firmato', servizi: ['sito_web'], visita: LUNEDI_ALLE_10 } });
    expect(vai).toHaveBeenCalledWith('/seller/abbonamento');
  });

  it('senza la spunta delle condizioni non parte niente, e lo dice', async () => {
    const posta = vi.fn();
    vi.stubGlobal('fetch', posta);
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    await premi(oraVisita(r, '10:00'));
    await scriviEmail(r, 'titolare@grida.it');
    await scriviPassword(r, PASSWORD);
    await invia(r);
    expect(posta).not.toHaveBeenCalled();
    expect(r.querySelector('[role="alert"]')?.textContent).toContain('accetta le condizioni');
  });

  // 28/11/2026 — Nicola, iscrivendo un bar: «deve anche inserire la password, così può accedere con email e password».
  it('sotto l email c è «Scegli una password», da nuova password, e la regola resta scritta sotto', async () => {
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    const campo = r.querySelector('#password-titolare') as HTMLInputElement;
    expect(campo).not.toBeNull();
    expect(campo.type).toBe('password');
    expect(campo.autocomplete).toBe('new-password');
    expect(campo.required).toBe(true);
    expect(r.querySelector('label[for="password-titolare"]')?.textContent).toContain('Scegli una password');
    expect(r.textContent).toContain('Almeno 8 caratteri');
  });

  it('senza password, o con 7 caratteri, il codice non parte, e lo dice', async () => {
    const posta = vi.fn();
    vi.stubGlobal('fetch', posta);
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    await premi(oraVisita(r, '10:00'));
    await scriviEmail(r, 'titolare@grida.it');
    await premi(r.querySelector('input[type="checkbox"]:not([name="servizi"])') as HTMLInputElement);
    await invia(r);
    expect(posta).not.toHaveBeenCalled();
    expect(r.querySelector('[role="alert"]')?.textContent).toContain('password di almeno 8 caratteri');
    await scriviPassword(r, '1234567');
    await invia(r);
    expect(posta).not.toHaveBeenCalled();
    expect(r.querySelector('[role="alert"]')?.textContent).toContain('password di almeno 8 caratteri');
  });

  it('la password che Supabase trova troppo debole: si torna alla scelta, col campo vuoto e il messaggio', async () => {
    const { PASSWORD_TROPPO_DEBOLE } = await import('@/lib/agenzia/password-dal-link');
    serverFinto({ status: 409, corpo: { ok: false, error: { message: PASSWORD_TROPPO_DEBOLE } } });
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    await primoPasso(r);
    await scriviCodice(r, '123456');
    await invia(r);
    expect(r.querySelector('#codice-email')).toBeNull();
    expect((r.querySelector('#password-titolare') as HTMLInputElement).value).toBe('');
    expect(r.querySelector('[role="alert"]')?.textContent).toContain('troppo facile da indovinare');
    expect(vai).not.toHaveBeenCalled();
  });

  it('un codice sbagliato: il messaggio del server, si resta sul codice e si può riprovare', async () => {
    serverFinto({ status: 400, corpo: { ok: false, error: { message: 'Il codice non è giusto o è scaduto. Controlla l’ultima email che ti abbiamo mandato, o chiedine un altro.' } } });
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    await primoPasso(r);
    await scriviCodice(r, '000000');
    await invia(r);
    expect(r.querySelector('[role="alert"]')?.textContent).toContain('non è giusto');
    expect(r.querySelector('#codice-email')).not.toBeNull();
    expect(pulsante(r).disabled).toBe(false);
    expect(vai).not.toHaveBeenCalled();
  });

  it('«rimanda il codice» lo chiede di nuovo; «ho sbagliato email» torna alla scelta senza perderla', async () => {
    const chiamate = serverFinto({ status: 200, corpo: { ok: true, data: { url: null, entra: null, accessoInviato: true } } });
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    await premi(radio(r, 'base'));
    await primoPasso(r);
    const rimanda = [...r.querySelectorAll('button')].find((b) => b.textContent === 'rimanda il codice')!;
    await premi(rimanda);
    await act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });
    expect(chiamate.filter((c) => c.url.endsWith('/codice'))).toHaveLength(2);
    expect(r.textContent).toContain('Ti abbiamo mandato un codice nuovo');
    const sbagliata = [...r.querySelectorAll('button')].find((b) => b.textContent === 'ho sbagliato email')!;
    await premi(sbagliata);
    expect(radio(r, 'base').checked).toBe(true);
    expect((r.querySelector('#email-titolare') as HTMLInputElement).value).toBe('titolare@grida.it');
    expect(oraVisita(r, '10:00').checked).toBe(true);
  });

  it('se la sessione non si apre (risposta senza `entra`), dice «Fatto» e il titolare entra dall email', async () => {
    serverFinto({ status: 200, corpo: { ok: true, data: { url: null, entra: null, accessoInviato: true } } });
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    await primoPasso(r);
    await scriviCodice(r, '123456');
    await invia(r);
    expect(vai).not.toHaveBeenCalled();
    const fatto = r.querySelector('[role="status"]')?.textContent ?? '';
    expect(fatto).toContain('il Business è confermato');
    expect(fatto).toContain('Ti abbiamo scritto a titolare@grida.it');
  });

  it('se il codice non può partire, lo dice e si resta sulla scelta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { message: 'Questo preventivo è già stato accettato: controlla la tua email per entrare.' } }), { status: 409 })));
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    await primoPasso(r);
    expect(r.querySelector('[role="alert"]')?.textContent).toContain('già stato accettato');
    expect(r.querySelector('#codice-email')).toBeNull();
    expect(pulsante(r).disabled).toBe(false);
    expect(pulsante(r).textContent).toBe('Confermo il Business e la visita');
  });
});

describe('il titolare sceglie quando passa SDG', () => {
  it('i giorni partono da lunedì 30/11, niente domenica; l ora presa è barrata; la pagina dice cosa succede dopo', async () => {
    stato.presi = [LUNEDI_ALLE_10];
    const r = disegna(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    expect(r.textContent).toContain('Quando passiamo da te?');
    expect(r.textContent).toContain('il fotografo e il videomaker fanno subito le prime foto e i primi video');
    const giorni = [...r.querySelectorAll('[data-giorno]')].map((e) => e.getAttribute('data-giorno'));
    expect(giorni[0]).toBe('2026-11-30');
    expect(giorni).not.toContain('2026-11-28'); // domani: troppo presto
    expect(giorni).not.toContain('2026-11-29'); // domenica
    expect(giorni).not.toContain('2026-12-06'); // domenica
    expect(giorni).not.toContain('2026-12-08'); // l'Immacolata (collaudo del 27/11)
    expect(giorni.at(-1)).toBe('2026-12-11'); // due settimane
    expect(giornoVisita(r, '2026-11-30').hasAttribute('checked')).toBe(true);
    // Lunedì alle 10:00 l'ha già presa un'altra attività: barrata e non si tocca. Le altre ore sì.
    expect(oraVisita(r, '10:00').hasAttribute('disabled')).toBe(true);
    expect(oraVisita(r, '14:30').hasAttribute('disabled')).toBe(false);
    expect(r.textContent).toContain('Cosa succede dopo');
    expect(r.textContent).toContain('Ti mandiamo un codice per email: lo scrivi qui ed entri nella tua pagina, con il Business già attivo.');
    expect(r.textContent).toContain('Prepariamo i primi post e te li facciamo vedere prima di pubblicarli.');
  });

  it('senza l ora non parte niente, e lo dice', async () => {
    const posta = vi.fn();
    vi.stubGlobal('fetch', posta);
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    await primoPasso(r, null);
    expect(posta).not.toHaveBeenCalled();
    expect(r.querySelector('[role="alert"]')?.textContent).toContain('Scegli il giorno e l’ora in cui passiamo da te');
  });

  it('martedì 1/12 alle 16:30: «Cosa succede dopo» e il riepilogo dicono il giorno, e la conferma lo manda', async () => {
    const chiamate = serverFinto({ status: 200, corpo: { ok: true, data: { url: null, entra: null, accessoInviato: true } } });
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    await premi(giornoVisita(r, '2026-12-01'));
    expect(r.textContent).toContain('L’ora, martedì 1 dicembre');
    await premi(oraVisita(r, '16:30'));
    expect(r.textContent).toContain('Martedì 1 dicembre alle 16:30. Il team di SDG passa da te');
    await primoPasso(r, null);
    expect(r.textContent).toContain('visita martedì 1 dicembre alle 16:30');
    await scriviCodice(r, '123456');
    await invia(r);
    // Le 16:30 di Piacenza, il 1° dicembre, sono le 15:30 UTC.
    expect(chiamate[1].corpo.visita).toBe('2026-12-01T15:30:00.000Z');
    expect(r.querySelector('[role="status"]')?.textContent).toContain('Ci vediamo martedì 1 dicembre alle 16:30.');
  });

  it('cambiando giorno l ora scelta si azzera: non parte un ora di un altro giorno', async () => {
    const posta = vi.fn();
    vi.stubGlobal('fetch', posta);
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    await premi(oraVisita(r, '10:00'));
    await premi(giornoVisita(r, '2026-12-02'));
    expect(oraVisita(r, '10:00').checked).toBe(false);
    await primoPasso(r, null);
    expect(posta).not.toHaveBeenCalled();
    expect(r.querySelector('[role="alert"]')?.textContent).toContain('Scegli il giorno e l’ora');
  });

  it('tutte le ore prese: «siamo al completo», si conferma lo stesso e la conferma parte senza visita', async () => {
    stato.presi = giorniDellaVisita(ADESSO).flatMap((g) => g.orari.map((o) => o.id));
    const chiamate = serverFinto({ status: 200, corpo: { ok: true, data: { url: null, entra: '/seller/abbonamento', accessoInviato: true } } });
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    expect(r.querySelector('[data-giorno]')).toBeNull();
    expect(r.textContent).toContain('siamo al completo');
    expect(r.textContent).toContain('Ti chiamiamo per fissare quando il team di SDG passa da te');
    expect(r.textContent).not.toContain('Il giorno che scegli');
    expect(pulsante(r).textContent).toBe('Confermo il Business');
    await primoPasso(r, null);
    await scriviCodice(r, '123456');
    await invia(r);
    expect(chiamate[1].corpo).not.toHaveProperty('visita');
    expect(vai).toHaveBeenCalledWith('/seller/abbonamento');
  });

  it('l ora appena presa da un altro: si torna alla scelta, quell ora è barrata e si sceglie un altra', async () => {
    const { ORA_GIA_PRESA } = await import('@/lib/agenzia/visita-sdg');
    const chiamate = serverFinto({ status: 409, corpo: { ok: false, error: { message: ORA_GIA_PRESA } } });
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    await primoPasso(r);
    await scriviCodice(r, '123456');
    await invia(r);
    expect(chiamate[1].corpo.visita).toBe(LUNEDI_ALLE_10);
    // Di nuovo sulla scelta, col messaggio; le 10:00 di lunedì barrate, l'email e la fascia restano.
    expect(r.querySelector('#codice-email')).toBeNull();
    expect(r.querySelector('[role="alert"]')?.textContent).toBe(ORA_GIA_PRESA);
    expect(oraVisita(r, '10:00').disabled).toBe(true);
    expect(oraVisita(r, '10:00').checked).toBe(false);
    expect((r.querySelector('#email-titolare') as HTMLInputElement).value).toBe('titolare@grida.it');
    await premi(oraVisita(r, '14:30'));
    expect(oraVisita(r, '14:30').checked).toBe(true);
  });

  it('quel giorno non vale più (pagina aperta oltre la mezzanotte): si torna alla scelta e tutto quel giorno è barrato', async () => {
    const { GIORNO_NON_PIU_VALIDO } = await import('@/lib/agenzia/visita-sdg');
    serverFinto({ status: 400, corpo: { ok: false, error: { message: GIORNO_NON_PIU_VALIDO } } });
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    await primoPasso(r);
    await scriviCodice(r, '123456');
    await invia(r);
    expect(r.querySelector('[role="alert"]')?.textContent).toBe(GIORNO_NON_PIU_VALIDO);
    for (const ora of ['10:00', '14:30', '16:30']) expect(oraVisita(r, ora).disabled, ora).toBe(true);
  });

  it('se l ora rifiutata era l ultima libera: «al completo», e si conferma senza visita (collaudo del 27/11)', async () => {
    const { ORA_GIA_PRESA } = await import('@/lib/agenzia/visita-sdg');
    // Libera solo lunedì alle 10:00.
    stato.presi = giorniDellaVisita(ADESSO).flatMap((g) => g.orari.map((o) => o.id)).filter((id) => id !== LUNEDI_ALLE_10);
    let risposta: { status: number; corpo: unknown } = { status: 409, corpo: { ok: false, error: { message: ORA_GIA_PRESA } } };
    const chiamate: Array<{ url: string; corpo: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      chiamate.push({ url, corpo: JSON.parse(String(init.body)) });
      if (url.endsWith('/codice')) return new Response(JSON.stringify({ ok: true, data: { gettone: 'gettone-firmato' } }), { status: 200 });
      return new Response(JSON.stringify(risposta.corpo), { status: risposta.status });
    }));
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    await primoPasso(r);
    await scriviCodice(r, '123456');
    await invia(r);
    expect(r.textContent).toContain('siamo al completo');
    expect(pulsante(r).textContent).toBe('Confermo il Business');
    risposta = { status: 200, corpo: { ok: true, data: { url: null, entra: '/seller/abbonamento', accessoInviato: true } } };
    await invia(r);
    await scriviCodice(r, '123456');
    await invia(r);
    expect(chiamate.at(-1)?.corpo).not.toHaveProperty('visita');
    expect(vai).toHaveBeenCalledWith('/seller/abbonamento');
  });
});

// 28/11/2026, 01:40 — Nicola: i servizi li segna il venditore «però lo deve poter fare anche» il cliente. Nel link il
// titolare li trova segnati e li può cambiare; senza nessun servizio non si conferma.
describe('il titolare vede i servizi segnati dal venditore e li può cambiare (28/11)', () => {
  const casella = (r: HTMLElement, s: string) => r.querySelector(`[data-servizio="${s}"] input`) as HTMLInputElement;
  it('trova segnato il servizio del venditore, ne aggiunge due e lo toglie: la conferma manda i suoi', async () => {
    const chiamate = serverFinto({ status: 200, corpo: { ok: true, data: { url: null, entra: null, accessoInviato: true } } });
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    expect(r.textContent).toContain('Di quali servizi hai bisogno?');
    expect(r.textContent).toContain('Li trovi segnati come li hai scelti col nostro venditore');
    expect(casella(r, 'sito_web').checked).toBe(true);
    expect(casella(r, 'analisi').checked).toBe(false);
    await premi(casella(r, 'analisi'));
    await premi(casella(r, 'social'));
    await premi(casella(r, 'sito_web'));
    expect(casella(r, 'sito_web').checked).toBe(false);
    await primoPasso(r);
    await scriviCodice(r, '123456');
    await invia(r);
    expect(chiamate[1]?.corpo).toMatchObject({ servizi: ['social', 'analisi'] });
  });

  it('se toglie tutti i servizi non parte niente, e lo dice', async () => {
    const chiamate = serverFinto({ status: 200, corpo: { ok: true, data: { url: null, entra: null, accessoInviato: true } } });
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    await premi(casella(r, 'sito_web'));
    await primoPasso(r);
    expect(chiamate).toHaveLength(0);
    expect(r.querySelector('[role="alert"]')?.textContent).toContain('Scegli almeno un servizio');
  });

  it('se il venditore non ha segnato niente (link vecchi) il titolare li sceglie da sé', async () => {
    stato.pc = { sellerId: 'gc-1', stato: 'aperto', fasciaScelta: 'business', nomeAttivita: 'Grida Caffè', serviziScelti: null };
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    expect(['foto_video', 'sito_web', 'social', 'analisi'].some((s) => casella(r, s).checked)).toBe(false);
    expect(r.textContent).not.toContain('Li trovi segnati');
  });
});
