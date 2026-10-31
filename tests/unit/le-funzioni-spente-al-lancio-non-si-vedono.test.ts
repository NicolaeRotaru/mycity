/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';
import * as interruttori from '@/lib/funzioni-al-lancio';

/**
 * 26/10/2026 — QUELLO CHE È SPENTO AL LANCIO NON SI PROMETTE A SCHERMO.
 *
 * Carta #209, firmata da Nicola. Le pagine si montano per davvero, con
 * l'interruttore vero di lib/funzioni-al-lancio.ts: se un giorno Nicola ne
 * riaccende uno, la prova di quella funzione va riscritta insieme alla
 * riaccensione (lo dice il «se acceso, salta» di ciascun blocco).
 */

const globali = globalThis as Record<string, unknown>;

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__DATI_QUERY__', '__ESITO_QUERY__']) globali[k] = undefined;
});

async function aSchermo(file: string, props: Record<string, unknown> = {}) {
  const mod = await monta(file);
  const s = accendi(mod.default, props);
  await attendi();
  await attendi();
  return s;
}

describe.skipIf(interruttori.BUONI_REGALO_IN_VENDITA)('buoni regalo spenti', () => {
  it('la pagina del credito non offre «Regala» e il credito resta visibile', async () => {
    globali.__UTENTE__ = { id: 'u1', email: 'chi@prova.it' };
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (Array.isArray(o.queryKey) && o.queryKey[0] === 'wallet' ? 2500 : []);
    const s = await aSchermo('app/profile/gift-cards/page.tsx');
    const pulsanti = Array.from(s.radice.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(pulsanti.filter((t) => /regala/i.test(t)), 'la vendita spenta si offre ancora').toEqual([]);
    expect(s.radice.textContent ?? '', 'paga .* e regala').not.toMatch(/Paga\s*€/);
    expect(s.radice.textContent ?? '', 'il credito non deve sparire con la vendita').toContain('25,00');
    s.smonta();
  }, 60000);
});

describe.skipIf(interruttori.CLASSIFICA_INVITI_ACCESA)('classifica inviti spenta', () => {
  it('la classifica non promette premi in euro', async () => {
    globali.__DATI_QUERY__ = () => [
      { user_id: 'a', full_name: 'Luca Rossi', store_name: null, total_referrals: 4, converted_referrals: 4 },
      { user_id: 'b', full_name: 'Anna Bianchi', store_name: null, total_referrals: 3, converted_referrals: 2 },
      { user_id: 'c', full_name: 'Marco Verdi', store_name: null, total_referrals: 1, converted_referrals: 1 },
    ];
    const s = await aSchermo('app/profile/referral/leaderboard/page.tsx');
    const testo = testoVisibile(s.radice);
    expect(testo, 'la pagina promette premi che nessuno paga').not.toMatch(/€\s?\d|premi|vincono/i);
    expect(testo).toMatch(/non è attiva/i);
    s.smonta();
  }, 60000);

  it('«Invita un amico» non porta più alla classifica', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
      JSON.stringify(o.queryKey).includes('mine') ? { referral_code: 'LUCA5', referral_credits_cents: 0 } : [];
    const s = await aSchermo('app/profile/referral/page.tsx');
    expect(testoVisibile(s.radice), 'controprova: la pagina degli inviti si deve vedere').toMatch(/Invita un amico/);
    expect(s.radice.querySelector('a[href="/profile/referral/leaderboard"]'), 'il link alla classifica spenta c\'è ancora').toBeNull();
    s.smonta();
  }, 60000);
});

describe('Negozio del mese: nessun codice sconto che la cassa non conosce', () => {
  it('il riquadro in home non mostra il codice', async () => {
    globali.__DATI_QUERY__ = () => ({
      id: 'm1', cover_image_url: null, headline: null, story: 'Il forno del quartiere',
      discount_code: 'APRILE15', discount_percent: 15, month: '2026-10-01',
      seller: { id: 's1', store_name: 'Pane Quotidiano', store_logo: null },
    });
    const s = await aSchermo('components/home/ShopOfMonthHero.tsx');
    const testo = testoVisibile(s.radice);
    expect(testo, 'controprova: il negozio del mese si deve vedere').toContain('Pane Quotidiano');
    expect(testo, 'un codice scritto a mano, non legato ai coupon, promette uno sconto').not.toContain('APRILE15');
    s.smonta();
  }, 60000);
});

describe.skipIf(interruttori.NEWSLETTER_ACCESA)('newsletter spenta', () => {
  it('il modulo di iscrizione non si disegna', async () => {
    const s = await aSchermo('components/NewsletterForm.tsx', { variant: 'light' });
    expect(s.radice.querySelector('input[type="email"]'), 'il modulo porta a una rotta che va in errore').toBeNull();
    s.smonta();
  }, 60000);
});

describe.skipIf(interruttori.TRADUCI_ACCESO)('«Traduci» spento', () => {
  it('gli strumenti rapidi del prodotto non offrono la traduzione', async () => {
    const s = await aSchermo('components/seller/QuickAiTools.tsx', {
      product: { name: 'Focaccia', description: 'Focaccia al rosmarino', tags: [], attributes: {}, category_id: null },
      attributeSchema: [],
      topCategories: [],
      imageUrls: [],
      onApplyPatch: () => ({ applicati: [], scartati: [] }),
    });
    const pulsanti = Array.from(s.radice.querySelectorAll('button')).map((b) => b.textContent ?? '');
    // Con l'AI dei negozi spenta il riquadro intero non c'è (prova in
    // con-le-funzioni-spente-il-negozio-non-vede-ingressi-che-non-portano-a-niente).
    if (interruttori.AI_NEGOZI_ACCESA) expect(pulsanti.length, 'controprova: gli altri strumenti devono restare').toBeGreaterThan(0);
    expect(pulsanti.filter((t) => /traduci/i.test(t)), '«Traduci» scrive l\'inglese al posto dell\'italiano').toEqual([]);
    expect(s.radice.querySelector('select[aria-label="Lingua di traduzione"]')).toBeNull();
    s.smonta();
  }, 60000);
});

describe.skipIf(interruttori.CARICAMENTO_DA_FILE_ACCESO)('caricamento da file spento', () => {
  it('la pagina non offre un caricamento che rifiuta il CSV dell\'Excel italiano', async () => {
    globali.__UTENTE__ = { id: 'seller-1' };
    globali.__DATI_QUERY__ = () => [];
    const s = await aSchermo('app/seller/products/import/page.tsx');
    expect(s.radice.querySelector('input[type="file"]'), 'il caricamento rotto è ancora offerto').toBeNull();
    expect(testoVisibile(s.radice)).toMatch(/non è attivo/i);
    expect(s.radice.querySelector('a[href="/seller/products/new"]'), 'manca la strada che funziona').not.toBeNull();
    s.smonta();
  }, 60000);
});

describe.skipIf(interruttori.AI_NEGOZI_ACCESA)('AI per i negozi spenta', () => {
  it('«Nuovo prodotto» non promette che l\'AI compila la scheda', async () => {
    globali.__UTENTE__ = { id: 'seller-1' };
    globali.__DATI_QUERY__ = () => undefined;
    const s = await aSchermo('app/seller/products/new/page.tsx');
    const testo = testoVisibile(s.radice);
    expect(testo, 'controprova: la pagina si deve vedere').toMatch(/Nuovo prodotto/);
    expect(testo, 'la pagina promette un\'AI che risponde «non configurato»').not.toMatch(/lascia che l'AI/i);
    s.smonta();
  }, 60000);
});
