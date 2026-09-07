import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 6/9/2026 — IL DATABASE CHE NON RISPONDE NON E' UN RIMBORSO PERSO.
 *
 * Il giro che annulla gli ordini mai accettati chiede il rimborso e, se il
 * rimborso fallisce, guarda un solo campo per decidere se riprovare:
 * `ritentabile === false` vuol dire «non ritentare mai piu'», l'ordine resta
 * annullato e i soldi del cliente restano a noi finche' una persona non legge
 * l'avviso nel pannello.
 *
 * Quel marchio deve andare SOLO sui rimborsi che non riusciranno mai: ordine
 * che non esiste, importo gia' rimborsato, stato che lo esclude. Una lettura
 * del database semplicemente caduta — timeout, connessione persa, PostgREST
 * che risponde 503 — mezz'ora dopo riesce benissimo: quella deve restare
 * ritentabile.
 *
 * Questa prova diventa rossa se le due cose tornano a confondersi.
 */

type RispostaLettura = { data: unknown; error: unknown };

const stato: { lettura: RispostaLettura } = {
  lettura: { data: null, error: null },
};

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_x' })) },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/email/templates', () => ({
  refundIssuedTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve(stato.lettura) }) }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));

const { refundOrder } = await import('@/lib/stripe/payout');

/**
 * La stessa domanda che si fa il giro degli ordini scaduti prima di decidere
 * se rimettere l'ordine in coda (`rimborsoSenzaRitorno`, in
 * app/api/cron/expire-stale-orders/route.ts). Non e' esportata: qui e'
 * ricopiata, ed e' il patto fra i due file.
 */
function rimborsoSenzaRitorno(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { ritentabile?: unknown }).ritentabile === false;
}

async function erroreDi(): Promise<unknown> {
  try {
    await refundOrder({ orderId: 'o1', amountCents: 1000, reason: 'ordine mai accettato' });
  } catch (e) {
    return e;
  }
  throw new Error('il rimborso doveva fallire, e invece e\' andato a buon fine');
}

beforeEach(() => {
  stato.lettura = { data: null, error: null };
});

describe('una lettura caduta non e\' un rimborso perso', () => {
  // I tre modi veri in cui la lettura di un ordine cade, coi codici che
  // arrivano davvero: statement timeout di Postgres, connessione persa,
  // PostgREST dietro un 503. Nessuno dei tre dice «l'ordine non c'e'».
  const guasti: Array<[string, Record<string, unknown>]> = [
    ['il database ci mette troppo', { code: '57014', message: 'canceling statement due to statement timeout' }],
    ['la connessione cade', { code: '08006', message: 'connection to server was lost' }],
    ['PostgREST risponde 503', { code: '', message: 'TypeError: fetch failed', details: 'Service Unavailable' }],
  ];

  for (const [quando, guasto] of guasti) {
    it(`${quando}, il rimborso resta da ritentare`, async () => {
      stato.lettura = { data: null, error: guasto };

      const errore = await erroreDi();

      expect(
        rimborsoSenzaRitorno(errore),
        'una lettura caduta e\' stata marchiata «non ritentare»: il cliente ha pagato, l\'ordine e\' annullato e i soldi restano a noi',
      ).toBe(false);
    });
  }

  it('l\'ordine che davvero non esiste resta senza ritorno', async () => {
    // PGRST116 = la `single()` non ha trovato nessuna riga. Qui riprovare non
    // servira' mai, e il marchio ci deve stare.
    stato.lettura = {
      data: null,
      error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
    };

    const errore = await erroreDi();

    expect(rimborsoSenzaRitorno(errore)).toBe(true);
    expect((errore as Error).message).toBe('refundOrder: ordine non trovato');
  });
});
