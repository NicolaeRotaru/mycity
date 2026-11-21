import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R04-021 — La consegna veloce si vendeva a tutti insieme anche con un solo fattorino: nessuno
 * contava quante veloci aveva già in mano.
 *
 * Nicola ha scelto (19/11): una veloce alla volta per fattorino. La decisione resta UNA, la stessa
 * per la cassa e per le rotte: `contaFattoriniOnline` risponde i fattorini accesi che non hanno già
 * una veloce in mano, e tutte le strade (la domanda della cassa e del carrello, le schede dei negozi,
 * la rotta dei contanti e quella della carta) lo passano a `veloceSiPuo`. Il collaudo di prima: con 1
 * fattorino e 1 veloce in corso la cassa offriva «Adesso» e il clic finale in contanti prendeva 409.
 * Si contano le consegne, non le righe: un carrello di due negozi è una consegna sola.
 */

const stato = vi.hoisted(() => ({
  profili: [] as Array<Record<string, unknown>>,
  ordini: [] as Array<Record<string, unknown>>,
  ordiniRotti: false,
}));

/** Un database finto con due tabelle vere: i profili (conteggio) e gli ordini (righe). */
function dbFinto() {
  return {
    from(tabella: string) {
      const filtri: Array<(r: Record<string, unknown>) => boolean> = [];
      let soloConteggio = false;
      const q = {
        select: (_c: string, o?: { head?: boolean }) => ((soloConteggio = !!o?.head), q),
        eq: (c: string, v: unknown) => (filtri.push((r) => r[c] === v), q),
        in: (c: string, v: unknown[]) => (filtri.push((r) => v.includes(r[c])), q),
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          if (tabella === 'orders' && stato.ordiniRotti) {
            return Promise.resolve({ data: null, error: { message: 'giù' } }).then(ok, ko);
          }
          const righe = (tabella === 'orders' ? stato.ordini : stato.profili).filter((r) => filtri.every((f) => f(r)));
          return Promise.resolve(soloConteggio ? { count: righe.length, error: null } : { data: righe, error: null }).then(ok, ko);
        },
      };
      return q;
    },
  };
}
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => dbFinto() }));

import { contaFattoriniOnline, veloceSiPuo } from '@/lib/ordini/consegna-veloce';
import { GET } from '@/app/api/consegna/veloce/route';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

const FORNAIO = '11111111-1111-4111-8111-111111111111';
const SEMPRE_APERTO = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => [k, [['00:00', '23:59']]]),
);
const fornaio = { id: FORNAIO, role: 'seller', is_approved: true, store_name: 'Il fornaio', store_hours: SEMPRE_APERTO };
const fattorino = (id: string) => ({ id, role: 'rider', is_approved: true, rider_is_online: true });
/** Giovedì 19/11/2026 alle 12:00 di Piacenza (UTC+1). */
const MEZZOGIORNO = new Date('2026-11-19T11:00:00.000Z');
const veloce = (id: string, cliente: string, p: Record<string, unknown> = {}) => ({
  id, user_id: cliente, delivery_slot: ETICHETTA_ADESSO, delivery_status: 'ACCEPTED', created_at: '2026-11-19T10:40:00.000Z', ...p,
});

let ip = 0;
async function chiediAllaCassa() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MEZZOGIORNO);
  // Ogni domanda da un indirizzo suo: il freno delle richieste non è l'oggetto della prova.
  const r = await GET(new Request(`https://mycity.test/api/consegna/veloce?negozi=${FORNAIO}`, { headers: { 'x-forwarded-for': `10.0.0.${++ip}` } }));
  return { status: r.status, ...((await r.json()) as { possibile: boolean; perche?: string }) };
}

afterEach(() => {
  stato.profili = [];
  stato.ordini = [];
  stato.ordiniRotti = false;
  vi.useRealTimers();
});

describe('R04-021 · una veloce alla volta per fattorino, la stessa risposta per la cassa e per le rotte', () => {
  it('un fattorino con una veloce in mano: la cassa non offre «Adesso» (prima diceva sì, e il clic finale prendeva 409)', async () => {
    stato.profili = [fornaio, fattorino('r1')];
    stato.ordini = [veloce('o1', 'anna')];
    const esito = await chiediAllaCassa();
    expect(esito.possibile, 'la cassa offre la veloce a un fattorino già occupato').toBe(false);
    expect(esito.perche).toContain('fattorino libero');
  });

  it('la veloce consegnata (o annullata) libera il fattorino', async () => {
    stato.profili = [fornaio, fattorino('r1')];
    stato.ordini = [veloce('o1', 'anna', { delivery_status: 'DELIVERED' }), veloce('o2', 'bruno', { delivery_status: 'CANCELED' })];
    expect((await chiediAllaCassa()).possibile).toBe(true);
  });

  it('un carrello di due negozi è una consegna sola: con due fattorini ne resta uno libero', async () => {
    stato.profili = [fornaio, fattorino('r1'), fattorino('r2')];
    stato.ordini = [veloce('pane', 'anna'), veloce('frutta', 'anna')];
    expect((await chiediAllaCassa()).possibile).toBe(true);
    stato.ordini = [veloce('pane', 'anna'), veloce('latte', 'bruno')];
    expect((await chiediAllaCassa()).possibile).toBe(false);
  });

  it('una veloce dimenticata da giorni non tiene occupato il fattorino', async () => {
    stato.profili = [fornaio, fattorino('r1')];
    stato.ordini = [veloce('vecchia', 'anna', { created_at: '2026-11-16T10:00:00.000Z' })];
    expect((await chiediAllaCassa()).possibile).toBe(true);
  });

  it('se il conteggio delle veloci cade, la cassa non promette alla cieca', async () => {
    stato.profili = [fornaio, fattorino('r1')];
    stato.ordiniRotti = true;
    const esito = await chiediAllaCassa();
    expect(esito.possibile).toBe(false);
    expect(esito.status).toBe(503);
  });

  it('la stessa risposta del clic finale: `veloceSiPuo` con `contaFattoriniOnline`, come nelle rotte', async () => {
    stato.profili = [fornaio, fattorino('r1')];
    stato.ordini = [veloce('o1', 'anna')];
    const liberi = await contaFattoriniOnline(dbFinto() as never, MEZZOGIORNO);
    expect(liberi).toBe(0);
    const esito = veloceSiPuo({ adesso: new Date(2026, 10, 19, 12, 0), negozi: [{ nome: 'Il fornaio', orari: SEMPRE_APERTO }], fattoriniOnline: liberi });
    expect(esito.possibile).toBe(false);
    // Le rotte che creano l'ordine e le domande della cassa passano tutte questo numero alla stessa decisione.
    for (const rotta of ['app/api/orders/cod/route.ts', 'app/api/stripe/checkout/route.ts', 'app/api/consegna/veloce/route.ts', 'app/api/consegna/veloce/negozi/route.ts']) {
      const src = readFileSync(rotta, 'utf8');
      expect(src, rotta).toContain('veloceSiPuo(');
      expect(src, rotta).toContain('contaFattoriniOnline(admin)');
      expect(src, rotta).not.toContain('velociInCorso');
    }
  });
});
