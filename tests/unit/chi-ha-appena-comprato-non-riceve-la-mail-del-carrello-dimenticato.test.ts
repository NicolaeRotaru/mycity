/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 3/9/2026 — IL CARRELLO SI PERDEVA IN SILENZIO, IN DUE MODI.
 *
 * La copia del carrello sul server serve a due cose che valgono soldi: dire
 * «hai dimenticato qualcosa» a chi se n'è andato, e NON dirlo a chi invece ha
 * comprato. Il codice scriveva e non guardava mai com'era andata: il database
 * non lancia quando rifiuta, restituisce l'errore dentro la risposta, e quella
 * risposta non la leggeva nessuno.
 *
 * ① `recovered_at` arriva con la migrazione 148, e le migrazioni si applicano a
 *    mano. Finché non è applicata, il database rifiuta l'INTERA scrittura che
 *    la nomina — non «quella colonna»: tutta la riga. Risultato: chi aveva
 *    appena pagato restava «non recuperato» e il mattino dopo riceveva l'email
 *    «hai lasciato qualcosa nel carrello»; e la spesa messa nel carrello non
 *    arrivava mai sul server, quindi non si ritrovava sull'altro dispositivo.
 *
 * ② «Il servizio di accesso non risponde» veniva scambiato per «non ha fatto
 *    l'accesso»: si usciva in silenzio. È lo stesso sbaglio del portiere del
 *    sito; la regola che distingue le due cose sta in
 *    `lib/auth/decisione-portiere.ts` e qui si chiama quella, non una copia.
 *
 * Questa prova non legge il sorgente: fa lavorare la funzione vera contro un
 * finto database che ha ESATTAMENTE le colonne della produzione di oggi.
 */

type Scrittura = { tipo: 'update' | 'upsert' | 'delete'; campi?: Record<string, unknown> };

const scritture: Scrittura[] = [];
const avvisi: string[] = [];

/** Le colonne che `abandoned_carts` ha nel database di questa prova. */
let colonne = new Set<string>();
let sessione: { user: { id: string } } | null = { user: { id: 'u1' } };
let erroreSessione: unknown = null;

/** Com'è oggi in produzione: la migrazione 148 non è ancora stata applicata. */
const PRODUZIONE_OGGI = [
  'user_id',
  'cart_data',
  'cart_total',
  'last_activity',
  'recovery_email_sent_at',
  'recovered',
];
/** Com'è dopo la firma sulla migrazione 148. */
const SCHEMA_COMPLETO = [...PRODUZIONE_OGGI, 'recovered_at'];

/** Come risponde davvero il servizio di accesso quando la rete è caduta. */
const RETE_CADUTA = { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 };
/** Come risponde quando la sessione è semplicemente scaduta: non è un guasto. */
const SESSIONE_FINITA = { name: 'AuthSessionMissingError', message: 'Auth session missing!', status: 400 };

/**
 * Il database finto: rifiuta tutta la scrittura se nomina una colonna che non
 * ha, con lo stesso codice di PostgREST. E registra solo le scritture riuscite.
 */
function rispostaA(tipo: Scrittura['tipo'], campi?: Record<string, unknown>) {
  const mancante = campi ? Object.keys(campi).find((c) => !colonne.has(c)) : undefined;
  if (mancante) {
    return {
      data: null,
      error: {
        code: 'PGRST204',
        message: `Could not find the '${mancante}' column of 'abandoned_carts' in the schema cache`,
      },
    };
  }
  scritture.push({ tipo, campi });
  return { data: [], error: null };
}

function catena(risposta: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['eq', 'lt', 'select', 'in', 'is']) c[m] = () => c;
  c.then = (risolvi: (v: unknown) => unknown) => Promise.resolve(risposta).then(risolvi);
  return c;
}

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: (msg: string) => { avvisi.push(msg); },
    info: () => {},
    error: () => {},
    spesa: () => {},
  },
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: () => ({
      update: (v: Record<string, unknown>) => catena(rispostaA('update', v)),
      upsert: (v: Record<string, unknown>) => catena(rispostaA('upsert', v)),
      delete: () => catena(rispostaA('delete')),
    }),
    auth: {
      getSession: async () => ({ data: { session: sessione }, error: erroreSessione }),
    },
  },
}));

import { syncAbandonedCart } from '@/lib/cart-sync';
import { erroreDaFornitoreMuto } from '@/lib/auth/decisione-portiere';

const RIGA = { id: 'p1', name: 'Focaccia', price: 4.5, quantity: 2, sellerId: 's1' };

beforeEach(() => {
  scritture.length = 0;
  avvisi.length = 0;
  colonne = new Set(PRODUZIONE_OGGI);
  sessione = { user: { id: 'u1' } };
  erroreSessione = null;
});

describe('il database è indietro di una migrazione', () => {
  it('chi ha appena comprato risulta comunque tornato, e non finisce in coda per l email', async () => {
    await syncAbandonedCart([], { totale: 0, dopoUnOrdine: true });

    const marcata = scritture.find((s) => s.tipo === 'update');
    expect(
      marcata,
      'la scrittura nomina una colonna che qui non esiste e il database la rifiuta TUTTA: chi ha pagato resta «non recuperato» e domattina riceve «hai lasciato qualcosa nel carrello»',
    ).toBeTruthy();
    expect(marcata?.campi?.recovered).toBe(true);
    expect(scritture.find((s) => s.tipo === 'delete'), 'la riga recuperata non si cancella mai').toBeUndefined();
    expect(avvisi.join(' '), 'un ripiego silenzioso è un guasto che nessuno vedrà mai').toContain('148');
  });

  it('la spesa messa nel carrello arriva sul server lo stesso', async () => {
    await syncAbandonedCart([RIGA], { totale: 9 });

    const salvata = scritture.find((s) => s.tipo === 'upsert');
    expect(
      salvata,
      'il carrello non viene salvato affatto: chi cambia dispositivo lo ritrova vuoto, e la campagna di recupero non ha niente da ricontattare',
    ).toBeTruthy();
    expect(salvata?.campi?.cart_data).toEqual([RIGA]);
    expect(salvata?.campi?.cart_total).toBe(9);
    // La colonna nuova è stata tolta solo perché mancava: le altre restano.
    expect(salvata?.campi?.recovery_email_sent_at).toBeNull();
    expect(salvata?.campi?.recovered).toBe(false);
  });
});

describe('la strada che conta di più: il server', () => {
  /**
   * Chi paga con la carta ed esce dalla scheda non passa mai dal browser che
   * marca. L'unico posto dove l'ordine è un fatto certo è il webhook di Stripe,
   * e da lì si arriva a `marcaCarrelloRecuperato`. Se cade quella, l'email
   * sbagliata parte comunque.
   */
  function adminFinto() {
    return {
      from: () => ({
        update: (v: Record<string, unknown>) => catena(rispostaA('update', v)),
      }),
    };
  }

  it('il webhook marca il carrello anche se il database non ha la colonna nuova', async () => {
    const { marcaCarrelloRecuperato } = await import('@/lib/carrelli-abbandonati');
    await marcaCarrelloRecuperato(
      adminFinto() as unknown as Parameters<typeof marcaCarrelloRecuperato>[0],
      'u1',
    );

    const marcata = scritture.find((s) => s.tipo === 'update');
    expect(
      marcata,
      'chi paga con la carta e chiude la scheda non passa dal browser: se cade anche questa, nessuno marca niente',
    ).toBeTruthy();
    expect(marcata?.campi?.recovered).toBe(true);
  });
});

describe('col database aggiornato non cambia niente', () => {
  it('si scrive tutto in un colpo solo, e QUANDO è tornato resta scritto', async () => {
    colonne = new Set(SCHEMA_COMPLETO);
    await syncAbandonedCart([], { totale: 0, dopoUnOrdine: true });

    expect(scritture, 'con lo schema giusto non ci deve essere nessun secondo tentativo').toHaveLength(1);
    expect(scritture[0].campi?.recovered).toBe(true);
    expect(
      scritture[0].campi?.recovered_at,
      'recuperato senza sapere quando: non si può misurare a quanti giorni dall email arriva l acquisto',
    ).toBeTruthy();
    expect(avvisi, 'niente da segnalare quando va tutto bene').toHaveLength(0);
  });
});

describe('quando il servizio di accesso non risponde', () => {
  it('un intoppo del fornitore non passa per «non ha fatto l accesso»: resta scritto nei log', async () => {
    sessione = null;
    erroreSessione = RETE_CADUTA;

    await syncAbandonedCart([RIGA], { totale: 9 });

    expect(scritture, 'senza sapere chi è non si scrive niente: giusto').toHaveLength(0);
    expect(
      avvisi,
      'la copia sul server resta indietro e nessuno lo sa: è lo stesso silenzio che buttava fuori chi era già entrato',
    ).toHaveLength(1);
  });

  it('ma una sessione scaduta è normale amministrazione, e non riempie i log', async () => {
    sessione = null;
    erroreSessione = SESSIONE_FINITA;

    await syncAbandonedCart([RIGA], { totale: 9 });

    expect(scritture).toHaveLength(0);
    expect(avvisi, 'un avviso a ogni sessione scaduta vuol dire migliaia di avvisi inutili').toHaveLength(0);
  });

  it('e la regola che distingue i due casi è quella del portiere, non una copia', () => {
    expect(erroreDaFornitoreMuto(RETE_CADUTA)).toBe(true);
    expect(erroreDaFornitoreMuto(SESSIONE_FINITA)).toBe(false);
  });
});

describe('«lo schema è indietro» si riconosce in un posto solo', () => {
  it('i codici di PostgreSQL li decide la 124, non una seconda lista qui', async () => {
    const { colonnaNonTrovata } = await import('@/lib/db/migrazione-148');
    // `42P01` (tabella che non c'è) e `42703` (colonna che non c'è) li conosce
    // solo `eSchemaIndietro`, insieme alla migrazione 124. Il messaggio è muto
    // apposta: se questi passano, vuol dire che quella lista viene davvero
    // interrogata e non ne è nata una seconda qui dentro.
    expect(colonnaNonTrovata({ code: '42703', message: 'boom' })).toBe(true);
    expect(colonnaNonTrovata({ code: '42P01', message: 'boom' })).toBe(true);
    // Questo invece è il codice che là manca, ed è quello che torna sulle
    // scritture: è l'unica cosa che la 148 aggiunge.
    expect(colonnaNonTrovata({ code: 'PGRST204', message: 'boom' })).toBe(true);
    // Un errore vero resta un errore vero: non si riprova a scrivere.
    expect(colonnaNonTrovata({ code: '23505', message: 'duplicate key' })).toBe(false);
  });
});
