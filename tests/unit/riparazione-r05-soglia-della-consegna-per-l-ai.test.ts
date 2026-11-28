import { describe, it, expect, vi } from 'vitest';

/**
 * R05-009 / R05-010 — LA SOGLIA DELLA CONSEGNA NELLA FRASE PER L'ASSISTENTE VIENE DALLA COSTANTE.
 *
 * `regolaConsegnaPerAi` scriveva a mano «da 10 € in su» e «sotto i 10 €», e chiedeva la tariffa a
 * 999 e 1000 centesimi. Se la soglia (`SPESA_SENZA_SUPPLEMENTO_CENTS`) cambiava, la frase diceva
 * ancora 10 € con le cifre sbagliate. Qui la costante è finta a 15 €: la frase deve seguirla.
 */
vi.mock('@/lib/constants', async (orig) => ({ ...(await orig<object>()), SPESA_SENZA_SUPPLEMENTO_CENTS: 1500 }));

import { regolaConsegnaPerAi } from '@/lib/products/economics';
import { tariffaConsegnaCents } from '@/lib/ordini/prezzi';
import { formatPrice } from '@/lib/format';

// R09-012 — Le cifre si scrivono in italiano, da formatPrice («3,00 €»), anche per l'assistente.
const tariffa = (merceCents: number) => formatPrice(tariffaConsegnaCents({ pickupInStore: false, merceCents, consegnaVeloce: false }) / 100);

describe('R05-009 / R05-010 · la soglia della consegna per l assistente', () => {
  it('con la soglia a 15 € la frase dice 15 €, con le cifre della tariffa ai due lati', () => {
    const testo = regolaConsegnaPerAi();
    expect(testo).toContain(`${tariffa(1500)} per una spesa da 15 € in su`);
    expect(testo).toContain(`${tariffa(1499)} sotto i 15 €`);
    expect(testo).not.toMatch(/10 €/);
    // Le due cifre sono diverse: la soglia è davvero quella della tariffa.
    expect(tariffa(1500)).not.toBe(tariffa(1499));
  });
});
