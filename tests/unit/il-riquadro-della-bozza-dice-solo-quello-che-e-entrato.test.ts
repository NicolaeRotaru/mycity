import { describe, it, expect } from 'vitest';
import { buildDraftProductInsert } from '@/lib/products/draftFromVision';
import { productSnapshot } from '@/lib/products/aiSnapshot';
import { bozzaDaCreare, riquadroDichiarazioni, type BozzaSalvata } from '@/lib/products/prontoPerLaVendita';
import type { CategoryRow } from '@/lib/products/aiPatch';

/**
 * 16/10/2026 — IL RIQUADRO DICEVA «ENTRATE NELLA BOZZA» E, SOTTO, «MANCA».
 *
 * Il fornaio crea la focaccia dalle foto nella chat Assistenza. Il modello
 * scrive le chiavi con la maiuscola: «Allergeni: Glutine, sesamo»,
 * «Ingredienti: farina…». Il fornaio spunta «le ho controllate» e crea.
 *
 * Il riquadro riconosceva «Allergeni» anche con la maiuscola; la porta che crea
 * la bozza (`buildDraftProductInsert`) cercava il campo con la chiave com'era e
 * la scartava. La bozza nasceva senza allergeni, e il riquadro titolava
 * «Entrate nella bozza: le hai confermate tu», elencava gli allergeni e, sotto,
 * scriveva «Manca e lo scrivi tu: Allergeni, Ingredienti».
 *
 * Qui si passa sempre dalla porta vera: la bozza proposta va al server come la
 * manda la chat, il server la salva, e il riquadro dopo la creazione si legge
 * con quello che il server ha salvato.
 */

const CATEGORIE: CategoryRow[] = [
  { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'casa', name: 'Casa', slug: 'casa', parent_id: null },
  { id: 'bell', name: 'Bellezza', slug: 'bellezza', parent_id: null },
];

type Proposta = { category_slug: string; attributes: Record<string, string> };

/** Il server: salva la bozza che la chat gli manda e restituisce lo snapshot. */
function salvaComeIlServer(bozza: Proposta, confermate: boolean): BozzaSalvata {
  const riga = {
    id: 'nuova',
    ...buildDraftProductInsert({
      draft: { name: 'Prodotto', ...bozzaDaCreare(bozza, confermate) },
      imageUrls: ['https://abcdefgh.supabase.co/x.jpg'],
      categories: CATEGORIE,
      sellerId: 'forno-1',
    }),
    has_variants: false,
  };
  const { categorySlug, attributes } = productSnapshot(riga, CATEGORIE);
  return { categorySlug, attributes };
}

/** Il riquadro dopo la creazione, come lo disegna la chat. */
function riquadroDopo(bozza: Proposta, confermate: boolean) {
  const salvata = salvaComeIlServer(bozza, confermate);
  return { salvata, riquadro: riquadroDichiarazioni(bozza, { creata: true, confermate, salvata }) };
}

/** Le quattro grafie con cui il modello puo' scrivere la stessa chiave. */
const GRAFIE: Record<string, (k: string) => string> = {
  minuscola: (k) => k,
  maiuscola: (k) => k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '),
  'con lo spazio': (k) => k.replace(/_/g, ' '),
  'col trattino': (k) => k.replace(/_/g, '-'),
};

function focaccia(grafia: (k: string) => string): Proposta {
  return {
    category_slug: 'alimentari',
    attributes: {
      [grafia('allergeni')]: 'Glutine, sesamo',
      [grafia('ingredienti')]: 'farina, acqua, olio, sale, lievito, sesamo',
      [grafia('valori_nutrizionali')]: '250 kcal',
      [grafia('peso')]: '300 g',
    },
  };
}

describe('la porta che crea la bozza legge le chiavi come il riquadro', () => {
  for (const [nome, grafia] of Object.entries(GRAFIE)) {
    it(`chiavi ${nome}, con la spunta: allergeni, ingredienti e valori entrano nella bozza`, () => {
      const { attributes } = salvaComeIlServer(focaccia(grafia), true);
      expect(attributes, 'la bozza confermata e nata senza le dichiarazioni').toMatchObject({
        allergeni: 'Glutine, sesamo',
        ingredienti: 'farina, acqua, olio, sale, lievito, sesamo',
        valori_nutrizionali: '250 kcal',
        peso: '300 g',
      });
    });

    it(`chiavi ${nome}, senza la spunta: le dichiarazioni restano fuori, il peso entra`, () => {
      const { attributes } = salvaComeIlServer(focaccia(grafia), false);
      expect(attributes).not.toHaveProperty('allergeni');
      expect(attributes).not.toHaveProperty('ingredienti');
      expect(attributes).not.toHaveProperty('valori_nutrizionali');
      expect(attributes).toHaveProperty('peso', '300 g');
    });

    it(`chiavi ${nome}, PRIMA della creazione: non dice che manca quello che ha appena letto`, () => {
      const r = riquadroDichiarazioni(focaccia(grafia), { creata: false, confermate: false });
      expect(r?.righe.map((x) => x.etichetta)).toEqual(['Allergeni', 'Ingredienti', 'Valori nutrizionali (per 100g)']);
      expect(r?.daScrivere).toBeNull();
      expect(r?.chiediSpunta).toBe(true);
    });
  }
});

describe('dopo la creazione il riquadro non si contraddice mai', () => {
  for (const [nome, grafia] of Object.entries(GRAFIE)) {
    for (const confermate of [true, false]) {
      it(`chiavi ${nome}, ${confermate ? 'con' : 'senza'} la spunta`, () => {
        const { salvata, riquadro } = riquadroDopo(focaccia(grafia), confermate);
        expect(riquadro).not.toBeNull();
        const r = riquadro!;
        if (r.titolo.startsWith('Entrate')) {
          // Ogni riga data per entrata c'e' davvero nella bozza salvata, e non
          // ricompare fra quelle che mancano.
          for (const riga of r.righe) {
            expect(r.daScrivere ?? '', `«${riga.etichetta}» e insieme entrata e mancante`).not.toContain(riga.etichetta);
          }
          expect(Object.values(salvata.attributes ?? {})).toEqual(
            expect.arrayContaining(r.righe.map((x) => x.valore)),
          );
        }
        if (confermate) {
          expect(r.titolo).toBe('Entrate nella bozza: le hai confermate tu');
          expect(r.righe.map((x) => x.etichetta)).toEqual(['Allergeni', 'Ingredienti', 'Valori nutrizionali (per 100g)']);
          expect(r.daScrivere).toBeNull();
        } else {
          expect(r.titolo).toContain('NON entrate');
          expect(r.daScrivere).toContain('Allergeni, Ingredienti');
        }
      });
    }
  }
});

describe('dopo la creazione, «entrata» e solo quello che il server ha salvato', () => {
  it('una dichiarazione che la categoria non ha non viene data per entrata', () => {
    // Un tagliere: il modello legge «Origine: Italia» sull'etichetta, ma la
    // categoria Casa non ha quel campo e il server lo scarta.
    const { salvata, riquadro } = riquadroDopo(
      { category_slug: 'casa', attributes: { origine: 'Italia', materiale: 'Legno di ulivo' } },
      true,
    );
    expect(salvata.attributes).not.toHaveProperty('origine');
    expect(riquadro?.titolo).not.toContain('Entrate');
    expect(riquadro?.titolo).toContain('NON entrate');
  });

  it('se ne entrano solo alcune, il riquadro elenca quelle e dice quali sono rimaste fuori', () => {
    // Una crema: Bellezza ha «Vegano» ma non «Allergeni».
    const { salvata, riquadro } = riquadroDopo(
      { category_slug: 'bellezza', attributes: { vegano: 'true', allergeni: 'Nichel' } },
      true,
    );
    expect(salvata.attributes).toHaveProperty('vegano', 'true');
    expect(salvata.attributes).not.toHaveProperty('allergeni');
    expect(riquadro?.titolo).toBe('Entrate nella bozza: le hai confermate tu');
    expect(riquadro?.righe).toEqual([{ etichetta: 'Vegano', valore: 'Sì' }]);
    expect(riquadro?.daScrivere).toBe('Non sono entrate nella bozza: Allergeni.');
  });

  it('il valore mostrato e quello salvato, non quello proposto', () => {
    const lungo = 'farina '.repeat(100).trim(); // oltre il tetto di 500 caratteri
    const { salvata, riquadro } = riquadroDopo(
      { category_slug: 'alimentari', attributes: { Allergeni: 'Glutine', Ingredienti: lungo } },
      true,
    );
    const ingredienti = riquadro?.righe.find((x) => x.etichetta === 'Ingredienti');
    expect(ingredienti?.valore).toBe(salvata.attributes?.ingredienti);
    expect(ingredienti?.valore.length).toBe(500);
  });
});
