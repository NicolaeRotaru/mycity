/**
 * @vitest-environment jsdom
 */
/**
 * 26/11/2026 (R26-013) — COL TESTO DEL TELEFONO AL MASSIMO, «CONTANTI ALLA CONSEGNA» RESTA NELLO SCHERMO.
 *
 * Su un telefono largo 390 px col testo al 200% («Dimensione carattere» al massimo), la scheda
 * «Contanti alla consegna» usciva dal riquadro «Come paghi» e la pagina scorreva di lato di 57 px.
 * Le cause, misurate in Chrome (390 px: pagina larga 414 px; 423 con la carta accesa):
 *  - il `fieldset` ha di suo una larghezza minima uguale al contenuto (min-inline-size:
 *    min-content): senza `min-w-0` non si stringe mai sotto la riga più lunga;
 *  - il contenuto di ogni scheda è un figlio flex (`flex-1`) senza `min-w-0`: la parola più lunga
 *    decide la larghezza minima e spinge fuori la scheda;
 *  - le parole lunghe («Mastercard,», «MyCity») e la riga «Un solo pagamento…» (testo sciolto in un
 *    contenitore flex, che non va a capo) uscivano dalla loro scheda.
 * Con la correzione, misurata col Chrome della macchina (render del selettore e del riquadro del
 * credito con le classi vere del sito): 360, 375, 390 e 412 px col testo al 200% e ogni larghezza al
 * 100% e al 130%, nessuno scorrimento di lato. A 320 px col 200% resta largo il bollino «Zero
 * rischio» (components/ui, non di questa voce).
 *
 * In CI non c'è Chrome: qui si monta il selettore vero e si guarda che porti le classi che lo
 * tengono dentro. Prova leggera, come vuole una voce di stile; cade togliendo la correzione.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
});

async function selettore(stripeAvailable: boolean) {
  const { PaymentMethodSelector } = await monta('components/checkout/PaymentMethodSelector.tsx');
  schermo = accendi(PaymentMethodSelector, {
    value: 'cod',
    onChange: () => undefined,
    stripeAvailable,
    multiSeller: true,
    pickupInStore: false,
    onPickupChange: () => undefined,
    pickupDiscount: 0,
    pickupDiscountPercent: 10,
    motivoNoContanti: null,
  });
  return schermo.radice;
}

const classi = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(/\s+/);

/** Il contenuto di una scheda: il figlio `flex-1` della label, dopo il pallino e l'icona. */
const contenuto = (scheda: Element) => [...scheda.children].find((c) => classi(c).includes('flex-1'));

describe('R26-013 · col testo al massimo il selettore del pagamento si stringe invece di uscire', () => {
  it('il fieldset si può stringere sotto la riga più lunga', async () => {
    const r = await selettore(false);
    const fieldset = r.querySelector('fieldset');
    expect(fieldset, 'il selettore non è più un fieldset: la prova non misurerebbe niente').toBeTruthy();
    expect(classi(fieldset), 'il fieldset tiene la larghezza del contenuto e spinge fuori la scheda').toContain('min-w-0');
  }, 60_000);

  it('ogni scheda (contanti e carta) si stringe e manda a capo le parole lunghe', async () => {
    const r = await selettore(true);
    const schede = [...r.querySelectorAll('fieldset > label')];
    expect(schede.length, 'con la carta accesa le schede sono due').toBeGreaterThanOrEqual(2);
    for (const scheda of schede) {
      const c = contenuto(scheda);
      const nome = (c?.textContent ?? '').slice(0, 30);
      expect(c, 'il contenuto della scheda non è più il figlio flex-1').toBeTruthy();
      expect(classi(c), `«${nome}»: il contenuto non si stringe (min-w-0)`).toContain('min-w-0');
      expect(classi(c), `«${nome}»: le parole lunghe escono dalla scheda (break-words)`).toContain('break-words');
    }
  }, 60_000);

  it('il titolo «Contanti alla consegna», accanto al bollino, si stringe anche lui', async () => {
    const r = await selettore(false);
    const titolo = [...r.querySelectorAll('p')].find((p) => p.textContent === 'Contanti alla consegna');
    expect(titolo, 'il titolo della scheda contanti non si trova').toBeTruthy();
    expect(classi(titolo), 'nella riga flex col bollino il titolo tiene la parola più lunga').toContain('min-w-0');
  }, 60_000);

  it('la riga «Un solo pagamento…» della carta va a capo: il testo sta in un pezzo che si stringe', async () => {
    const r = await selettore(true);
    const riga = [...r.querySelectorAll('p')].find((p) => /Un solo pagamento per tutto il carrello/.test(p.textContent ?? ''));
    expect(riga, 'la riga dei più negozi non si trova').toBeTruthy();
    const testo = [...riga!.children].find((c) => /Un solo pagamento/.test(c.textContent ?? ''));
    expect(testo, 'il testo è sciolto nel contenitore flex: non va a capo sotto la sua parola più lunga').toBeTruthy();
    expect(classi(testo)).toContain('min-w-0');
  }, 60_000);
});

describe('R26-013 · nel riquadro «Come paghi» della cassa anche la scheda del credito si stringe', () => {
  it('il contenuto di «Usa il mio credito MyCity» porta min-w-0 e break-words', () => {
    const cassa = readFileSync('app/checkout/page.tsx', 'utf8');
    const i = cassa.indexOf('Usa il mio credito MyCity</p>');
    expect(i, 'la scheda del credito non si trova nella cassa').toBeGreaterThan(0);
    const apertura = cassa.slice(0, i).match(/<div className="([^"]*)">\s*<p className="[^"]*">$/);
    expect(apertura, 'il contenuto della scheda del credito non è più un div subito prima del titolo').not.toBeNull();
    expect(apertura![1].split(/\s+/)).toEqual(expect.arrayContaining(['flex-1', 'min-w-0', 'break-words']));
  });
});
