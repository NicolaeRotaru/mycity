/**
 * 6/9/2026 — IL CARRELLO VUOTO PROMETTEVA «SPEDIZIONE GRATIS SOPRA €30», E TACEVA I 3 € DI CONSEGNA.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────────
 * Lo stato vuoto del carrello aveva la frase battuta a mano, soglia compresa:
 * «Scopri i prodotti dei negozi della tua città. Spedizione gratis sopra €30.»
 *
 * Su ogni ordine portato a casa si pagano comunque 3 € di «Consegna MyCity», uno per negozio,
 * anche sopra i 30 (`PLATFORM_DELIVERY_FEE_CENTS`, e il conto lo fa `prezziDelCarrello`). È il
 * difetto per cui `promessaSpedizione` è stata scritta: la scheda prodotto, il distintivo di
 * catalogo e la barra «ti manca poco» le parole le chiedono già a lei. Questa riga era rimasta
 * l'ultima a scriversele da sola — e con la soglia dentro, quindi il giorno che uno dei due numeri
 * cambia resta indietro senza che nessuno se ne accorga.
 *
 * ── Cosa prova questo file, e cosa NON prova ────────────────────────────────────────────────────
 *   ① ESEGUE la funzione che tiene i due numeri e la mette a confronto con la cassa vera: il costo
 *      che il carrello vuoto annuncia è lo stesso centesimo che `prezziDelCarrello` addebita.
 *   ② ESEGUE la stessa funzione con altri numeri, per mostrare che la frase li segue invece di
 *      ricopiarli: alzata la soglia cambia la soglia, portata a zero la consegna sparisce da sé.
 *   ③ LEGGE il carrello e pretende che nella promessa non sia rimasta nessuna cifra scritta a mano.
 *
 * ⚠️ Cosa NON prova: che a video la frase stia su una riga sola e si legga bene sul telefono. Qui
 * non c'è niente che disegni la pagina.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promessaSpedizione } from '@/lib/promesse-pubbliche';
import { prezziDelCarrello } from '@/lib/ordini/prezzi';
import { FREE_SHIPPING_THRESHOLD, PLATFORM_DELIVERY_FEE_CENTS } from '@/lib/constants';

const SORGENTE = readFileSync(join(process.cwd(), 'app/cart/page.tsx'), 'utf8');

/** Le righe di codice senza i commenti: quello che ci scriviamo dentro nessuno lo legge a video. */
const righeVive = (sorgente: string): string[] =>
  sorgente.split('\n').filter((r) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(r));

const VIVE = righeVive(SORGENTE);
const CODICE = VIVE.join('\n');

/** Dice «gratis» a proposito della spedizione, in una frase che legge un cliente. */
const PROMETTE_GRATIS = /sped(izione|\.)\s+(è\s+)?grat/i;

/**
 * La riga senza le parti calcolate. Quello che sta dentro `${…}` è un numero che arriva da dove è
 * deciso; quello che resta fuori è un numero ricopiato a mano — cioè il difetto.
 */
const senzaInterpolazioni = (riga: string) => riga.replace(/\$\{[^}]*\}/g, '');

describe('il numero che il carrello vuoto annuncia è quello che la cassa addebita', () => {
  it('su un carrello vuoto la soglia È quello che manca, e viene da FREE_SHIPPING_THRESHOLD', () => {
    expect(promessaSpedizione(0).mancano).toBe(FREE_SHIPPING_THRESHOLD);
  });

  it('e la consegna annunciata è lo stesso centesimo che il checkout mette in conto', () => {
    const cassa = prezziDelCarrello({
      gruppi: [{ sellerId: 'negozio-1', subtotalCents: 3500 }],
      coordinateNegozio: () => ({ lat: null, lng: null }),
      consegnaLat: null,
      consegnaLng: null,
      pickupInStore: false,
      couponSpedizioneGratis: false,
      couponScontoCents: 0,
    });
    const gruppo = cassa.gruppi[0];

    // 35 € è sopra la soglia: la spedizione del negozio è davvero zero…
    expect(gruppo.shippingCents).toBe(0);
    // …e la consegna si paga lo stesso. È questo che la frase taceva.
    expect(gruppo.deliveryFeeCents).toBe(PLATFORM_DELIVERY_FEE_CENTS);
    expect(Math.round(promessaSpedizione(0).costoConsegna * 100)).toBe(gruppo.deliveryFeeCents);
  });

  it('cambiare i numeri cambia la frase, senza riscrivere niente', () => {
    expect(promessaSpedizione(0, 50, 500).mancano).toBe(50);
    expect(promessaSpedizione(0, 50, 500).costoConsegna).toBe(5);
    // A consegna gratis la coda deve sparire da sé: è la condizione che il carrello legge.
    expect(promessaSpedizione(0, 30, 0).costoConsegna).toBe(0);
  });
});

describe('e nel carrello vuoto non è rimasta nessuna cifra scritta a mano', () => {
  it('nessuna riga promette «gratis» con dentro un numero suo', () => {
    expect(
      VIVE.filter((r) => PROMETTE_GRATIS.test(r) && /\d/.test(senzaInterpolazioni(r))),
      'la promessa è tornata a ricopiare un numero invece di chiederlo a promessaSpedizione()',
    ).toEqual([]);
  });

  it('la frase nasce da promessaSpedizione, e lo stato vuoto la chiama', () => {
    expect(CODICE).toContain('promessaSpedizione');
    expect(CODICE).toContain('const spedizione = promessaSpedizione(0);');
    expect(CODICE).toContain('description={descrizioneDelCarrelloVuoto()}');
  });

  it('la soglia e la consegna arrivano tutte e due da lì', () => {
    expect(CODICE, 'la soglia').toContain('formatPrice(spedizione.mancano)');
    if (PLATFORM_DELIVERY_FEE_CENTS > 0) {
      expect(CODICE, 'i 3 € di consegna, quelli che la frase taceva').toContain(
        'formatPrice(spedizione.costoConsegna)',
      );
      expect(CODICE, 'e a consegna gratis la coda deve sparire').toContain(
        'spedizione.costoConsegna > 0',
      );
    }
  });
});
