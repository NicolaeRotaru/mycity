import { describe, it, expect } from 'vitest';
import { validaRigaDelCarrello, rispostaPerCarrelloNonVendibile, type ProdottoDelCatalogo } from '@/lib/ordini/valida-carrello';

/**
 * R30-010 — La cassa non vende una riga a zero euro.
 *
 * Il database accetta price = 0 (migrations/001: price >= 0) e la convalida del carrello,
 * che usano tutte e due le strade dell'ordine (contanti e carta), non guardava il prezzo:
 * un prodotto finito a 0,00 € si comprava, e il negozio consegnava merce gratis se accettava
 * senza guardare. La modifica in blocco e la porta di scrittura lo fermano già
 * (tests/unit/minori-s06-modifica-in-blocco.test.tsx); questa è l'ultima difesa.
 */

const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';

function focaccia(p: Partial<ProdottoDelCatalogo> = {}): ProdottoDelCatalogo {
  return { id: 'p-focaccia', name: 'Focaccia', price: 4.5, seller_id: NEGOZIO, stock: 10, status: 'available', has_variants: false, ...p };
}

function valida(prodotto: ProdottoDelCatalogo, sconto = 0) {
  return validaRigaDelCarrello({
    riga: { productId: prodotto.id, quantity: 1 },
    sellerId: NEGOZIO,
    prodotti: [prodotto],
    varianti: new Map(),
    sconti: new Map(sconto ? [[prodotto.id, sconto]] : []),
  });
}

describe('R30-010 — una riga a zero euro non si vende', () => {
  it('prezzo 0: la riga è scartata, con 400 e il nome del prodotto', () => {
    const esito = valida(focaccia({ price: 0 }));
    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.scarto.messaggio).toContain('Focaccia');
    expect(rispostaPerCarrelloNonVendibile(esito.scarto).status).toBe(400);
  });

  it('prezzo negativo o illeggibile: scartata anche lei', () => {
    expect(valida(focaccia({ price: -1 })).ok).toBe(false);
    expect(valida(focaccia({ price: Number.NaN })).ok).toBe(false);
  });

  it('un centesimo col 70% di sconto arriva a zero centesimi: scartata', () => {
    expect(valida(focaccia({ price: 0.01 }), 70).ok).toBe(false);
  });

  it('un prezzo vero passa come prima, scontato in centesimi', () => {
    const esito = valida(focaccia({ price: 4.5 }), 20);
    expect(esito.ok).toBe(true);
    if (!esito.ok) return;
    expect(esito.riga.unitCents).toBe(360);
  });
});
