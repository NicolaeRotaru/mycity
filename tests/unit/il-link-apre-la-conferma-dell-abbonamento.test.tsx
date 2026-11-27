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
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const CODICE = 'b'.repeat(64);

const stato = vi.hoisted(() => ({
  pc: null as null | { sellerId: string; stato: 'aperto' | 'accettato' | 'chiuso'; fasciaScelta: string | null; nomeAttivita: string },
  preventivo: null as unknown,
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
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return { getAdminSupabase: () => ({ from: () => q }) };
});

import { FASCE, ABBONAMENTI, costruisciPreventivo, leggiImpostazioniAgenzia, type Preventivo } from '@/lib/agenzia/preventivo';
import ConfermaDalLink from '@/app/preventivo/[codice]/page';
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

async function scriviEmail(r: HTMLElement, email: string) {
  const campo = r.querySelector('#email-titolare') as HTMLInputElement;
  const imposta = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    imposta.call(campo, email);
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
  stato.pc = { sellerId: 'gc-1', stato: 'aperto', fasciaScelta: 'business', nomeAttivita: 'Grida Caffè' };
  stato.preventivo = vetrina();
  vai.mockReset();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign: vai } });
});

afterEach(() => {
  if (radice) act(() => radice!.unmount());
  contenitore?.remove();
  radice = null;
  contenitore = null;
  vi.unstubAllGlobals();
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
    expect(pulsante(r).textContent).toBe('Confermo il Business');
    // Niente guscio della demo, niente pagine della demo, niente area del negozio prima della conferma.
    expect(r.querySelector('[data-testid="pannello-demo"]')).toBeNull();
    expect(r.textContent).not.toContain('Demo del pannello');
    expect(r.querySelector(`a[href^="/preventivo/${CODICE}/"]`)).toBeNull();
    expect(r.querySelector('a[href^="/seller"]')).toBeNull();
    // Il marchio riporta al sito, e si dice come si paga.
    expect(r.querySelector('a[href="/"]')?.textContent).toBe('MyCity');
    expect(r.textContent).toContain('si paga in contanti');
    // Il primo mese a metà, detto una volta sola: «Il primo mese 250,00 €», non «… € al mese».
    expect(r.querySelector('[data-fascia="business"]')?.textContent).toMatch(/Il primo mese 250,00\s€(?! al mese)/);
  });

  it('vale la fascia del venditore anche quando non è la consigliata (collaudo: la prova deve vederlo)', async () => {
    const p = stato.preventivo as Preventivo;
    const diversa = ABBONAMENTI.find((f) => f !== p.consigliato)!;
    stato.pc = { sellerId: 'gc-1', stato: 'aperto', fasciaScelta: diversa, nomeAttivita: 'Grida Caffè' };
    const r = disegna(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    expect(radio(r, diversa).hasAttribute('checked')).toBe(true);
    expect(radio(r, p.consigliato).hasAttribute('checked')).toBe(false);
    expect(r.querySelector(`[data-fascia="${diversa}"]`)?.textContent).toContain('La tua scelta');
    expect(pulsante(r).textContent).toBe(`Confermo il ${FASCE[diversa].nome}`);
  });

  it('senza la scelta del venditore è segnata la consigliata, con «Consigliato»', async () => {
    stato.pc = { sellerId: 'gc-1', stato: 'aperto', fasciaScelta: null, nomeAttivita: 'Grida Caffè' };
    const p = stato.preventivo as Preventivo;
    const r = disegna(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    expect(radio(r, p.consigliato).hasAttribute('checked')).toBe(true);
    expect(r.querySelector(`[data-fascia="${p.consigliato}"]`)?.textContent).toContain('Consigliato');
    expect(r.textContent).not.toContain('La tua scelta');
    expect(pulsante(r).textContent).toBe(`Confermo il ${FASCE[p.consigliato].nome}`);
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
    if (url.endsWith('/codice')) return new Response(JSON.stringify({ ok: true, data: { inviato: true } }), { status: 200 });
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

async function primoPasso(r: HTMLElement) {
  await scriviEmail(r, 'titolare@grida.it');
  await premi(r.querySelector('input[type="checkbox"]') as HTMLInputElement);
  await invia(r);
}

describe('il titolare tocca un altro abbonamento, conferma col codice dell email, ed entra', () => {
  it('tocca il Premium, chiede il codice, lo scrive: la conferma manda il Premium e il browser entra nella sua pagina', async () => {
    const chiamate = serverFinto({ status: 200, corpo: { ok: true, data: { url: null, entra: '/seller/abbonamento', accessoInviato: true } } });
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    expect(pulsante(r).textContent).toBe('Confermo il Business');
    await premi(radio(r, 'premium'));
    expect(radio(r, 'premium').checked).toBe(true);
    expect(pulsante(r).textContent).toBe('Confermo il Premium');
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
    expect(chiamate[1]).toEqual({ url: `/api/preventivo/${CODICE}/conferma`, corpo: { email: 'titolare@grida.it', abbonamento: 'premium', accettoCondizioni: true, codice: '123456' } });
    expect(vai).toHaveBeenCalledWith('/seller/abbonamento');
  });

  it('senza la spunta delle condizioni non parte niente, e lo dice', async () => {
    const posta = vi.fn();
    vi.stubGlobal('fetch', posta);
    const r = await monta(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    await scriviEmail(r, 'titolare@grida.it');
    await invia(r);
    expect(posta).not.toHaveBeenCalled();
    expect(r.querySelector('[role="alert"]')?.textContent).toContain('accetta le condizioni');
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
    expect(pulsante(r).textContent).toBe('Confermo il Business');
  });
});
