/**
 * @vitest-environment jsdom
 *
 * R13-010 — LE FRASI PUBBLICHE SI PROVANO SU QUELLO CHE LA PERSONA VEDE E FA, NON SU UNA PAROLA NEL CODICE.
 *
 * La prova comune (le-frasi-pubbliche-seguono-la-cassa-e-la-realta) legge ancora i sorgenti con readFileSync:
 * sette difetti rimessi a mano restavano verdi. Qui si disegnano i componenti veri e si guarda cosa esce:
 *   1. scheda prodotto: la frase del pagamento segue la cassa (contanti soli; sopra il tetto; carta accesa);
 *   2. carrello: la stessa frase, anche con la carta accesa (una frase scritta a mano non lo segue);
 *   3. home: il banner di consegna senza negozio non dice «oggi» né i minuti (domenica alle 10);
 *   4. dialogo di conferma: Tab e Maiusc+Tab restano dentro;
 *   5. aiuto dei fattorini: nessun numero finto, per l'emergenza c'è il 112;
 *   6. caratteristiche del negozio: una casella non si spunta su «false»;
 *   7. scheda prodotto: «false»→«No», e la descrizione per i non vedenti non entra nella griglia.
 * Scheda, home, dialogo, aiuto e caratteristiche sono compilati e disegnati con l'aiutante `monta`; il carrello
 * si importa diretto perché la carta accesa si ottiene solo con un finto di `funzioni-al-lancio`.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

const mondo = vi.hoisted(() => ({
  carta: false,
  prezzi: {} as Record<string, number>,
}));

vi.mock('@/lib/funzioni-al-lancio', async (originale) => {
  const vero = await originale<typeof import('@/lib/funzioni-al-lancio')>();
  return { ...vero, get CARTA_ACCESA() { return mondo.carta; } };
});
vi.mock('next/link', () => ({ default: (p: { children?: unknown }) => p.children ?? null }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }),
}));
vi.mock('@/components/cart/CartUpsell', () => ({ CartUpsell: () => null }));
vi.mock('@/components/ShareCartButton', () => ({ default: () => null }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/promotions', async (originale) => ({
  ...(await originale<typeof import('@/lib/promotions')>()),
  fetchActiveDiscounts: async () => new Map(),
}));
vi.mock('@/lib/queries/seller-public-profiles', () => ({ fetchSellerPublicMap: async () => new Map() }));

// Il carrello vero legge il database: client vero su un indirizzo finto, rete finta come PostgREST.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.finto.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
const reteDiPartenza = globalThis.fetch;
const json = (dati: unknown) => new Response(JSON.stringify(dati), { status: 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (url.includes('/api/consegna/veloce')) return json({ possibile: true });
  if (url.includes('/rest/v1/products')) return json(Object.entries(mondo.prezzi).map(([id, price]) => ({ id, stock: 50, price })));
  if (url.includes('/rest/v1/')) return json([]);
  return new Response('', { status: 503 });
}) as unknown as typeof fetch;
process.on('exit', () => { globalThis.fetch = reteDiPartenza; });

import CartPage from '@/app/cart/page';

const g = globalThis as unknown as Record<string, unknown>;
type Pagina = ComponentType<Record<string, unknown>>;
type Schermo = ReturnType<typeof accendi>;

let Scheda: Pagina;
let Home: Pagina;
let AiutoFattorini: Pagina;
let Campi: Pagina;
let Dialogo: { ConfirmDialogHost: Pagina; confirmDialog: (o: { title: string; danger?: boolean }) => Promise<boolean> };

const aperti: Schermo[] = [];

beforeAll(async () => {
  (Element.prototype as unknown as Record<string, unknown>).scrollTo = () => undefined;
  (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => undefined;
  Scheda = (await monta('app/product/[id]/page.tsx')).default as Pagina;
  Home = (await monta('components/home-sections/HomeSectionRenderer.tsx')).default as Pagina;
  AiutoFattorini = (await monta('app/rider/help/page.tsx')).default as Pagina;
  Campi = (await monta('components/seller/AttributesFields.tsx')).default as Pagina;
  Dialogo = (await monta('components/ConfirmDialog.tsx')) as unknown as typeof Dialogo;
}, 240000);

afterEach(() => {
  while (aperti.length) aperti.pop()!.smonta();
  delete g.__DATI_QUERY__;
  delete g.__UTENTE__;
  mondo.carta = false;
  mondo.prezzi = {};
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

/** Il carrello disegnato; si restituiscono il testo e le righe «piccole» del riepilogo (i <p> con la sola frase). */
async function carrello(): Promise<{ testo: string; righe: string[] }> {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(2026, 9, 30, 14, 0));
  mondo.prezzi = { p1: 5 };
  const ora = Math.floor(Date.now() / 1000);
  document.cookie = `sb-supabase-auth-token=${encodeURIComponent(JSON.stringify({
    access_token: 'gettone-finto', refresh_token: 'rinnovo-finto', token_type: 'bearer',
    expires_in: 3600 * 24 * 365, expires_at: ora + 3600 * 24 * 365,
    user: { id: 'cliente-1', aud: 'authenticated', role: 'authenticated', email: 'luca@example.it', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  }))}; path=/`;
  localStorage.setItem('cart', JSON.stringify([{ id: 'p1', name: 'Pane', price: 5, quantity: 1, sellerId: 's1', storeName: 'Forno' }]));
  const s = mostra(CartPage);
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const righe = Array.from(s.radice.querySelectorAll('p')).map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim());
  return { testo: s.radice.textContent ?? '', righe };
}

describe('1. la scheda prodotto dice come si paga, e lo dice come la cassa', () => {
  it('prodotto da 5 €: «Paghi in contanti alla consegna», senza carta', async () => {
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

describe('2. il carrello dice come si paga, e segue la cassa', () => {
  it('carta spenta: «Paghi in contanti alla consegna» e nessuna carta', async () => {
    const { testo: t, righe } = await carrello();
    expect(t, 'il carrello non si è disegnato').toMatch(/Riepilogo ordine/);
    expect(righe, 'manca la riga del pagamento nel riepilogo').toContain('Paghi in contanti alla consegna');
    expect(t).not.toMatch(/carta adesso|con carta|Stripe/i);
  });

  it('carta accesa con la chiave pubblica: la frase la nomina («oppure con carta adesso»)', async () => {
    mondo.carta = true;
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_123');
    const { testo: t, righe } = await carrello();
    expect(t, 'il carrello non si è disegnato').toMatch(/Riepilogo ordine/);
    expect(righe, 'la riga del pagamento scritta a mano non segue la cassa').toContain('Paghi in contanti alla consegna, oppure con carta adesso');
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
    expect(testo).toContain('Consegna in giornata, nella fascia oraria che scegli');
    expect(testo).not.toMatch(/\boggi\b/i);
    expect(testo).not.toMatch(/30-60|30–60|minuti|min\b/i);
  });
});

describe('4. il dialogo di conferma tiene il fuoco dentro', () => {
  async function apriIlDialogo() {
    const apri = document.createElement('button');
    apri.textContent = 'Annulla ordine';
    document.body.append(apri);
    const s = mostra(Dialogo.ConfirmDialogHost);
    apri.focus();
    await act(async () => { void Dialogo.confirmDialog({ title: "Annullare l'ordine?", danger: true }); });
    const bottoni = Array.from(s.radice.querySelectorAll('button'));
    expect(bottoni.length, 'il dialogo non si è aperto con i suoi due bottoni').toBe(2);
    return { apri, bottoni };
  }
  const tasto = (el: Element, shift: boolean) => {
    const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
  };

  it('Tab sull’ultimo bottone torna al primo', async () => {
    const { apri, bottoni } = await apriIlDialogo();
    bottoni[1].focus();
    expect(tasto(bottoni[1], false).defaultPrevented, 'col Tab si usciva dal dialogo modale').toBe(true);
    expect(document.activeElement).toBe(bottoni[0]);
    apri.remove();
  });

  it('Maiusc+Tab sul primo bottone va all’ultimo', async () => {
    const { apri, bottoni } = await apriIlDialogo();
    bottoni[0].focus();
    expect(tasto(bottoni[0], true).defaultPrevented, 'con Maiusc+Tab si usciva dal dialogo modale').toBe(true);
    expect(document.activeElement).toBe(bottoni[1]);
    apri.remove();
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

  it('«false» testuale: vuota; «true» testuale e vero booleano: spuntata; niente: vuota', () => {
    const sFalse = mostra(Campi, { fields: campi, values: { bio: 'false' }, onChange: () => undefined });
    expect(casella(sFalse).checked, '«false» scritto come testo spunta la casella').toBe(false);
    expect(casella(mostra(Campi, { fields: campi, values: { bio: 'true' }, onChange: () => undefined })).checked).toBe(true);
    expect(casella(mostra(Campi, { fields: campi, values: { bio: true }, onChange: () => undefined })).checked).toBe(true);
    expect(casella(mostra(Campi, { fields: campi, values: {}, onChange: () => undefined })).checked).toBe(false);
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
