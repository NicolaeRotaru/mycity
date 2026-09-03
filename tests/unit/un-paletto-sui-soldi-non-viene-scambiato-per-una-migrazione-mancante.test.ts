import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CAMPI_124, eSchemaIndietro, conRipiegoSchema, senzaCampi } from '@/lib/db/migrazione-124';

/**
 * IL DATABASE FERMA UN IMPORTO STORTO E IL CODICE NON DEVE AGGIRARLO.
 *
 * Sui soldi la difesa vera sta nel database: la migrazione 127 e la 146 hanno
 * messo tre paletti sulla tabella degli ordini — il lordo non negativo, il
 * rimborso entro il lordo, il compenso al negozio non più alto dell'incasso.
 * Quando uno scatta, PostgreSQL risponde 23514.
 *
 * Il ripiego scritto per la migrazione 124 trattava 23514 come «la migrazione
 * non è ancora applicata»: toglieva `gross_total_cents` dalla riga e riprovava.
 * E i tre paletti sono scritti tutti «se il lordo c'è»: con il lordo vuoto
 * lasciano passare qualunque cifra. Un ordine da 10,00 € con 11,00 € di
 * compenso al negozio entrava lo stesso, senza lordo, e nel registro restava
 * scritta la diagnosi sbagliata. Da lì rimborsi e bonifici ripiegano su
 * `total_price`, che sugli ordini pagati in parte col credito MyCity è il
 * netto: il tetto del rimborso e la quota da recuperare al negozio escono
 * sbagliati.
 *
 * Questa prova gira il ripiego con i messaggi d'errore veri di PostgreSQL.
 */

const { logger } = vi.hoisted(() => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logger }));

beforeEach(() => logger.warn.mockClear());

/** Il messaggio che PostgreSQL scrive davvero quando un CHECK ferma una riga. */
function checkViolato(vincolo: string) {
  return {
    code: '23514',
    message: `new row for relation "orders" violates check constraint "${vincolo}"`,
    details: 'Failing row contains (…).',
  };
}

/** I tre paletti sui soldi, più quello sul prezzo di riga (146). */
const PALETTI_SUI_SOLDI = [
  'orders_payout_venditore_sensato',
  'orders_lordo_non_negativo',
  'orders_rimborso_entro_lordo',
  'orders_rimborso_non_negativo',
  'order_items_prezzo_non_negativo',
];

describe('un paletto sui soldi non è «schema indietro»', () => {
  it.each(PALETTI_SUI_SOLDI)('%s resta un errore, non un ripiego', (vincolo) => {
    expect(eSchemaIndietro(checkViolato(vincolo))).toBe(false);
  });

  it('un CHECK che non dice quale non vale come schema indietro', () => {
    // Sui soldi, nel dubbio si sbatte la porta: meglio una scrittura fermata
    // che una cifra storta salvata senza lordo.
    expect(eSchemaIndietro({ code: '23514', message: 'violates check constraint' })).toBe(false);
    expect(eSchemaIndietro({ code: '23514' })).toBe(false);
  });

  it('i due vincoli sugli stati del bonifico invece sì: è per loro che il ripiego esiste', () => {
    expect(eSchemaIndietro(checkViolato('orders_payout_status_check'))).toBe(true);
    expect(eSchemaIndietro(checkViolato('orders_rider_payout_status_check'))).toBe(true);
  });

  it('gli altri codici di schema indietro non cambiano', () => {
    expect(eSchemaIndietro({ code: '42703', message: 'column "gross_total_cents" does not exist' })).toBe(true);
    expect(eSchemaIndietro({ code: '42P01' })).toBe(true);
    expect(eSchemaIndietro({ code: '42883' })).toBe(true);
  });
});

describe('l ordine con un compenso più alto dell incasso non entra lo stesso', () => {
  it('il ripiego NON riprova senza il lordo, e l errore torna al chiamante', async () => {
    type Esito = { data: { id: string } | null; error: unknown };
    // Ordine da 10,00 € con 11,00 € di compenso al negozio: è il caso che il
    // paletto `orders_payout_venditore_sensato` esiste per fermare.
    const riga = { user_id: 'u1', total_price: 10, gross_total_cents: 1000, seller_payout_cents: 1100 };
    const errore = checkViolato('orders_payout_venditore_sensato');

    const senzaLordo = vi.fn(async (): Promise<Esito> => {
      // Senza `gross_total_cents` il paletto non guarda più niente: la riga
      // storta passerebbe. È esattamente quello che non deve succedere.
      expect(senzaCampi(riga, CAMPI_124)).not.toHaveProperty('gross_total_cents');
      return { data: { id: 'ordine-storto' }, error: null };
    });

    const esito = await conRipiegoSchema<Esito>(
      'orders.insert (cod)',
      async () => ({ data: null, error: errore }),
      senzaLordo,
    );

    expect(senzaLordo).not.toHaveBeenCalled();
    expect(esito.data).toBeNull();
    expect(esito.error).toBe(errore);
    // E nessun avviso che dia la colpa a una migrazione mancante.
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('uno stato nuovo rifiutato dal vincolo vecchio invece si ripiega ancora', async () => {
    type Esito = { data: { id: string } | null; error: unknown };
    const esito = await conRipiegoSchema<Esito>(
      'orders.update (turno del bonifico)',
      async () => ({ data: null, error: checkViolato('orders_payout_status_check') }),
      async () => ({ data: { id: 'o1' }, error: null }),
    );
    expect(esito.data).toEqual({ id: 'o1' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
