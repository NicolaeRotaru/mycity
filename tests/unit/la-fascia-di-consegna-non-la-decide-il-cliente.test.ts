import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { negozioPuoServire, leggiFasciaConsegna } from '@/lib/store-hours';
import { FASCE_AMMESSE, FASCE_DI_DOMANI } from '@/lib/quando-arriva';
import { campoFasciaConsegna } from '@/lib/ordini/fascia-consegna';

/** Il minimo per far arrivare una richiesta vera fino al controllo del corpo. */
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@/lib/api/middleware')>();
  return {
    ...vero,
    withAuthRateLimit:
      (_opzioni: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
      (req: Request) =>
        gestore({
          user: { id: 'cliente-1', email: 'maria@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
          profile: { id: 'cliente-1', role: 'buyer', is_approved: true },
          req,
        }),
  };
});
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  createMultiSellerCheckoutSession: vi.fn(),
  getStripe: () => ({ checkout: { sessions: { retrieve: vi.fn(), expire: vi.fn() } } }),
}));
vi.mock('@/lib/supabase/server', () => {
  // Un magazzino finto e vuoto: qualunque catena di chiamate risponde «niente».
  const risposta = { data: [], error: null };
  const catena = new Proxy(
    {},
    {
      get(_bersaglio, nome) {
        if (nome === 'then') return (ok: (v: unknown) => unknown) => ok(risposta);
        return () => catena;
      },
    },
  );
  const client = { from: () => catena, rpc: () => Promise.resolve(risposta) };
  return { getServerSupabase: async () => client, getAdminSupabase: () => client };
});

import { POST as pagaConLaCarta } from '@/app/api/stripe/checkout/route';

function richiestaConFascia(fascia: string): Request {
  return new Request('https://mycity.test/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups: [{ sellerId: '22222222-2222-2222-2222-222222222222', items: [{ productId: '11111111-1111-1111-1111-111111111111', quantity: 1 }] }],
      delivery: {
        fullName: 'Maria',
        address: 'Via Verdi 10',
        city: 'Piacenza',
        zip: '29121',
        phone: '3331111111',
      },
      pickupInStore: false,
      deliverySlot: fascia,
    }),
  });
}

/**
 * BASTAVA SCRIVERE «DOMANI» PER ORDINARE A UN NEGOZIO CHIUSO.
 *
 * Il controllo che ferma gli ordini quando il negozio è chiuso guarda la fascia di consegna
 * scelta in cassa. Quella fascia, però, arriva dal browser come testo libero: chi manda la
 * richiesta a mano può scriverci quello che vuole. E se ci scriveva la sola parola «domani»,
 * senza un orario, il lettore apriva una finestra da mezzanotte a mezzanotte e la domanda
 * diventava «domani, in qualche momento, il negozio apre?». Per un panificio aperto tutti i
 * giorni la risposta è sempre sì.
 *
 * Alle 3 di notte nasceva così un ordine in contanti su un fornaio chiuso. Il fattorino trova la
 * saracinesca abbassata, il cliente aspetta, e nessuno dei due sa perché.
 *
 * Le fasce che la cassa può davvero proporre sono sette, e sono scritte in `lib/quando-arriva.ts`.
 * Qui si pretende che valgano solo quelle: una fascia inventata non deve né entrare nella
 * richiesta né allargare un permesso.
 */

/** Lunedì 7 settembre 2026, le 3 del mattino: il panificio è chiuso adesso e apre alle 7. */
const lunediAlleTre = new Date('2026-09-07T03:00:00');

/** Aperto tutti i giorni dalle 7 alle 13. Domani, in qualche momento, apre di sicuro. */
const panificio = {
  mon: [['07:00', '13:00']],
  tue: [['07:00', '13:00']],
  wed: [['07:00', '13:00']],
  thu: [['07:00', '13:00']],
  fri: [['07:00', '13:00']],
  sat: [['07:00', '13:00']],
  sun: [['07:00', '13:00']],
} as unknown;

/**
 * Quello che si può scrivere nel campo libero per far dire «è domani» al lettore, senza dargli
 * un orario. Nessuna di queste stringhe esce dalla cassa: le scrive chi manda la richiesta a mano.
 */
const FASCE_INVENTATE = [
  'domani',
  'DOMANI',
  'Domani',
  ' domani ',
  'consegna domani',
  'domani mattina',
  'Domani ·',
  'Domani · 0:00–24:00',
  'Domani · 00:00–23:59',
  'Domani · 9:00–12:00 oppure quando volete',
  'Domani · 22:00–23:00',
  `${'x'.repeat(100)} domani`,
];

describe('un negozio chiuso resta chiuso, qualunque cosa scriva il cliente nella fascia', () => {
  it('alle 3 di notte, senza fascia, l’ordine si ferma — è la regola di sempre', () => {
    expect(negozioPuoServire(panificio, null, lunediAlleTre)).toBe(false);
  });

  it('la parola «domani» non ribalta quel no', () => {
    // È la riproduzione esatta: stessa funzione, stesso negozio, stessa ora.
    expect(negozioPuoServire(panificio, 'domani', lunediAlleTre)).toBe(false);
  });

  it('nessuna delle fasce inventate apre la saracinesca', () => {
    for (const inventata of FASCE_INVENTATE) {
      expect(negozioPuoServire(panificio, inventata, lunediAlleTre), inventata).toBe(false);
    }
  });

  it('una fascia fuori elenco non viene proprio letta come una finestra di domani', () => {
    for (const inventata of FASCE_INVENTATE) {
      expect(leggiFasciaConsegna(inventata), inventata).toBeNull();
    }
  });

  it('e le sette vere continuano a funzionare: la sera si ordina per domani', () => {
    // Martedì sera: il panificio è chiuso adesso, ma domani alle 9 è aperto.
    const martediSera = new Date('2026-09-08T21:15:00');
    expect(negozioPuoServire(panificio, 'Domani · 9:00–12:00', martediSera)).toBe(true);
    for (const vera of FASCE_DI_DOMANI) {
      expect(leggiFasciaConsegna(vera), vera).not.toBeNull();
    }
  });
});

describe('la fascia entra nella richiesta solo se è una di quelle che la cassa propone', () => {
  it('tutte e sette le etichette vere passano', () => {
    expect(FASCE_AMMESSE.length).toBe(7);
    for (const vera of FASCE_AMMESSE) {
      expect(campoFasciaConsegna.parse(vera), vera).toBe(vera);
    }
  });

  it('ritiro in negozio o fascia non scelta: nessuna fascia, e va bene', () => {
    expect(campoFasciaConsegna.parse(null)).toBe(null);
    expect(campoFasciaConsegna.parse(undefined)).toBe(undefined);
  });

  it('la fascia inventata viene rifiutata prima di toccare qualunque decisione', () => {
    for (const inventata of FASCE_INVENTATE) {
      expect(campoFasciaConsegna.safeParse(inventata).success, inventata).toBe(false);
    }
    // E non è nemmeno un posto dove scrivere: `orders.delivery_slot` lo legge il negoziante.
    expect(campoFasciaConsegna.safeParse('<script>alert(1)</script>').success).toBe(false);
  });
});

describe('la richiesta con la fascia inventata muore sulla soglia', () => {
  it('la cassa con la carta risponde 400, e dice che è la fascia', async () => {
    const res = await pagaConLaCarta(richiestaConFascia('domani') as never);
    expect(res.status).toBe(400);
    const corpo = JSON.stringify(await res.json());
    expect(corpo).toContain('INVALID_REQUEST');
    // Il rifiuto parla proprio della fascia, non di un corpo storto qualunque.
    expect(corpo.toLowerCase()).toContain('fascia');
  });

  it('lo stesso ordine con una fascia vera non viene fermato per la fascia', async () => {
    const res = await pagaConLaCarta(richiestaConFascia(FASCE_DI_DOMANI[0]) as never);
    const corpo = JSON.stringify(await res.json()).toLowerCase();
    // Più avanti si ferma per altro (qui il finto magazzino è vuoto), ma non per questo.
    expect(corpo).not.toContain('fascia');
  });
});

describe('le due rotte dei soldi controllano la fascia con lo stesso elenco', () => {
  const radice = process.cwd();
  for (const rotta of ['app/api/orders/cod/route.ts', 'app/api/stripe/checkout/route.ts']) {
    it(`${rotta} valida la fascia con l’elenco chiuso, non con la lunghezza`, () => {
      const src = readFileSync(join(radice, rotta), 'utf8');
      expect(src, 'la fascia deve passare dal campo condiviso').toContain('campoFasciaConsegna');
      expect(
        src,
        'il testo libero è tornato: qualunque stringa di 120 caratteri entrerebbe di nuovo',
      ).not.toMatch(/deliverySlot:\s*z\.string\(\)/);
    });
  }
});
