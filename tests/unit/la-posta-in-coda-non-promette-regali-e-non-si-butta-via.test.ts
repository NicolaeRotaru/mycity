import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { preparaEmailCicloDiVita, TEMPLATE_DI_SERVIZIO } from '@/lib/email/templates';

/**
 * 27/10/2026 — LA POSTA AUTOMATICA DICEVA COSE FALSE, E SE NON PARTIVA SI BUTTAVA.
 *
 * Due famiglie di difetti nello stesso giro della coda (app/api/cron/send-emails)
 * e nei suoi template (lib/email/templates.ts).
 *
 * ① Le promesse. Scelta firmata da Nicola il 26/10: al lancio nessun regalo in
 *    euro. Le email invece promettevano «€5 di benvenuto, lo sconto si applica
 *    da solo alla cassa» (la cassa non lo applica), «invita un amico, ricevi €5»
 *    dentro un messaggio che parte anche a chi ha detto no alla pubblicita', e il
 *    codice RITORNO10 che nessuna migrazione crea.
 *
 * ② Il cestino. Se la posta non e' ancora configurata (chiave Resend o mittente
 *    mancanti), `sendEmail` risponde «saltata» e il giro la contava come un
 *    tentativo fallito: dopo cinque giri, circa tredici ore, la riga veniva
 *    annullata per sempre. Lo stesso per un errore di un attimo nella lettura
 *    dell'indirizzo, e per i carrelli: segnati «avvisati» prima dell'invio e mai
 *    rimessi in coda se l'invio saltava.
 */

let esitoInvio: Record<string, unknown> = { ok: true, id: 'msg-1' };
const spedite: Array<{ to: string; subject: string; html: string; text?: string; tipo?: string }> = [];

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string; subject: string; html: string; text?: string; tipo?: string }) => {
    spedite.push(m);
    return esitoInvio;
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, spesa: () => {} } }));
vi.mock('@/lib/carrelli-abbandonati', () => ({ potaCarrelliRecuperati: async () => 0 }));

type RigaCoda = { id: string; user_id: string; template: string; attempts?: number };
let coda: RigaCoda[] = [];
let profili: Array<{ id: string; full_name?: string | null; email_marketing: boolean | null }> = [];
let carrelli: Array<Record<string, unknown>> = [];
let lettura: (id: string) => Promise<{ data: unknown; error: unknown }> = async () => ({
  data: { user: { email: 'giulia@example.it' } },
  error: null,
});
const scritture: Array<{ tabella: string; valori: Record<string, unknown>; chiave: unknown }> = [];

function finto() {
  return {
    rpc: async (nome: string) => {
      if (nome === 'claim_pending_emails') return { data: coda, error: null };
      if (nome === 'list_abandoned_carts_to_recover') return { data: carrelli, error: null };
      return { data: null, error: null };
    },
    auth: { admin: { getUserById: (id: string) => lettura(id) } },
    from: (tabella: string) => ({
      select: () => ({ in: async () => ({ data: tabella === 'profiles' ? profili : [], error: null }) }),
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
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto() }));

async function giroDellaPosta() {
  vi.resetModules();
  const { POST } = await import('@/app/api/cron/send-emails/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://localhost/api/cron/send-emails', { method: 'POST' }),
  );
}
async function giroDeiCarrelli() {
  vi.resetModules();
  const { POST } = await import('@/app/api/cron/abandoned-carts/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://localhost/api/cron/abandoned-carts', { method: 'POST' }),
  );
}
const scritturaDi = (id: string) => scritture.filter((s) => s.tabella === 'email_queue' && s.chiave === id);

beforeEach(() => {
  esitoInvio = { ok: true, id: 'msg-1' };
  spedite.length = 0;
  scritture.length = 0;
  coda = [];
  profili = [];
  carrelli = [];
  lettura = async () => ({ data: { user: { email: 'giulia@example.it' } }, error: null });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('il «3 cose da sapere» parte senza consenso, quindi non porta incentivi', () => {
  it('Giulia ha detto no alla pubblicita: riceve la guida, ma senza «invita un amico, ricevi €5»', async () => {
    profili = [{ id: 'u1', full_name: 'Giulia Bianchi', email_marketing: false }];
    coda = [{ id: 'q1', user_id: 'u1', template: 'tutorial_day2' }];
    await giroDellaPosta();
    expect(spedite, 'la guida di servizio deve partire anche senza consenso').toHaveLength(1);
    const tutto = `${spedite[0].subject} ${spedite[0].html} ${spedite[0].text}`;
    expect(tutto).not.toMatch(/€|credito|invita|amico|gratis|sconto/i);
    expect(TEMPLATE_DI_SERVIZIO.has('tutorial_day2')).toBe(true);
  });
});

describe('nessun regalo in euro e nessun codice che non esiste', () => {
  it('la promo del primo ordine non promette €5 che la cassa non applica', () => {
    const m = preparaEmailCicloDiVita('first_order_promo', {});
    expect(m).not.toBeNull();
    const tutto = `${m!.subject} ${m!.html} ${m!.text}`;
    expect(tutto).not.toMatch(/€\s?5|5\s?€|sconto|si applica da solo/i);
  });

  it('il «ci manchi» non porta RITORNO10 (non lo crea nessuno) e non dice «non ti vediamo da un po»', () => {
    const m = preparaEmailCicloDiVita('winback_60d', {});
    expect(m).not.toBeNull();
    const tutto = `${m!.subject} ${m!.html} ${m!.text}`;
    expect(tutto).not.toMatch(/RITORNO10|-10%|non ti vediamo/i);
  });

  it('il tour di benvenuto e la fascia newsletter non promettono €5', () => {
    const tour = readFileSync(join(process.cwd(), 'components', 'BuyerOnboardingTour.tsx'), 'utf8');
    expect(tour).not.toMatch(/€\s?5|5\s?€/);
    const home = readFileSync(join(process.cwd(), 'components', 'home-sections', 'HomeSectionRenderer.tsx'), 'utf8');
    const newsletter = home.slice(home.indexOf("case 'newsletter'"), home.indexOf("case 'newsletter'") + 1500);
    expect(newsletter.length).toBeGreaterThan(100);
    expect(newsletter).not.toMatch(/€\s?5|5\s?€|in regalo/i);
  });
});

describe('un guasto di configurazione non consuma i tentativi', () => {
  it('posta non configurata: la riga torna in attesa, senza tentativo e senza annullo, col motivo vero', async () => {
    esitoInvio = { ok: false, skipped: true, reason: 'RESEND_FROM non configurata' };
    profili = [{ id: 'u1', full_name: 'Maria Rossi', email_marketing: true }];
    coda = [{ id: 'q1', user_id: 'u1', template: 'welcome', attempts: 4 }];
    await giroDellaPosta();
    const righe = scritturaDi('q1');
    expect(righe.length).toBeGreaterThan(0);
    for (const r of righe) {
      expect(r.valori.cancelled_at, 'una posta non configurata ha buttato via la riga').toBeUndefined();
      expect(r.valori.attempts, 'una posta non configurata ha consumato un tentativo').toBeUndefined();
    }
    const rilascio = righe.find((r) => 'claimed_at' in r.valori);
    expect(rilascio?.valori.claimed_at).toBeNull();
    expect(String(rilascio?.valori.last_error)).toContain('RESEND_FROM');
  });

  it('controprova: un errore vero di Resend conta ancora come tentativo', async () => {
    esitoInvio = { ok: false, error: 'boom' };
    profili = [{ id: 'u1', full_name: 'Maria Rossi', email_marketing: true }];
    coda = [{ id: 'q1', user_id: 'u1', template: 'welcome', attempts: 0 }];
    await giroDellaPosta();
    expect(scritturaDi('q1').some((r) => r.valori.attempts === 1)).toBe(true);
  });

  it('se la lettura dell indirizzo fallisce per un attimo, la riga si rilascia e non si annulla', async () => {
    lettura = async () => ({ data: { user: null }, error: { message: 'timeout' } });
    profili = [{ id: 'u1', full_name: 'Maria Rossi', email_marketing: true }];
    coda = [{ id: 'q1', user_id: 'u1', template: 'welcome', attempts: 0 }];
    await giroDellaPosta();
    const righe = scritturaDi('q1');
    expect(righe.some((r) => r.valori.cancelled_at), 'un errore di un attimo ha annullato la riga per sempre').toBe(false);
    expect(righe.some((r) => r.valori.claimed_at === null)).toBe(true);
  });

  it('controprova: chi non ha piu un indirizzo (senza errori) si annulla come prima', async () => {
    lettura = async () => ({ data: { user: null }, error: null });
    profili = [{ id: 'u1', full_name: 'Maria Rossi', email_marketing: true }];
    coda = [{ id: 'q1', user_id: 'u1', template: 'welcome', attempts: 0 }];
    await giroDellaPosta();
    expect(scritturaDi('q1').some((r) => typeof r.valori.cancelled_at === 'string')).toBe(true);
  });

  it('il carrello torna da avvisare se l invio salta per configurazione', async () => {
    esitoInvio = { ok: false, skipped: true, reason: 'RESEND_API_KEY non configurata' };
    profili = [{ id: 'u1', email_marketing: true }];
    carrelli = [{ user_id: 'u1', email: 'maria@example.it', full_name: 'Maria', cart_data: [], cart_total: 12 }];
    await giroDeiCarrelli();
    const rimesso = scritture.find((s) => s.tabella === 'abandoned_carts' && s.chiave === 'u1');
    expect(rimesso, 'il promemoria e perso: il carrello resta segnato come avvisato').toBeDefined();
    expect(rimesso!.valori.recovery_email_sent_at).toBeNull();
  });
});
