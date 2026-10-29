import { describe, it, expect } from 'vitest';
import { attributoSpuntato, formatAttributeValue } from '@/lib/category-attributes';
import { deriveQualityMarks } from '@/lib/products/qualityMarks';
import {
  propostaPerIlModulo,
  pianoPatchPerIlModulo,
  resolveAiPatch,
  type CategoryRow,
} from '@/lib/products/aiPatch';
import { valoreLeggibile } from '@/lib/products/prontoPerLaVendita';

/**
 * 29/10/2026 — Il sì/no di una casella aveva quattro regole in cinque punti: la casella del
 * negoziante leggeva solo `true`/«true», il marchio di qualità anche «sì», «yes», «1» e 1.
 * Risultato: casella vuota nel modulo mentre il cliente vedeva «Cruelty free». Qui si prova che
 * casella, marchio, riga della griglia e proposta dell'assistente dicono la stessa cosa, senza
 * rompere la riparazione di «Vegano false»: «false», «no», «0» e false restano No.
 */

const SI_A_PAROLE = ['true', 'TRUE', ' true ', 'sì', 'Sì', 'si', 'SI', 'yes', 'Yes', 'vero'];
const SI = [true, 1, '1', ...SI_A_PAROLE];
const NO_A_PAROLE = ['false', 'FALSE', 'no', 'No', 'falso'];
const NO = [false, 0, '0', '', null, undefined, ...NO_A_PAROLE];

const marchi = (v: unknown) =>
  deriveQualityMarks({ name: 'Crema mani', attributes: { cruelty_free: v, bio_naturale: v } }).map((m) => m.key);

const categorie: CategoryRow[] = [{ id: 'top-bel', name: 'Bellezza', slug: 'bellezza', parent_id: null }];
const campiBellezza = [
  { key: 'cruelty_free', type: 'checkbox' },
  { key: 'formato', type: 'text' },
];

describe('il sì/no di una casella dice la stessa cosa in tutti i punti', () => {
  it.each(SI.map((v) => [JSON.stringify(v), v]))('%s: casella spuntata E marchio sulla scheda', (_n, v) => {
    expect(attributoSpuntato(v)).toBe(true);
    expect(marchi(v)).toEqual(expect.arrayContaining(['cruelty_free', 'bio']));
  });

  it.each(NO.map((v) => [JSON.stringify(v) ?? 'undefined', v]))(
    '%s: casella vuota E nessun marchio (la riparazione di «Vegano false» regge)',
    (_n, v) => {
      expect(attributoSpuntato(v)).toBe(false);
      expect(marchi(v)).not.toContain('cruelty_free');
      expect(marchi(v)).not.toContain('bio');
    },
  );

  it('la griglia del cliente e il riepilogo della bozza scrivono «Sì» dove la casella è spuntata', () => {
    for (const v of [true, ...SI_A_PAROLE]) {
      expect(formatAttributeValue(v)).toBe('Sì');
      expect(valoreLeggibile(v)).toBe('Sì');
    }
    for (const v of [false, ...NO_A_PAROLE]) {
      expect(formatAttributeValue(v)).toBe('No');
      expect(valoreLeggibile(v)).toBe('No');
    }
    // Un numero resta un numero: la griglia non sa se «1» è una casella o «1 anno di garanzia».
    expect(formatAttributeValue(1)).toBe('1');
    expect(formatAttributeValue('0')).toBe('0');
  });

  it('la proposta dell assistente spunta la casella con la stessa regola', () => {
    for (const v of SI.filter((x): x is string => typeof x === 'string')) {
      expect(propostaPerIlModulo({ chiave: 'cruelty_free', valore: v, motivo: 'm' }, campiBellezza).valore).toBe(true);
    }
    for (const v of NO_A_PAROLE.concat('0')) {
      expect(propostaPerIlModulo({ chiave: 'cruelty_free', valore: v, motivo: 'm' }, campiBellezza).valore).toBe(false);
    }
    // Un campo di testo resta testo.
    expect(propostaPerIlModulo({ chiave: 'formato', valore: ' 50 ml ', motivo: 'm' }, campiBellezza).valore).toBe('50 ml');
  });

  it('l assistente che scrive «sì» in una casella la salva come vero, nel modulo e sul server', () => {
    for (const [scritto, atteso] of [['sì', true], ['yes', true], ['1', true], ['no', false], ['false', false]] as const) {
      const piano = pianoPatchPerIlModulo(
        { attributes: { cruelty_free: scritto } },
        { categorie, categoriaAttuale: 'top-bel', modo: 'edit' },
      );
      const scrittura = piano.scritture.find((s) => s.campo === 'attributo' && s.chiave === 'cruelty_free');
      expect(scrittura?.valore).toBe(atteso);

      const { update } = resolveAiPatch({
        patch: { attributes: { cruelty_free: scritto } },
        current: { attributes: {}, category_id: 'top-bel', has_variants: false },
        categories: categorie,
      });
      expect((update.attributes as Record<string, unknown>).cruelty_free).toBe(atteso);
      // E quello che si salva si legge uguale da casella e marchio.
      const salvato = (update.attributes as Record<string, unknown>).cruelty_free;
      expect(attributoSpuntato(salvato)).toBe(atteso);
      expect(marchi(salvato).includes('cruelty_free')).toBe(atteso);
    }
  });
});
