/**
 * @vitest-environment jsdom
 *
 * R04-009 — DUE GUARDIE SULLA VELOCE CHE LEGGEVANO IL TESTO DEL SORGENTE.
 *
 * Le prove `la-consegna-veloce-si-vende-solo-se-c-e-un-fattorino` (la cassa offre «Adesso» solo col sì del
 * server) e `l-ordine-con-un-appuntamento-gia-passato` (la riga sotto le mattonelle non è un testo fisso)
 * cercavano una stringa nel codice con readFileSync. Qui la cassa si monta intera e si guarda quello che la
 * persona vede e può premere:
 *   ① il server dice no  → «Adesso» si spegne e la scelta passa a domani; dice sì → si offre; la cassa ha
 *      davvero chiesto al server (e per i negozi del carrello);
 *   ② la riga sotto le mattonelle segue la scelta: con «Adesso» dice i minuti, con una fascia di domani dice
 *      quella fascia (un testo fisso direbbe sempre i minuti).
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { act } from 'react';
import { VOCE_CONSEGNA } from '@/lib/promesse-pubbliche';
import { EXPRESS_ETA_LABEL } from '@/lib/delivery';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, info: () => undefined, error: () => undefined }),
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
/** Maria ha già scelto «Adesso»: la bozza la riporta in cassa com'era. */
const BOZZA = {
  form: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567', notes: '' },
  metodoPagamento: 'cod',
  giorno: 'now',
  fasciaOggi: 'In giornata · 15:00–18:00',
  fasciaDomani: 'Domani · 15:00–18:30',
};
// Giovedì 29/10/2026, le 18:00 di Roma: Pane Quotidiano aperto, nelle ore della veloce (8-21).
const GIOVEDI_ALLE_18 = '2026-10-29T17:00:00Z';

/** Le domande che la cassa fa a /api/consegna/veloce, e la risposta che decide la prova. */
const domande: string[] = [];
let rispondi: (esito: unknown) => void = () => undefined;
const reteDiPartenza = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (!url.includes('/api/consegna/veloce')) {
    return { ok: false, status: 503, statusText: 'finto', headers: new Headers(), text: async () => '', json: async () => null };
  }
  domande.push(url);
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
  domande.length = 0;
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

/** La cassa di Maria, a Roma, nell'istante detto. La risposta della veloce arriva quando la manda `veloce()`. */
async function cassa() {
  process.env.TZ = 'Europe/Rome';
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(GIOVEDI_ALLE_18));
  localStorage.setItem('cart', JSON.stringify([FILONE]));
  localStorage.setItem('mc_checkout_draft', JSON.stringify(BOZZA));
  globale.__UTENTE__ = MARIA;
  globale.__MUTAZIONI__ = [];
  globale.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
    const [chi, cosa] = o.queryKey;
    if (chi === 'checkout-groups') return String(cosa).includes(FILONE.id) ? GRUPPI : undefined;
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
    /** La riga sotto il titolo della consegna, quella che dice quando arriva. */
    rigaQuandoArriva: () => {
      const titolo = [...s.radice.querySelectorAll('p')].find((p) => (p.textContent ?? '').trim() === VOCE_CONSEGNA);
      return (titolo?.nextElementSibling?.textContent ?? '').trim();
    },
    veloce: async (esito: unknown) => {
      rispondi(esito);
      await assesta();
    },
    scegli: async (el: Element) => {
      await act(async () => {
        clicca(el);
      });
      await assesta();
    },
  };
}

describe('① la cassa offre «Adesso» solo col sì del server', () => {
  it('la cassa chiede al server la veloce dei negozi del suo carrello', async () => {
    await cassa();
    expect(domande.length, 'la cassa non ha chiesto la veloce').toBe(1);
    expect(domande[0]).toContain('/api/consegna/veloce?negozi=');
    expect(domande[0], 'la domanda non nomina il negozio del carrello').toContain(PANE);
  }, 30_000);

  it('col sì «Adesso» si offre e resta scelta', async () => {
    const c = await cassa();
    expect(c.adesso(), 'la tessera «Adesso» non si trova').not.toBeNull();
    await c.veloce({ possibile: true });
    expect(c.adesso()!.disabled).toBe(false);
    expect(c.adesso()!.getAttribute('aria-pressed')).toBe('true');
  }, 30_000);

  it('col no «Adesso» non si offre più e non resta scelta', async () => {
    const c = await cassa();
    await c.veloce({ possibile: false, perche: 'Nessun fattorino è in servizio adesso.' });
    expect(c.adesso()!.disabled, 'col no del server «Adesso» si offre ancora').toBe(true);
    expect(c.adesso()!.getAttribute('aria-pressed')).toBe('false');
    expect(c.rigaQuandoArriva(), 'senza veloce la riga dice ancora i minuti').not.toContain(EXPRESS_ETA_LABEL);
  }, 30_000);

  it('se la risposta del server è un guasto, «Adesso» non si offre', async () => {
    const c = await cassa();
    await c.veloce(null);
    expect(c.adesso()!.disabled, 'senza un sì del server «Adesso» si offre').toBe(true);
    expect(c.adesso()!.getAttribute('aria-pressed')).toBe('false');
  }, 30_000);
});

describe('② la riga sotto le mattonelle segue la scelta, non è un testo fisso', () => {
  it('con «Adesso» dice i minuti; scelto domani, dice la fascia di domani', async () => {
    const c = await cassa();
    await c.veloce({ possibile: true });
    expect(c.rigaQuandoArriva(), 'il riquadro della consegna non si trova').not.toBe('');
    expect(c.rigaQuandoArriva()).toBe(`In ${EXPRESS_ETA_LABEL} dalla conferma del negozio`);

    await c.scegli(c.domani()!);
    expect(c.domani()!.getAttribute('aria-pressed'), 'la tessera «Domani» non si è scelta').toBe('true');
    const riga = c.rigaQuandoArriva();
    expect(riga, 'scelto domani la riga dice ancora i minuti della veloce').not.toContain(EXPRESS_ETA_LABEL);
    expect(riga).toMatch(/Domani/);
    expect(FASCE_DI_DOMANI.some((f) => riga.includes(f)), `la riga «${riga}» non è una fascia di domani`).toBe(true);
  }, 30_000);
});
