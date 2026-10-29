import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 29/10/2026 22:21 — LA CONSEGNA È UNA SOLA, PER TUTTO IL CARRELLO (registro dei fatti, consegna.promessa).
 *
 * ① 3 € di base per tutto il carrello · ② +1 € per ogni negozio in più · ③ +1 € per ogni negozio
 * sotto i 10 € di merce dopo gli sconti · ④ la veloce +1 € una volta sola, compresa se al punto ③
 * c'è già almeno un euro. L'ondata 13 faceva pagare 3 o 4 € a OGNI negozio: 15+12 uscivano a 6 €.
 * Qui si danno i carrelli firmati da Nicola al conto vero, allo schermo e al riepilogo della cassa,
 * e si pretendono gli stessi centesimi.
 */

const stato: { profili: Array<Record<string, unknown>>; frenato: boolean } = { profili: [], frenato: false };

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@/lib/rate-limit')>();
  return {
    ...vero,
    rateLimitAsync: vi.fn(async () =>
      stato.frenato
        ? { allowed: false, remaining: 0, retryAfterSec: 30, limit: 30 }
        : { allowed: true, remaining: 29, retryAfterSec: 0, limit: 30 },
    ),
  };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from() {
      const filtri: Array<[string, unknown]> = [];
      let ids: string[] | null = null;
      let conteggio = false;
      const q: Record<string, unknown> = {
        select: (_c: string, o?: { head?: boolean }) => { conteggio = !!o?.head; return q; },
        eq: (c: string, v: unknown) => { filtri.push([c, v]); return q; },
        in: (_c: string, v: string[]) => { ids = v; return q; },
        then: (ok: (r: unknown) => unknown) => {
          const righe = stato.profili.filter(
            (r) => filtri.every(([c, v]) => r[c] === v) && (ids === null || ids.includes(String(r.id))),
          );
          return Promise.resolve(conteggio ? { count: righe.length, error: null } : { data: righe, error: null }).then(ok);
        },
      };
      return q;
    },
  }),
}));

import { prezziDelCarrello, vociDellaConsegna, type IngressiPrezzo } from '@/lib/ordini/prezzi';
import { calcolaTotali } from '@/components/checkout/useTotaliCarrello';
import { riepilogoDaMostrare } from '@/lib/ordini/riepilogo-cassa';
import { computeOrderSplit } from '@/lib/stripe/client';
import { COMPENSO_RIDER_CENTS } from '@/lib/constants';
import { formatPrice } from '@/lib/format';
import { leggiEsitoDellaVeloce } from '@/lib/ordini/consegna-veloce';
import {
  avvisoSpesaPiccola,
  promessaSpedizione,
  rigaDelCodiceSpedizione,
  rigaDellaVeloceNelCarrello,
  righeDellaConsegna,
  riquadroTariffaConsegna,
  rispostaCostoSpedizione,
  spiegazioneDellaConsegna,
} from '@/lib/promesse-pubbliche';
import { quandoLaVeloceCade } from '@/components/checkout/DeliverySlotPicker';
import { GET as veloceGET } from '@/app/api/consegna/veloce/route';

function ing(merci: number[], o: Partial<IngressiPrezzo> = {}): IngressiPrezzo {
  return {
    gruppi: merci.map((c, i) => ({ sellerId: `negozio-${i}`, subtotalCents: c })),
    coordinateNegozio: () => ({ lat: null, lng: null }),
    consegnaLat: null,
    consegnaLng: null,
    pickupInStore: false,
    couponSpedizioneGratis: false,
    couponScontoCents: 0,
    consegnaVeloce: false,
    ...o,
  };
}
const consegna = (merci: number[], o: Partial<IngressiPrezzo> = {}) =>
  prezziDelCarrello(ing(merci, o)).gruppi.reduce((s, g) => s + g.deliveryFeeCents, 0);

/** Gli esempi firmati: spesa per negozio in centesimi → [con la fascia, con la veloce]. */
const FIRMATI: Array<[number[], number, number]> = [
  [[1500], 300, 400],
  [[800], 400, 400],
  [[1500, 1200], 400, 500],
  [[1500, 600], 500, 500],
  [[600, 700], 600, 600],
  [[1500, 1200, 2000], 500, 600],
  [[1500, 1200, 500], 600, 600],
  [[500, 600, 700], 800, 800],
];

describe('la consegna è una sola per tutto il carrello', () => {
  it.each(FIRMATI)('carrello %j: %i con la fascia, %i con la veloce', (merci, fascia, veloce) => {
    expect(consegna(merci)).toBe(fascia);
    expect(consegna(merci, { consegnaVeloce: true })).toBe(veloce);
  });

  it('la somma delle consegne degli ordini è la consegna del carrello, al centesimo', () => {
    for (const [merci] of FIRMATI) {
      for (const consegnaVeloce of [false, true]) {
        const p = prezziDelCarrello(ing(merci, { consegnaVeloce }));
        expect(p.gruppi.reduce((s, g) => s + g.deliveryFeeCents, 0)).toBe(p.consegna.totaleCents);
        expect(p.grandDeliveryFeeCents).toBe(p.consegna.totaleCents);
      }
    }
  });

  it('il primo negozio, quello che porta la base e la veloce, è la spesa più alta; a parità il primo', () => {
    expect(prezziDelCarrello(ing([1200, 1500], { consegnaVeloce: true })).gruppi.map((g) => g.deliveryFeeCents)).toEqual([100, 400]);
    expect(prezziDelCarrello(ing([1500, 1500])).gruppi.map((g) => g.deliveryFeeCents)).toEqual([300, 100]);
  });

  it('la soglia dei 10 € si conta negozio per negozio, dopo gli sconti', () => {
    // 12 € con 3 € di sconto: 9 € di merce, sotto la soglia.
    expect(consegna([1200], { couponScontoCents: 300 })).toBe(400);
    expect(consegna([999])).toBe(400);
    expect(consegna([1000])).toBe(300);
  });

  it('il ritiro in negozio non ha consegna', () => {
    expect(consegna([800, 600], { pickupInStore: true, consegnaVeloce: true })).toBe(0);
  });

  it('il codice «Spedizione gratuita» toglie solo la base, mai gli euro in più', () => {
    expect(consegna([5000], { couponSpedizioneGratis: true })).toBe(0);
    expect(consegna([5000], { couponSpedizioneGratis: true, consegnaVeloce: true })).toBe(100);
    expect(consegna([5000, 4000], { couponSpedizioneGratis: true })).toBe(100);
    expect(consegna([5000, 600], { couponSpedizioneGratis: true })).toBe(200);
  });

  it('un negozio solo tiene le garanzie dell’ondata 13: fattorino coperto e bonifici dentro l’incasso', () => {
    const errori: string[] = [];
    for (let c = 1; c <= 6000; c++) {
      for (const consegnaVeloce of [false, true]) {
        for (const couponSpedizioneGratis of [false, true]) {
          const [g] = prezziDelCarrello(ing([c], { consegnaVeloce, couponSpedizioneGratis })).gruppi;
          const split = computeOrderSplit({ totalCents: g.totalCents, deliveryFeeCents: g.deliveryFeeCents, shippingCents: g.shippingCents });
          if (g.deliveryFeeCents + split.applicationFeeCents < COMPENSO_RIDER_CENTS) errori.push(`fattorino scoperto ${c}`);
          if (split.sellerPayoutCents + g.riderFeeCents > g.totalCents) errori.push(`bonifici oltre l'incasso ${c}`);
        }
      }
    }
    expect(errori.slice(0, 5), `${errori.length} casi`).toEqual([]);
  });

  it('con più negozi il cliente paga la regola, e schermo e riepilogo danno gli stessi centesimi', () => {
    const errori: string[] = [];
    const secondi = [1, 999, 1000, 2999];
    for (let c = 1; c <= 3000; c += 7) {
      for (const b of secondi) {
        for (const terzo of [null, 500]) {
          for (const consegnaVeloce of [false, true]) {
            const merci = terzo === null ? [c, b] : [c, b, terzo];
            const i = ing(merci, { consegnaVeloce });
            const server = prezziDelCarrello(i);
            const sotto = merci.filter((m) => m < 1000).length;
            const attesa = 300 + (merci.length - 1) * 100 + sotto * 100 + (consegnaVeloce && sotto === 0 ? 100 : 0);
            if (server.grandDeliveryFeeCents !== attesa) errori.push(`${merci.join('+')} veloce=${consegnaVeloce}: ${server.grandDeliveryFeeCents} invece di ${attesa}`);
            const schermo = calcolaTotali({
              gruppi: merci.map((m, k) => ({ sellerId: `negozio-${k}`, subtotalEuro: m / 100, storeLat: null, storeLng: null })),
              consegnaLat: null, consegnaLng: null, pickupInStore: false, couponSpedizioneGratis: false,
              couponScontoEuro: 0, consegnaVeloce, creditoDisponibileEuro: 0,
            }).centesimi;
            schermo.gruppi.forEach((s, k) => {
              if (s.deliveryFeeCents !== server.gruppi[k].deliveryFeeCents) errori.push(`schermo diverso ${merci.join('+')}`);
            });
            const cassa = riepilogoDaMostrare({ ...i, usaCredito: false, creditoDisponibileCents: 0 });
            if (Math.round(cassa.totale * 100) !== server.grandTotalCents) errori.push(`riepilogo diverso ${merci.join('+')}`);
          }
        }
      }
    }
    expect(errori.slice(0, 5), `${errori.length} casi`).toEqual([]);
  });

  it('le voci del dettaglio sommano la consegna e compaiono solo quando costano', () => {
    const v = vociDellaConsegna({ pickupInStore: false, negozi: [{ spesaCents: 1500, merceCents: 1500 }, { spesaCents: 600, merceCents: 600 }], consegnaVeloce: false });
    expect(righeDellaConsegna(v)).toEqual([
      `· base, per tutto il carrello: ${formatPrice(3)}`,
      `· 1 negozio in più: ${formatPrice(1)}`,
      `· spesa sotto i ${formatPrice(10)} in 1 negozio: ${formatPrice(1)}`,
    ]);
    const solo = vociDellaConsegna({ pickupInStore: false, negozi: [{ spesaCents: 1500, merceCents: 1500 }], consegnaVeloce: false });
    expect(righeDellaConsegna(solo)).toEqual([`· base, per tutto il carrello: ${formatPrice(3)}`]);
    expect(avvisoSpesaPiccola(600)).toContain(`Ti mancano ${formatPrice(4)}`);
    expect(avvisoSpesaPiccola(1000)).toBeNull();
  });
});

describe('le frasi dicono la regola nuova', () => {
  it('nessuna frase pubblica dice più «per ogni negozio»', () => {
    const r = riquadroTariffaConsegna();
    expect(r.titolo).toBe(`Consegna da ${formatPrice(3)}`);
    expect(r.sottotitolo).toBe('Una sola per tutto il carrello');
    const faq = rispostaCostoSpedizione();
    expect(faq.q).toBe('Quanto costa la consegna?');
    expect(faq.a).toContain('una volta sola, per tutto il carrello');
    for (const t of [r.titolo, r.sottotitolo, faq.a, promessaSpedizione().titolo]) {
      expect(t).not.toMatch(/per ogni negozio da cui|qualunque sia la spesa|per negozio\b/);
    }
    expect(promessaSpedizione().titolo).toBe(`Consegna MyCity da ${formatPrice(3)} per tutto il carrello`);
  });

  it('gli esempi della spiegazione escono dal conto vero', () => {
    const s = spiegazioneDellaConsegna('Paghi alla consegna.');
    expect(s.esempi).toContain(`2 negozi, ${formatPrice(15)} + ${formatPrice(12)}: ${formatPrice(4)} all’ora che scegli, ${formatPrice(5)} con la veloce`);
    expect(s.esempi).toContain(`3 negozi, ${formatPrice(5)} + ${formatPrice(6)} + ${formatPrice(7)}: ${formatPrice(8)} all’ora che scegli, ${formatPrice(8)} con la veloce`);
  });

  it('col codice e la veloce, a 40 € la riga non dice «la copre tutta»', () => {
    const conCodice = prezziDelCarrello(ing([4000], { couponSpedizioneGratis: true, consegnaVeloce: true }));
    const senza = prezziDelCarrello(ing([4000], { consegnaVeloce: true }));
    const riga = rigaDelCodiceSpedizione(conCodice.grandDeliveryFeeCents, 1, senza.grandDeliveryFeeCents);
    expect(conCodice.grandDeliveryFeeCents).toBe(100);
    expect(riga).not.toContain('la copre tutta');
    expect(riga).toContain('restano da pagare');
  });
});

describe('la veloce: nel carrello è una scelta, e una risposta storta non vale «sì»', () => {
  it('solo «possibile: true» vale sì', () => {
    expect(leggiEsitoDellaVeloce({ possibile: true })).toBe(true);
    expect(leggiEsitoDellaVeloce({ possibile: false, perche: 'x' })).toBe(false);
    for (const storta of [null, undefined, {}, { possibile: 'true' }, { error: 'giù' }, 'ok']) {
      expect(leggiEsitoDellaVeloce(storta), JSON.stringify(storta)).toBeNull();
    }
  });

  it('sotto il totale del carrello la veloce dice il suo prezzo, o «compresa», o che adesso non c’è', () => {
    expect(rigaDellaVeloceNelCarrello(true, 100, 300)).toContain(`${formatPrice(1)} in più`);
    expect(rigaDellaVeloceNelCarrello(true, 0, 400)).toContain(`già compresa nei ${formatPrice(4)}`);
    expect(rigaDellaVeloceNelCarrello(false, 100, 300)).toContain('non c’è');
    expect(rigaDellaVeloceNelCarrello(null, 100, 300)).toBeNull();
  });

  it('se la veloce cade dopo «Adesso», la cassa torna alla fascia e lo dice', () => {
    const caduta = quandoLaVeloceCade({ day: 'now', expressAvailable: false, ora: 10 });
    expect(caduta?.day).toBe('today');
    expect(caduta?.avviso).toMatch(/non si può più/);
    expect(quandoLaVeloceCade({ day: 'now', expressAvailable: true, ora: 10 })).toBeNull();
  });
});

describe('la rotta pubblica della veloce', () => {
  const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';
  const CLIENTE = 'cccccccc-0000-0000-0000-000000000003';
  const INESISTENTE = 'dddddddd-0000-0000-0000-000000000004';
  beforeEach(() => {
    // Le 10 a Piacenza: dentro le 8-21, così la risposta dipende dai negozi e non dall'orologio.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T09:00:00Z'));
    stato.frenato = false;
    stato.profili = [
      { id: NEGOZIO, role: 'seller', is_approved: true, store_name: 'Forno', store_hours: null },
      { id: CLIENTE, role: 'buyer', is_approved: true, store_name: null, store_hours: null },
    ];
  });
  afterEach(() => vi.useRealTimers());
  const chiedi = async (id: string) => {
    const r = await veloceGET(new Request(`http://localhost/api/consegna/veloce?negozi=${id}`));
    return { status: r.status, corpo: await r.json() };
  };

  it('l’uuid di un cliente risponde come un uuid che non esiste', async () => {
    expect(await chiedi(CLIENTE)).toEqual(await chiedi(INESISTENTE));
  });

  it('ha un limite di richieste', async () => {
    stato.frenato = true;
    expect((await chiedi(NEGOZIO)).status).toBe(429);
  });
});
