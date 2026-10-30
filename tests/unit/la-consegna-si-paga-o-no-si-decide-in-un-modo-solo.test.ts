import { describe, it, expect, vi } from 'vitest';

/**
 * 30/10/2026 — «LA CONSEGNA SI PAGA?» SI DECIDE IN UN MODO SOLO (ondata 18).
 *
 * La FAQ guardava la base con la fascia, il riquadro della pagina Spedizioni il conto più caro.
 * Oggi la base è 3 € e le due risposte coincidono. Il giorno in cui la base va a zero (una
 * promozione, una riga in lib/constants.ts) e restano gli euro in più, 8 € di pane pagano 1 €:
 * il riquadro diceva «si paga», la FAQ «gratuita, qualunque sia la spesa». Qui la base è a zero.
 */
vi.mock('@/lib/constants', async (orig) => ({ ...(await orig<object>()), PLATFORM_DELIVERY_FEE_CENTS: 0 }));

import { rispostaCostoSpedizione, riquadroTariffaConsegna } from '@/lib/promesse-pubbliche';
import { vociDellaConsegna } from '@/lib/ordini/prezzi';

describe('con la base a zero e gli euro in più accesi', () => {
  const ottoEuro = vociDellaConsegna({
    pickupInStore: false,
    negozi: [{ spesaCents: 800, merceCents: 800 }],
    consegnaVeloce: false,
  }).totaleCents;

  it('la cassa chiede 1 € su 8 € di pane', () => {
    expect(ottoEuro).toBe(100);
  });

  it('la FAQ e il riquadro danno la stessa risposta, e non «gratuita qualunque sia la spesa»', () => {
    const faq = rispostaCostoSpedizione().a;
    const riquadro = riquadroTariffaConsegna();
    expect(riquadro.siPaga).toBe(true);
    expect(faq).not.toMatch(/gratuita, qualunque sia la spesa/);
    expect(faq).toContain('1,00');
  });
});
