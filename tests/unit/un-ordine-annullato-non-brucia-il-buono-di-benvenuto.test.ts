import { describe, it, expect } from 'vitest';
import { validateCoupon } from '@/lib/coupons';

/**
 * UN ORDINE ANNULLATO NON BRUCIA IL BUONO DI BENVENUTO.
 *
 * Passo indietro: i codici «solo primo ordine» sono quelli di benvenuto, la
 * leva che serve a far fare il primo acquisto a una persona nuova.
 *
 * 3/9/2026 — IL CONTROLLO CONTAVA OGNI RIGA. La domanda «è il tuo primo
 * ordine?» era tradotta in «esiste una riga in orders con il tuo nome», senza
 * guardare come fosse andata a finire.
 *
 * Lunedì Maria ordina con BENVENUTO10, il fornaio rifiuta perché il pane è
 * finito. Il sistema le scrive «Il codice sconto BENVENUTO10 torna
 * utilizzabile» e glielo restituisce davvero. Martedì Maria riprova e la cassa
 * risponde «Codice valido solo al primo ordine»: quell'ordine mai avvenuto le
 * ha bruciato il buono. Il secondo tentativo — quello in cui stava riprovando a
 * comprare — le costa di più, e la promessa scritta si rivela falsa.
 *
 * Vale anche per l'annullo del cliente prima della conferma e per l'ordine in
 * contanti scaduto dal giro automatico (annullato + pagamento fallito).
 *
 * La finta qui sotto APPLICA DAVVERO i filtri della query: se il conteggio
 * torna a guardare tutte le righe, queste prove diventano rosse.
 */

type RigaOrdine = {
  user_id: string;
  delivery_status: string | null;
  payment_status: string | null;
};

const BENVENUTO = {
  id: 'cpn-benvenuto',
  code: 'BENVENUTO10',
  type: 'PERCENT' as const,
  value: 10,
  min_subtotal: 0,
  max_uses: 100,
  uses_count: 3,
  first_order_only: true,
  expires_at: null,
  active: true,
  description: 'Benvenuto su MyCity',
};

/** Un finto database che filtra le righe come farebbe Postgres. */
function databaseCon(ordini: RigaOrdine[]) {
  return {
    from(tabella: string) {
      if (tabella === 'coupons') {
        const catena: Record<string, unknown> = {
          select: () => catena,
          eq: () => catena,
          maybeSingle: () => Promise.resolve({ data: BENVENUTO, error: null }),
        };
        return catena;
      }
      // orders: `.select('id', { count: 'exact', head: true })` + i filtri.
      let righe = ordini;
      const catena: Record<string, unknown> = {
        select: () => catena,
        eq: (colonna: keyof RigaOrdine, valore: unknown) => {
          righe = righe.filter((r) => r[colonna] === valore);
          return catena;
        },
        neq: (colonna: keyof RigaOrdine, valore: unknown) => {
          // Come `<>` in SQL: la riga resta solo se il valore è diverso.
          righe = righe.filter((r) => r[colonna] !== valore);
          return catena;
        },
        then: (risolvi: (v: { count: number }) => unknown) => Promise.resolve(risolvi({ count: righe.length })),
      };
      return catena;
    },
  } as unknown as Parameters<typeof validateCoupon>[3];
}

const provaIlBuono = (ordini: RigaOrdine[]) =>
  validateCoupon('BENVENUTO10', 30, 'maria', databaseCon(ordini));

describe('il buono di benvenuto e gli ordini che non sono andati a buon fine', () => {
  it('IL CASO CHE ROMPEVA — un ordine rifiutato dal negozio non brucia il primo ordine', async () => {
    const esito = await provaIlBuono([
      { user_id: 'maria', delivery_status: 'CANCELED', payment_status: 'PENDING' },
    ]);

    expect(
      esito.ok,
      'il negozio ha rifiutato, le abbiamo scritto che il codice torna utilizzabile, e la cassa lo rifiuta',
    ).toBe(true);
  });

  it('IL CASO CHE ROMPEVA — un ordine in contanti mai partito e scaduto non brucia il primo ordine', async () => {
    const esito = await provaIlBuono([
      { user_id: 'maria', delivery_status: 'CANCELED', payment_status: 'FAILED' },
    ]);

    expect(esito.ok, 'il giro automatico ha chiuso un ordine mai partito e il buono è morto con lui').toBe(true);
  });

  it('un ordine col pagamento fallito non brucia il primo ordine', async () => {
    // Oggi chi scrive «pagamento fallito» annulla anche l'ordine, quindi il
    // filtro sullo stato basterebbe. La regola però è sui SOLDI, non sullo
    // stato della consegna: un ordine che non è stato pagato non è un acquisto.
    // Il giorno che nascesse una strada che segna il pagamento fallito senza
    // annullare, il buono non deve morire lì dentro.
    const esito = await provaIlBuono([
      { user_id: 'maria', delivery_status: 'NEW', payment_status: 'FAILED' },
    ]);

    expect(esito.ok, 'un pagamento mai andato a buon fine ha bruciato il buono').toBe(true);
  });

  it('senza nessun ordine il buono vale', async () => {
    const esito = await provaIlBuono([]);
    expect(esito.ok).toBe(true);
  });

  it('con un ordine consegnato il buono non vale più: il primo acquisto c è stato', async () => {
    const esito = await provaIlBuono([
      { user_id: 'maria', delivery_status: 'DELIVERED', payment_status: 'PAID' },
    ]);

    expect(esito.ok).toBe(false);
    if (!esito.ok) expect(esito.reason).toMatch(/primo ordine/i);
  });

  it('un ordine consegnato e poi rimborsato resta un primo acquisto', async () => {
    // Il freno all'altro danno: se un rimborso riaprisse il buono, «compro, mi
    // faccio rimborsare, riuso il buono» diventerebbe uno sconto infinito.
    const esito = await provaIlBuono([
      { user_id: 'maria', delivery_status: 'DELIVERED', payment_status: 'REFUNDED' },
    ]);

    expect(esito.ok, 'un reso non deve restituire il buono di benvenuto').toBe(false);
  });

  it('gli ordini degli altri clienti non contano', async () => {
    const esito = await provaIlBuono([
      { user_id: 'luca', delivery_status: 'DELIVERED', payment_status: 'PAID' },
    ]);
    expect(esito.ok).toBe(true);
  });

  it('un ordine vero in corso brucia il buono anche se l altro è annullato', async () => {
    const esito = await provaIlBuono([
      { user_id: 'maria', delivery_status: 'CANCELED', payment_status: 'PENDING' },
      { user_id: 'maria', delivery_status: 'ACCEPTED', payment_status: 'PAID' },
    ]);
    expect(esito.ok).toBe(false);
  });
});
