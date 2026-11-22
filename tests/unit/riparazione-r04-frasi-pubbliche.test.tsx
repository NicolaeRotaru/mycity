/**
 * @vitest-environment jsdom
 *
 * R04-005 — LE FRASI PUBBLICHE SI PROVANO SU QUELLO CHE LA PERSONA VEDE, NON SU UNA PAROLA NEL CODICE.
 *
 * La prova delle frasi pubbliche (le-frasi-pubbliche-seguono-la-cassa-e-la-realta) cerca parole nel
 * sorgente: sette difetti rimessi a mano restavano verdi. Qui i componenti veri si disegnano e si guarda
 * il testo che esce a video:
 *   1. scheda prodotto: la frase del pagamento (e quando il carrello supera il tetto dei contanti);
 *   2. carrello: la stessa frase, senza la carta che la cassa non offre;
 *   3. home: il banner di consegna non dice «oggi» né i minuti (con l'orologio finto: domenica alle 10);
 *   4. dialogo di conferma: nella prova accanto (riparazione-r04-dialogo-di-conferma), che lo monta da solo;
 *   5. aiuto dei fattorini: nessun numero finto, per l'emergenza c'è il 112;
 *   6. caratteristiche del negozio: una casella non si spunta su «false»;
 *   7. scheda prodotto: la descrizione per i non vedenti non finisce nella griglia, «false» si legge «No».
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

const g = globalThis as unknown as Record<string, unknown>;
type Pagina = ComponentType<Record<string, unknown>>;
type Schermo = ReturnType<typeof accendi>;

let Scheda: Pagina;
let Carrello: Pagina;
let Home: Pagina;
let AiutoFattorini: Pagina;
let Campi: Pagina;

const aperti: Schermo[] = [];

beforeAll(async () => {
  // jsdom non sa scorrere né portare un elemento in vista: le pagine lo chiamano.
  (Element.prototype as unknown as Record<string, unknown>).scrollTo = () => undefined;
  (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => undefined;
  Scheda = (await monta('app/product/[id]/page.tsx')).default as Pagina;
  Carrello = (await monta('app/cart/page.tsx')).default as Pagina;
  Home = (await monta('components/home-sections/HomeSectionRenderer.tsx')).default as Pagina;
  AiutoFattorini = (await monta('app/rider/help/page.tsx')).default as Pagina;
  Campi = (await monta('components/seller/AttributesFields.tsx')).default as Pagina;
}, 180000);

afterEach(() => {
  while (aperti.length) aperti.pop()!.smonta();
  delete g.__DATI_QUERY__;
  delete g.__UTENTE__;
  try { localStorage.clear(); } catch { /* niente */ }
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const chiave = (o: unknown) => JSON.stringify((o as { queryKey?: unknown })?.queryKey ?? []);
const un = (ms = 120) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const mostra = (c: unknown, p: Record<string, unknown> = {}) => {
  const s = accendi(c, p);
  aperti.push(s);
  return s;
};

/** La scheda di un prodotto da `prezzo` euro, con le caratteristiche date. */
function schedaDelProdotto(prezzo: number, attributes: Record<string, unknown> = {}) {
  g.__DATI_QUERY__ = (o: unknown) => {
    const k = chiave(o);
    if (k.startsWith('["products","detail"')) {
      return {
        id: 'p1', name: 'Pane', description: 'Pane di grano duro', price: prezzo, seller_id: 's1', stock: 10, images: [],
        is_active: true, attributes, profiles: { id: 's1', store_name: 'Forno', is_approved: true },
      };
    }
    if (k.includes('products')) return [];
    return undefined;
  };
  return mostra(Scheda, { params: Promise.resolve({ id: 'p1' }) });
}

describe('1. la scheda prodotto dice come si paga, e lo dice come la cassa', () => {
  it('prodotto da 5 €: «Paghi in contanti alla consegna», e nessuna carta che la cassa non offre', async () => {
    const s = schedaDelProdotto(5);
    await un();
    const testo = testoVisibile(s.radice);
    expect(testo, 'la scheda non si è disegnata').toMatch(/Pane/);
    expect(testo).toContain('Paghi in contanti alla consegna');
    expect(testo).not.toMatch(/carta adesso|con carta|Stripe/i);
  });

  it('prodotto da 6.000 €: sopra il tetto la scheda non promette i contanti', async () => {
    const s = schedaDelProdotto(6000);
    await un();
    const testo = testoVisibile(s.radice);
    expect(testo, 'la scheda non si è disegnata').toMatch(/Pane/);
    expect(testo).toMatch(/non si può pagare in contanti/);
    expect(testo).not.toContain('Paghi in contanti alla consegna');
  });
});

describe('2. il carrello dice come si paga, senza la carta che la cassa non offre', () => {
  it('un articolo nel carrello: la frase è «Paghi in contanti alla consegna» e la carta non c’è', async () => {
    localStorage.setItem('cart', JSON.stringify([{ id: 'p1', name: 'Pane', price: 5, quantity: 1, sellerId: 's1', storeName: 'Forno' }]));
    g.__DATI_QUERY__ = () => undefined;
    const s = mostra(Carrello);
    await un(150);
    const testo = testoVisibile(s.radice);
    expect(testo, 'il carrello non si è disegnato').toMatch(/Riepilogo ordine/);
    expect(testo).toContain('Paghi in contanti alla consegna');
    expect(testo).not.toMatch(/carta adesso|con carta|Stripe/i);
    expect(testo).not.toMatch(/Metodi di pagamento in aggiornamento/);
  });
});

describe('3. la home non promette «oggi» né i minuti senza un negozio di cui sapere gli orari', () => {
  it('di domenica alle 10 il banner dice «in giornata», non «oggi» né «30-60»', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 1, 10, 0, 0)); // domenica 1/11/2026
    g.__DATI_QUERY__ = () => undefined;
    const s = mostra(Home, {
      sections: [{ id: 'h', type: 'hero', enabled: true, config: {} }],
      heroVariant: 'a',
      heroDefaults: { eyebrow: 'Eyebrow', headline: 'Titolo', subhead: 'Sottotitolo', ctaPrimary: 'Compra' },
    });
    await un(60);
    const testo = testoVisibile(s.radice);
    expect(testo, 'la home non si è disegnata').toMatch(/Esplora i negozi/);
    // Il banner senza negozio: la frase intera (la lista sotto dice «In giornata» per conto suo).
    expect(testo).toContain('Consegna in giornata, nella fascia oraria che scegli');
    expect(testo).not.toContain('all’ora che scegli');
    expect(testo).not.toContain("all'ora che scegli");
    expect(testo).not.toMatch(/\boggi\b/i);
    expect(testo).not.toMatch(/30-60|30–60|minuti|min\b/i);
  });
});

describe('5. nessun telefono finto dove un fattorino chiede aiuto', () => {
  it('l’aiuto dei fattorini manda gli infortuni al 112 e non mostra nessun altro numero', async () => {
    const s = mostra(AiutoFattorini);
    await un(40);
    const testo = testoVisibile(s.radice);
    expect(testo, 'la pagina di aiuto non si è disegnata').toMatch(/112/);
    expect(testo).not.toMatch(/0523[\s.\-]*000[\s.\-]*000/);
    const telefoni = Array.from(s.radice.querySelectorAll('a[href^="tel:"]')).map((a) => a.getAttribute('href'));
    expect(telefoni.length, 'manca il numero di emergenza').toBeGreaterThan(0);
    expect(telefoni.every((t) => t === 'tel:112'), `numeri nei collegamenti: ${telefoni.join(', ')}`).toBe(true);
  });
});

describe('6. la casella di una caratteristica non si spunta su «false»', () => {
  const campi = [{ key: 'bio', label: 'Biologico', type: 'checkbox' }];
  const casella = (s: Schermo) => s.radice.querySelector('input[type="checkbox"]') as HTMLInputElement;

  it('«false» testuale: casella vuota; «true» testuale e vero booleano: spuntata', async () => {
    const sFalse = mostra(Campi, { fields: campi, values: { bio: 'false' }, onChange: () => undefined });
    expect(casella(sFalse), 'la casella non si è disegnata').toBeTruthy();
    expect(casella(sFalse).checked, '«false» scritto come testo spunta la casella').toBe(false);

    const sTrue = mostra(Campi, { fields: campi, values: { bio: 'true' }, onChange: () => undefined });
    expect(casella(sTrue).checked).toBe(true);

    const sBool = mostra(Campi, { fields: campi, values: { bio: true }, onChange: () => undefined });
    expect(casella(sBool).checked).toBe(true);

    const sNiente = mostra(Campi, { fields: campi, values: {}, onChange: () => undefined });
    expect(casella(sNiente).checked).toBe(false);
  });
});

describe('7. le caratteristiche della scheda parlano italiano e non mostrano la descrizione per i non vedenti', () => {
  it('«false» si legge «No», «true» si legge «Sì», e l’alt text non è nella griglia', async () => {
    const s = schedaDelProdotto(5, {
      alt_text: 'Una pagnotta dorata su un tagliere di legno',
      bio: 'false',
      senza_glutine: 'true',
    });
    await un();
    const testo = testoVisibile(s.radice);
    expect(testo, 'la scheda non si è disegnata').toMatch(/Caratteristiche/);
    expect(testo).toMatch(/Biologico\s+No\b/);
    expect(testo).toMatch(/Senza glutine\s+Sì(\s|$)/);
    expect(testo).not.toMatch(/pagnotta dorata/);
    expect(testo).not.toMatch(/alt[ _]?text/i);
    expect(testo).not.toMatch(/\bfalse\b|\btrue\b/);
  });
});

