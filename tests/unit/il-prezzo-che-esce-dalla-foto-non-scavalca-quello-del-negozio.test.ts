import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { patchAiPerIlForm } from '@/lib/products/aiPatch';

/**
 * 3/9/2026 — LA BANDA SUL PREZZO COPRIVA UNA PORTA SU DUE.
 *
 * R145 aveva messo la banda del 30% dentro `applyPatch`, la funzione che
 * applica i suggerimenti dell'assistente. Ma nel modulo del prodotto le porte
 * che scrivono nel campo prezzo sono DUE, e la seconda era rimasta aperta:
 * «riempi dalla foto» (`handleExtracted`) scriveva `data.suggested_price` —
 * il prezzo che il modello legge dall'immagine — senza guardare niente e senza
 * dirlo a nessuno.
 *
 * Il caso vero: quel pulsante c'è anche quando il prodotto si MODIFICA. Il
 * negoziante rifotografa la vetrina per aggiornare le immagini di un prodotto
 * da 20 €, il modello stima 2 €, il campo prezzo cambia in silenzio, lui salva
 * e la vetrina vende a 2 €. Lo stesso zero perso di R145, dalla porta accanto.
 *
 * ── Cosa prova questo file ─────────────────────────────────────────────────
 * ① la regola, ESEGUITA: 20 € → 2 € non passa, e il motivo c'è;
 * ② l'invariante strutturale: nel modulo del prodotto NESSUNA scrittura del
 *    campo prezzo prende il numero grezzo. Ogni `setValue('price', …)` deve
 *    leggerlo da una variabile che esce da `patchAiPerIlForm`. Una terza porta
 *    che domani scrivesse il prezzo saltando il filtro fa diventare rossa
 *    questa prova, non un difetto in produzione.
 */

const MODULO = join(process.cwd(), 'components/seller/ProductForm.tsx');
const sorgente = readFileSync(MODULO, 'utf8');

/**
 * I nomi locali del patch filtrato: da `const { patch: dallaFoto, rifiutati }
 * = patchAiPerIlForm(` tira fuori `dallaFoto`. Sono gli unici nomi da cui è
 * lecito leggere un prezzo.
 */
function nomiDelPatchFiltrato(src: string): string[] {
  const nomi: string[] = [];
  for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*patchAiPerIlForm\s*\(/g)) {
    for (const pezzo of m[1].split(',')) {
      const [chiave, alias] = pezzo.split(':').map((s) => s.trim());
      if (chiave === 'patch') nomi.push(alias || 'patch');
    }
  }
  return nomi;
}

/** I nomi locali dei motivi di rifiuto, per controllare che non si perdano. */
function nomiDeiRifiuti(src: string): string[] {
  const nomi: string[] = [];
  for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*patchAiPerIlForm\s*\(/g)) {
    for (const pezzo of m[1].split(',')) {
      const [chiave, alias] = pezzo.split(':').map((s) => s.trim());
      if (chiave === 'rifiutati') nomi.push(alias || 'rifiutati');
    }
  }
  return nomi;
}

/** Cosa viene scritto nel campo prezzo: l'espressione dentro `setValue('price', …`. */
function scrittureDelPrezzo(src: string): string[] {
  return [...src.matchAll(/setValue\(\s*'price'\s*,\s*([^,)]+)/g)].map((m) => m[1].trim());
}

describe('il prezzo che il modello legge da una foto', () => {
  it('su un prodotto da 20 € una stima da 2 € non entra nel campo, e il motivo si legge', () => {
    // È il passaggio esatto di `handleExtracted`: la stima della foto contro il
    // prezzo che il prodotto ha adesso.
    const { patch, rifiutati } = patchAiPerIlForm({ price: 2 }, { prezzoAttuale: 20 });

    expect(patch.price, 'la stima della foto sostituisce il prezzo vero del negozio').toBeUndefined();
    expect(rifiutati.length, 'il prezzo sparisce senza che nessuno lo dica al negoziante').toBe(1);
    expect(rifiutati[0]).toContain('20.00');
    expect(rifiutati[0]).toContain('2.00');
  });

  it('creando un prodotto NUOVO dalla foto il primo prezzo passa: non c è niente da confrontare', () => {
    const { patch, rifiutati } = patchAiPerIlForm({ price: 9.9 }, { prezzoAttuale: undefined });
    expect(patch.price, 'il freno blocca anche chi crea il prodotto dalla foto').toBe(9.9);
    expect(rifiutati).toEqual([]);
  });

  it('un ritocco dentro la banda passa anche dalla foto', () => {
    const { patch } = patchAiPerIlForm({ price: 24 }, { prezzoAttuale: 20 });
    expect(patch.price).toBe(24);
  });
});

describe('nel modulo del prodotto il campo prezzo ha una porta sola', () => {
  it('le porte che scrivono il prezzo sono due e passano tutte e due dal filtro', () => {
    const scritture = scrittureDelPrezzo(sorgente);
    const nomi = nomiDelPatchFiltrato(sorgente);

    expect(scritture.length, 'nessuna scrittura del prezzo trovata: la prova va riscritta').toBeGreaterThanOrEqual(2);
    expect(nomi.length, 'il modulo non passa più da patchAiPerIlForm: la banda del 30% non vale più').toBeGreaterThanOrEqual(2);

    for (const espressione of scritture) {
      const daFiltro = nomi.some((n) => espressione.startsWith(`${n}.price`));
      expect(
        daFiltro,
        `il campo prezzo riceve «${espressione}»: un numero che non è passato dalla banda del 30%`,
      ).toBe(true);
    }
  });

  it('il prezzo scartato non sparisce in silenzio: ogni motivo viene mostrato', () => {
    const rifiuti = nomiDeiRifiuti(sorgente);
    expect(rifiuti.length).toBeGreaterThanOrEqual(2);

    for (const nome of rifiuti) {
      const usi = sorgente.split(new RegExp(`\\b${nome}\\b`)).length - 1;
      expect(
        usi,
        `«${nome}» viene creato e mai usato: il negoziante non sa che il prezzo proposto è stato scartato`,
      ).toBeGreaterThan(1);
    }
  });
});
