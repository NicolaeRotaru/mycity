import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import ShippingPage from '@/app/shipping/page';
import { FreeShippingProgress } from '@/components/ui/FreeShippingProgress';
import {
  COMPENSO_RIDER_CENTS,
  PLATFORM_DELIVERY_FEE_CENTS,
  RAGGIO_CONSEGNA_KM,
  VALUE_PROPS,
} from '@/lib/constants';
import { formatPrice } from '@/lib/format';
import { haversineKm } from '@/lib/geo';
import { prezziDelCarrello, type IngressiPrezzo } from '@/lib/ordini/prezzi';
import {
  NEGOZIO_CHIUSO_COSA_SUCCEDE,
  promessaSpedizione,
  rispostaCostoSpedizione,
} from '@/lib/promesse-pubbliche';
import { DAY_KEYS, negozioPuoServire } from '@/lib/store-hours';

/**
 * 27/10/2026 — AL LANCIO IL CLIENTE PAGA SOLO LA CONSEGNA: 3 EURO PER NEGOZIO.
 *
 * Le firme di Nicola: scelta 8 della carta #209 (26/10) — promessa «in giornata» e il cliente
 * paga SOLO i 3 euro di consegna per negozio, senza spedizione a chilometri — e la consegna in
 * bici fino a 10 km dal negozio (27/10).
 *
 * Il codice faceva un'altra cosa: sotto i 30 euro per negozio sommava la spedizione a distanza
 * (2,50 € più 1,20 € al km) ai 3 euro di consegna. Venti euro di spesa a 5 km costavano 11,50 €
 * di consegna. La pagina Spedizioni prometteva intanto una tabella sua (2,50 · 3,50 · 4,50 €),
 * «GRATIS» sopra i 30 euro, consegne «entro 15 km» e «oltre 10 km a preventivo»: nessuna di
 * queste cifre era quella della cassa.
 *
 * Qui si prova il comportamento, non le parole: il conto lo fa la stessa funzione delle due
 * rotte che creano l'ordine, e la pagina si trasforma in HTML e si confronta, cifra per cifra e
 * chilometro per chilometro, con le costanti e con quel conto.
 */

const NEGOZIO = { lat: 45.0526, lng: 9.6929 };
// Stessa latitudine, 0,0636° più a est: circa 5 km in linea d'aria.
const CASA_A_5_KM = { lat: 45.0526, lng: 9.7565 };

function conto(gruppi: Array<{ sellerId: string; euro: number }>, opz: Partial<IngressiPrezzo> = {}) {
  return prezziDelCarrello({
    gruppi: gruppi.map((g) => ({ sellerId: g.sellerId, subtotalCents: Math.round(g.euro * 100) })),
    coordinateNegozio: () => NEGOZIO,
    consegnaLat: CASA_A_5_KM.lat,
    consegnaLng: CASA_A_5_KM.lng,
    pickupInStore: false,
    couponSpedizioneGratis: false,
    couponScontoCents: 0,
    ...opz,
  });
}

/** Quanto paga il cliente per farsi portare la spesa di un negozio: spedizione più consegna. */
const consegnaPagata = (g: { shippingCents: number; deliveryFeeCents: number }) => g.shippingCents + g.deliveryFeeCents;

/** Il testo di un pezzo di HTML, con le entità sciolte. */
function testoDi(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t\r\n]+/g, ' ');
}

/** Ogni importo in euro scritto nel testo, in qualunque forma: «3,00 €», «€ 2,50», «€30». */
function importiIn(testo: string): number[] {
  const trovati: number[] = [];
  for (const m of testo.matchAll(/€\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*€/g)) {
    trovati.push(Number((m[1] ?? m[2]).replace(',', '.')));
  }
  return trovati;
}

/** Ogni distanza in chilometri scritta nel testo. */
function chilometriIn(testo: string): number[] {
  return [...testo.matchAll(/(\d+(?:[.,]\d+)?)\s*km\b/gi)].map((m) => Number(m[1].replace(',', '.')));
}

const TRE_EURO = formatPrice(PLATFORM_DELIVERY_FEE_CENTS / 100);

describe('in cassa si pagano solo i 3 euro di consegna per negozio', () => {
  it('la cifra firmata è 3 euro, e il fattorino resta pagato con 3 euro', () => {
    expect(PLATFORM_DELIVERY_FEE_CENTS, 'scelta 8 della carta #209: 3 euro di consegna per negozio').toBe(300);
    expect(COMPENSO_RIDER_CENTS, 'il compenso del fattorino non cambia').toBe(300);
  });

  it('IL CASO CHE ROMPEVA — 20 euro di spesa a 5 km pagano 3 euro di consegna, non 11,50', () => {
    const esito = conto([{ sellerId: 'forno', euro: 20 }]);
    expect(
      consegnaPagata(esito.gruppi[0]),
      'sotto i 30 euro la cassa somma ancora la spedizione a chilometri ai 3 euro di consegna',
    ).toBe(PLATFORM_DELIVERY_FEE_CENTS);
    expect(esito.grandTotalCents).toBe(2000 + PLATFORM_DELIVERY_FEE_CENTS);
    expect(esito.grandShippingCents, 'la spedizione a distanza non esiste più').toBe(0);
  });

  it('senza coordinate non parte una tariffa fissa: restano i 3 euro', () => {
    const esito = conto([{ sellerId: 'forno', euro: 12 }], { consegnaLat: null, consegnaLng: null });
    expect(consegnaPagata(esito.gruppi[0])).toBe(PLATFORM_DELIVERY_FEE_CENTS);
  });

  it('sopra i 30 euro la consegna si paga lo stesso: non esiste più una soglia', () => {
    for (const euro of [29.99, 30, 45, 120]) {
      const esito = conto([{ sellerId: 'forno', euro }]);
      expect(consegnaPagata(esito.gruppi[0]), `con ${euro} € di spesa`).toBe(PLATFORM_DELIVERY_FEE_CENTS);
    }
  });

  it('due negozi pagano due consegne, e ognuno porta il suo compenso del fattorino', () => {
    const esito = conto([
      { sellerId: 'forno', euro: 8 },
      { sellerId: 'macelleria', euro: 18 },
    ]);
    expect(esito.gruppi.map(consegnaPagata)).toEqual([PLATFORM_DELIVERY_FEE_CENTS, PLATFORM_DELIVERY_FEE_CENTS]);
    expect(esito.grandTotalCents).toBe(800 + 1800 + 2 * PLATFORM_DELIVERY_FEE_CENTS);
    expect(esito.gruppi.map((g) => g.riderFeeCents)).toEqual([COMPENSO_RIDER_CENTS, COMPENSO_RIDER_CENTS]);
  });

  it('col ritiro in negozio non si paga consegna', () => {
    const esito = conto([{ sellerId: 'forno', euro: 20 }], { pickupInStore: true });
    expect(consegnaPagata(esito.gruppi[0])).toBe(0);
  });
});

/*
 * 27/10/2026 (terzo giro) — IL TRATTO FRA 6 E 10 KM CHE NESSUNA PROVA GUARDAVA.
 *
 * Le prove qui sopra mettono la casa a 5 km, oppure senza coordinate. Il collaudo ha rimesso la
 * spedizione a chilometri in una forma sola — sotto i 30 euro e oltre i 6 km, 2,50 € più 1,20 €
 * al km — e tutto è rimasto verde: 20 euro di spesa a 9 km costavano 16,30 € di consegna invece
 * di 3. Un punto solo prova quel punto, non il tratto. Qui si prova il tratto intero: ogni mezzo
 * chilometro dal negozio fino al confine, in otto direzioni, con spese da 1 a 120 euro. In ogni
 * punto la cassa chiede i 3 euro di consegna, e niente di più.
 */
const RAGGIO_DELLA_TERRA_KM = 6371;
const DIREZIONI = [0, 45, 90, 135, 180, 225, 270, 315]; // gradi: 0 = nord, 90 = est
const DISTANZE: number[] = [];
for (let km = 0.5; km < RAGGIO_CONSEGNA_KM; km += 0.5) DISTANZE.push(km);
DISTANZE.push(RAGGIO_CONSEGNA_KM - 0.05);
const SPESE = [1, 5, 12, 20, 29.99, 30, 45, 120];

/** Il punto a `km` dal negozio nella direzione `gradi`, sulla sfera: non usa la funzione che prova. */
function puntoA(km: number, gradi: number): { lat: number; lng: number } {
  const rad = Math.PI / 180;
  const d = km / RAGGIO_DELLA_TERRA_KM;
  const verso = gradi * rad;
  const lat1 = NEGOZIO.lat * rad;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(verso));
  const lng2 =
    NEGOZIO.lng * rad +
    Math.atan2(Math.sin(verso) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 / rad, lng: lng2 / rad };
}

describe('a ogni distanza dentro la zona si pagano solo i 3 euro', () => {
  it('i punti della griglia stanno dove dicono (se no la prova sotto non misura niente)', () => {
    for (const gradi of DIREZIONI) {
      for (const km of DISTANZE) {
        const casa = puntoA(km, gradi);
        const misurati = haversineKm(NEGOZIO.lat, NEGOZIO.lng, casa.lat, casa.lng);
        expect(Math.abs(misurati - km), `${km} km verso ${gradi}° ne misura ${misurati}`).toBeLessThan(0.01);
      }
    }
  });

  it('IL CASO DEL COLLAUDO — 20 euro di spesa a 9 km pagano 3 euro di consegna, non 16,30', () => {
    const casa = puntoA(9, 90);
    const esito = conto([{ sellerId: 'forno', euro: 20 }], { consegnaLat: casa.lat, consegnaLng: casa.lng });
    expect(
      consegnaPagata(esito.gruppi[0]),
      'oltre i 6 km la cassa somma ancora una spedizione a chilometri ai 3 euro di consegna',
    ).toBe(PLATFORM_DELIVERY_FEE_CENTS);
    expect(esito.grandTotalCents).toBe(2000 + PLATFORM_DELIVERY_FEE_CENTS);
  });

  it('ogni mezzo chilometro fino al confine, in ogni direzione e con ogni spesa: 3 euro e niente di più', () => {
    const sbagliati: string[] = [];
    for (const gradi of DIREZIONI) {
      for (const km of DISTANZE) {
        const casa = puntoA(km, gradi);
        for (const euro of SPESE) {
          const esito = conto([{ sellerId: 'forno', euro }], { consegnaLat: casa.lat, consegnaLng: casa.lng });
          const pagata = consegnaPagata(esito.gruppi[0]);
          const totale = Math.round(euro * 100) + PLATFORM_DELIVERY_FEE_CENTS;
          if (pagata !== PLATFORM_DELIVERY_FEE_CENTS || esito.grandShippingCents !== 0 || esito.grandTotalCents !== totale) {
            sbagliati.push(`${euro} € a ${km} km verso ${gradi}°: consegna ${pagata} cent, totale ${esito.grandTotalCents} invece di ${totale}`);
          }
        }
      }
    }
    const casi = DIREZIONI.length * DISTANZE.length * SPESE.length;
    expect(sbagliati.slice(0, 6), `${sbagliati.length} casi su ${casi} non pagano i soli 3 euro`).toEqual([]);
  });
});

describe('la pagina Spedizioni dice le cifre della cassa', () => {
  const testo = testoDi(renderToStaticMarkup(<ShippingPage />));
  const consegnaDellaCassa = consegnaPagata(conto([{ sellerId: 'forno', euro: 20 }]).gruppi[0]) / 100;

  it('ogni importo in euro della pagina è la consegna che la cassa addebita', () => {
    const importi = importiIn(testo);
    expect(importi.length, `la pagina non dice quanto costa la consegna: ${testo.slice(0, 300)}`).toBeGreaterThan(0);
    for (const i of importi) {
      expect(i, `la pagina scrive ${i} € e la cassa addebita ${consegnaDellaCassa} €`).toBe(consegnaDellaCassa);
    }
  });

  it('ogni chilometro della pagina è il confine della cassa', () => {
    const km = chilometriIn(testo);
    expect(km.length, 'la pagina non dice fin dove consegniamo').toBeGreaterThan(0);
    for (const k of km) expect(k, `la pagina scrive ${k} km e la cassa si ferma a ${RAGGIO_CONSEGNA_KM}`).toBe(RAGGIO_CONSEGNA_KM);
  });

  it('niente «gratis» e niente «a preventivo»: si paga sempre la consegna, e oltre il confine non si consegna', () => {
    expect(testo).not.toMatch(/gratis|gratuit|preventivo/i);
  });

  it('niente scadenza di 48 ore per segnalare un problema: vale la garanzia legale', () => {
    expect(testo).not.toMatch(/48\s*(h\b|ore)/i);
    expect(testo).toContain('garanzia legale di 24 mesi');
  });

  it('a negozio chiuso la pagina dice quello che fa la cassa', () => {
    expect(testo).toContain(NEGOZIO_CHIUSO_COSA_SUCCEDE);
  });
});

describe('a negozio chiuso si prenota per domani, e la frase pubblica lo dice', () => {
  // Un forno aperto la mattina, ogni giorno: alle 21:30 è chiuso.
  const ORARI_DEL_FORNO = Object.fromEntries(DAY_KEYS.map((k) => [k, [['07:00', '13:00']]]));
  const SERA = new Date(2026, 9, 27, 21, 30);

  it('la cassa: la consegna subito no, la fascia di domani sì', () => {
    expect(negozioPuoServire(ORARI_DEL_FORNO, null, SERA)).toBe(false);
    expect(negozioPuoServire(ORARI_DEL_FORNO, 'Domani · 9:00–12:00', SERA)).toBe(true);
  });

  it('la frase non scoraggia il pre-ordine della sera', () => {
    expect(NEGOZIO_CHIUSO_COSA_SUCCEDE).toMatch(/domani/i);
    expect(NEGOZIO_CHIUSO_COSA_SUCCEDE).not.toMatch(/non puoi ordinare/i);
  });
});

describe('le altre promesse parlano della stessa consegna', () => {
  it('la risposta delle FAQ non ha più la forbice 2,50–4,50 né la soglia', () => {
    const { a } = rispostaCostoSpedizione();
    expect(a).not.toMatch(/2,50|4,50|gratuit|gratis|sopra/i);
    expect(a).toContain(TRE_EURO);
    expect(a).toContain(`${RAGGIO_CONSEGNA_KM} km`);
  });

  it('la frase della vetrina non dice «gratis» né «ti mancano», a nessun sottototale', () => {
    for (const sottototale of [0, 8, 29.99, 30, 80]) {
      const p = promessaSpedizione(sottototale);
      expect(p.sopraSoglia).toBe(false);
      expect(p.mancano).toBe(0);
      expect(p.costoConsegna).toBe(PLATFORM_DELIVERY_FEE_CENTS / 100);
      expect(`${p.titolo} ${p.breve}`).not.toMatch(/gratis|mancano/i);
      expect(p.titolo).toContain(TRE_EURO);
    }
  });

  it('la barra «ti mancano X €» non c’è più: resta la riga con la consegna', () => {
    const html = renderToStaticMarkup(<FreeShippingProgress subtotal={12} />);
    const t = testoDi(html);
    expect(t).not.toMatch(/mancano|gratis/i);
    expect(html).not.toContain('progressbar');
    expect(t).toContain(TRE_EURO);
  });

  it('le quattro promesse della home non dicono più «spedizione gratuita sopra 30 €»', () => {
    const consegna = `${VALUE_PROPS[0].title} ${VALUE_PROPS[0].subtitle}`;
    expect(consegna).not.toMatch(/gratuit|gratis|sopra/i);
    expect(consegna).toContain(TRE_EURO);
    expect(consegna).toContain(`${RAGGIO_CONSEGNA_KM} km`);
  });
});

describe('«Vicino a te» non mostra negozi oltre il confine della consegna', () => {
  // Minore, letto dal sorgente: la pagina è un componente client con mappa e posizione.
  const sorgente = readFileSync(join(process.cwd(), 'app/near/page.tsx'), 'utf8');

  it('il cursore del raggio si ferma al confine della cassa', () => {
    const massimi = [...sorgente.matchAll(/type="range"[\s\S]*?max=\{([^}]+)\}/g)].map((m) => m[1].trim());
    expect(massimi).toEqual(['RAGGIO_CONSEGNA_KM']);
    expect(sorgente).toMatch(/import\s*\{[^}]*\bRAGGIO_CONSEGNA_KM\b[^}]*\}\s*from\s*'@\/lib\/constants'/);
  });

  it('niente «consegna locale rapida» senza un confine', () => {
    expect(sorgente).not.toMatch(/consegna locale rapida/i);
  });
});

describe('il carrello dice la stessa consegna', () => {
  // Le cifre vere le legge la prova montata (la-cassa-mostra-la-spedizione-che-addebita-coi-profili-chiusi):
  // carrello e cassa scrivono la stessa consegna, e nessuno dei due una riga «Gratis» accanto.
  // Il carrello chiama ancora `shippingForEuro` con gli ingressi della cassa: lo tiene fermo
  // il-carrello-e-la-cassa-dicono-lo-stesso-numero. Qui si guarda che non torni la barra della soglia.
  const carrello = readFileSync(join(process.cwd(), 'app/cart/page.tsx'), 'utf8');

  it('la frase del carrello vuoto la scrive promessaSpedizione, e la barra «ti mancano X €» non c’è più', () => {
    expect(carrello).toContain('promessaSpedizione().titolo');
    expect(carrello).not.toMatch(/dettoDellaSpedizione|FreeShippingProgress/);
  });
});
