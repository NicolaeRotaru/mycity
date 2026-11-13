/**
 * @vitest-environment jsdom
 */
/**
 * 13/11/2026 (R19-015) — STESSO CARRELLO, UN'ALTRA FASCIA: LA CASSA DICEVA «FATTO» CON L'ORDINE DI PRIMA.
 *
 * Alle 10:00 Maria preme «Ordina» con una fascia: l'ordine nasce, ma la risposta si perde. La chiave
 * del tentativo resta nella scheda, legata al carrello. Poco dopo Maria cambia fascia (o indirizzo) e
 * ripreme: stessa chiave, la rotta risponde «ripetuto» con l'ordine delle 10:00, e la cassa scriveva
 * «Ordine effettuato!» come se valesse la scelta nuova.
 *
 * La chiave NON deve cambiare: se il selettore sposta la fascia da solo dopo una risposta persa, una
 * chiave nuova creerebbe un secondo ordine vero (provato e tolto il 5/11). Deve cambiare quello che la
 * cassa dice: l'ordine valido è quello di prima, con la fascia di prima.
 *
 * Qui la pagina di cassa si MONTA intera, e l'invio gira davvero contro una rotta finta.
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { act } from 'react';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

const avvisi = vi.hoisted(() => ({ errori: [] as string[], fatti: [] as string[], attenzione: [] as string[] }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: (m: unknown) => {
      avvisi.fatti.push(String(m));
    },
    info: () => undefined,
    warning: (m: unknown) => {
      avvisi.attenzione.push(String(m));
    },
    error: (m: unknown) => {
      avvisi.errori.push(String(m));
    },
  }),
}));

const globale = globalThis as Record<string, unknown>;
const MARIA = { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'maria@test.it' };
const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ORDINE = '11111111-aaaa-4aaa-8aaa-111111111111';

/** Gli invii alla rotta dei contanti: la chiave e la fascia di ognuno. Il primo «si perde». */
const invii: Array<{ chiave: string; fascia: string }> = [];
const reteDiPartenza = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string>; body?: string }) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (url.includes('/api/consegna/veloce')) return { ok: true, json: async () => ({ possibile: false, perche: 'finto' }) };
  if (url.includes('/api/orders/cod')) {
    const corpo = JSON.parse(init?.body ?? '{}') as { deliverySlot?: string };
    invii.push({ chiave: init?.headers?.['idempotency-key'] ?? '', fascia: corpo.deliverySlot ?? '' });
    if (invii.length === 1) throw new TypeError('Failed to fetch');
    // Dal secondo invio in poi la chiave è già passata: la rotta restituisce l'ordine nato al primo.
    return { ok: true, status: 200, json: async () => ({ orderIds: [ORDINE], ordini: [{ id: ORDINE, sellerId: PANE, totalCents: 1500 }], ripetuto: true }) };
  }
  return { ok: false, status: 503, statusText: 'finto', headers: new Headers(), text: async () => '', json: async () => null };
}) as unknown as typeof fetch;

const fusoDiPartenza = process.env.TZ;
let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
  avvisi.errori.length = 0;
  avvisi.fatti.length = 0;
  avvisi.attenzione.length = 0;
  invii.length = 0;
  delete globale.__DATI_QUERY__;
  delete globale.__UTENTE__;
  delete globale.__MUTAZIONI__;
  delete globale.__MUTAZIONI_VERE__;
  delete globale.__MUTAZIONI_IN_VOLO__;
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

/** Maria, entrata, apre la cassa giovedì 29/10/2026 alle 10 di Roma con un filone da 15 €, per domani. */
async function cassa() {
  process.env.TZ = 'Europe/Rome';
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-10-29T09:00:00Z'));
  const filone = { id: 'p-filone', name: 'Filone', price: 15, quantity: 1, sellerId: PANE, storeName: 'Pane Quotidiano' };
  const gruppi = {
    groups: [{ sellerId: PANE, storeName: 'Pane Quotidiano', storeLat: null, storeLng: null, items: [filone] }],
    orphans: [],
    stockIssues: [],
    variantIssues: [],
    prezziCambiati: [],
  };
  localStorage.setItem('cart', JSON.stringify([filone]));
  localStorage.setItem('mc_checkout_draft', JSON.stringify({
    form: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567', notes: '' },
    metodoPagamento: 'cod',
    giorno: 'tomorrow',
    fasciaDomani: FASCE_DI_DOMANI[2],
    sceltaIl: Date.now(),
  }));
  globale.__UTENTE__ = MARIA;
  globale.__MUTAZIONI_VERE__ = true;
  globale.__MUTAZIONI_IN_VOLO__ = [];
  globale.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
    const [chi, cosa] = o.queryKey;
    if (chi === 'checkout-groups') return String(cosa).includes('p-filone') ? gruppi : undefined;
    if (chi === 'auth-user') return MARIA;
    if (chi === 'user-addresses') return [];
    return undefined;
  };
  const pagina = (await monta('app/checkout/page.tsx')).default;
  schermo = accendi(pagina, {});
  await assesta();
  const s = schermo;
  return {
    fascia: () => s.radice.querySelector<HTMLInputElement>('input[name="deliverySlot"]:checked')?.value ?? null,
    scegli: async (fascia: string) => {
      const r = s.radice.querySelector<HTMLInputElement>(`input[name="deliverySlot"][value="${fascia}"]`);
      expect(r, `la fascia «${fascia}» non si trova`).not.toBeNull();
      await act(async () => {
        r!.click();
      });
      await assesta();
    },
    /** Scrive nel campo come una persona: il valore vero e l'evento che React ascolta. */
    scrivi: async (nome: string, valore: string) => {
      const campo = s.radice.querySelector<HTMLInputElement>(`input[name="${nome}"]`);
      expect(campo, `il campo «${nome}» non si trova`).not.toBeNull();
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(campo, valore);
        campo!.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
      await assesta();
    },
    ordina: async () => {
      const modulo = s.radice.querySelector('form#checkout-form');
      expect(modulo, 'il modulo della cassa non si trova: la prova non misurerebbe niente').not.toBeNull();
      await act(async () => {
        modulo!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      });
      await assesta();
      await Promise.all(globale.__MUTAZIONI_IN_VOLO__ as Promise<unknown>[]);
      await assesta();
    },
  };
}

describe('R19-015 · stesso carrello con un’altra fascia: la cassa non dice «fatto» con l’ordine di prima', () => {
  it('risposta persa, fascia cambiata, ripremuto: stessa chiave (niente doppione) e la cassa dice qual è l’ordine valido', async () => {
    const c = await cassa();
    expect(c.fascia(), 'la fascia di partenza non è quella della bozza').toBe(FASCE_DI_DOMANI[2]);

    await c.ordina();
    expect(invii.length, 'il primo invio non è partito').toBe(1);
    expect(avvisi.fatti, 'con la risposta persa non si può dire «fatto»').toEqual([]);

    await c.scegli(FASCE_DI_DOMANI[4]);
    expect(c.fascia()).toBe(FASCE_DI_DOMANI[4]);
    await c.ordina();

    expect(invii.length, 'il secondo invio non è partito').toBe(2);
    expect(invii[1].chiave, 'con la fascia cambiata la chiave è nuova: dopo una risposta persa nasce un secondo ordine').toBe(invii[0].chiave);
    expect(invii[1].fascia).toBe(FASCE_DI_DOMANI[4]);
    expect(avvisi.fatti, 'la cassa dice «fatto» con l’ordine di prima, come se valesse la fascia nuova').toEqual([]);
    const detto = avvisi.attenzione.join(' · ');
    expect(detto, 'la cassa non dice che l’ordine valido è quello di prima').toMatch(/già ordinato/);
    expect(detto, 'la cassa non dice con quale fascia è l’ordine valido').toContain(FASCE_DI_DOMANI[2]);
  }, 30_000);

  it('risposta persa, indirizzo cambiato, ripremuto: stessa chiave e la cassa dice a quale indirizzo è l’ordine valido', async () => {
    const c = await cassa();
    await c.ordina();
    await c.scrivi('address', 'Via Roma 3');
    await c.ordina();
    expect(invii.length).toBe(2);
    expect(invii[1].chiave).toBe(invii[0].chiave);
    expect(avvisi.fatti, 'la cassa dice «fatto» con l’ordine di prima, come se valesse l’indirizzo nuovo').toEqual([]);
    expect(avvisi.attenzione.join(' · '), 'la cassa non dice a quale indirizzo è l’ordine valido').toContain('Via Verdi 10');
  }, 30_000);

  it('doppio invio con la stessa fascia: stessa chiave e «Ordine effettuato!», come sempre', async () => {
    const c = await cassa();
    await c.ordina();
    await c.ordina();
    expect(invii.length).toBe(2);
    expect(invii[1].chiave, 'il doppio invio dello stesso ordine deve restare protetto').toBe(invii[0].chiave);
    expect(avvisi.attenzione, 'lo stesso ordine ripetuto non è «un altro ordine»').toEqual([]);
    expect(avvisi.fatti).toEqual(['Ordine effettuato!']);
  }, 30_000);
});
