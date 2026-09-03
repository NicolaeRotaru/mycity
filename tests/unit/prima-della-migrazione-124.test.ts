import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CAMPI_124,
  COLONNE_124,
  eSchemaIndietro,
  conRipiegoSchema,
  senzaCampi,
  senzaColonne,
} from '@/lib/db/migrazione-124';

/**
 * L'ORDINE DEVE NASCERE ANCHE PRIMA CHE LA MIGRAZIONE SIA APPLICATA.
 *
 * Nel progetto il codice e le migrazioni hanno due firme separate: unire una
 * richiesta pubblica il codice, applicare la migrazione al database è
 * un'azione a parte. Fra le due c'è sempre una finestra.
 *
 * Il lotto del 21 agosto quella finestra non l'aveva coperta, ed è un difetto
 * mio: le colonne nuove finivano nelle istruzioni senza condizioni. PostgreSQL
 * non ignora una colonna che non conosce — fa fallire l'istruzione INTERA — e
 * il risultato, dal minuto dell'unione a quello della firma sul database, era
 * che non si poteva creare nessun ordine, confermare nessun incasso in
 * contanti, far partire nessun pagamento.
 *
 * Questa prova gira il ripiego contro il codice d'errore vero di PostgreSQL
 * per «colonna che non esiste» (42703) e per «stato rifiutato dal vincolo»
 * (23514).
 */

const { logger } = vi.hoisted(() => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logger }));

beforeEach(() => logger.warn.mockClear());

/** La forma di quello che torna da PostgREST: o il dato, o l'errore. */
type Esito = { data: { id: string } | null; error: unknown };

/** L'errore che PostgREST restituisce quando la colonna non c'è ancora. */
const COLONNA_ASSENTE = { code: '42703', message: 'column "gross_total_cents" does not exist' };
/**
 * Quello che restituisce quando uno stato nuovo urta il vincolo vecchio.
 *
 * 3/9/2026 — IL NOME DEL VINCOLO FA PARTE DELLA PROVA. Prima qui c'era un
 * «violates check constraint» senza nome, e il ripiego lo accettava: cioè
 * accettava QUALSIASI vincolo di quella tabella, compresi i tre paletti sui
 * soldi nati con la 127 e la 146. Il messaggio vero di PostgreSQL il nome ce
 * l'ha sempre, ed è quello che distingue «schema indietro» da «importo storto».
 */
const STATO_RIFIUTATO = {
  code: '23514',
  message: 'new row for relation "orders" violates check constraint "orders_payout_status_check"',
};

describe('il ripiego riconosce uno schema indietro', () => {
  it('riconosce colonna assente, funzione assente e vincolo violato', () => {
    expect(eSchemaIndietro(COLONNA_ASSENTE)).toBe(true);
    expect(eSchemaIndietro({ code: '42883' })).toBe(true);
    expect(eSchemaIndietro(STATO_RIFIUTATO)).toBe(true);
  });

  it('NON scambia per «schema indietro» un errore vero', () => {
    // 23505 = doppione: è il controllo anti-doppia-cassa che deve restare tale.
    expect(eSchemaIndietro({ code: '23505' })).toBe(false);
    // 42501 = permesso negato: una falla di sicurezza non si aggira riprovando.
    expect(eSchemaIndietro({ code: '42501' })).toBe(false);
    expect(eSchemaIndietro(null)).toBe(false);
    expect(eSchemaIndietro(new Error('rete giù'))).toBe(false);
  });
});

describe('l ordine nasce in tutti e due i mondi', () => {
  it('col database aggiornato passa al primo colpo, e il ripiego non parte', async () => {
    const senza = vi.fn(async (): Promise<Esito> => ({ data: { id: 'o1' }, error: null }));
    const esito = await conRipiegoSchema<Esito>(
      'prova',
      async () => ({ data: { id: 'o1' }, error: null }),
      senza,
    );
    expect(esito.data).toEqual({ id: 'o1' });
    expect(senza).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('col database indietro riprova senza i campi nuovi, e lo dice forte', async () => {
    const esito = await conRipiegoSchema<Esito>(
      'orders.insert (cod)',
      async () => ({ data: null, error: COLONNA_ASSENTE }),
      async () => ({ data: { id: 'o1' }, error: null }),
    );
    // L'ordine nasce lo stesso: è tutto il punto.
    expect(esito.data).toEqual({ id: 'o1' });
    expect(esito.error).toBeNull();
    // E resta una traccia: questa strada non deve diventare la normalità muta.
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('un errore vero NON viene aggirato: si restituisce com è', async () => {
    const senza = vi.fn(async (): Promise<Esito> => ({ data: { id: 'doppione' }, error: null }));
    const esito = await conRipiegoSchema<Esito>(
      'prova',
      async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }),
      senza,
    );
    expect(senza).not.toHaveBeenCalled();
    expect((esito.error as { code: string }).code).toBe('23505');
  });
});

describe('cosa si toglie quando si riprova', () => {
  it('dalla riga si toglie solo il campo nuovo, il resto resta intatto', () => {
    const riga = {
      user_id: 'u1',
      total_price: 20,
      gross_total_cents: 2000,
      seller_payout_cents: 1800,
      payment_method: 'cod',
    };
    const ridotta = senzaCampi(riga, CAMPI_124);
    expect(ridotta).not.toHaveProperty('gross_total_cents');
    // I soldi che c'erano prima della 124 devono restare tutti.
    expect(ridotta).toMatchObject({
      user_id: 'u1',
      total_price: 20,
      seller_payout_cents: 1800,
      payment_method: 'cod',
    });
    // E l'originale non si tocca: chi lo riusa deve trovarlo com'era.
    expect(riga.gross_total_cents).toBe(2000);
  });

  it('dalla select si tolgono solo le colonne nuove', () => {
    const select = 'id, seller_id, payout_status, seller_payout_cents, payout_tentativo, delivery_status';
    expect(senzaColonne(select, COLONNE_124)).toBe(
      'id, seller_id, payout_status, seller_payout_cents, delivery_status',
    );
  });

  it('una select senza colonne nuove resta identica', () => {
    const select = 'id, seller_id, delivery_status';
    expect(senzaColonne(select, COLONNE_124)).toBe(select);
  });
});
