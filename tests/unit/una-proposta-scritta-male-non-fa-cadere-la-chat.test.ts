import { describe, it, expect } from 'vitest';
import { avvisoSullaPubblicazione } from '@/lib/products/prontoPerLaVendita';
import type { AiProductPatch } from '@/lib/products/aiPatch';

/**
 * 16/10/2026 — UNA PROPOSTA SCRITTA FUORI SCHEMA FACEVA CADERE LA CHAT.
 *
 * Il fornaio scrive «pubblica la focaccia e togli il colore». Lo strumento
 * dice al modello che `attributes_remove` e' un elenco di chiavi, ma non lo
 * garantisce: il modello puo' rispondere `{ colore: true }`. La rotta della chat
 * passa la proposta com'e', e la scheda «Stato → In vendita» calcolava cosa
 * mancherebbe scorrendo quel campo come un elenco: «object is not iterable»,
 * la finestra della chat spariva e compariva la pagina d'errore del sito.
 *
 * Qui la proposta arriva scritta male in tutti i modi in cui il modello puo'
 * sbagliare il tipo. La scheda non deve cadere, e deve dire quello che dira'
 * il server, che un campo senza la forma giusta lo ignora.
 */

const FOCACCIA_COMPLETA = {
  name: 'Focaccia genovese',
  description: "Focaccia genovese all'olio, alta e morbida",
  price: 3.5,
  categorySlug: 'alimentari',
  attributes: {
    allergeni: 'Glutine, sesamo',
    ingredienti: 'farina, acqua, olio, sale, lievito, sesamo',
    colore: 'dorata',
  } as Record<string, unknown>,
  image: 'https://abcdefgh.supabase.co/x.jpg',
  status: 'draft',
};

const FOCACCIA_SENZA_DESCRIZIONE = { ...FOCACCIA_COMPLETA, description: 'Pane' };

/** Le forme sbagliate che il modello puo' dare a un campo che vuole un elenco. */
const RIMOZIONI_SCRITTE_MALE: unknown[] = [{ colore: true }, { 0: 'colore' }, 7, true, 'colore'];

/** Le forme sbagliate che il modello puo' dare a un campo che vuole un oggetto. */
const ATTRIBUTI_SCRITTI_MALE: unknown[] = ['colore: rossa', 42, true, ['colore', 'rossa'], { colore: { valore: 'rossa' } }];

function proposta(campi: Record<string, unknown>): AiProductPatch {
  return { status: 'available', ...campi } as AiProductPatch;
}

describe('la scheda «Stato → In vendita» non cade su una proposta scritta male', () => {
  for (const prodotto of [FOCACCIA_COMPLETA, FOCACCIA_SENZA_DESCRIZIONE]) {
    const atteso = avvisoSullaPubblicazione(prodotto, proposta({}));

    for (const via of RIMOZIONI_SCRITTE_MALE) {
      it(`attributes_remove = ${JSON.stringify(via)} su «${prodotto.description}»: nessun errore, si ignora`, () => {
        let avviso: ReturnType<typeof avvisoSullaPubblicazione> = null;
        expect(() => {
          avviso = avvisoSullaPubblicazione(prodotto, proposta({ attributes_remove: via }));
        }, 'la scheda della chat cade mentre si disegna').not.toThrow();
        expect(avviso).toEqual(atteso);
      });
    }

    for (const attributi of ATTRIBUTI_SCRITTI_MALE) {
      it(`attributes = ${JSON.stringify(attributi)} su «${prodotto.description}»: nessun errore`, () => {
        let avviso: ReturnType<typeof avvisoSullaPubblicazione> = null;
        expect(() => {
          avviso = avvisoSullaPubblicazione(prodotto, proposta({ attributes: attributi }));
        }).not.toThrow();
        expect(avviso).toEqual(atteso);
      });
    }
  }

  it('una proposta scritta bene si legge ancora: la descrizione nuova non e piu «mancante»', () => {
    const avviso = avvisoSullaPubblicazione(
      FOCACCIA_SENZA_DESCRIZIONE,
      proposta({ description: "Focaccia genovese all'olio, alta e morbida", attributes_remove: ['colore'] }),
    );
    expect(avviso?.mancanti).toEqual([]);
  });

  it('il campo scritto male non nasconde il resto: manca ancora la descrizione', () => {
    const avviso = avvisoSullaPubblicazione(FOCACCIA_SENZA_DESCRIZIONE, proposta({ attributes_remove: { colore: true } }));
    expect(avviso?.mancanti).toEqual(['Descrizione di almeno 10 caratteri']);
    expect(avviso?.dichiarazioni.map((d) => d.etichetta)).toEqual(['Allergeni', 'Ingredienti']);
  });
});
