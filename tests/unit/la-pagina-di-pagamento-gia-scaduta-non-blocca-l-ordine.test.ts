import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  destinoDellaPagina,
  dopoIlRifiutoDiStripe,
} from '@/lib/ordini/che-fine-ha-fatto-la-pagina-di-pagamento';
import type { ClientRiserve } from '@/lib/ordini/riserve-abbandonate';

/**
 * 8/9/2026 — «RIPROVA» A UNA PERSONA CHE NON HA NIENTE DA RIPROVARE.
 *
 * ── Cosa succedeva a una persona vera ───────────────────────────────────────
 * Maria preme «Paga con carta», si apre la pagina di Stripe, ci ripensa e chiude
 * tutto. Dopo mezz'ora quella pagina scade da sola: non incassa più niente.
 * Maria torna sul sito e sceglie «pago alla consegna». Le risponde: «Hai un
 * pagamento con la carta ancora aperto su questi articoli. Chiudi quella pagina
 * e riprova». Non c'è nessuna pagina da chiudere. Riprovare dà lo stesso
 * risultato, e l'ordine resta bloccato finché non scade la riserva: fino a due
 * ore. Un ordine perso per una pagina morta.
 *
 * ── Perché il codice ci cascava ─────────────────────────────────────────────
 * Per rendere non più pagabile una pagina si chiama `sessions.expire`. Stripe la
 * rifiuta in due situazioni che, viste dal rifiuto, sono identiche: la pagina è
 * ancora viva (e allora fermarsi è giusto), oppure era GIÀ scaduta da sé (e
 * allora non c'è niente da temere). Il codice le trattava allo stesso modo, cioè
 * sempre come la peggiore.
 *
 * ── Cosa difende questa prova ───────────────────────────────────────────────
 * Si esegue la chiusura vera, quella che parla con Stripe, con un rifiuto vero e
 * quattro risposte diverse alla riletta. Solo `expired` deve aprire la strada.
 * L'asimmetria è voluta: una pagina PAGATA non è morta, è il caso peggiore di
 * tutti — i soldi sono già stati presi — e deve continuare a fermare tutto.
 */

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

/** Com'è messa la pagina quando si va a rileggerla, prova per prova. */
const pagina: { riletta: { status?: string; payment_status?: string } | null; illeggibile: boolean } = {
  riletta: { status: 'expired', payment_status: 'unpaid' },
  illeggibile: false,
};
/** Quante volte si è provato a chiudere: la chiusura deve restare un tentativo vero. */
const tentativiDiChiusura: string[] = [];

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        // Stripe rifiuta SEMPRE: è il caso da cui parte tutta la storia.
        expire: async (id: string) => {
          tentativiDiChiusura.push(id);
          throw new Error('You may only expire a session that is currently in the open state.');
        },
        retrieve: async (id: string) => {
          if (pagina.illeggibile) throw new Error('Stripe non raggiungibile');
          return { id, ...pagina.riletta };
        },
      },
    },
  }),
}));

type Esito = { data: unknown[] | null; error?: { message: string } | null };

const tentativoAbbandonato = {
  id: 'p1',
  created_at: '2026-09-08T09:00:00Z',
  groups: [{ items: [{ productId: 'torta', quantity: 1, variantId: null }] }],
  coupon_code: 'BENVENUTO5',
  stripe_session_id: 'cs_di_maria',
  delivery: { impronta_carrello: 'carrello-di-prima' },
};

function fintoDatabase() {
  const rpcChiamate: string[] = [];
  const client = {
    from(tavola: string) {
      let tipo: 'select' | 'update' = 'select';
      const c: Record<string, unknown> = {
        select: () => c,
        update: () => { tipo = 'update'; return c; },
        eq: () => c,
        in: () => c,
        limit: () => c,
        then: (risolvi: (e: Esito) => unknown) => {
          const risposta: Esito =
            tavola === 'orders' ? { data: [], error: null }
              : tipo === 'update' ? { data: [{ id: 'p1' }], error: null }
                : { data: [tentativoAbbandonato], error: null };
          return Promise.resolve(risposta).then(risolvi);
        },
      };
      return c;
    },
    rpc: async (nome: string) => { rpcChiamate.push(nome); return { error: null }; },
  };
  return { admin: client as unknown as ClientRiserve, rpcChiamate };
}

async function pulisci() {
  const { liberaRiserveAbbandonate } = await import('@/lib/ordini/riserve-abbandonate');
  const { admin, rpcChiamate } = fintoDatabase();
  // Nessun `chiudiSessione`: si vuole proprio la chiusura vera, quella che parla
  // con Stripe. È lì che stava il difetto.
  const esito = await liberaRiserveAbbandonate(admin, {
    buyerId: 'maria',
    improntaDaTenere: 'carrello-di-adesso',
    soloConProdotti: ['torta'],
  });
  return { esito, rpcChiamate };
}

beforeEach(() => {
  tentativiDiChiusura.length = 0;
  pagina.illeggibile = false;
  pagina.riletta = { status: 'expired', payment_status: 'unpaid' };
});

describe('Stripe rifiuta di chiudere la pagina: ma perche?', () => {
  it('era gia scaduta da se → la merce torna in vendita e l ordine puo nascere', async () => {
    pagina.riletta = { status: 'expired', payment_status: 'unpaid' };

    const { esito, rpcChiamate } = await pulisci();

    expect(tentativiDiChiusura, 'non si e nemmeno provato a chiudere la pagina').toEqual(['cs_di_maria']);
    expect(
      esito.ancoraPagabili,
      'una pagina gia scaduta da se viene segnalata come pagabile: l ordine in contanti resta bloccato fino a due ore per niente',
    ).toEqual([]);
    expect(esito.liberati, 'la merce di una pagina morta resta impegnata').toEqual(['p1']);
    expect(rpcChiamate, 'la merce non e tornata a scaffale').toContain('restore_stock');
    expect(rpcChiamate, 'il codice sconto non e tornato al cliente').toContain('release_coupon');
  });

  it('era ancora viva → non si tocca niente e non si incassa', async () => {
    pagina.riletta = { status: 'open', payment_status: 'unpaid' };

    const { esito, rpcChiamate } = await pulisci();

    expect(esito.ancoraPagabili).toEqual(['cs_di_maria']);
    expect(esito.liberati).toEqual([]);
    expect(rpcChiamate, 'la merce e tornata a scaffale mentre la carta puo ancora pagarla').not.toContain('restore_stock');
  });

  it('era gia PAGATA → il caso peggiore: si ferma tutto lo stesso', async () => {
    // I soldi sono gia' stati presi e l'avviso di Stripe e' ancora per strada.
    // Liberare la merce vorrebbe dire farla comprare a un altro; far nascere un
    // ordine in contanti accanto vorrebbe dire incassare due volte.
    pagina.riletta = { status: 'complete', payment_status: 'paid' };

    const { esito, rpcChiamate } = await pulisci();

    expect(
      esito.ancoraPagabili,
      'una pagina gia pagata e stata trattata come morta: la merce venduta torna a scaffale e si incassa due volte',
    ).toEqual(['cs_di_maria']);
    expect(esito.liberati).toEqual([]);
    expect(rpcChiamate).not.toContain('restore_stock');
  });

  it('non si e riusciti nemmeno a rileggerla → si tratta come un pericolo', async () => {
    pagina.illeggibile = true;

    const { esito, rpcChiamate } = await pulisci();

    expect(esito.ancoraPagabili).toEqual(['cs_di_maria']);
    expect(rpcChiamate).not.toContain('restore_stock');
  });
});

describe('la regola, da sola', () => {
  it('lo stato della pagina si legge senza ambiguita', () => {
    expect(destinoDellaPagina({ status: 'expired', payment_status: 'unpaid' })).toBe('gia_morta');
    expect(destinoDellaPagina({ status: 'open', payment_status: 'unpaid' })).toBe('ancora_viva');
    expect(destinoDellaPagina({ status: 'complete', payment_status: 'paid' })).toBe('pagata');
    expect(destinoDellaPagina({ status: 'complete', payment_status: 'no_payment_required' })).toBe('pagata');
    expect(destinoDellaPagina(null)).toBe('non_so');
    expect(destinoDellaPagina({})).toBe('non_so');
  });

  it('i soldi presi battono qualunque stato: se e pagata, e pagata', () => {
    // Una pagina che risulta «scaduta» ma con il pagamento riuscito non e' un
    // via libera: e' il caso in cui si rimborserebbe un incasso buono.
    expect(destinoDellaPagina({ status: 'expired', payment_status: 'paid' })).toBe('pagata');
  });

  it('dopo un rifiuto di Stripe, solo «gia morta» apre la strada', () => {
    expect(dopoIlRifiutoDiStripe('gia_morta')).toBe('gia_morta');
    expect(dopoIlRifiutoDiStripe('ancora_viva')).toBe('ancora_pagabile');
    expect(dopoIlRifiutoDiStripe('pagata')).toBe('ancora_pagabile');
    expect(dopoIlRifiutoDiStripe('non_so')).toBe('ancora_pagabile');
  });
});
