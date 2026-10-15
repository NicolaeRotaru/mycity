import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * DIMENTICARE DI CHIUDERE LA PAGINA DI PAGAMENTO NON DEVE PIÙ ESSERE POSSIBILE.
 *
 * ── La malattia, non il sintomo ─────────────────────────────────────────────
 * `liberaRiserveAbbandonate` viene chiamata da due posti: la cassa con la carta
 * e la cassa in contanti. L'effetto che conta — rendere non più pagabile la
 * pagina di Stripe rimasta aperta — era appeso a un parametro FACOLTATIVO
 * (`chiudiSessione`). La rotta della carta se lo ricordava, quella dei contanti
 * no, e nessuno se ne accorgeva: né il compilatore né le prove.
 *
 * La prova scritta allora leggeva il sorgente della rotta
 * (`src.indexOf('liberaRiserveAbbandonate(')`): una ricerca di parole non può
 * accorgersi di un argomento che manca.
 *
 * ── Cosa difende questa prova ───────────────────────────────────────────────
 * La funzione si esegue **senza passare `chiudiSessione`** — cioè come la
 * chiamerebbe uno smemorato, o come la chiamerà chiunque la userà domani da un
 * terzo posto — e si pretende che la pagina venga chiusa su Stripe lo stesso.
 * Se un giorno la chiusura tornasse a essere un favore da ricordarsi, qui
 * diventa rosso.
 */

/** Le sessioni che il codice ha chiuso passando dal vero client di Stripe. */
const chiuseSuStripe: string[] = [];

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

/**
 * Stripe finto. `chiudiSuStripe` lo importa al volo (`await import`): il mock
 * vale anche per gli import dinamici, quindi qui passa davvero di qua.
 */
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        expire: async (id: string) => {
          chiuseSuStripe.push(id);
          return { id, status: 'expired' };
        },
      },
    },
  }),
}));

type Esito = { data: unknown[] | null; error?: { message: string } | null };

const tentativoAbbandonato = {
  id: 'p1',
  groups: [{ items: [{ productId: 'torta', quantity: 1, variantId: null }] }],
  coupon_code: null,
  stripe_session_id: 'cs_rimasta_aperta',
  delivery: { impronta_carrello: 'carrello-di-prima' },
};

/** Database finto: un tentativo aperto, nessun ordine collegato. */
function fintoDatabase() {
  const rpcChiamate: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const client = {
    from(tavola: string) {
      let inAggiornamento = false;
      const risposta = (): Esito => {
        if (tavola === 'orders') return { data: [], error: null };
        if (inAggiornamento) return { data: [{ id: 'p1' }], error: null };
        return { data: [tentativoAbbandonato], error: null };
      };
      const c: Record<string, unknown> = {
        select: () => c,
        update: () => { inAggiornamento = true; return c; },
        eq: () => c,
        in: () => c,
        limit: () => c,
        then: (risolvi: (e: Esito) => unknown) => Promise.resolve(risposta()).then(risolvi),
      };
      return c;
    },
    rpc: async (nome: string, args: Record<string, unknown>) => {
      rpcChiamate.push({ nome, args });
      return { error: null };
    },
  };
  return { admin: client, rpcChiamate };
}

beforeEach(() => {
  chiuseSuStripe.length = 0;
  /**
   * 9/9/2026 — L'ARRAY TORNA UN ARRAY NORMALE, NON SOLO VUOTO.
   *
   * La prova sull'ORDINE qui sotto sostituisce `push` per segnare quando Stripe
   * viene chiamato. Quella sostituzione resta addosso all'array per tutto il
   * file, e diventa una proprieta' SUA: `toEqual` le proprieta' proprie le
   * confronta. Girando in un altro ordine, l'altra prova trovava gli stessi
   * identici elementi e falliva lo stesso, con un messaggio che sembra un
   * enigma — «Compared values have no visual difference».
   *
   * Svuotarlo non bastava: va tolta anche la sostituzione.
   */
  delete (chiuseSuStripe as Partial<Pick<string[], 'push'>>).push;
});

describe('la pagina di pagamento si chiude anche se nessuno lo chiede', () => {
  it('chiamata senza «chiudiSessione», chiude comunque la pagina su Stripe', async () => {
    const { liberaRiserveAbbandonate } = await import('@/lib/ordini/riserve-abbandonate');
    const { admin } = fintoDatabase();

    // Nessun `chiudiSessione`: esattamente la chiamata che la rotta dei contanti
    // faceva quando il difetto era vivo.
    const esito = await liberaRiserveAbbandonate(admin as never, {
      buyerId: 'maria',
      soloConProdotti: ['torta'],
    });

    expect(
      chiuseSuStripe,
      'nessuno ha chiuso la pagina: chi ci torna paga una seconda volta la stessa merce',
    ).toEqual(['cs_rimasta_aperta']);
    expect(esito.liberati, 'la merce del tentativo abbandonato non e tornata a scaffale').toEqual(['p1']);
    expect(esito.ancoraPagabili, 'una pagina risulta ancora pagabile senza motivo').toEqual([]);
  });

  it('la merce torna a scaffale solo DOPO che la pagina e chiusa', async () => {
    /**
     * L'ordine conta. Rimettere in vendita la merce lasciando viva la pagina è
     * la coppia che fa pagare due volte: prima si chiude, poi si libera.
     */
    const { liberaRiserveAbbandonate } = await import('@/lib/ordini/riserve-abbandonate');
    const { admin, rpcChiamate } = fintoDatabase();
    const cronologia: string[] = [];

    const originale = admin.rpc;
    admin.rpc = async (nome: string, args: Record<string, unknown>) => {
      cronologia.push(`rpc:${nome}`);
      return originale(nome, args);
    };
    chiuseSuStripe.push = ((id: string) => {
      cronologia.push('stripe:expire');
      return Array.prototype.push.call(chiuseSuStripe, id);
    }) as typeof chiuseSuStripe.push;

    await liberaRiserveAbbandonate(admin as never, { buyerId: 'maria', soloConProdotti: ['torta'] });

    expect(rpcChiamate.map((c) => c.nome), 'la merce non e stata rimessa in vendita').toContain('restore_stock');
    expect(
      cronologia.indexOf('stripe:expire'),
      'la merce e tornata a scaffale prima di chiudere la pagina: se la chiusura fallisce, si paga due volte',
    ).toBeLessThan(cronologia.indexOf('rpc:restore_stock'));
  });
});
