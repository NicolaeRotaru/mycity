import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 26/10/2026 — LE FUNZIONI SPENTE AL LANCIO LE RIFIUTA IL SERVER, NON SOLO LA PAGINA.
 *
 * Carta #209, firmata da Nicola: al lancio restano spenti i buoni regalo, il
 * Drop del giorno, la newsletter, «Traduci». Nascondere un pulsante è vetrina:
 * una richiesta fatta a mano arriva lo stesso alla rotta. Qui si chiamano le
 * rotte vere, e si guarda cosa scrivono e cosa incassano.
 *
 * Gli interruttori si fingono (vi.mock di lib/funzioni-al-lancio) così la prova
 * non diventa rossa per sbaglio il giorno in cui Nicola ne riaccende uno, e si
 * può provare anche il verso «acceso».
 */

const stato = vi.hoisted(() => ({
  buoniInVendita: false,
  dropAcceso: false,
  traduciAcceso: false,
  newsletterAccesa: false,
  admin: (() => {
    throw new Error('getAdminSupabase non preparato per questa prova');
  }) as () => unknown,
  create: undefined as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('@/lib/funzioni-al-lancio', async (originale) => {
  const vero = (await originale()) as Record<string, unknown>;
  return {
    ...vero,
    get BUONI_REGALO_IN_VENDITA() { return stato.buoniInVendita; },
    get DROP_DEL_GIORNO_ACCESO() { return stato.dropAcceso; },
    get TRADUCI_ACCESO() { return stato.traduciAcceso; },
    get NEWSLETTER_ACCESA() { return stato.newsletterAccesa; },
    // Qui si prova «Traduci»: gli strumenti AI restano accesi (hanno le loro prove).
    AI_NEGOZI_ACCESA: true,
  };
});

const UTENTE = { id: 'cliente-1', email: 'mamma@example.com', email_confirmed_at: '2026-10-01T10:00:00Z' };
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, gestore: (c: { user: typeof UTENTE; req: Request }) => unknown) => (req: Request) =>
    gestore({ user: UTENTE, req }),
  withAdminAuth: (gestore: (c: { user: { id: string }; req: Request }) => unknown) => (req: Request) =>
    gestore({ user: { id: 'admin-1' }, req }),
  withSellerAuth: (gestore: (c: { user: { id: string }; req: Request }) => unknown) => (req: Request) =>
    gestore({ user: { id: 'seller-1' }, req }),
}));

vi.mock('@/lib/stripe/client', async (originale) => {
  const vero = (await originale()) as Record<string, unknown>;
  stato.create = vi.fn(async () => ({ id: 'cs_prova', url: 'https://checkout.stripe.com/prova' }));
  return {
    ...vero,
    isStripeConfigured: () => true,
    getStripe: () => ({ checkout: { sessions: { create: stato.create } } }),
  };
});

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.admin() }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));
vi.mock('@/lib/ai/moderation', () => ({ classifyProductPolicy: async () => ({ allowed: true }) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/captcha', () => ({ verifyTurnstileToken: async () => ({ ok: true }) }));

import { POST as compraBuono } from '@/app/api/gift-cards/checkout/route';
import { POST as salvaDrop } from '@/app/api/admin/daily-drops/route';
import { POST as iscriviNewsletter } from '@/app/api/newsletter/route';
import { POST as applicaLotto } from '@/app/api/ai/catalog-batch/apply/route';
import { defaultHomeSite, homeEnabledSections, type HomeSite } from '@/lib/home-site';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

let ip = 0;
function richiesta(url: string, corpo: unknown): never {
  ip += 1;
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.0.${ip}`, 'idempotency-key': `k-${ip}` },
    body: JSON.stringify(corpo),
  }) as never;
}

beforeEach(() => {
  __resetRateLimitBuckets();
  stato.buoniInVendita = false;
  stato.dropAcceso = false;
  stato.traduciAcceso = false;
  stato.newsletterAccesa = false;
  stato.create?.mockClear();
  stato.admin = () => {
    throw new Error('getAdminSupabase non preparato per questa prova');
  };
});

describe('buoni regalo: la vendita spenta non incassa', () => {
  const ACQUISTO = { amountEuro: 25, recipientName: 'Mamma', recipientEmail: 'mamma@example.com', message: 'Auguri' };

  it('spenta: 503 e nessuna sessione di pagamento Stripe', async () => {
    const res = await compraBuono(richiesta('/api/gift-cards/checkout', ACQUISTO));
    expect(res.status, 'la rotta vende ancora un buono che il sito dice di non vendere').toBe(503);
    expect(stato.create, 'parte un pagamento vero verso il conto di MyCity').not.toHaveBeenCalled();
  });

  it('accesa (controprova): la sessione di pagamento parte', async () => {
    stato.buoniInVendita = true;
    await compraBuono(richiesta('/api/gift-cards/checkout', ACQUISTO));
    expect(stato.create, 'con la vendita accesa il freno blocca lo stesso: misura sbagliata').toHaveBeenCalled();
  });
});

describe('Drop del giorno: spento, la home non lo mostra e il pannello non lo salva', () => {
  const DROP = {
    product_id: '11111111-1111-4111-8111-111111111111',
    drop_date: '2026-11-02',
    discount_percent: 20,
    original_price: 10,
    drop_price: 8,
  };

  it('la home predefinita non disegna il Drop né la newsletter', () => {
    const tipi = homeEnabledSections(defaultHomeSite()).map((s) => s.type);
    expect(tipi, 'il Drop annuncia un prezzo che la cassa non applica').not.toContain('dropOfDay');
    expect(tipi, 'la sezione newsletter promette 5 euro che nessuno dà').not.toContain('newsletter');
    expect(tipi, 'controprova: i prodotti devono restare').toContain('popularProducts');
  });

  it('nemmeno una home salvata dal pannello col Drop acceso', () => {
    const salvata: HomeSite = {
      version: 1,
      sections: [
        { id: 'h', type: 'hero', enabled: true, config: {} },
        { id: 'd', type: 'dropOfDay', enabled: true, config: {} },
        { id: 'n', type: 'newsletter', enabled: true, config: {} },
      ],
    } as HomeSite;
    expect(homeEnabledSections(salvata).map((s) => s.id)).toEqual(['h']);
  });

  it('il pannello admin riceve 409 e non scrive nessun drop, anche senza chiave di servizio', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    let chiesto = false;
    stato.admin = () => {
      chiesto = true;
      return { from: () => ({ upsert }) };
    };
    const res = await salvaDrop(richiesta('/api/admin/daily-drops', DROP));
    expect(res.status, 'il Drop spento si salva lo stesso').toBe(409);
    expect(upsert).not.toHaveBeenCalled();
    expect(chiesto, 'il freno deve stare prima della chiave di servizio').toBe(false);
  });
});

describe('newsletter: senza chiave di servizio risponde «non disponibile», non 500', () => {
  it('getAdminSupabase che lancia diventa un 503 leggibile', async () => {
    stato.newsletterAccesa = true;
    stato.admin = () => {
      throw new Error('Variabile d\'ambiente mancante: SUPABASE_SERVICE_ROLE_KEY');
    };
    const res = await iscriviNewsletter(richiesta('/api/newsletter', { email: 'chi@example.com', captchaToken: 'x' }));
    expect(res.status, 'la chiave mancante fa esplodere la rotta').toBe(503);
    const corpo = (await res.json()) as { error?: string; message?: string };
    expect(JSON.stringify(corpo)).toMatch(/non disponibile/i);
  });
});

describe('«Traduci» sul catalogo: un lotto di traduzione non riscrive l\'italiano', () => {
  const PRODOTTO = {
    id: 'p1', name: 'Focaccia al rosmarino', description: 'Focaccia del forno, cotta ogni mattina.', price: 4,
    compare_at_price: null, unit: 'pezzo', condition: null, stock: 5, status: 'available', category_id: 'casa-top',
    images: [], attributes: {}, tags: ['pane'], has_variants: false, seller_id: 'seller-1',
  };
  function dbConLavoro(operation: string, scritture: unknown[]) {
    const lavoro = {
      id: 'job-1', seller_id: 'seller-1', operation, status: 'ready',
      results: [{ product_id: 'p1', patch: { name: 'Focaccia with rosemary', tags: ['bread'] } }],
    };
    return () => ({
      from: (tabella: string) => {
        if (tabella === 'catalog_ai_jobs') {
          return {
            select: () => ({ eq: () => ({ single: async () => ({ data: lavoro, error: null }) }) }),
            update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
          };
        }
        if (tabella === 'categories') {
          return {
            select: () => ({
              order: async () => ({ data: [{ id: 'casa-top', name: 'Casa', slug: 'casa', parent_id: null }], error: null }),
            }),
          };
        }
        return {
          select: () => ({ eq: () => ({ in: async () => ({ data: [PRODOTTO], error: null }) }) }),
          update: (u: Record<string, unknown>) => ({
            eq: () => ({ eq: async () => { scritture.push(u); return { error: null }; } }),
          }),
        };
      },
    });
  }

  it('lavoro «translate»: 400 e nessuna scrittura sui prodotti', async () => {
    const scritture: unknown[] = [];
    stato.admin = dbConLavoro('translate', scritture);
    const res = await applicaLotto(richiesta('/api/ai/catalog-batch/apply', { jobId: 'job-1' }));
    expect(res.status, 'il lotto di traduzione si applica ancora').toBe(400);
    expect(scritture, 'il nome italiano è stato sostituito con quello inglese').toEqual([]);
  });

  it('controprova: un lavoro «improve» si applica ancora', async () => {
    const scritture: unknown[] = [];
    stato.admin = dbConLavoro('improve', scritture);
    const res = await applicaLotto(richiesta('/api/ai/catalog-batch/apply', { jobId: 'job-1' }));
    expect(res.status).toBe(200);
    expect(scritture.length).toBeGreaterThan(0);
  });
});
