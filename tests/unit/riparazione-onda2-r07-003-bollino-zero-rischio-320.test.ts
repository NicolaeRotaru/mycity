/**
 * @vitest-environment jsdom
 */
/**
 * R07-003 (onda 2, 28/11/2026) — A 320 PX COL TESTO AL 200% IL BOLLINO «ZERO RISCHIO» USCIVA DI 18 PX.
 *
 * Misurato col Chrome della macchina (playwright-core, `html{font-size:200%}`, il riquadro «Come
 * paghi» disegnato coi componenti veri, StepCard + PaymentMethodSelector, e il CSS di Tailwind del
 * sito): a 320 px la pagina era larga 338 px. La causa non era il bollino da solo: col testo al 200%
 * il pallino, l'icona (2,5rem = 80 px) e i due spazi della scheda occupano più della scheda stessa,
 * e la colonna del contenuto (`flex-1 min-w-0`) restava larga 0 px. Il titolo andava a capo una
 * lettera per riga e il bollino (82 px, non si stringe sotto «rischio») usciva dalla scheda: di 101
 * px a 320, di 61 a 360, di 31 a 390 (lì senza far scorrere la pagina, ma sopra il bordo).
 *
 * Correzione: la scheda va a capo (`flex-wrap`) e il contenuto ha una base in rem (`basis-20`):
 * col testo normale resta accanto all'icona (5rem = 80 px ci stanno anche a 280 px), col testo al
 * 200% scende sotto, largo quanto la scheda. Il bollino non supera la sua riga (`max-w-full`) e,
 * se proprio non ci sta, va a capo anche dentro la parola. Rimisurato: 320, 360 e 390 px al 200%
 * nessuno scorrimento di lato e il bollino dentro la scheda; al 100% a 280, 320, 360 e 390 px il
 * contenuto resta accanto all'icona, largo come prima.
 *
 * In CI non c'è Chrome: qui si monta il selettore vero e si guarda che porti le classi che lo
 * tengono dentro (come riparazione-r26-col-testo-grande-la-scheda-contanti-resta-nello-schermo).
 */
import { describe, it, expect, afterEach } from 'vitest';
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
const contenuto = (scheda: Element) => [...scheda.children].find((c) => classi(c).includes('flex-1'));

describe('R07-003 · col testo al 200% a 320 px il bollino «Zero rischio» resta nella scheda', () => {
  it('ogni scheda va a capo e il contenuto ha una base in rem: col testo grande scende sotto l’icona invece di restare largo 0', async () => {
    const r = await selettore(true);
    const schede = [...r.querySelectorAll('fieldset > label')];
    expect(schede.length, 'con la carta accesa le schede sono due').toBeGreaterThanOrEqual(2);
    for (const scheda of schede) {
      const nome = (scheda.textContent ?? '').slice(0, 30);
      expect(classi(scheda), `«${nome}»: la scheda non va a capo, e col testo al 200% il contenuto resta largo 0 px`).toContain('flex-wrap');
      const c = contenuto(scheda);
      expect(c, 'il contenuto della scheda non è più il figlio flex-1').toBeTruthy();
      const base = classi(c).find((k) => /^basis-/.test(k));
      // Una base in rem cresce col testo: al 100% (80 px) sta accanto all'icona, al 200% (160 px) no.
      expect(base, `«${nome}»: senza una base il contenuto (flex: 1 1 0%) non va mai sotto l’icona`).toMatch(/^basis-(\d+(\.5)?)$/);
      expect(Number(base!.slice('basis-'.length)), 'una base così larga manda il contenuto sotto anche col testo normale').toBeLessThanOrEqual(20);
      expect(classi(c)).toEqual(expect.arrayContaining(['min-w-0', 'break-words']));
    }
  }, 60_000);

  it('il bollino non supera la sua riga e, se serve, va a capo anche dentro la parola', async () => {
    const r = await selettore(false);
    const bollino = [...r.querySelectorAll('span')].find((s) => s.textContent === 'Zero rischio');
    expect(bollino, 'il bollino «Zero rischio» non si trova').toBeTruthy();
    expect(classi(bollino), 'il bollino tiene la larghezza di «rischio» ed esce dalla scheda').toContain('max-w-full');
    expect(classi(bollino)).toContain('[overflow-wrap:anywhere]');
  }, 60_000);
});
