import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promessaSpedizioneDelCarrello } from '@/lib/ordini/promessa-del-carrello';
import { prezziDelCarrello } from '@/lib/ordini/prezzi';

/**
 * ALL'ULTIMO SCHERMO LA CASSA SCRIVEVA «SPEDIZIONE GRATIS» E ADDEBITAVA DUE SPEDIZIONI.
 *
 * Il caso, coi numeri veri: 18 € dal fornaio e 18 € dal macellaio. La barra del
 * riepilogo riceveva la somma — 36 € — e la soglia dei 30 € vale per NEGOZIO:
 * scriveva «Spedizione gratis», mentre due righe sotto il totale conteneva due
 * spedizioni. La sorpresa arrivava nel punto in cui costa di più: un attimo
 * prima di pagare.
 *
 * La prova non si fida della frase da sola: la mette accanto ai soldi che
 * `prezziDelCarrello` addebita davvero — la stessa funzione che usano le due
 * rotte d'ordine — e pretende che le due cose dicano la stessa cosa.
 */

/** Il conto vero della cassa per questi gruppi, senza coupon né ritiro. */
function spedizioneAddebitata(sottototaliEuro: number[]): number {
  const esito = prezziDelCarrello({
    gruppi: sottototaliEuro.map((s, i) => ({
      sellerId: `negozio-${i}`,
      subtotalCents: Math.round(s * 100),
    })),
    // Senza coordinate si applica la tariffa fissa: il caso più comune e il più
    // facile da leggere. La regola della soglia è la stessa a ogni distanza.
    coordinateNegozio: () => ({ lat: null, lng: null }),
    consegnaLat: null,
    consegnaLng: null,
    pickupInStore: false,
    couponSpedizioneGratis: false,
    couponScontoCents: 0,
  });
  return esito.grandShippingCents / 100;
}

describe('la frase sulla spedizione e la spedizione addebitata dicono la stessa cosa', () => {
  it('due negozi da 18 € non hanno la spedizione gratis, e la cassa non lo scrive', () => {
    const sottototali = [18, 18];

    const addebitata = spedizioneAddebitata(sottototali);
    expect(addebitata, 'il caso non è quello descritto: qui la spedizione è gratis davvero').toBeGreaterThan(0);

    const { promessa } = promessaSpedizioneDelCarrello(sottototali);

    expect(promessa.sopraSoglia).toBe(false);
    // La barra festeggia su `sopraSoglia`, e il titolo è la frase che si legge:
    // nessuno dei due deve annunciare una spedizione che poi si paga.
    expect(
      promessa.titolo,
      `la cassa promette «${promessa.titolo}» e nel totale addebita ${addebitata} € di spedizione`,
    ).not.toMatch(/^Spedizione gratis/);
    expect(promessa.titolo).toMatch(/^Ti mancano/);
    // E dice una cosa utile: quanto manca al negozio che ne ha più bisogno.
    expect(promessa.mancano).toBe(12);
  });

  it('quando ogni negozio è sopra soglia la spedizione è gratis davvero, e si può dire', () => {
    const sottototali = [36, 40];

    expect(spedizioneAddebitata(sottototali)).toBe(0);

    const { promessa } = promessaSpedizioneDelCarrello(sottototali);
    expect(promessa.sopraSoglia).toBe(true);
    expect(promessa.titolo).toContain('Spedizione gratis');
  });

  it('un negozio solo sopra soglia non fa promettere gratis a tutto il carrello', () => {
    const sottototali = [36, 10];

    expect(spedizioneAddebitata(sottototali)).toBeGreaterThan(0);

    const { promessa } = promessaSpedizioneDelCarrello(sottototali);
    expect(promessa.sopraSoglia).toBe(false);
    expect(promessa.titolo).not.toMatch(/^Spedizione gratis/);
  });

  it('con un negozio solo la promessa resta quella di prima', () => {
    expect(promessaSpedizioneDelCarrello([36]).promessa.sopraSoglia).toBe(true);
    expect(promessaSpedizioneDelCarrello([18]).promessa.mancano).toBe(12);
    // Carrello vuoto: nessun negozio, nessuna promessa mantenuta per sbaglio.
    expect(promessaSpedizioneDelCarrello([]).promessa.sopraSoglia).toBe(false);
  });
});

describe('la barra del riepilogo chiede al negozio, non al totale del carrello', () => {
  const sorgente = readFileSync(join(process.cwd(), 'app/checkout/page.tsx'), 'utf-8');

  it('la cassa non passa alla barra il sottototale sommato di tutti i negozi', () => {
    const barra = sorgente.match(/<FreeShippingProgress[^/]*\/>/g) ?? [];
    expect(barra.length, 'la barra della spedizione è sparita dalla cassa').toBeGreaterThan(0);
    for (const uso of barra) {
      expect(
        uso,
        'il totale del carrello sulla barra è esattamente il difetto: 18 € + 18 € diventavano «gratis»',
      ).not.toMatch(/subtotal=\{\s*(grandSubtotal|riepilogo\.subtotale)\s*\}/);
    }
  });

  it('la promessa della cassa nasce dall\'elenco dei negozi', () => {
    expect(sorgente).toContain('promessaSpedizioneDelCarrello');
    // Il totale unico non deve poter tornare nella promessa da una porta laterale.
    expect(sorgente).not.toMatch(/promessaSpedizione\(\s*riepilogo\.subtotale\s*\)/);
  });
});
