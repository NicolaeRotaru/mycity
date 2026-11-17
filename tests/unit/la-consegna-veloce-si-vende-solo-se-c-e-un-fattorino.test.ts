import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 29/10/2026 — «Consegna in 30-60 min» ovunque, e in produzione nessun fattorino approvato.
 *
 * La veloce («Adesso») si vende solo se si può mantenere: dalle 8 alle 21 a Piacenza, negozi
 * aperti adesso, almeno un fattorino approvato con l'interruttore acceso. Le due rotte rifiutano
 * con un 409, la cassa non offre «Adesso», il carrello non scrive minuti. Se una lettura cade,
 * niente veloce. Al lancio il fattorino è Nicola: interruttore acceso → c'è, spento → no.
 */

const stato = vi.hoisted(() => ({
  profili: [] as Array<Record<string, unknown>>,
  rotto: false,
}));

type Filtro = [string, unknown];
function dbFinto() {
  return {
    from(_tabella: string) {
      const filtri: Filtro[] = [];
      let soloConteggio = false;
      let inId: string[] | null = null;
      const q = {
        select: (_c: string, o?: { head?: boolean }) => {
          soloConteggio = !!o?.head;
          return q;
        },
        eq: (c: string, v: unknown) => {
          filtri.push([c, v]);
          return q;
        },
        in: (_c: string, v: string[]) => {
          inId = v;
          return q;
        },
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          if (stato.rotto) return Promise.resolve({ data: null, count: null, error: { message: 'giù' } }).then(ok, ko);
          const righe = stato.profili.filter(
            (r) => filtri.every(([c, v]) => r[c] === v) && (inId === null || inId.includes(String(r.id))),
          );
          return Promise.resolve(soloConteggio ? { count: righe.length, error: null } : { data: righe, error: null }).then(ok, ko);
        },
      };
      return q;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => dbFinto() }));

import { contaFattoriniOnline, rigaQuandoArrivaNelCarrello, veloceSiPuo } from '@/lib/ordini/consegna-veloce';
import { GET } from '@/app/api/consegna/veloce/route';

const FORNAIO = '11111111-1111-4111-8111-111111111111';
const SEMPRE_APERTO = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => [k, [['00:00', '23:59']]]),
);
const SEMPRE_CHIUSO = { mon: [['05:00', '05:01']] };
const fornaio = (orari: unknown) => ({ id: FORNAIO, role: 'seller', is_approved: true, store_name: 'Il fornaio', store_hours: orari });
const nicola = (online: boolean, approvato = true) => ({
  id: 'r1',
  role: 'rider',
  is_approved: approvato,
  rider_is_online: online,
});

// Giovedì 29/10/2026: alle 10:00 e alle 21:30 di Piacenza (ora solare, UTC+1).
const ALLE_DIECI = new Date('2026-10-29T09:00:00Z');
const ALLE_21_E_30 = new Date('2026-10-29T20:30:00Z');

async function chiedi(adesso: Date) {
  vi.useFakeTimers();
  vi.setSystemTime(adesso);
  const r = await GET(new Request(`https://mycity.test/api/consegna/veloce?negozi=${FORNAIO}`));
  vi.useRealTimers();
  return (await r.json()) as { possibile: boolean; perche?: string };
}

afterEach(() => {
  stato.profili = [];
  stato.rotto = false;
  vi.useRealTimers();
});

describe('la consegna veloce si vende solo se c’è un fattorino online', () => {
  it('zero fattorini online: niente veloce', async () => {
    stato.profili = [fornaio(SEMPRE_APERTO)];
    expect((await chiedi(ALLE_DIECI)).possibile).toBe(false);
  });

  it('un fattorino offline (o non approvato): niente veloce', async () => {
    stato.profili = [fornaio(SEMPRE_APERTO), nicola(false)];
    expect((await chiedi(ALLE_DIECI)).possibile).toBe(false);
    stato.profili = [fornaio(SEMPRE_APERTO), nicola(true, false)];
    expect((await chiedi(ALLE_DIECI)).possibile).toBe(false);
  });

  it('un fattorino online, negozio aperto, alle 10: la veloce c’è', async () => {
    stato.profili = [fornaio(SEMPRE_APERTO), nicola(true)];
    expect((await chiedi(ALLE_DIECI)).possibile).toBe(true);
  });

  it('alle 21:30 no, anche col fattorino online', async () => {
    stato.profili = [fornaio(SEMPRE_APERTO), nicola(true)];
    const esito = await chiedi(ALLE_21_E_30);
    expect(esito.possibile).toBe(false);
    expect(esito.perche).toContain('fascia');
  });

  it('negozio chiuso adesso: no', async () => {
    stato.profili = [fornaio(SEMPRE_CHIUSO), nicola(true)];
    expect((await chiedi(ALLE_DIECI)).possibile).toBe(false);
  });

  it('se la lettura cade non si promette alla cieca', async () => {
    stato.profili = [fornaio(SEMPRE_APERTO), nicola(true)];
    stato.rotto = true;
    expect((await chiedi(ALLE_DIECI)).possibile).toBe(false);
    expect(await contaFattoriniOnline(dbFinto() as never)).toBeNull();
    expect(veloceSiPuo({ adesso: new Date(2026, 9, 29, 10), negozi: null, fattoriniOnline: 1 }).possibile).toBe(false);
  });

  it('le due rotte rifiutano «Adesso» con un 409 dalla stessa decisione', () => {
    for (const rotta of ['app/api/orders/cod/route.ts', 'app/api/stripe/checkout/route.ts']) {
      const src = readFileSync(rotta, 'utf8');
      const blocco = src.slice(src.indexOf('if (consegnaVeloce) {'), src.indexOf('if (consegnaVeloce) {') + 600);
      expect(blocco, rotta).toContain('veloceSiPuo({');
      expect(blocco, rotta).toContain('fattoriniOnline: await contaFattoriniOnline(admin)');
      expect(blocco, rotta).toContain('ApiErrors.conflict(veloce.perche)');
    }
  });

  it('la cassa offre «Adesso» solo con il sì del server', () => {
    const picker = readFileSync('components/checkout/DeliverySlotPicker.tsx', 'utf8');
    // 30/10/2026 (ondata 18) — Il sì vero, non «non ha ancora risposto»: `null` è l'attesa, e la
    // cassa la tiene ferma senza offrire né togliere «Adesso» (la prova montata è
    // `la-veloce-resta-scelta-dopo-l-accesso`).
    expect(picker).toContain('const expressAvailable = expressSiPuo(ora) && veloceDisponibile === true;');
    const cassa = readFileSync('app/checkout/page.tsx', 'utf8');
    expect(cassa).toContain('/api/consegna/veloce?negozi=');
    expect(cassa).toContain('veloceDisponibile={veloceDisponibile}');
    expect(cassa).toContain('useState<{ negozi: string; possibile: boolean } | null>(null)');
  });
});

describe('il carrello non scrive «30-60 min» se la veloce non si può', () => {
  it('scrive i minuti solo col sì del server e dentro le 8-21', () => {
    expect(rigaQuandoArrivaNelCarrello(10, true)).toMatch(/min/);
    expect(rigaQuandoArrivaNelCarrello(10, false)).not.toMatch(/min/);
    expect(rigaQuandoArrivaNelCarrello(21, true)).not.toMatch(/min/);
    expect(rigaQuandoArrivaNelCarrello(10, null)).toBeNull();
    expect(rigaQuandoArrivaNelCarrello(null, true)).toBeNull();
  });

  it('il carrello chiede al server, non solo all’orologio', () => {
    const carrello = readFileSync('app/cart/page.tsx', 'utf8');
    expect(carrello).toContain('/api/consegna/veloce?negozi=');
    expect(carrello).toContain('quandoArrivaScrittoNelCarrello(oraDiAdesso, veloceSiPuoAdesso)');
    expect(carrello).not.toMatch(/if \(expressSiPuo\(ora\)\) return `Consegna in/);
  });
});
