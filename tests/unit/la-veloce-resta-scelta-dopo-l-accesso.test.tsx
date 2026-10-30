/**
 * @vitest-environment jsdom
 */
/**
 * 30/10/2026 (ondata 18) — IL CLIENTE SCEGLIE LA VELOCE, PASSA DALL'ACCESSO E TORNA IN CASSA.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────────
 * L'accesso si chiede solo quando si conferma: quasi ogni cliente nuovo passa di lì. La cassa salva
 * la bozza con «Adesso» e lo manda all'accesso. Al ritorno la bozza rimette «Adesso», ma la cassa
 * ripartiva con `veloceDisponibile = false`: la domanda a /api/consegna/veloce parte solo dopo che
 * il carrello è stato letto. Il selettore vedeva «Adesso» con la veloce spenta, spostava la scelta
 * su una fascia e scriveva «la consegna veloce adesso non si può più». Mezzo secondo dopo il server
 * diceva «sì», ma la scelta del cliente era già persa.
 *
 * La regola: finché la risposta non arriva, la veloce è «non so ancora», non «no». La scelta resta,
 * il pulsante per ordinare aspetta, e solo un no vero sposta la scelta, con un avviso che dice
 * QUALE fascia ha messo (non «la prima fascia libera»: il selettore non sa se è libera).
 *
 * ── E l'orologio ──────────────────────────────────────────────────────────────────────────────
 * La cassa leggeva l'ora del telefono, la vetrina e le rotte quella di Roma. Un telefono a Bucarest
 * alle 21:30 (a Roma le 20:30) si vedeva togliere «Adesso» che la vetrina prometteva; uno a Londra
 * alle 20:30 (a Roma le 21:30) se lo vedeva offrire, e la rotta l'avrebbe rifiutato. Qui la cassa si
 * monta su quei telefoni, e anche l'invio (che rilegge l'ora) deve seguire Roma.
 *
 * Qui la pagina di cassa si MONTA intera: bozza nel browser, cliente entrato, risposta della veloce
 * che arriva quando lo decide la prova.
 *
 * ⚠️ Cosa NON prova: un browser vero (qui c'è jsdom) né la rotta /api/consegna/veloce, che qui è
 * finta: la sua regola la prova `la-consegna-veloce-si-vende-solo-se-c-e-un-fattorino`.
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { act } from 'react';
import { formatPrice } from '@/lib/format';
import { romeNow } from '@/lib/store-hours';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';
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
const FILONE = { id: 'p-filone', name: 'Filone', price: 15, quantity: 1, sellerId: PANE, storeName: 'Pane Quotidiano' };
const GRUPPI = {
  groups: [{ sellerId: PANE, storeName: 'Pane Quotidiano', storeLat: null, storeLng: null, items: [FILONE] }],
  orphans: [],
  stockIssues: [],
  variantIssues: [],
  prezziCambiati: [],
};

/** La bozza che la cassa ha salvato prima di mandare Maria all'accesso: aveva scelto «Adesso». */
const BOZZA = {
  form: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567', notes: '' },
  metodoPagamento: 'cod',
  giorno: 'now',
  fasciaOggi: 'In giornata · 15:00–18:00',
  fasciaDomani: 'Domani · 15:00–18:30',
};

/** La risposta della veloce: la prova decide quando arriva e cosa dice. */
let rispondi: (esito: unknown) => void = () => undefined;
let domandeVeloce = 0;
const reteDiPartenza = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (!url.includes('/api/consegna/veloce')) {
    return { ok: false, status: 503, statusText: 'finto', headers: new Headers(), text: async () => '', json: async () => null };
  }
  domandeVeloce += 1;
  const esito = await new Promise<unknown>((r) => {
    rispondi = r;
  });
  return { ok: true, json: async () => esito };
}) as unknown as typeof fetch;

const fusoDiPartenza = process.env.TZ;
let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  vi.useRealTimers();
  avvisi.errori.length = 0;
  domandeVeloce = 0;
  rispondi = () => undefined;
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

/**
 * La cassa riaperta da Maria dopo l'accesso, su un telefono col fuso detto, nell'istante detto (in
 * tempo universale). La risposta della veloce NON è ancora arrivata: la manda `veloce()`.
 */
async function cassaDopoLAccesso(fuso: string, istanteUtc: string, gruppi: typeof GRUPPI = GRUPPI) {
  process.env.TZ = fuso;
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(istanteUtc));
  localStorage.setItem('cart', JSON.stringify(gruppi.groups.flatMap((g) => g.items)));
  localStorage.setItem('mc_checkout_draft', JSON.stringify(BOZZA));
  globale.__UTENTE__ = MARIA;
  globale.__MUTAZIONI__ = [];
  globale.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
    const [chi, cosa] = o.queryKey;
    // Come la lettura vera: i gruppi arrivano solo dopo che il carrello è stato letto.
    if (chi === 'checkout-groups') return String(cosa).includes(gruppi.groups[0].items[0].id) ? gruppi : undefined;
    if (chi === 'auth-user') return MARIA;
    if (chi === 'user-addresses') return [];
    return undefined;
  };
  const pagina = (await monta('app/checkout/page.tsx')).default;
  schermo = accendi(pagina, {});
  await assesta();
  const s = schermo;
  const tessera = (nome: string) => s.radice.querySelector<HTMLButtonElement>(`button[aria-label^="${nome},"]`);
  return {
    adesso: () => tessera('Adesso'),
    domani: () => tessera('Domani'),
    testo: () => testoVisibile(s.radice),
    /** La cifra del riquadro «Consegna a domicilio», la prima della consegna che si vede. */
    consegna: () => {
      const titolo = [...s.radice.querySelectorAll('p')].find((p) => (p.textContent ?? '').trim() === 'Consegna a domicilio');
      return (titolo?.parentElement?.nextElementSibling?.textContent ?? '').trim();
    },
    /** Le righe che la pagina annuncia (role=status), tutte insieme. */
    avviso: () => [...s.radice.querySelectorAll('[role="status"]')].map((n) => n.textContent ?? '').join(' · '),
    fascia: () => s.radice.querySelector<HTMLInputElement>('input[name="deliverySlot"]:checked')?.value ?? null,
    /** Il pulsante in fondo, l'unico che si vede sul telefono. */
    bloccato: () => s.radice.querySelector('button[form="checkout-form"]')?.getAttribute('aria-disabled') === 'true',
    veloce: async (esito: unknown) => {
      rispondi(esito);
      await assesta();
    },
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

describe('la veloce scelta da ospite resta scelta dopo l’accesso', () => {
  // Giovedì 29/10/2026 alle 18:00 di Roma: Pane Quotidiano aperto, Nicola in servizio.
  const GIOVEDI_ALLE_18 = '2026-10-29T17:00:00Z';

  it('finché il server non risponde, «Adesso» resta scelta e il pulsante aspetta; col sì si ordina a 4 €', async () => {
    const c = await cassaDopoLAccesso('Europe/Rome', GIOVEDI_ALLE_18);
    expect(romeNow().getHours(), 'a Roma sono le 18: il caso è quello giusto').toBe(18);
    expect(domandeVeloce, 'la cassa non ha chiesto la veloce: la prova non misurerebbe niente').toBe(1);

    // La risposta non è ancora arrivata.
    expect(c.adesso(), 'la tessera «Adesso» non si trova').not.toBeNull();
    expect(c.adesso()!.getAttribute('aria-pressed'), 'la cassa ha tolto «Adesso» prima che il server rispondesse').toBe('true');
    expect(c.testo(), 'la cassa dice che la veloce non si può, ma il server non ha ancora risposto').not.toMatch(/non si può più/);
    expect(c.consegna(), '15 € di pane con la veloce: 3 € più 1 € di veloce').toBe(formatPrice(4));
    expect(c.bloccato(), 'senza la risposta del server il pulsante per ordinare deve aspettare').toBe(true);

    await c.veloce({ possibile: true });
    expect(c.adesso()!.getAttribute('aria-pressed'), 'arrivato il sì, «Adesso» deve essere ancora la scelta').toBe('true');
    expect(c.testo()).not.toMatch(/non si può più/);
    expect(c.consegna()).toBe(formatPrice(4));
    expect(c.bloccato(), 'col sì del server si deve poter ordinare').toBe(false);
  }, 30_000);

  it('solo un no vero sposta la scelta: e l’avviso dice quale fascia ha messo, la prima di domani', async () => {
    // Venerdì 30/10/2026 alle 20:30 di Roma: per oggi non c'è più nessuna fascia.
    const c = await cassaDopoLAccesso('Europe/Rome', '2026-10-30T19:30:00Z');
    expect(c.adesso()!.getAttribute('aria-pressed')).toBe('true');

    await c.veloce({ possibile: false, perche: 'Nessun fattorino è in servizio adesso.' });
    expect(c.adesso()!.getAttribute('aria-pressed'), 'col no del server «Adesso» non può restare scelta').toBe('false');
    expect(c.adesso()!.disabled, 'col no del server «Adesso» non si offre').toBe(true);
    expect(c.domani()!.getAttribute('aria-pressed')).toBe('true');
    expect(c.fascia(), 'la fascia messa al posto della veloce non è la prima di domani').toBe(FASCE_DI_DOMANI[0]);
    expect(c.avviso(), 'lo spostamento deve dirlo').toMatch(/non si può più/);
    expect(c.avviso(), 'l’avviso deve dire quale fascia ha messo').toContain(FASCE_DI_DOMANI[0]);
    expect(c.avviso(), 'il selettore non sa se la fascia è libera: non può dirlo').not.toMatch(/prima fascia libera/);
    expect(c.consegna(), '15 € di pane con la fascia: 3 €').toBe(formatPrice(3));
    expect(c.bloccato()).toBe(false);
  }, 30_000);
});

describe('la cassa legge l’ora di Roma, non quella del telefono', () => {
  it('Bucarest alle 21:30 (a Roma le 20:30), col sì: «Adesso» resta, e l’ordine parte con la veloce', async () => {
    const c = await cassaDopoLAccesso('Europe/Bucharest', '2026-10-30T19:30:00Z');
    expect(new Date().getHours(), 'il fuso di Bucarest non ha preso: la prova non misurerebbe niente').toBe(21);
    await c.veloce({ possibile: true });
    expect(c.adesso()!.disabled, 'a Roma sono le 20:30: la veloce si offre, come in vetrina').toBe(false);
    expect(c.adesso()!.getAttribute('aria-pressed'), 'la cassa ha tolto «Adesso» leggendo l’ora del telefono').toBe('true');
    expect(c.testo()).not.toMatch(/non si può più/);
    expect(c.consegna()).toBe(formatPrice(4));

    // L'invio rilegge l'ora: deve essere la stessa, quella di Roma.
    const ordini = await c.ordina();
    expect(avvisi.errori, 'l’invio ha riletto l’ora del telefono e ha fermato l’ordine').toEqual([]);
    expect(ordini, 'l’ordine non è partito').toBe(1);
  }, 30_000);

  it('Londra alle 20:30 (a Roma le 21:30), col sì: la veloce non si offre, come in vetrina e nelle rotte', async () => {
    const c = await cassaDopoLAccesso('Europe/London', '2026-10-30T20:30:00Z');
    expect(new Date().getHours(), 'il fuso di Londra non ha preso: la prova non misurerebbe niente').toBe(20);
    await c.veloce({ possibile: true });
    expect(c.adesso()!.disabled, 'a Roma sono le 21:30: la cassa offre una veloce che la rotta rifiuterebbe').toBe(true);
    expect(c.adesso()!.getAttribute('aria-pressed')).toBe('false');
    expect(c.domani()!.getAttribute('aria-pressed')).toBe('true');
    expect(c.consegna()).toBe(formatPrice(3));
  }, 30_000);
});

describe('con più negozi la cassa dice quello che dice il carrello: un giro solo', () => {
  it('pane 15 € da Pane Quotidiano e frutta 12 €: nessun «ogni rider consegna il proprio ordine»', async () => {
    const FRUTTA = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    const MELE = { id: 'p-mele', name: 'Mele', price: 12, quantity: 1, sellerId: FRUTTA, storeName: 'Frutta Bella' };
    const due = {
      ...GRUPPI,
      groups: [...GRUPPI.groups, { sellerId: FRUTTA, storeName: 'Frutta Bella', storeLat: null, storeLng: null, items: [MELE] }],
    };
    const c = await cassaDopoLAccesso('Europe/Rome', '2026-10-29T17:00:00Z', due);
    await c.veloce({ possibile: true });
    expect(c.testo(), 'il riquadro dei negozi non c’è: la prova non misurerebbe niente').toMatch(/prodotti da 2 negozi diversi/);
    expect(c.testo(), 'la cassa promette un fattorino per negozio').not.toMatch(/Ogni rider consegna il proprio ordine/);
    expect(c.testo(), 'la cassa promette una consegna per negozio').not.toMatch(/fa consegnare il proprio/);
    expect(c.testo(), 'la cassa non dice il giro unico del carrello').toMatch(/il fattorino passa da tutti in un giro solo/);
  }, 30_000);
});
