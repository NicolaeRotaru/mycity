import { describe, it, expect } from 'vitest';
import {
  CONSEGNA_NEGOZIO_IN_PIU_CENTS as EURO_NEGOZIO_IN_PIU,
  SPESA_SENZA_SUPPLEMENTO_CENTS as SOGLIA_SPESA,
  SUPPLEMENTO_CONSEGNA_CENTS as EURO_SPESA_PICCOLA,
} from '@/lib/constants';

/** 29/10/2026 22:21 — La regola firmata: una consegna sola per il carrello (base, negozi in più, spesa piccola). */
const regolaDelCarrello = (merciCents: number[]) =>
  PLATFORM_DELIVERY_FEE_CENTS + (merciCents.length - 1) * EURO_NEGOZIO_IN_PIU
  + merciCents.filter((m) => m < SOGLIA_SPESA).length * EURO_SPESA_PICCOLA;
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import ShippingPage from '@/app/shipping/page';
import { metadata as metadatiVicinoATe } from '@/app/near/layout';
import { FreeShippingProgress } from '@/components/ui/FreeShippingProgress';
import {
  COMPENSO_RIDER_CENTS,
  PLATFORM_DELIVERY_FEE_CENTS,
  RAGGIO_CONSEGNA_KM,
  VALUE_PROPS,
} from '@/lib/constants';
import { EXPRESS_ETA_LABEL } from '@/lib/delivery';
import { formatPrice } from '@/lib/format';
import { haversineKm } from '@/lib/geo';
import { prezziDelCarrello, type IngressiPrezzo } from '@/lib/ordini/prezzi';
import { fuoriZonaDiConsegna } from '@/lib/ordini/zona-di-consegna';
import {
  avvisoNessunNegozioVicino,
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
    consegnaVeloce: false,
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

/** Ogni numero scritto in cifre nel testo, così com'è scritto: «3,00», «10», «24». */
function numeriIn(testo: string): string[] {
  return [...testo.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0]);
}

/** I blocchi di testo di un pezzo di HTML (paragrafi, voci di elenco, titoli, riquadri), uno per uno. */
function blocchiDi(html: string): string[] {
  return html
    .split(/<\/(?:p|li|div|h[1-6])>|<br\s*\/?>/i)
    .map((b) => testoDi(b).trim())
    .filter(Boolean);
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
    // 29/10/2026 22:21 — Una consegna sola: la macelleria (spesa più alta) porta la base, il forno
    // l'euro del negozio in più e quello della spesa sotto i 10 €.
    expect(esito.gruppi.map(consegnaPagata)).toEqual([EURO_NEGOZIO_IN_PIU + EURO_SPESA_PICCOLA, PLATFORM_DELIVERY_FEE_CENTS]);
    expect(esito.grandTotalCents).toBe(800 + 1800 + PLATFORM_DELIVERY_FEE_CENTS + EURO_NEGOZIO_IN_PIU + EURO_SPESA_PICCOLA);
    // 29/10/2026 23:04 — Un giro solo (logistica.compenso-fattorino): 3 € sulla macelleria che porta
    // la base, 1 € sul forno, il negozio in più. Prima erano 3 € su ognuno: 6 € al fattorino.
    expect(esito.gruppi.map((g) => g.riderFeeCents)).toEqual([EURO_NEGOZIO_IN_PIU, COMPENSO_RIDER_CENTS]);
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
          const attesa = regolaDelCarrello([Math.round(euro * 100)]);
          const totale = Math.round(euro * 100) + attesa;
          if (pagata !== attesa || esito.grandShippingCents !== 0 || esito.grandTotalCents !== totale) {
            sbagliati.push(`${euro} € a ${km} km verso ${gradi}°: consegna ${pagata} cent, totale ${esito.grandTotalCents} invece di ${totale}`);
          }
        }
      }
    }
    const casi = DIREZIONI.length * DISTANZE.length * SPESE.length;
    expect(sbagliati.slice(0, 6), `${sbagliati.length} casi su ${casi} non pagano i soli 3 euro`).toEqual([]);
  });

  /*
   * 27/10/2026 (quarto giro) — DUE E TRE NEGOZI, IN POSTI DIVERSI.
   *
   * La griglia qui sopra ha un negozio solo, e la prova dei due negozi li mette nello stesso punto
   * con la casa a 5 km. Il collaudo ha rimesso la tariffa a chilometri solo quando il carrello ha
   * due negozi, e tutto è rimasto verde: chi comprava dal forno e dalla macelleria pagava la
   * consegna a distanza, chi comprava da uno solo no. Qui il carrello ha due e tre negozi in tre
   * punti diversi della città, la casa gira tutta la griglia e le spese si incrociano: ogni negozio
   * chiede i suoi 3 euro e niente di più, e il totale è la merce più 3 euro per negozio.
   *
   * 28/10/2026 (sesto giro) — LA PROVA SEGUE IL CONFINE DA SOLA. Contava i casi contro una soglia
   * scritta a mano, più di 10.000, tarata sul confine a 10 km: 8 direzioni × 20 distanze × 91
   * carrelli fa 14.560. Col confine a 5 km le distanze sono 10 e i casi 7.280, e la prova usciva
   * rossa sulla soglia prima di guardare un solo prezzo. Anche la macelleria a 4 km e il fioraio a
   * 7 km dal forno erano scritti a mano: col confine a 5, in 4.144 casi su 7.280 la casa stava oltre
   * il confine di almeno un negozio del carrello, cioè un carrello che la cassa non lascia nascere.
   * Adesso i negozi stanno a frazioni del confine, e la casa gira fino a sette decimi del confine dal
   * forno: da ogni negozio dista al massimo sette decimi più tre decimi, cioè meno del confine. La
   * prova lo verifica con la regola della cassa, e conta i casi verificati contro le dimensioni della
   * griglia. Il prossimo cambio del confine non la riscrive.
   */
  it('con due e tre negozi in posti diversi, a ogni distanza e con ogni spesa: 3 euro per negozio e niente di più', () => {
    // I negozi a frazioni del confine, non a chilometri scritti a mano: col confine a 5 km la
    // macelleria sta a 1 km dal forno e il fioraio a 1,5 km.
    const QUOTA_MACELLERIA = 1 / 5;
    const QUOTA_FIORAIO = 3 / 10;
    // La casa gira fino a sette decimi del confine dal forno: la sua distanza dal forno più quella
    // del negozio più lontano non arriva al confine, quindi ogni casa sta nella zona di ogni negozio.
    // Il forno fino al confine lo guarda già la prova qui sopra; qui il bordo lo tocca il fioraio.
    const QUOTA_CASA = 1 - Math.max(QUOTA_MACELLERIA, QUOTA_FIORAIO);
    const POSIZIONI: Record<string, { lat: number; lng: number }> = {
      forno: NEGOZIO,
      macelleria: puntoA(RAGGIO_CONSEGNA_KM * QUOTA_MACELLERIA, 200),
      fioraio: puntoA(RAGGIO_CONSEGNA_KM * QUOTA_FIORAIO, 60),
    };
    const carrelli: Array<Array<{ sellerId: string; euro: number }>> = [];
    for (const a of SPESE) {
      for (const b of SPESE) carrelli.push([{ sellerId: 'forno', euro: a }, { sellerId: 'macelleria', euro: b }]);
    }
    for (const a of [5, 20, 29.99]) {
      for (const b of [1, 12, 45]) {
        for (const c of [8, 29.99, 30]) {
          carrelli.push([
            { sellerId: 'forno', euro: a },
            { sellerId: 'macelleria', euro: b },
            { sellerId: 'fioraio', euro: c },
          ]);
        }
      }
    }
    const sbagliati: string[] = [];
    const fuoriZona: string[] = [];
    let verificati = 0;
    for (const gradi of DIREZIONI) {
      for (const km of DISTANZE) {
        const kmDalForno = km * QUOTA_CASA;
        const casa = puntoA(kmDalForno, gradi);
        for (const gruppi of carrelli) {
          const lontani = gruppi
            .filter((g) =>
              fuoriZonaDiConsegna({
                storeLat: POSIZIONI[g.sellerId].lat,
                storeLng: POSIZIONI[g.sellerId].lng,
                deliveryLat: casa.lat,
                deliveryLng: casa.lng,
              }),
            )
            .map((g) => g.sellerId);
          if (lontani.length > 0) {
            fuoriZona.push(`casa a ${kmDalForno.toFixed(2)} km dal forno verso ${gradi}°: oltre il confine di ${lontani.join(' e ')}`);
          }
          const esito = conto(gruppi, {
            coordinateNegozio: (id) => POSIZIONI[id],
            consegnaLat: casa.lat,
            consegnaLng: casa.lng,
          });
          const merce = gruppi.reduce((s, g) => s + Math.round(g.euro * 100), 0);
          const regola = regolaDelCarrello(gruppi.map((g) => Math.round(g.euro * 100)));
          const atteso = merce + regola;
          const pagate = esito.gruppi.map(consegnaPagata);
          if (
            pagate.length !== gruppi.length ||
            pagate.reduce((s, p) => s + p, 0) !== regola ||
            esito.grandShippingCents !== 0 ||
            esito.grandTotalCents !== atteso
          ) {
            const chi = gruppi.map((g) => `${g.sellerId} ${g.euro} €`).join(' + ');
            sbagliati.push(`${chi}, casa a ${kmDalForno.toFixed(2)} km dal forno verso ${gradi}°: consegne ${pagate.join('/')} cent, totale ${esito.grandTotalCents} invece di ${atteso}`);
          }
          verificati++;
        }
      }
    }
    // Prima il conto, che è la cosa provata: gira su ogni caso della griglia. Poi le garanzie che la
    // griglia è quella dichiarata: ha carrelli da due e da tre negozi, è stata percorsa tutta (il
    // numero viene dalle sue dimensioni, non da una soglia scritta a mano) ed è fatta solo di
    // carrelli che la cassa lascia nascere.
    expect(sbagliati.slice(0, 6), `${sbagliati.length} carrelli su ${verificati} non pagano la consegna della regola`).toEqual([]);
    expect(new Set(carrelli.map((c) => c.length)), 'mancano i carrelli da due o da tre negozi').toEqual(new Set([2, 3]));
    expect(verificati, 'la griglia dei carrelli con più negozi non è stata percorsa tutta').toBe(
      DIREZIONI.length * DISTANZE.length * carrelli.length,
    );
    expect(
      fuoriZona.slice(0, 6),
      `${fuoriZona.length} casi su ${verificati} hanno la casa oltre il confine di un negozio del carrello: la cassa non li lascia nascere`,
    ).toEqual([]);
  });
});

describe('la pagina Spedizioni dice le cifre della cassa', () => {
  const html = renderToStaticMarkup(<ShippingPage />);
  const testo = testoDi(html);
  const consegnaDellaCassa = consegnaPagata(conto([{ sellerId: 'forno', euro: 20 }]).gruppi[0]) / 100;

  it('ogni importo in euro della pagina è la consegna che la cassa addebita', () => {
    const importi = importiIn(testo);
    expect(importi.length, `la pagina non dice quanto costa la consegna: ${testo.slice(0, 300)}`).toBeGreaterThan(0);
    for (const i of importi) {
      // 29/10/2026 22:21 — La pagina dice anche l'euro dei negozi in più e la soglia dei 10 €.
      expect([consegnaDellaCassa, EURO_NEGOZIO_IN_PIU / 100, EURO_SPESA_PICCOLA / 100, SOGLIA_SPESA / 100], `la pagina scrive ${i} € e la cassa non lo conosce`).toContain(i);
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

  /*
   * 27/10/2026 (terzo giro) — Le prove qui sopra cercano le parole vecchie: «48 ore», «preventivo»,
   * «gratis». Il collaudo ha aggiunto alla pagina, una per volta, «segnalacelo entro 2 giorni»,
   * «oltre il confine su richiesta, con un supplemento», «sopra i trenta euro la consegna te la
   * offriamo noi» e «a negozio chiuso non si possono fare ordini»: sempre verde. Qui si guarda la
   * cosa e non la parola: ogni numero viene da dove è deciso, e ogni promessa ha la sua regola.
   */
  it('ogni numero scritto in cifre viene da dove è deciso: consegna, confine, tempi, garanzia legale', () => {
    const ammessi = new Set([
      ...numeriIn(TRE_EURO),
      ...numeriIn(formatPrice(EURO_NEGOZIO_IN_PIU / 100)),
      ...numeriIn(formatPrice(EURO_SPESA_PICCOLA / 100)),
      ...numeriIn(formatPrice(SOGLIA_SPESA / 100)),
      String(RAGGIO_CONSEGNA_KM),
      ...numeriIn(EXPRESS_ETA_LABEL),
      '24', // la garanzia legale di 24 mesi, che la prova qui sopra pretende
    ]);
    const estranei = numeriIn(testo).filter((n) => !ammessi.has(n));
    expect(estranei, `numeri che la cassa non conosce: ${estranei.join(', ')}`).toEqual([]);
  });

  it('niente scadenze per segnalare un problema, nemmeno scritte in lettere', () => {
    expect(testo).not.toMatch(/\bentro\s+(?:\S+\s+)?(?:or[ae]|giorn[oi]|settiman[ae]|mes[ei])\b/i);
  });

  it('niente consegna regalata, detta con altre parole', () => {
    expect(testo).not.toMatch(/offr|omaggi|regal|inclus|\beuro\b|\b(?:dieci|quindici|venti|trenta|quaranta|cinquanta|cento)\b/i);
  });

  it('niente consegne oltre il confine a un altro prezzo', () => {
    expect(testo).not.toMatch(/supplement|su richiesta|sovrapprezz|maggiorazion|extra/i);
  });

  it('a negozio chiuso ogni frase della pagina dice che si prenota, nessuna che non si può', () => {
    const chiuso = blocchiDi(html).filter((b) => /chius[oa]/i.test(b));
    expect(chiuso.length, 'la pagina non dice cosa succede a negozio chiuso').toBeGreaterThan(0);
    for (const b of chiuso) {
      expect(b).toMatch(/prenot/i);
      expect(b).not.toMatch(/\bnon\b|riprova/i);
    }
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
    // Terzo giro: «l'ordine non parte, riprova domani» diceva «domani» e restava verde.
    expect(NEGOZIO_CHIUSO_COSA_SUCCEDE).toMatch(/prenot/i);
    expect(NEGOZIO_CHIUSO_COSA_SUCCEDE).not.toMatch(/non parte|non viene|riprova|non si pu[oò]|non puoi|in coda/i);
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

  it('la lista parte da un raggio dentro il confine: il cursore non basta, conta il punto di partenza', () => {
    const m = sorgente.match(/\[radiusKm,\s*setRadiusKm\]\s*=\s*useState(?:<[^>]*>)?\(([^)]*)\)/);
    expect(m, 'non trovo lo stato del raggio in app/near/page.tsx').not.toBeNull();
    const iniziale = m![1].trim();
    const km = iniziale === 'RAGGIO_CONSEGNA_KM' ? RAGGIO_CONSEGNA_KM : Number(iniziale);
    expect(Number.isFinite(km), `useState(${iniziale}): la prova sa leggere un numero o RAGGIO_CONSEGNA_KM`).toBe(true);
    expect(km).toBeGreaterThan(0);
    expect(km, `«Vicino a te» parte filtrando a ${km} km, oltre il confine di ${RAGGIO_CONSEGNA_KM}`).toBeLessThanOrEqual(
      RAGGIO_CONSEGNA_KM,
    );
  });

  it('al confine la lista vuota non dice di aumentare il raggio, che non si può', () => {
    const alConfine = avvisoNessunNegozioVicino(RAGGIO_CONSEGNA_KM);
    expect(alConfine).not.toMatch(/aument/i);
    expect(alConfine).toContain(`${RAGGIO_CONSEGNA_KM} km`);
    expect(avvisoNessunNegozioVicino(3)).toMatch(/aument/i);
    expect(sorgente).toContain('avvisoNessunNegozioVicino(radiusKm)');
    expect(sorgente).not.toMatch(/Aumenta il raggio/);
  });

  it('nemmeno la descrizione per Google e per le condivisioni promette una consegna «rapida»', () => {
    const descrizioni = [
      metadatiVicinoATe.description,
      metadatiVicinoATe.openGraph?.description,
      metadatiVicinoATe.twitter?.description,
    ].map((d) => String(d ?? ''));
    for (const d of descrizioni) expect(d).not.toMatch(/rapid|express|immediat/i);
    expect(String(metadatiVicinoATe.description)).toContain(`${RAGGIO_CONSEGNA_KM} km`);
    const categorie = readFileSync(join(process.cwd(), 'app/category/[slug]/layout.tsx'), 'utf8');
    expect(categorie).not.toMatch(/consegna (locale )?rapida/i);
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

describe('dove la cassa non può misurare la distanza, admin e /shipping lo dicono com’è', () => {
  // La regola eseguita: senza una delle due coordinate la cassa non blocca (lib/ordini/zona-di-consegna.ts).
  it('senza la posizione del negozio o della casa la cassa accetta qualunque distanza', () => {
    const milano = { lat: 45.4642, lng: 9.19 };
    expect(fuoriZonaDiConsegna({ storeLat: null, storeLng: null, deliveryLat: milano.lat, deliveryLng: milano.lng })).toBe(false);
    expect(fuoriZonaDiConsegna({ storeLat: NEGOZIO.lat, storeLng: NEGOZIO.lng, deliveryLat: null, deliveryLng: null })).toBe(false);
  });

  it('/shipping: la frase del confine dice anche il caso in cui la cassa non lo misura', () => {
    const blocchi = blocchiDi(renderToStaticMarkup(<ShippingPage />));
    const confine = blocchi.find((b) => b.includes(`${RAGGIO_CONSEGNA_KM} km`) && /cassa/i.test(b));
    expect(confine, 'la pagina non dice più come la cassa controlla il confine').toBeDefined();
    expect(confine, String(confine)).toMatch(/mappa|posizione/i);
  });

  it('admin: la riga del confine dice anche quando la cassa non può misurare', () => {
    const admin = readFileSync(join(process.cwd(), 'app/admin/delivery/page.tsx'), 'utf8');
    const riga = admin.match(/title="Confine della consegna"\s*desc="([^"]*)"/);
    expect(riga, 'non trovo la riga «Confine della consegna» in app/admin/delivery/page.tsx').not.toBeNull();
    expect(riga![1]).toMatch(/posizione|mappa/i);
  });
});
