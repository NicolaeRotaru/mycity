/**
 * @vitest-environment jsdom
 */
/**
 * La vetrina vendeva cose che la cassa poi rifiutava.
 *
 * Il «+» sulle schede prodotto aggiunge al carrello senza aprire il prodotto. Per farlo bene deve
 * sapere due cose: **quanto ce n'è** e **se il prodotto ha varianti**. Se non le sa, aggiunge
 * comunque — e il muro arriva al checkout, dopo che la persona ha già scelto.
 *
 * Misurato il 24/8, con `grep hasVariants=` su tutto il progetto: **una sola occorrenza**, in
 * `ProductGrid`. Le altre cinque vetrine passavano `undefined`, quindi un articolo con taglie e
 * colori finiva nel carrello senza taglia. E la sorgente delle promozioni — la RPC che alimenta gli
 * «Sconti attivi» in home e la pagina /promozioni, cioè il traffico attirato dallo sconto — non
 * restituiva né la giacenza né le varianti: lì mancava alla radice.
 *
 * IL PEZZO PEGGIORE erano le istruzioni per uscirne. Il riquadro del checkout diceva «apri il
 * prodotto, seleziona la variante e aggiungilo di nuovo al carrello». Chi lo faceva restava bloccato
 * lo stesso: due righe sono lo stesso articolo solo se coincidono prodotto E variante, quindi quella
 * nuova si aggiunge e la rotta resta. E in quel riquadro non c'era nessun modo di toglierla.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { addToCart, getCart, rimuoviRigaSenzaVariante } from '@/lib/cart';

const RADICE = process.cwd();

const senzaCommenti = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

describe('togliere la riga rotta senza perdere quella giusta', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('toglie la riga senza variante e lascia quella con la taglia scelta', () => {
    // È il caso vero: la riga rotta arriva dal «+» di una vetrina, quella giusta l'ha scelta la
    // persona aprendo il prodotto. `removeFromCart(id)` le porterebbe via tutte e due.
    addToCart({ id: 'p1', name: 'Grembiule', price: 20, image: '', sellerId: 's1', storeName: 'Bottega' });
    addToCart({ id: 'p1', name: 'Grembiule', price: 20, image: '', sellerId: 's1', storeName: 'Bottega', variantId: 'v-m', variantLabel: 'M' });
    expect(getCart()).toHaveLength(2);

    rimuoviRigaSenzaVariante('p1');

    const dopo = getCart();
    expect(dopo).toHaveLength(1);
    expect(dopo[0].variantId).toBe('v-m');
  });

  it('non tocca le righe degli altri prodotti', () => {
    addToCart({ id: 'p1', name: 'Grembiule', price: 20, image: '', sellerId: 's1', storeName: 'Bottega' });
    addToCart({ id: 'p2', name: 'Coppa', price: 9, image: '', sellerId: 's1', storeName: 'Bottega' });
    rimuoviRigaSenzaVariante('p1');
    expect(getCart().map((c) => c.id)).toEqual(['p2']);
  });

  it('su un carrello che non ha quella riga non fa niente', () => {
    addToCart({ id: 'p1', name: 'Grembiule', price: 20, image: '', sellerId: 's1', storeName: 'Bottega', variantId: 'v-m', variantLabel: 'M' });
    rimuoviRigaSenzaVariante('p1');
    expect(getCart()).toHaveLength(1);
  });
});

describe("l'invariante di STRUTTURA sulle vetrine vere", () => {
  // Ogni posto che disegna una scheda prodotto deve passarle le due cose che servono al «+» per
  // decidere. Diventa rossa il giorno che nasce una vetrina nuova senza, invece di scoprirlo dal
  // carrello di qualcuno.
  const files = execSync('grep -rl "<ProductCard" --include=*.tsx . | grep -v node_modules', { encoding: 'utf8' })
    .trim().split('\n');

  it('le vetrine trovate non sono zero: senza, questo blocco non misura niente', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(['stock', 'hasVariants'])('ogni vetrina passa %s alla scheda prodotto', (prop) => {
    const senza = files.filter((f) => {
      const src = senzaCommenti(readFileSync(join(RADICE, f), 'utf8'));
      const blocco = src.match(/<ProductCard[\s\S]{0,900}?\/>/);
      return !blocco || !new RegExp(`${prop}=`).test(blocco[0]);
    });
    expect(senza).toEqual([]);
  });
});

describe('il riquadro che blocca il checkout ha una via d uscita', () => {
  const checkout = senzaCommenti(readFileSync(join(RADICE, 'app/checkout/page.tsx'), 'utf8'));

  it('la riga senza variante si può togliere da lì, e con la funzione precisa', () => {
    // Non `removeFromCart(v.id)`: quella toglierebbe anche la riga giusta appena aggiunta, cioè
    // proprio il gesto che le istruzioni chiedono di fare.
    expect(checkout).toMatch(/rimuoviRigaSenzaVariante\(/);
  });

  it("l'articolo finito si può togliere da lì", () => {
    // «Riduci le quantità nel carrello» non è una via d'uscita per chi ha davanti disponibili zero:
    // non c'è niente da ridurre.
    const blocco = checkout.match(/stockIssues\.length > 0 && \([\s\S]{0,1600}?\n {10}\)\}/);
    expect(blocco, 'non trovo il riquadro della giacenza: la prova non misura niente').not.toBeNull();
    expect(blocco![0]).toMatch(/removeFromCart\(/);
  });
});

describe('la striscia di suggerimenti nel carrello', () => {
  const upsell = senzaCommenti(readFileSync(join(RADICE, 'components/cart/CartUpsell.tsx'), 'utf8'));

  it('chiede la giacenza al database, e non la deduce dallo stato', () => {
    // `status = 'available'` NON vuol dire «ce n'è»: nessun automatismo porta lo stato a
    // 'out_of_stock' quando la giacenza arriva a zero.
    expect(upsell).toMatch(/has_variants,\s*stock/);
  });

  it('non propone quello che è finito', () => {
    expect(upsell).toMatch(/p\.stock\s*>\s*0/);
  });

  it('non ingoia il proprio errore di lettura', () => {
    expect(upsell).toMatch(/if \(error\) throw error;/);
  });
});
