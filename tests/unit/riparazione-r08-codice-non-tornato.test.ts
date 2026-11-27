/**
 * R08-007 — LA PULIZIA DELLE CASSE ABBANDONATE DICE QUALI CODICI SCONTO NON SONO TORNATI.
 *
 * La pulizia rimette a scaffale la merce di un tentativo abbandonato e restituisce il codice
 * (`release_coupon`). Se la restituzione cade, l'uso del codice resta contato: la rivendicazione di
 * quel tentativo va lasciata aperta, come fanno l'avviso di Stripe e `rilasciaCoupon`. Chi chiama
 * la chiudeva lo stesso, perché il tentativo stava fra i liberati e basta. Adesso il resoconto dice
 * quali tentativi hanno il codice ancora fuori; la merce resta fra i liberati (è tornata davvero).
 *
 * Supabase finto, in memoria (nessun database vero); Stripe finto (chiudiSessione).
 */
import { describe, expect, it } from 'vitest';
import { liberaRiserveAbbandonate, type ClientRiserve } from '@/lib/ordini/riserve-abbandonate';

type Riga = Record<string, unknown>;

function fintoDb(opzioni: { codiceCade: boolean }) {
  const tentativi: Riga[] = [
    {
      id: 'p1', status: 'PENDING', buyer_id: 'luca', created_at: '2026-11-20T09:00:00.000Z',
      groups: [{ items: [{ productId: 'torta', quantity: 1, variantId: null }] }],
      coupon_code: 'BENVENUTO5', stripe_session_id: 'cs_vecchia',
      delivery: { impronta_carrello: 'vecchio', rivendicazione: 'riv-1' },
    },
  ];
  const chiamate: string[] = [];
  const client = {
    from(tabella: string) {
      const filtri: Array<(r: Riga) => boolean> = [];
      let aggiorna: Riga | null = null;
      const catena = {
        select: () => catena,
        update(valori: Riga) {
          aggiorna = valori;
          return catena;
        },
        eq(colonna: string, valore: unknown) {
          filtri.push((r) => r[colonna] === valore);
          return catena;
        },
        in: () => catena,
        limit: () => catena,
        then(ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) {
          if (tabella === 'orders') return Promise.resolve({ data: [], error: null }).then(ok, ko);
          const presi = tentativi.filter((r) => filtri.every((f) => f(r)));
          if (aggiorna) for (const r of presi) Object.assign(r, aggiorna);
          return Promise.resolve({ data: presi.map((r) => ({ ...r })), error: null }).then(ok, ko);
        },
      };
      return catena;
    },
    async rpc(nome: string) {
      chiamate.push(nome);
      if (nome === 'release_coupon' && opzioni.codiceCade) return { error: { message: 'connessione persa' } };
      return { error: null };
    },
  };
  return { admin: client as unknown as ClientRiserve, chiamate, tentativi };
}

describe('R08-007 · il codice che non torna non si confonde con quello restituito', () => {
  it('release_coupon cade: la merce è liberata, il codice risulta ancora fuori', async () => {
    const { admin, chiamate, tentativi } = fintoDb({ codiceCade: true });

    const esito = await liberaRiserveAbbandonate(admin, {
      buyerId: 'luca', soloConProdotti: ['torta'], chiudiSessione: async () => 'chiusa',
    });

    expect(chiamate).toEqual(['restore_stock', 'release_coupon']);
    expect(tentativi[0].status).toBe('EXPIRED');
    expect(esito.liberati, 'la merce è tornata a scaffale: le scorte vanno rilette').toEqual(['p1']);
    expect(
      esito.codiceNonTornato,
      'il codice non è tornato ma il resoconto non lo dice: chi chiama chiude la rivendicazione lo stesso',
    ).toEqual(['p1']);
  });

  it('release_coupon riesce: nessun codice resta fuori', async () => {
    const { admin } = fintoDb({ codiceCade: false });

    const esito = await liberaRiserveAbbandonate(admin, {
      buyerId: 'luca', soloConProdotti: ['torta'], chiudiSessione: async () => 'chiusa',
    });

    expect(esito.liberati).toEqual(['p1']);
    expect(esito.codiceNonTornato).toEqual([]);
  });
});
