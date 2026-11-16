import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shippingForEuro, shippingCentsFor } from '@/lib/shipping';
import { promessaSpedizione } from '@/lib/promesse-pubbliche';

/**
 * R29-005 — Interfacce zombie. `shippingForEuro` vale sempre 0 ma riceveva sette ingressi
 * (sottototale, coordinate, ritiro, codice); `promessaSpedizione` aveva un primo argomento morto (il
 * sottototale) e due campi sempre uguali (`sopraSoglia` false, `mancano` 0). Chi leggeva credeva che
 * spedizione e pastiglia «gratis» dipendessero ancora dalla soglia dei 30 €. Prova di struttura:
 * nessun cambiamento di cifre (la spedizione resta 0, la frase della consegna resta la stessa).
 */

const leggi = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

describe('R29-005 — le interfacce della spedizione dicono quello che fanno', () => {
  it('shippingForEuro non ha ingressi, e vale 0 come prima', () => {
    expect(shippingForEuro.length, 'shippingForEuro riceve di nuovo ingressi che non usa').toBe(0);
    expect(shippingForEuro()).toBe(0);
    expect(shippingCentsFor()).toBe(0);
  });

  it('promessaSpedizione ha un solo argomento, la consegna, e niente soglia nel risultato', () => {
    expect(leggi('lib/promesse-pubbliche.ts')).toMatch(
      /export function promessaSpedizione\(consegnaCents: number = PLATFORM_DELIVERY_FEE_CENTS\): PromessaSpedizione \{/,
    );
    const p = promessaSpedizione();
    expect(p).not.toHaveProperty('sopraSoglia');
    expect(p).not.toHaveProperty('mancano');
    expect(Object.keys(p).sort()).toEqual(['breve', 'costoConsegna', 'dettaglioConsegna', 'titolo']);
  });

  it.each([
    ['app/product/[id]/page.tsx', /promessaSpedizione\(\)/],
    ['components/ProductCard.tsx', /promessaSpedizione\(\)/],
    ['app/checkout/page.tsx', /shippingForEuro\(\)/],
  ])('%s chiama senza argomenti morti', (file, chiamata) => {
    const src = leggi(file);
    expect(src).toMatch(chiamata);
    expect(src, `${file} passa ancora qualcosa che non cambia la risposta`).not.toMatch(/promessaSpedizione\([^)]|shippingForEuro\(\{/);
    expect(src, `${file} legge ancora un campo che non esiste più`).not.toMatch(/\.sopraSoglia\b|spedizione\.mancano\b/);
  });
});
