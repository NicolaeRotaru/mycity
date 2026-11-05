import { describe, expect, it } from 'vitest';
import { compensoRiderCents } from '@/lib/shipping';
import { COMPENSO_RIDER_CENTS, COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS } from '@/lib/constants';

describe('S07 · il compenso del fattorino vuole sempre sapere se è un negozio in più', () => {
  it('dimenticare l\'argomento è un errore di compilazione, non 3 € in silenzio', () => {
    // @ts-expect-error — negozioInPiu è obbligatorio
    const senza = compensoRiderCents({ pickupInStore: false });
    expect(senza).toBe(COMPENSO_RIDER_CENTS);
    expect(compensoRiderCents({ pickupInStore: false, negozioInPiu: true })).toBe(COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS);
    expect(compensoRiderCents({ pickupInStore: false, negozioInPiu: false })).toBe(COMPENSO_RIDER_CENTS);
  });
});
