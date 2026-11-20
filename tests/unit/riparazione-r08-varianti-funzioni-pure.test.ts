import { describe, expect, it } from 'vitest';
import {
  MAX_VARIANTS,
  buildCombinations,
  contaCombinazioni,
  statoSceltaVarianti,
  valoreSenzaVariante,
  type ProductVariant,
} from '@/lib/products/variants';

/**
 * R08-011 (funzioni pure) — Un capo con troppe combinazioni di taglia e colore. Il taglio a 100 resta (PostgREST
 * espone al massimo 1000 righe e chi legge le varianti non pagina: sopra quel numero il taglio
 * tornerebbe silenzioso e il salvataggio farebbe duplicati), ma non è più silenzioso: `contaCombinazioni`
 * dà il conto PRIMA del taglio, così chi crea le varianti lo vede prima di salvare. Sulla scheda, con
 * tutte le opzioni scelte e nessuna variante, il cliente legge «combinazione non c'è», non «scegli»,
 * e i valori senza variante si spengono.
 */
const taglie = ['34', '36', '38', '40', '42', '44', '46', '48', '50', '52', '54'];
const colori = ['Bianco', 'Nero', 'Blu', 'Rosso', 'Verde', 'Giallo', 'Grigio', 'Rosa', 'Viola', 'Beige'];
const tipi = [
  { name: 'Taglia', values: taglie },
  { name: 'Colore', values: colori },
];
const valoriN = (n: number) => Array.from({ length: n }, (_, i) => `v${i + 1}`);

describe('R08-011 il conto delle combinazioni, prima del taglio', () => {
  it('11 taglie per 10 colori sono 110: il conto è 110 anche se ne restano 100', () => {
    expect(contaCombinazioni(tipi)).toBe(110);
    expect(buildCombinations(tipi)).toHaveLength(MAX_VARIANTS);
  });
  it('il tetto è 100', () => {
    expect(MAX_VARIANTS).toBe(100);
  });
  it('doppioni, valori vuoti e assi senza valori non si contano, come non nascono', () => {
    expect(contaCombinazioni([{ name: 'Taglia', values: ['S', 's', ' S ', '', 'M'] }, { name: 'Colore', values: [] }])).toBe(2);
    expect(contaCombinazioni([])).toBe(0);
    expect(contaCombinazioni([{ name: 'Taglia', values: [] }])).toBe(0);
  });
  it('il conto rispetta i tetti per asse: 3 assi da 40 valori contano 30 × 30 × 30', () => {
    expect(contaCombinazioni([0, 1, 2, 3].map((i) => ({ name: `Asse${i}`, values: valoriN(40) })))).toBe(27000);
  });
  it('il conto è sempre quello che buildCombinations farebbe senza il tetto', () => {
    expect(contaCombinazioni([{ name: 'Taglia', values: valoriN(9) }, { name: 'Colore', values: valoriN(11) }])).toBe(99);
    expect(buildCombinations([{ name: 'Taglia', values: valoriN(9) }, { name: 'Colore', values: valoriN(11) }])).toHaveLength(99);
  });
});

const v = (Taglia: string, Colore: string): ProductVariant => ({ id: `${Taglia}-${Colore}`, options: { Taglia, Colore }, label: `${Taglia} · ${Colore}`, stock: 3 });
const VARIANTI = [v('S', 'Rosso'), v('S', 'Verde'), v('M', 'Blu')];

describe('R08-011 «combinazione non disponibile» contro «scegli le opzioni»', () => {
  it('tutte le opzioni scelte e nessuna variante: combinazione mancante, non «da scegliere»', () => {
    const s = statoSceltaVarianti(VARIANTI, { Taglia: 'S', Colore: 'Blu' });
    expect(s.tutteScelte).toBe(true);
    expect(s.variante).toBeNull();
    expect(s.combinazioneMancante).toBe(true);
    expect(s.daScegliere).toBe(false);
  });
  it('una opzione sola scelta: da scegliere, non «non disponibile»', () => {
    const s = statoSceltaVarianti(VARIANTI, { Taglia: 'S' });
    expect(s.combinazioneMancante).toBe(false);
    expect(s.daScegliere).toBe(true);
  });
  it('nessuna scelta: da scegliere', () => {
    expect(statoSceltaVarianti(VARIANTI, {}).daScegliere).toBe(true);
  });
  it('una combinazione che esiste: variante trovata, né mancante né da scegliere', () => {
    const s = statoSceltaVarianti(VARIANTI, { Taglia: 'S', Colore: 'Verde' });
    expect(s.variante?.id).toBe('S-Verde');
    expect(s.combinazioneMancante).toBe(false);
    expect(s.daScegliere).toBe(false);
  });
  it('un prodotto senza varianti non chiede di scegliere', () => {
    const s = statoSceltaVarianti([], {}, false);
    expect(s.daScegliere).toBe(false);
    expect(s.gruppi).toEqual([]);
  });
  it('un prodotto con varianti dichiarate ma non ancora lette chiede di scegliere, senza dire «non c\'è»', () => {
    const s = statoSceltaVarianti([], {}, true);
    expect(s.daScegliere).toBe(true);
    expect(s.combinazioneMancante).toBe(false);
  });
});

describe('R08-011 i valori senza variante si spengono', () => {
  it('scelta la S, il Blu non ha variante (spento); Rosso e Verde sì', () => {
    const scelte = { Taglia: 'S' };
    expect(valoreSenzaVariante(VARIANTI, scelte, 'Colore', 'Blu')).toBe(true);
    expect(valoreSenzaVariante(VARIANTI, scelte, 'Colore', 'Rosso')).toBe(false);
    expect(valoreSenzaVariante(VARIANTI, scelte, 'Colore', 'Verde')).toBe(false);
  });
  it('scelto il Blu, la S è spenta e la M no', () => {
    const scelte = { Colore: 'Blu' };
    expect(valoreSenzaVariante(VARIANTI, scelte, 'Taglia', 'S')).toBe(true);
    expect(valoreSenzaVariante(VARIANTI, scelte, 'Taglia', 'M')).toBe(false);
  });
  it('senza altre scelte nessun valore è spento; la scelta dello stesso gruppo non conta', () => {
    expect(valoreSenzaVariante(VARIANTI, {}, 'Colore', 'Blu')).toBe(false);
    expect(valoreSenzaVariante(VARIANTI, { Colore: 'Rosso' }, 'Colore', 'Blu')).toBe(false);
  });
});

