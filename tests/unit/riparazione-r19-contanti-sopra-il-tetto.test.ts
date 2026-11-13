/**
 * @vitest-environment jsdom
 */
/**
 * 13/11/2026 (R19-013) — LA CASSA PROPONEVA I CONTANTI ANCHE SOPRA IL TETTO DELLA LEGGE.
 *
 * La rotta dei contanti rifiuta sopra 4.999,99 € (lib/ordini/tetto-dei-contanti.ts, art. 49 del
 * D.Lgs. 231/2007), ma la cassa offriva «Contanti alla consegna» come sempre: si compilava tutto,
 * si premeva «Ordina» e il «no» arrivava solo dalla rotta. Al lancio la carta è spenta, quindi i
 * contanti sono l'unica scelta: sopra il tetto la cassa deve dirlo PRIMA, e fermare l'invio.
 *
 * Qui la pagina di cassa si MONTA intera, con un cliente entrato e due filoni da 2.600 € (5.200 €).
 * ⚠️ Cosa NON prova: il ramo con la carta accesa (CARTA_ACCESA è false e la pagina compilata lo legge
 * così), né la rotta, che ha già la sua prova.
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { act } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

const avvisi = vi.hoisted(() => ({ errori: [] as string[] }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: () => undefined,
    info: () => undefined,
    error: (m: unknown) => {
      avvisi.errori.push(String(m));
    },
  }),
}));

const globale = globalThis as Record<string, unknown>;
const MARIA = { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'maria@test.it' };
const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

const reteDiPartenza = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (url.includes('/api/consegna/veloce')) return { ok: true, json: async () => ({ possibile: false, perche: 'finto' }) };
  return { ok: false, status: 503, statusText: 'finto', headers: new Headers(), text: async () => '', json: async () => null };
}) as unknown as typeof fetch;

const fusoDiPartenza = process.env.TZ;
let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  vi.useRealTimers();
  avvisi.errori.length = 0;
  delete globale.__DATI_QUERY__;
  delete globale.__UTENTE__;
  delete globale.__MUTAZIONI__;
  if (fusoDiPartenza === undefined) delete process.env.TZ;
  else process.env.TZ = fusoDiPartenza;
});
afterAll(() => {
  globalThis.fetch = reteDiPartenza;
});

async function assesta() {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Maria, entrata, apre la cassa con due pezzi al prezzo detto. Giovedì 29/10/2026 alle 10 di Roma. */
async function cassaCon(prezzoEuro: number) {
  process.env.TZ = 'Europe/Rome';
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-10-29T09:00:00Z'));
  const pezzo = { id: 'p-forma', name: 'Forma intera', price: prezzoEuro, quantity: 2, sellerId: PANE, storeName: 'Pane Quotidiano' };
  const gruppi = {
    groups: [{ sellerId: PANE, storeName: 'Pane Quotidiano', storeLat: null, storeLng: null, items: [pezzo] }],
    orphans: [],
    stockIssues: [],
    variantIssues: [],
    prezziCambiati: [],
  };
  localStorage.setItem('cart', JSON.stringify([pezzo]));
  localStorage.setItem('mc_checkout_draft', JSON.stringify({
    form: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567', notes: '' },
    metodoPagamento: 'cod',
    sceltaIl: Date.now(),
  }));
  globale.__UTENTE__ = MARIA;
  globale.__MUTAZIONI__ = [];
  globale.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
    const [chi, cosa] = o.queryKey;
    if (chi === 'checkout-groups') return String(cosa).includes('p-forma') ? gruppi : undefined;
    if (chi === 'auth-user') return MARIA;
    if (chi === 'user-addresses') return [];
    return undefined;
  };
  const pagina = (await monta('app/checkout/page.tsx')).default;
  schermo = accendi(pagina, {});
  await assesta();
  const s = schermo;
  return {
    contanti: () => s.radice.querySelector<HTMLInputElement>('input[name="paymentMethod"][value="cod"]'),
    testo: () => testoVisibile(s.radice),
    bloccato: () => s.radice.querySelector('button[form="checkout-form"]')?.getAttribute('aria-disabled') === 'true',
    ordina: async () => {
      const modulo = s.radice.querySelector('form#checkout-form');
      expect(modulo, 'il modulo della cassa non si trova: la prova non misurerebbe niente').not.toBeNull();
      await act(async () => {
        modulo!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      });
      await assesta();
      return (globale.__MUTAZIONI__ as unknown[]).length;
    },
  };
}

describe('R19-013 · sopra il tetto della legge la cassa non propone i contanti', () => {
  it('5.200 €: i contanti sono spenti, la cassa dice perché, il pulsante è fermo e l’invio non parte', async () => {
    const c = await cassaCon(2600);
    expect(c.testo(), 'il carrello non è arrivato in cassa: la prova non misurerebbe niente').toMatch(/Forma intera/);
    expect(c.contanti(), 'la scelta dei contanti non si trova').not.toBeNull();
    expect(c.contanti()!.disabled, 'sopra 4.999,99 € la cassa propone ancora i contanti').toBe(true);
    expect(c.testo(), 'la cassa non dice perché i contanti non si possono').toMatch(/non si può pagare in contanti/);
    expect(c.bloccato(), 'sopra il tetto, con i soli contanti, il pulsante per ordinare non deve partire').toBe(true);

    const ordini = await c.ordina();
    expect(ordini, 'l’ordine in contanti sopra il tetto è partito lo stesso').toBe(0);
    expect(avvisi.errori.join(' · '), 'l’invio fermato deve dire perché').toMatch(/non si può pagare in contanti/);
  }, 30_000);

  it('4.800 €: sotto il tetto i contanti restano e l’ordine parte', async () => {
    const c = await cassaCon(2400);
    expect(c.contanti()!.disabled).toBe(false);
    expect(c.testo()).not.toMatch(/non si può pagare in contanti/);
    const ordini = await c.ordina();
    expect(avvisi.errori, 'sotto il tetto l’invio non deve fermarsi').toEqual([]);
    expect(ordini, 'sotto il tetto l’ordine deve partire').toBe(1);
  }, 30_000);
});
