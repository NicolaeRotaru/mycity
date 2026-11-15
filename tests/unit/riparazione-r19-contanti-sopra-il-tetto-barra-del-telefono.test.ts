/**
 * @vitest-environment jsdom
 */
/**
 * 14/11/2026 (R19-013, giro di correzione) — LA BARRA DEL TELEFONO PROMETTEVA ANCORA I CONTANTI.
 *
 * Il collaudo K06: con la carta spenta (la configurazione di oggi), a 5.203 € la cassa dice che
 * l'ordine così non si può fare, ma il pulsante della barra in fondo, l'unico che si vede dal
 * telefono, diceva ancora «Ordina e paga alla consegna». Qui la cassa si MONTA intera, come nella
 * prova del primo giro, e si guarda il pulsante della barra (quello nel riquadro `lg:hidden`).
 * ⚠️ Cosa NON prova: il pulsante e la frase del riepilogo (components/checkout/OrderSummary.tsx),
 * che non è un file di R19 e resta nel referto come serve_file_altrui.
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
    barra: () => [...s.radice.querySelectorAll<HTMLButtonElement>('button[form="checkout-form"]')].find((b) => b.closest('.lg\\:hidden')) ?? null,
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

describe('R19-013 · sopra il tetto la barra del telefono non promette i contanti', () => {
  it('5.200 € con la carta spenta: la barra non dice «paga alla consegna», dice che non si può ordinare', async () => {
    const c = await cassaCon(2600);
    expect(c.testo(), 'il carrello non è arrivato in cassa: la prova non misurerebbe niente').toMatch(/Forma intera/);
    const barra = c.barra();
    expect(barra, 'il pulsante della barra del telefono non si trova').not.toBeNull();
    expect(barra!.getAttribute('aria-disabled')).toBe('true');
    expect(barra!.textContent ?? '', 'sopra il tetto la barra promette ancora il pagamento alla consegna').not.toMatch(/paga alla consegna/i);
    expect(barra!.getAttribute('aria-label') ?? '', 'il nome per chi non vede promette ancora i contanti').not.toMatch(/paga alla consegna/i);
    expect(barra!.textContent ?? '').toMatch(/Non si può ordinare/);
    // Il nome per chi non vede contiene il testo visibile (WCAG 2.5.3) e dice il perché.
    expect(barra!.getAttribute('aria-label') ?? '').toMatch(/^Non si può ordinare: sopra .* non si paga in contanti$/);
  }, 30_000);

  it('4.800 €: sotto il tetto la barra dice ancora «Ordina e paga alla consegna»', async () => {
    const c = await cassaCon(2400);
    const barra = c.barra();
    expect(barra, 'il pulsante della barra del telefono non si trova').not.toBeNull();
    expect(barra!.textContent ?? '').toMatch(/Ordina e paga alla consegna/);
    expect(barra!.getAttribute('aria-label')).toBe('Ordina e paga alla consegna');
  }, 30_000);
});
