import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 6/9/2026 — LA CASSA IN CONTANTI RISPONDEVA AGLI ERRORI IN DUE FORME DIVERSE.
 *
 * Il contratto del progetto sta scritto in `lib/api/responses.ts`: un errore e'
 * `{ ok:false, error:{ code, message } }`, «cosi' il frontend sa esattamente
 * cosa aspettarsi». La rotta dei contanti lo rispettava quasi ovunque
 * (`ApiErrors.*`) tranne in tre uscite, rimaste alla forma vecchia
 * `{ error: 'una stringa' }`. Chi scrive una chiamata nuova legge `error.message`
 * e trova `undefined`: al cliente arriva «Operazione non riuscita» al posto del
 * motivo vero — su una rotta di cassa e' la differenza fra riprovare e
 * abbandonare.
 *
 * C'e' pero' un segnale che NON si puo' perdere mentre si sistema la forma:
 * `inCorso: true`. Il browser lo legge (`laChiaveVaButtata`) per capire che la
 * chiave del tentativo appartiene a un invio gemello ancora vivo e non va
 * buttata. Senza, il tentativo successivo riparte con una chiave nuova e nasce
 * il DOPPIO ORDINE: merce riservata due volte, credito addebitato due volte.
 *
 * Questa prova percorre la rotta vera nei due casi che rispondevano male.
 *
 * ⚪ Non tocca il database: la tabella dei tentativi e' finta.
 */

/** Cosa risponde l'inserimento della chiave del tentativo. */
let esitoRivendica: { error: { code?: string; message: string } | null } = { error: null };
/** La riga gia' presente per quella chiave (il gemello che sta lavorando). */
let rigaEsistente: { order_ids: unknown[]; created_at: string } | null = null;

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (
      _opts: unknown,
      h: (ctx: { user: { id: string; email: string; email_confirmed_at: string }; profile: unknown; req: unknown }) => unknown,
    ) =>
    (req: unknown) =>
      h({
        user: { id: 'cliente-1', email: 'cliente@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
        profile: { role: 'buyer', is_approved: true },
        req,
      }),
  assertCanPurchase: vi.fn(() => null),
}));

vi.mock('@/lib/supabase/server', () => {
  const tentativi = {
    insert: () => Promise.resolve(esitoRivendica),
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: rigaEsistente, error: null }) }),
      }),
    }),
    delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
  };
  const from = (table: string) => {
    if (table === 'cod_checkout_attempts') return tentativi;
    throw new Error(`la prova non doveva arrivare a leggere «${table}»: l'uscita e' prima`);
  };
  return {
    getAdminSupabase: () => ({ from, rpc: async () => ({ data: null, error: null }) }),
    getServerSupabase: async () => ({ from }),
  };
});

function richiesta(): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'chiave-di-prova' },
    body: JSON.stringify({
      groups: [
        {
          sellerId: 'aaaaaaaa-0000-0000-0000-000000000001',
          items: [{ productId: '11111111-1111-1111-1111-111111111111', quantity: 1 }],
        },
      ],
      delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      useCredit: false,
    }),
  }) as never;
}

async function esegui() {
  const { POST } = await import('@/app/api/orders/cod/route');
  return (POST as unknown as (req: never) => Promise<Response>)(richiesta());
}

beforeEach(() => {
  esitoRivendica = { error: null };
  rigaEsistente = null;
});

describe('gli errori della cassa in contanti', () => {
  it('«ordine gia in corso» arriva nella forma del progetto, col motivo leggibile', async () => {
    esitoRivendica = { error: { code: '23505', message: 'duplicato' } };
    rigaEsistente = { order_ids: [], created_at: new Date().toISOString() };

    const res = await esegui();
    const corpo = (await res.json()) as { ok?: unknown; error?: { code?: string; message?: string }; inCorso?: unknown };

    expect(res.status).toBe(409);
    expect(corpo.ok, 'manca `ok:false`: il browser non riconosce la risposta come errore').toBe(false);
    expect(
      typeof corpo.error === 'object' && corpo.error !== null,
      `l'errore e' ancora una stringa nuda: ${JSON.stringify(corpo.error)}`,
    ).toBe(true);
    expect(corpo.error?.message, 'il motivo vero non arriva a schermo').toContain('Ordine gia in corso');
    expect(corpo.error?.code).toBe('CONFLICT');
  });

  it('e porta ancora `inCorso`, il segnale che impedisce il doppio ordine', async () => {
    esitoRivendica = { error: { code: '23505', message: 'duplicato' } };
    rigaEsistente = { order_ids: [], created_at: new Date().toISOString() };

    const corpo = await (await esegui()).json();
    const { laChiaveVaButtata } = await import('@/lib/ordini/chiave-dopo-l-errore');
    expect(
      laChiaveVaButtata(corpo),
      'il browser butterebbe la chiave del gemello ancora vivo: il prossimo invio crea il doppione',
    ).toBe(false);
  });

  it('anche il guasto nel registrare il tentativo risponde nella forma del progetto', async () => {
    esitoRivendica = { error: { code: '08006', message: 'connessione persa' } };

    const res = await esegui();
    const corpo = (await res.json()) as { ok?: unknown; error?: { code?: string; message?: string } };

    expect(res.status).toBe(503);
    expect(corpo.ok).toBe(false);
    expect(corpo.error?.message, 'il motivo vero non arriva a schermo').toContain('Impossibile registrare');
    expect(corpo.error?.code).toBe('SERVICE_UNAVAILABLE');
  });
});
