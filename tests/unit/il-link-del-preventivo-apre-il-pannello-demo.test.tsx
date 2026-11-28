/**
 * @vitest-environment jsdom
 */
/**
 * 25/11/2026 — Nicola: «che il link del preventivo ti porti ad una demo come quella di pane
 * quotidiano». Scelta sua: un pannello demo senza accesso, col nome dell'attività.
 *
 * Casi (dato → atteso):
 *  · /preventivo/<codice> aperto → la dashboard della demo: nome, le tre fasce che aprono il loro
 *    preventivo, il pulsante sulla consigliata, i quattro servizi col perché vero;
 *  · il guscio → menu come il pannello vero: Dashboard e servizi sono link, Ordini e Prodotti sono
 *    col lucchetto e non portano da nessuna parte; la fascia in cima dice che è una demo;
 *  · /preventivo/<codice>/abbonamento?fascia=premium → il preventivo col Premium, accettazione
 *    già sul Premium; senza fascia, la consigliata;
 *  · /preventivo/<codice>/servizi/foto-video → il perché e le tre fasce che aprono il preventivo;
 *  · il ritorno da Stripe (?pagato=1) e il preventivo accettato → la pagina dell'abbonamento;
 *  · codice sbagliato, preventivo chiuso o inesistente, servizio sconosciuto → «non trovato».
 *
 * 27/11/2026 — Il link non apre più la demo: apre la conferma dell'abbonamento (Nicola). Le pagine della
 * demo restano nel gruppo `(demo)`, col loro guscio: qui si provano ancora quelle.
 *
 * Le pagine sono quelle vere, disegnate come le disegna il server. Finti solo la lettura del
 * preventivo col codice, il calcolo del preventivo (la vetrina di una gastronomia vera nei dati) e
 * il database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

const CODICE = 'a'.repeat(64);

const stato = vi.hoisted(() => ({
  pathname: '/preventivo/x',
  pc: null as null | undefined | { sellerId: string; stato: 'aperto' | 'accettato' | 'chiuso'; fasciaScelta: string | null; nomeAttivita: string },
  preventivo: null as unknown,
  letturePreventivo: 0,
  sostituzioni: [] as string[],
}));

vi.mock('next/navigation', () => ({
  usePathname: () => stato.pathname,
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); },
  useRouter: () => ({ push: () => undefined, replace: (u: string) => { stato.sostituzioni.push(u); }, refresh: () => undefined }),
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
    stato.letturePreventivo += 1;
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
import LayoutDemo from '@/app/preventivo/[codice]/(demo)/layout';
import ConfermaDalLink from '@/app/preventivo/[codice]/page';
import ServizioDemo from '@/app/preventivo/[codice]/(demo)/servizi/[servizio]/page';
import PreventivoDemo from '@/app/preventivo/[codice]/(demo)/abbonamento/page';

/** Una gastronomia senza logo, con una foto e senza sito: come le attività che ricevono il link. */
const vetrina = (): Preventivo => costruisciPreventivo({
  idAttivita: 'og-1', nomeAttivita: 'Ora del Gusto', tipoAttivita: 'negozio',
  dati: { storeLogo: null, storeMedia: [{ type: 'image', url: 'https://x/1.jpg' }], prodotti: [], socials: {} },
  impostazioni: leggiImpostazioniAgenzia({}), adesso: new Date('2026-11-25T10:00:00Z'), attivo: null,
});

const params = (codice = CODICE) => Promise.resolve({ codice });
const cerca = (q: Record<string, string> = {}) => Promise.resolve(q);

/** Disegna come il server e restituisce un nodo dove cercare. */
function disegna(el: ReactElement): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = renderToStaticMarkup(el);
  return div;
}

async function errore(promessa: Promise<unknown>): Promise<string> {
  try { await promessa; } catch (e) { return (e as Error).message; }
  return 'nessun errore';
}

beforeEach(() => {
  stato.pathname = `/preventivo/${CODICE}`;
  stato.pc = { sellerId: 'og-1', stato: 'aperto', fasciaScelta: null, nomeAttivita: 'Ora del Gusto' };
  stato.preventivo = vetrina();
  stato.letturePreventivo = 0;
  stato.sostituzioni = [];
});

describe('il guscio della demo (le pagine restano, il link non ci porta più: 27/11/2026)', () => {
  it('il link col codice apre la conferma dell abbonamento, non la dashboard della demo', async () => {
    // Il dettaglio della conferma sta in tests/unit/il-link-apre-la-conferma-dell-abbonamento.test.tsx.
    const r = disegna(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    expect(r.querySelector('h1')?.textContent).toBe('Ora del Gusto, ecco il tuo abbonamento');
    expect(r.textContent).not.toContain('In demo');
    expect(r.querySelector(`a[href^="/preventivo/${CODICE}/"]`)).toBeNull();
  });

  it('il guscio è il pannello del negozio: menu, voci chiuse col lucchetto, la fascia della demo', async () => {
    const r = disegna(await LayoutDemo({ params: params(), children: <p>dentro</p> }));
    expect(r.querySelector('[data-testid="pannello-demo"]')).not.toBeNull();
    expect(r.textContent).toContain('Demo del pannello di Ora del Gusto');
    expect(r.textContent).toContain('dentro');
    const menu = r.querySelector('aside[aria-label="Menu della demo"]')!;
    const dashboard = [...menu.querySelectorAll(`a[href="/preventivo/${CODICE}"]`)].find((a) => a.textContent?.includes('Dashboard'));
    expect(dashboard?.getAttribute('aria-current')).toBe('page');
    for (const voce of ['Foto e video', 'Gestione sito web', 'Gestione social e Google', 'Analisi di mercato']) {
      expect([...menu.querySelectorAll('a')].some((a) => a.textContent?.includes(voce)), voce).toBe(true);
    }
    for (const chiusa of ['Ordini', 'Prodotti', 'Promozioni', 'Clienti', 'Messaggi', 'Guadagni']) {
      expect([...menu.querySelectorAll('a')].some((a) => a.textContent?.trim().startsWith(chiusa)), `${chiusa} non è un link`).toBe(false);
      expect(menu.textContent, chiusa).toContain(`${chiusa}: si accende quando attivi l’abbonamento`);
    }
    expect(r.querySelector('a[href^="/seller"]')).toBeNull();
    // Una lettura sola del preventivo, anche se guscio e pagina la chiedono tutti e due (nelle
    // prove `cache` non c'è: qui si conta solo che il guscio legga il preventivo pubblico).
    expect(stato.letturePreventivo).toBe(1);
  });

  it('a preventivo accettato il guscio sparisce, ma resta il marchio che riporta al sito', async () => {
    stato.pc = { sellerId: 'og-1', stato: 'accettato', fasciaScelta: 'business', nomeAttivita: 'Ora del Gusto' };
    const r = disegna(await LayoutDemo({ params: params(), children: <p>dentro</p> }));
    expect(r.querySelector('[data-testid="pannello-demo"]')).toBeNull();
    expect(r.textContent).toContain('dentro');
    expect(r.querySelector('a[href="/"]')?.textContent).toBe('MyCity');
  });
});

describe('ogni fascia apre il suo preventivo, anche nella demo', () => {
  it('con ?fascia=premium il preventivo è del Premium, e l accettazione parte dal Premium', async () => {
    const r = disegna(await PreventivoDemo({ params: params(), searchParams: cerca({ fascia: 'premium' }) }));
    expect(r.querySelector('h1')?.textContent).toBe('Il preventivo di Ora del Gusto col Premium');
    expect(r.querySelector(`a[href="/preventivo/${CODICE}/abbonamento?fascia=premium"]`)?.getAttribute('aria-current')).toBe('page');
    expect(r.querySelector('input[type="radio"][value="premium"]')?.hasAttribute('checked')).toBe(true);
  });

  it('cambiando fascia nella stessa pagina la scelta e il pulsante per confermare seguono la fascia letta (collaudo: soldi)', async () => {
    // Next, se cambia solo ?fascia, ridisegna la pagina tenendo lo stato dei componenti: qui lo stesso.
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    const spuntata = () => [...div.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((i) => i.checked)?.value;
    try {
      const premium = await PreventivoDemo({ params: params(), searchParams: cerca({ fascia: 'premium' }) });
      await act(async () => { root.render(premium); });
      expect(spuntata()).toBe('premium');
      const base = await PreventivoDemo({ params: params(), searchParams: cerca({ fascia: 'base' }) });
      await act(async () => { root.render(base); });
      expect(div.querySelector('h1')?.textContent).toBe('Il preventivo di Ora del Gusto col Base');
      expect(spuntata()).toBe('base');
      // 27/11/2026 — Da qui non si accetta più: il pulsante porta alla conferma col codice, con la fascia scelta.
      const vai = () => [...div.querySelectorAll('a')].find((a) => a.textContent?.startsWith('Conferma il'))?.getAttribute('href');
      expect(vai()).toBe(`/preventivo/${CODICE}?fascia=base`);
      const premiumDiNuovo = await PreventivoDemo({ params: params(), searchParams: cerca({ fascia: 'premium' }) });
      await act(async () => { root.render(premiumDiNuovo); });
      expect(spuntata()).toBe('premium');
      expect(vai()).toBe(`/preventivo/${CODICE}?fascia=premium`);
      // E scegliendo una fascia nel modulo, il preventivo sopra diventa il suo.
      const radioBase = [...div.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((i) => i.value === 'base')!;
      await act(async () => { radioBase.click(); });
      expect(stato.sostituzioni).toEqual(['?fascia=base']);
    } finally {
      act(() => root.unmount());
      div.remove();
    }
  });

  it('con la fascia ripetuta nell indirizzo non va in errore: vale la consigliata', async () => {
    const p = stato.preventivo as Preventivo;
    const r = disegna(await PreventivoDemo({ params: params(), searchParams: Promise.resolve({ fascia: ['base', 'premium'] }) as never }));
    expect(r.querySelector('h1')?.textContent).toBe(`Il preventivo di Ora del Gusto col ${FASCE[p.consigliato].nome}`);
  });

  it('senza fascia, o con una sconosciuta, vale la consigliata', async () => {
    const p = stato.preventivo as Preventivo;
    for (const q of [{}, { fascia: 'gold' }] as Array<Record<string, string>>) {
      const r = disegna(await PreventivoDemo({ params: params(), searchParams: cerca(q) }));
      expect(r.querySelector('h1')?.textContent).toBe(`Il preventivo di Ora del Gusto col ${FASCE[p.consigliato].nome}`);
      expect(r.querySelector(`input[type="radio"][value="${p.consigliato}"]`)?.hasAttribute('checked')).toBe(true);
    }
  });
});

describe('le pagine dei servizi della demo', () => {
  it('foto e video: il perché e le tre fasce che aprono il preventivo', async () => {
    stato.pathname = `/preventivo/${CODICE}/servizi/foto-video`;
    const r = disegna(await ServizioDemo({ params: Promise.resolve({ codice: CODICE, servizio: 'foto-video' }) }));
    expect(r.querySelector('h1')?.textContent).toContain('Foto');
    expect(r.textContent).toContain('Perché te lo proponiamo');
    for (const f of ABBONAMENTI) expect(r.querySelector(`a[href="/preventivo/${CODICE}/abbonamento?fascia=${f}"]`), f).not.toBeNull();
  });

  it('analisi del business: l analisi dell attività con le fonti, mai la pagella del marketplace (mycity#330)', async () => {
    const p = stato.preventivo as Preventivo;
    p.analisiAziendale = {
      situazione: [{ testo: 'Bar e pasticceria in centro, aperto da dieci anni', fonte: 'scheda Google' }],
      mercato: [], clienti: [], opportunita: [], rischi: [], prime_mosse: [],
    };
    const r = disegna(await ServizioDemo({ params: Promise.resolve({ codice: CODICE, servizio: 'analisi' }) }));
    const blocco = r.querySelector('[data-testid="analisi-aziendale"]');
    expect(blocco?.textContent).toContain('Bar e pasticceria in centro');
    // 26/11/2026 — Il testo dell'analisi nelle fasce non nomina più la scheda Google (rapporto dell'imprenditore):
    // la fonte della frase resta, come collegamento accanto alla frase.
    expect(blocco?.querySelector('a[rel~="nofollow"]')?.textContent).toBe('fonte');
    expect(r.textContent?.toLowerCase()).not.toContain('pagella');
  });

  it('un servizio sconosciuto non esiste', async () => {
    expect(await errore(ServizioDemo({ params: Promise.resolve({ codice: CODICE, servizio: 'boh' }) }))).toBe('NEXT_NOT_FOUND');
  });
});

describe('dove porta il link negli altri casi', () => {
  it('il ritorno dal pagamento va alla pagina dell abbonamento, con lo stesso esito', async () => {
    expect(await errore(ConfermaDalLink({ params: params(), searchParams: cerca({ pagato: '1' }) })))
      .toBe(`NEXT_REDIRECT /preventivo/${CODICE}/abbonamento?pagato=1`);
    expect(await errore(ConfermaDalLink({ params: params(), searchParams: cerca({ pagato: '0' }) })))
      .toBe(`NEXT_REDIRECT /preventivo/${CODICE}/abbonamento?pagato=0`);
  });

  it('un preventivo già accettato va alla pagina dell abbonamento, che dice cosa succede ora', async () => {
    stato.pc = { sellerId: 'og-1', stato: 'accettato', fasciaScelta: 'business', nomeAttivita: 'Ora del Gusto' };
    expect(await errore(ConfermaDalLink({ params: params(), searchParams: cerca() }))).toBe(`NEXT_REDIRECT /preventivo/${CODICE}/abbonamento`);
    const r = disegna(await PreventivoDemo({ params: params(), searchParams: cerca() }));
    expect(r.textContent).toContain('Hai accettato il preventivo');
  });

  it('codice sbagliato, preventivo chiuso o inesistente: non trovato', async () => {
    expect(await errore(ConfermaDalLink({ params: params('corto'), searchParams: cerca() }))).toBe('NEXT_NOT_FOUND');
    expect(await errore(LayoutDemo({ params: params('corto'), children: null }))).toBe('NEXT_NOT_FOUND');
    stato.pc = null;
    expect(await errore(ConfermaDalLink({ params: params(), searchParams: cerca() }))).toBe('NEXT_NOT_FOUND');
    stato.pc = { sellerId: 'og-1', stato: 'chiuso', fasciaScelta: null, nomeAttivita: 'Ora del Gusto' };
    expect(await errore(LayoutDemo({ params: params(), children: null }))).toBe('NEXT_NOT_FOUND');
  });

  it('se la lettura cade lo dice, senza inventare', async () => {
    stato.pc = undefined;
    const r = disegna(await ConfermaDalLink({ params: params(), searchParams: cerca() }));
    expect(r.textContent).toContain('Non riesco a leggere il preventivo');
  });
});
