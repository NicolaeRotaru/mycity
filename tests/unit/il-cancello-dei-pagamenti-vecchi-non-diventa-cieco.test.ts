import { describe, it, expect, vi } from 'vitest';
import { liberaRiserveAbbandonate, type ClientRiserve } from '@/lib/ordini/riserve-abbandonate';
import {
  SESSIONE_NON_GUARDATA,
  TETTO_TENTATIVI_APERTI,
  tentativiApertiDaLiberare,
  type RigaTentativo,
} from '@/lib/ordini/tentativi-aperti-da-liberare';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

/**
 * 8/9/2026 — IL CANCELLO CHE SMETTE DI VEDERE ALL'UNDICESIMA RIGA.
 *
 * ── Cosa succedeva a una persona vera ───────────────────────────────────────
 * Prima di aprire una cassa nuova si guarda se questa stessa persona ha lasciato
 * in giro pagamenti aperti sugli stessi prodotti, e li si chiude. La lettura
 * però chiedeva al database le prime DIECI righe in sospeso — `.limit(10)`, per
 * giunta senza dire in che ordine — e solo dopo, qui in JavaScript, teneva
 * quelle che c'entravano con questo carrello.
 *
 * Le due cose insieme fanno un buco. Se la pagina di pagamento che blocca la
 * torta di Maria è l'undicesima riga in sospeso, il database non la manda mai,
 * il filtro non la vede mai, e il cancello dice «tutto libero» mentre quella
 * pagina è viva e pagabile. Si apre la seconda cassa: due pagine, una torta,
 * due addebiti possibili.
 *
 * ── E l'altro verso, quello sbagliato ───────────────────────────────────────
 * Se la lettura falliva del tutto — rete, permessi — la risposta era «niente di
 * pagabile». Che è il contrario di quello che si sapeva davvero: non si sapeva
 * niente. Chi legge quella risposta apre la cassa.
 *
 * ── Cosa difende questa prova ───────────────────────────────────────────────
 * Il database finto qui sotto rispetta DAVVERO il `.limit(n)` che gli si chiede,
 * come farebbe quello vero: se il codice ne chiede dieci, l'undicesima riga non
 * arriva. Così il buco si può ricreare invece di raccontarlo.
 */

type Esito = { data: unknown[] | null; error?: { message: string } | null };

function tentativo(n: number, prodotto: string, quando: string): RigaTentativo {
  return {
    id: `p${n}`,
    created_at: quando,
    groups: [{ items: [{ productId: prodotto, quantity: 1, variantId: null }] }],
    coupon_code: null,
    stripe_session_id: `cs_${n}`,
    delivery: { impronta_carrello: `carrello-${n}` },
  };
}

/**
 * Database finto che si comporta come quello vero su una cosa sola, ma quella
 * che conta: **manda al massimo il numero di righe che gli è stato chiesto**.
 */
function fintoDatabase(opzioni: {
  pending?: RigaTentativo[];
  ordini?: unknown[];
  erroreLettura?: { message: string };
  erroreOrdini?: { message: string };
}) {
  const rpcChiamate: string[] = [];
  const limitiChiesti: number[] = [];

  const client = {
    from(tavola: string) {
      let tipo: 'select' | 'update' = 'select';
      let limite = Number.POSITIVE_INFINITY;
      const c: Record<string, unknown> = {
        select: () => c,
        update: () => { tipo = 'update'; return c; },
        eq: () => c,
        in: () => c,
        limit: (n: number) => { limite = n; limitiChiesti.push(n); return c; },
        then: (risolvi: (e: Esito) => unknown) => {
          let risposta: Esito;
          if (tavola === 'orders') {
            risposta = { data: (opzioni.ordini ?? []) as unknown[], error: opzioni.erroreOrdini ?? null };
          } else if (tipo === 'update') {
            risposta = { data: [{ id: 'preso' }], error: null };
          } else {
            const tutte = opzioni.pending ?? [];
            risposta = {
              data: opzioni.erroreLettura ? null : tutte.slice(0, limite),
              error: opzioni.erroreLettura ?? null,
            };
          }
          return Promise.resolve(risposta).then(risolvi);
        },
      };
      return c;
    },
    rpc: async (nome: string) => { rpcChiamate.push(nome); return { error: null }; },
  };

  return { admin: client as unknown as ClientRiserve, rpcChiamate, limitiChiesti };
}

describe('undici tentativi aperti: il cancello deve vederli tutti', () => {
  /** Dieci carrelli che non c'entrano, e all'undicesimo posto quello con la torta. */
  const undici = [
    ...Array.from({ length: 10 }, (_, i) => tentativo(i + 1, `altro-${i}`, `2026-09-08T10:${String(i).padStart(2, '0')}:00Z`)),
    tentativo(11, 'torta', '2026-09-08T09:00:00Z'),
  ];

  it('la pagina di pagamento in undicesima posizione viene vista e segnalata', async () => {
    const { admin } = fintoDatabase({ pending: undici });

    const esito = await liberaRiserveAbbandonate(admin, {
      buyerId: 'maria',
      improntaDaTenere: 'carrello-di-adesso',
      soloConProdotti: ['torta'],
      // Stripe non risponde: quella pagina resta pagabile e si deve sapere.
      chiudiSessione: async () => { throw new Error('Stripe non raggiungibile'); },
    });

    expect(
      esito.ancoraPagabili,
      'il cancello non ha visto la pagina oltre la decima riga: si apre una seconda cassa sulla stessa merce',
    ).toEqual(['cs_11']);
  });

  it('e se invece si riesce a chiuderla, quella merce torna davvero in vendita', async () => {
    const { admin, rpcChiamate } = fintoDatabase({ pending: undici });
    const chiuse: string[] = [];

    const esito = await liberaRiserveAbbandonate(admin, {
      buyerId: 'maria',
      improntaDaTenere: 'carrello-di-adesso',
      soloConProdotti: ['torta'],
      chiudiSessione: async (id) => { chiuse.push(id); },
    });

    expect(chiuse, 'la pagina oltre la decima riga non e stata nemmeno chiusa').toEqual(['cs_11']);
    expect(esito.liberati).toEqual(['p11']);
    expect(rpcChiamate).toContain('restore_stock');
  });

  it('al database si chiede una riga in piu del tetto: e cosi che ci si accorge di averlo superato', async () => {
    const { admin, limitiChiesti } = fintoDatabase({ pending: undici });
    await liberaRiserveAbbandonate(admin, { buyerId: 'maria', soloConProdotti: ['torta'] });
    expect(limitiChiesti[0]).toBe(TETTO_TENTATIVI_APERTI + 1);
  });
});

describe('«non ho potuto guardare» non si dice «niente di pagabile»', () => {
  it('lettura dei tentativi fallita → si blocca l incasso, non lo si lascia passare', async () => {
    const { admin, rpcChiamate } = fintoDatabase({ erroreLettura: { message: 'rete' } });

    const esito = await liberaRiserveAbbandonate(admin, { buyerId: 'maria', soloConProdotti: ['torta'] });

    expect(
      esito.ancoraPagabili,
      'con la lettura fallita si e risposto «strada libera»: la cassa si apre accanto a una pagina che nessuno ha guardato',
    ).toEqual([SESSIONE_NON_GUARDATA]);
    expect(esito.liberati, 'liberata merce senza aver letto niente').toEqual([]);
    expect(rpcChiamate, 'toccata la merce senza aver letto niente').toEqual([]);
  });

  it('controllo degli ordini gia creati fallito → stessa risposta: non si incassa', async () => {
    const { admin, rpcChiamate } = fintoDatabase({
      pending: [tentativo(1, 'torta', '2026-09-08T10:00:00Z')],
      erroreOrdini: { message: 'rete' },
    });

    const esito = await liberaRiserveAbbandonate(admin, {
      buyerId: 'maria',
      improntaDaTenere: 'carrello-di-adesso',
      soloConProdotti: ['torta'],
    });

    expect(esito.ancoraPagabili).toEqual([SESSIONE_NON_GUARDATA]);
    expect(esito.liberati).toEqual([]);
    expect(rpcChiamate).toEqual([]);
  });

  it('piu tentativi del tetto → ci si ferma invece di tirare a indovinare quali guardare', async () => {
    const troppi = Array.from({ length: TETTO_TENTATIVI_APERTI + 1 }, (_, i) =>
      tentativo(i + 1, 'torta', `2026-09-08T10:00:${String(i % 60).padStart(2, '0')}Z`),
    );
    const { admin, rpcChiamate } = fintoDatabase({ pending: troppi });

    const esito = await liberaRiserveAbbandonate(admin, {
      buyerId: 'maria',
      improntaDaTenere: 'carrello-di-adesso',
      soloConProdotti: ['torta'],
    });

    expect(esito.ancoraPagabili).toEqual([SESSIONE_NON_GUARDATA]);
    expect(rpcChiamate).toEqual([]);
  });
});

describe('la scelta di chi guardare, da sola', () => {
  it('errore in lettura → guardati: false, e il motivo resta scritto', () => {
    const esito = tentativiApertiDaLiberare({ errore: { message: 'permission denied' } }, {});
    expect(esito.guardati).toBe(false);
    if (esito.guardati) return;
    expect(esito.perche).toBe('lettura_fallita');
    expect(esito.dettaglio).toContain('permission denied');
  });

  it('una riga oltre il tetto → guardati: false', () => {
    const righe = [tentativo(1, 'torta', 'a'), tentativo(2, 'torta', 'b'), tentativo(3, 'torta', 'c')];
    expect(tentativiApertiDaLiberare({ righe, tetto: 2 }, {}).guardati).toBe(false);
    expect(tentativiApertiDaLiberare({ righe, tetto: 3 }, {}).guardati).toBe(true);
  });

  it('i tentativi si guardano dai piu recenti, non nell ordine che capita', () => {
    const righe = [
      tentativo(1, 'torta', '2026-09-08T08:00:00Z'),
      tentativo(2, 'torta', '2026-09-08T12:00:00Z'),
      tentativo(3, 'torta', '2026-09-08T10:00:00Z'),
    ];
    const esito = tentativiApertiDaLiberare({ righe }, {});
    expect(esito.guardati).toBe(true);
    if (!esito.guardati) return;
    expect(esito.candidati.map((r) => r.id)).toEqual(['p2', 'p3', 'p1']);
  });

  it('il carrello che si sta comprando adesso non si tocca, e nemmeno quelli senza prodotti in comune', () => {
    const righe = [tentativo(1, 'torta', 'a'), tentativo(2, 'pane', 'b')];
    const esito = tentativiApertiDaLiberare(
      { righe },
      { improntaDaTenere: 'carrello-1', soloConProdotti: ['torta', 'pane'] },
    );
    expect(esito.guardati).toBe(true);
    if (!esito.guardati) return;
    expect(esito.candidati.map((r) => r.id), 'toccato il carrello che si sta comprando adesso').toEqual(['p2']);
  });

  it('lista di prodotti vuota vuol dire «nessuno in comune», non «tutti»', () => {
    const esito = tentativiApertiDaLiberare({ righe: [tentativo(1, 'torta', 'a')] }, { soloConProdotti: [] });
    expect(esito.guardati).toBe(true);
    if (!esito.guardati) return;
    expect(esito.candidati).toEqual([]);
  });
});
