import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 31/10/2026 — IL GIRO DELLA CODA EMAIL (app/api/cron/send-emails) E QUATTRO
 * MODI IN CUI SPEDIVA O BUTTAVA LA COSA SBAGLIATA.
 *
 * ① Nessuna scadenza: una riga ferma da mesi partiva il giorno in cui si
 *    accende la posta (benvenuti di giugno, «ordine pronto» gia' ritirati).
 * ② Le promo saltate per UNSUBSCRIBE_SECRET mancante si rinviavano di mezz'ora
 *    per sempre, e partivano tutte insieme quando arrivava la chiave.
 * ③ Un account cancellato (404 dall'autenticazione) veniva trattato come un
 *    guasto di un attimo: la riga si rilasciava ogni mezz'ora, per sempre.
 * ④ Se la lettura dei profili falliva, ogni promozione del giro risultava
 *    «senza consenso» e veniva annullata per sempre.
 */

let esitoInvio: Record<string, unknown> = { ok: true, id: 'msg-1' };
const spedite: Array<{ to: string; subject: string }> = [];

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string; subject: string }) => {
    spedite.push(m);
    return esitoInvio;
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, spesa: () => {} } }));

type RigaCoda = { id: string; user_id: string; template: string; attempts?: number; scade_at?: string | null };
let coda: RigaCoda[] = [];
let profili: Array<{ id: string; full_name?: string | null; email_marketing: boolean | null }> = [];
let erroreProfili: { message: string } | null = null;
let lettura: (id: string) => Promise<{ data: unknown; error: unknown }> = async () => ({
  data: { user: { email: 'giulia@example.it' } },
  error: null,
});
const scritture: Array<{ tabella: string; valori: Record<string, unknown>; chiave: unknown }> = [];

function finto() {
  return {
    rpc: async (nome: string) => (nome === 'claim_pending_emails' ? { data: coda, error: null } : { data: null, error: null }),
    auth: { admin: { getUserById: (id: string) => lettura(id) } },
    from: (tabella: string) => ({
      select: () => ({
        in: async () =>
          tabella === 'profiles' && erroreProfili
            ? { data: null, error: erroreProfili }
            : { data: tabella === 'profiles' ? profili : [], error: null },
      }),
      update: (valori: Record<string, unknown>) => ({
        eq: async (_colonna: string, chiave: unknown) => {
          scritture.push({ tabella, valori, chiave });
          return { error: null };
        },
      }),
    }),
  };
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => finto() }));

async function giroDellaPosta() {
  vi.resetModules();
  const { POST } = await import('@/app/api/cron/send-emails/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://localhost/api/cron/send-emails', { method: 'POST' }),
  );
}
const scritturaDi = (id: string) => scritture.filter((s) => s.tabella === 'email_queue' && s.chiave === id);
const annullata = (id: string) => scritturaDi(id).some((s) => typeof s.valori.cancelled_at === 'string');
const rilasciata = (id: string) => scritturaDi(id).some((s) => s.valori.claimed_at === null && !('cancelled_at' in s.valori));
const GIORNO = 86_400_000;
const fa = (ms: number) => new Date(Date.now() - ms).toISOString();
const fra = (ms: number) => new Date(Date.now() + ms).toISOString();

beforeEach(() => {
  esitoInvio = { ok: true, id: 'msg-1' };
  spedite.length = 0;
  scritture.length = 0;
  coda = [];
  profili = [];
  erroreProfili = null;
  lettura = async () => ({ data: { user: { email: 'giulia@example.it' } }, error: null });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('① una riga scaduta non parte il giorno in cui si accende la posta', () => {
  it('il benvenuto di Giulia, scaduto da quattro mesi, si chiude col motivo e non si spedisce', async () => {
    profili = [{ id: 'u1', full_name: 'Giulia Bianchi', email_marketing: true }];
    coda = [{ id: 'q1', user_id: 'u1', template: 'welcome', scade_at: fa(120 * GIORNO) }];
    await giroDellaPosta();
    expect(spedite, 'e partito un benvenuto fermo da mesi').toHaveLength(0);
    expect(annullata('q1'), 'la riga scaduta resta in coda').toBe(true);
    expect(String(scritturaDi('q1').find((s) => s.valori.cancelled_at)?.valori.last_error)).toMatch(/scadut/);
  });

  it('controprova: entro la scadenza parte come prima', async () => {
    profili = [{ id: 'u1', full_name: 'Giulia Bianchi', email_marketing: true }];
    coda = [{ id: 'q1', user_id: 'u1', template: 'welcome', scade_at: fra(2 * GIORNO) }];
    await giroDellaPosta();
    expect(spedite).toHaveLength(1);
    expect(annullata('q1')).toBe(false);
  });
});

describe('② la promo rinviata per la chiave mancante non gira per sempre', () => {
  it('passata la scadenza la promo si chiude, non si rimanda di altri trenta minuti', async () => {
    esitoInvio = { ok: false, skipped: true, reason: 'UNSUBSCRIBE_SECRET non configurata' };
    profili = [{ id: 'u1', full_name: 'Maria Rossi', email_marketing: true }];
    coda = [{ id: 'q1', user_id: 'u1', template: 'first_order_promo', scade_at: fa(GIORNO) }];
    await giroDellaPosta();
    expect(rilasciata('q1'), 'la promo scaduta e stata rimessa in fila').toBe(false);
    expect(annullata('q1')).toBe(true);
  });
});

describe('③ un account che non esiste piu non si riprova ogni mezz ora', () => {
  it('404 user_not_found: la riga si chiude, non si rilascia', async () => {
    lettura = async () => ({ data: { user: null }, error: { status: 404, code: 'user_not_found', message: 'User not found' } });
    profili = [{ id: 'u1', full_name: null, email_marketing: false }];
    coda = [{ id: 'q1', user_id: 'u1', template: 'welcome' }];
    await giroDellaPosta();
    expect(rilasciata('q1'), 'la riga di un account cancellato torna in coda per sempre').toBe(false);
    expect(annullata('q1')).toBe(true);
  });

  it('controprova: un errore di rete si rilascia ancora', async () => {
    lettura = async () => ({ data: { user: null }, error: { status: 500, message: 'timeout' } });
    profili = [{ id: 'u1', full_name: null, email_marketing: false }];
    coda = [{ id: 'q1', user_id: 'u1', template: 'welcome' }];
    await giroDellaPosta();
    expect(rilasciata('q1')).toBe(true);
    expect(annullata('q1')).toBe(false);
  });
});

describe('④ se i profili non si leggono, il consenso non diventa un no', () => {
  it('la promo di chi ha detto si non si annulla: si rimanda; il servizio parte', async () => {
    erroreProfili = { message: 'canceling statement due to statement timeout' };
    coda = [
      { id: 'q1', user_id: 'u1', template: 'reengagement_14d' },
      { id: 'q2', user_id: 'u2', template: 'welcome' },
    ];
    const r = await giroDellaPosta();
    expect(annullata('q1'), 'una lettura fallita ha cancellato per sempre la promo').toBe(false);
    expect(rilasciata('q1')).toBe(true);
    expect(spedite, 'il benvenuto non dipende dal consenso commerciale').toHaveLength(1);
    expect((await r.json()).rinviate).toBe(1);
  });
});
