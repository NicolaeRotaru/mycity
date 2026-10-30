import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ShippingPage from '@/app/shipping/page';
import { prezziDelCarrello, type IngressiPrezzo } from '@/lib/ordini/prezzi';
import { rispostaCostoSpedizione } from '@/lib/promesse-pubbliche';
import { SPESA_SENZA_SUPPLEMENTO_CENTS } from '@/lib/constants';
import { formatPrice } from '@/lib/format';

/**
 * 29/10/2026 — LA TARIFFA SCRITTA DICE ANCHE I 4 EURO.
 *
 * La regola firmata da Nicola (registro dei fatti, consegna.promessa): 3 € per negozio con la
 * fascia, 4 € sotto i 10 € di merce di quel negozio o con la consegna veloce. La cassa la fa da
 * `tariffaConsegnaCents`. Due frasi pubbliche erano rimaste alla regola vecchia dei 3 € fissi:
 *   - il riquadro in cima a /shipping: «Consegna 3,00 € · Per ogni negozio, qualunque sia la spesa»;
 *   - la FAQ «Quanto costa la spedizione?»: «3,00 € per ogni negozio da cui ordini, qualunque sia
 *     la spesa».
 * Un ordine da 8 € di pane paga 4 €. Chi ha letto «qualunque sia la spesa» vede in cassa un euro in
 * più che nessuno gli ha detto.
 *
 * 30/10/2026 (ondata 18) — LA REGOLA DI OGGI (consegna.promessa, 29/10 22:21): una consegna sola per
 * tutto il carrello, 3 € di base, 1 € per ogni negozio in più, 1 € per ogni negozio sotto i 10 €, la
 * veloce 1 € una volta sola. Il corpo della pagina diceva ancora «per ogni negozio da cui ordini» e
 * «se ordini da due negozi paghi due consegne». Pane 15 € e frutta 12 €: la cassa conta 4 €, non due
 * consegne. La pagina disegnata ora deve dirlo: la base una volta sola più l'euro del negozio in più,
 * che sommati fanno quello che conta la cassa.
 *
 * La prova non cerca solo la frase: chiede che, finché la cassa fa pagare diverso a 8 € e a 15 €,
 * ogni testo che dice il prezzo nomini anche la cifra dell'ordine piccolo e la soglia. Riscrivere
 * «qualunque sia la spesa» con altre parole non basta a farla tornare verde.
 */

function consegnaDellaCassa(merceCents: number, consegnaVeloce = false): number {
  const ingressi: IngressiPrezzo = {
    gruppi: [{ sellerId: 's1', subtotalCents: merceCents }],
    coordinateNegozio: () => ({ lat: null, lng: null }),
    consegnaLat: null,
    consegnaLng: null,
    pickupInStore: false,
    couponSpedizioneGratis: false,
    couponScontoCents: 0,
    consegnaVeloce,
  };
  return prezziDelCarrello(ingressi).gruppi[0].deliveryFeeCents;
}

const euro = (cents: number) => formatPrice(cents / 100);

/** Il testo di un pezzo di HTML, con le entità sciolte. */
function testoDi(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t\r\n]+/g, ' ');
}

/** I blocchi di testo come li legge la persona: riquadri, paragrafi, voci d'elenco, titoli. */
function blocchiDi(html: string): string[] {
  return html
    .split(/<\/(?:p|li|div|h[1-6])>|<br\s*\/?>/i)
    .map((b) => testoDi(b).trim())
    .filter(Boolean);
}

const ORDINE_PICCOLO = consegnaDellaCassa(800);
const ORDINE_GRANDE = consegnaDellaCassa(1500);

/** Un testo che dice il prezzo della consegna dice quello che la cassa addebita, anche sotto i 10 €. */
function diceLaTariffaDellaCassa(testo: string, dove: string) {
  // 29/10/2026 22:21 — Una consegna sola per il carrello: la frase dice la base e non promette più
  // «per ogni negozio da cui ordini» né «qualunque sia la spesa» («per ogni negozio in più» è la regola nuova).
  expect(testo, `${dove} non dice la base della consegna (${euro(ORDINE_GRANDE)})`).toContain(euro(ORDINE_GRANDE));
  expect(testo, `${dove} dice ancora la regola per negozio`).not.toMatch(/per ogni negozio da cui ordini|qualunque sia la spesa/i);
  expect(testo, `${dove} non dice che è una sola`).toMatch(/per tutto il carrello/);
}

describe('la cassa: sotto i 10 € di merce la consegna costa 4 €', () => {
  it('8 € con la fascia → 400 centesimi, 15 € con la fascia → 300, 15 € veloce → 400', () => {
    expect(ORDINE_PICCOLO).toBe(400);
    expect(ORDINE_GRANDE).toBe(300);
    expect(consegnaDellaCassa(1500, true)).toBe(400);
  });
});

describe('IL CASO DEL COLLAUDO — il riquadro in cima alla pagina Spedizioni', () => {
  const blocchi = blocchiDi(renderToStaticMarkup(<ShippingPage />));

  it('il riquadro del prezzo nomina anche i 4 € e la soglia dei 10 €', () => {
    const i = blocchi.findIndex((b) => /^Consegna\b/.test(b) && b.includes('€'));
    expect(i, `non trovo il riquadro del prezzo: ${blocchi.slice(0, 6).join(' | ')}`).toBeGreaterThanOrEqual(0);
    diceLaTariffaDellaCassa(`${blocchi[i]} · ${blocchi[i + 1] ?? ''}`, 'il riquadro in cima a /shipping');
  });

  it('nessun blocco promette una consegna per negozio: pane 15 € e frutta 12 € fanno una consegna, quella della cassa', () => {
    const perNegozio = blocchi.filter((b) => /per ogni negozio da cui ordini|due consegne|ogni negozio ti porta/i.test(b));
    expect(perNegozio).toEqual([]);
    const dueNegozi: IngressiPrezzo = {
      gruppi: [{ sellerId: 's1', subtotalCents: 1500 }, { sellerId: 's2', subtotalCents: 1200 }],
      coordinateNegozio: () => ({ lat: null, lng: null }),
      consegnaLat: null,
      consegnaLng: null,
      pickupInStore: false,
      couponSpedizioneGratis: false,
      couponScontoCents: 0,
      consegnaVeloce: false,
    };
    const consegna = prezziDelCarrello(dueNegozi).gruppi.reduce((t, g) => t + g.deliveryFeeCents, 0);
    expect(consegna).toBe(400);
    const tariffa = blocchi.find((b) => b.includes('una volta sola per tutto il carrello'));
    expect(tariffa, 'la pagina non dice che la consegna è una sola').toBeTruthy();
    const base = ORDINE_GRANDE;
    const inPiu = consegna - base;
    expect(tariffa).toContain(`${euro(base)} una volta sola per tutto il carrello`);
    expect(tariffa).toContain(`${euro(inPiu)} in più per ogni negozio in più`);
  });

  it('nessun altro blocco della pagina promette lo stesso prezzo a ogni spesa', () => {
    if (ORDINE_PICCOLO === ORDINE_GRANDE) return;
    const sbagliati = blocchi.filter((b) => /qualunque sia la spesa|a prescindere dalla spesa/i.test(b));
    expect(sbagliati).toEqual([]);
  });
});

describe('IL CASO DEL COLLAUDO — la FAQ «Quanto costa la spedizione?»', () => {
  it('la risposta dice i 3 €, i 4 € e la soglia dei 10 €, non «qualunque sia la spesa»', () => {
    diceLaTariffaDellaCassa(rispostaCostoSpedizione().a, 'la FAQ sul costo della spedizione');
    expect(rispostaCostoSpedizione().a, 'la FAQ non dice la soglia dei 10 €').toContain(euro(SPESA_SENZA_SUPPLEMENTO_CENTS));
  });
});
