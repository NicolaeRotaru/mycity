import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 27/8/2026 (R007) — DUE BENVENUTI, E QUELLO CHE PARTE DAVVERO E' IL PEGGIORE.
 *
 * I template della posta stavano in due elenchi diversi. In
 * `lib/email/templates.ts` c'era l'impaginazione comune: intestazione col
 * marchio, piede con «Gestisci preferenze» e i link legali, e il filtro
 * `escapeHtml` su ogni campo scritto da una persona. Dentro la rotta del cron
 * ce n'era un secondo, scritto a mano: sei template fatti di `<p>` nudi, senza
 * marchio, senza piede — e con il nome dell'utente interpolato grezzo.
 *
 * Quello che parte davvero e' il secondo: e' il giro della coda che spedisce il
 * benvenuto a chi si iscrive. Quindi la prima email che una persona riceve da
 * MyCity era un paragrafo bianco senza intestazione, che nella casella sembra
 * spam — e il nome, che se lo scrive lei nel proprio profilo, finiva dentro
 * l'HTML del messaggio senza nessun filtro.
 *
 * Adesso l'elenco e' uno solo, dentro `lib/email/templates.ts`, e ci passano
 * anche i sei del ciclo di vita.
 */

const spedite: Array<{ to: string; subject: string; html: string; text?: string }> = [];

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));

vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string; subject: string; html: string; text?: string }) => {
    spedite.push(m);
    return { ok: true, id: 'msg-1' };
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

/** Le righe che il giro trova in coda, e i profili/indirizzi che le riguardano. */
let coda: Array<{ id: string; user_id: string; template: string }> = [];
let profili: Array<{ id: string; full_name: string | null; email_marketing: boolean | null }> = [];
const indirizzi: Record<string, string> = { u1: 'maria@example.it' };
/** Le righe che il giro ha dichiarato chiuse (spedite o annullate). */
const scritture: Array<Record<string, unknown>> = [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async () => ({ data: coda, error: null }),
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { email: indirizzi[id] ?? null } } }),
      },
    },
    from: (tabella: string) => {
      if (tabella === 'profiles') {
        return { select: () => ({ in: async () => ({ data: profili, error: null }) }) };
      }
      return {
        update: (valori: Record<string, unknown>) => ({
          eq: async (_c: string, id: string) => {
            scritture.push({ id, ...valori });
            return { error: null };
          },
        }),
      };
    },
  }),
}));

async function giroDellaPosta() {
  vi.resetModules();
  const { POST } = await import('@/app/api/cron/send-emails/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://localhost/api/cron/send-emails', { method: 'POST' }),
  );
}

beforeEach(() => {
  spedite.length = 0;
  scritture.length = 0;
  coda = [];
  profili = [];
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('il benvenuto che parte dalla coda', () => {
  it('porta il marchio e il piede, come tutte le altre email', async () => {
    coda = [{ id: 'q1', user_id: 'u1', template: 'welcome' }];
    profili = [{ id: 'u1', full_name: 'Maria Rossi', email_marketing: true }];

    await giroDellaPosta();

    expect(spedite, 'il benvenuto non e nemmeno partito').toHaveLength(1);
    const html = spedite[0].html;
    expect(html.toLowerCase(), 'la prima email che una persona riceve da MyCity era un paragrafo bianco senza intestazione: nella casella sembra spam').toContain('<!doctype html>');
    expect(html, 'senza la fascia col marchio in cima il messaggio non si riconosce come nostro').toContain('MyCity');
    expect(html, 'il piede comune porta le preferenze e i link legali: senza, il messaggio e monco').toContain('Gestisci preferenze');
  });

  it("non lascia passare l'HTML scritto da chi si iscrive nel proprio nome", async () => {
    // Il nome arriva da `profiles.full_name`, che lo scrive la persona stessa
    // nel proprio profilo: e' testo di un altro, e va trattato come tale.
    coda = [{ id: 'q1', user_id: 'u1', template: 'welcome' }];
    profili = [{ id: 'u1', full_name: '<script>alert(1)</script> Rossi', email_marketing: true }];

    await giroDellaPosta();

    const html = spedite[0].html;
    expect(html, "un nome con dentro del markup rompeva l'impaginazione della mail di benvenuto").not.toContain('<script>');
    expect(html, 'il nome deve arrivare come testo, non come codice').toContain('&lt;script&gt;');
  });

  it('saluta comunque la persona per nome', async () => {
    coda = [{ id: 'q1', user_id: 'u1', template: 'welcome' }];
    profili = [{ id: 'u1', full_name: 'Maria Rossi', email_marketing: true }];

    await giroDellaPosta();

    expect(spedite[0].html, 'filtrare il nome non vuol dire buttarlo via').toContain('Maria');
    expect(spedite[0].subject).toContain('MyCity');
  });

  it('gli altri cinque template del ciclo di vita partono ancora', async () => {
    coda = [
      { id: 'q1', user_id: 'u1', template: 'tutorial_day2' },
      { id: 'q2', user_id: 'u1', template: 'first_order_promo' },
      { id: 'q3', user_id: 'u1', template: 'reengagement_14d' },
      { id: 'q4', user_id: 'u1', template: 'winback_60d' },
      { id: 'q5', user_id: 'u1', template: 'abandoned_cart_4h' },
    ];
    profili = [{ id: 'u1', full_name: 'Maria Rossi', email_marketing: true }];

    await giroDellaPosta();

    expect(spedite, 'spostare i template non deve far sparire nessuno dei messaggi che partivano').toHaveLength(5);
    for (const m of spedite) {
      expect(m.subject.length, 'un messaggio senza oggetto non si spedisce').toBeGreaterThan(0);
      expect(m.html.toLowerCase()).toContain('<!doctype html>');
    }
  });

  it('un nome di template che non esiste non fa cadere tutto il giro', async () => {
    // `constructor` e `__proto__` esistono su ogni oggetto: cercando il template
    // con la parentesi quadra si trovava una funzione qualsiasi, e la riga dopo
    // il giro moriva con un errore — portandosi dietro anche le email buone
    // dello stesso lotto, che restavano prenotate e non partivano.
    coda = [
      { id: 'q1', user_id: 'u1', template: 'constructor' },
      { id: 'q2', user_id: 'u1', template: 'welcome' },
    ];
    profili = [{ id: 'u1', full_name: 'Maria Rossi', email_marketing: true }];

    const res = await giroDellaPosta();

    expect(res.status, 'il giro e caduto: le email buone dello stesso lotto restano ferme').toBe(200);
    expect(spedite.map((m) => m.subject), 'il benvenuto della seconda riga doveva partire lo stesso').toHaveLength(1);
    const annullata = scritture.find((s) => s.id === 'q1');
    expect(annullata?.cancelled_at, 'la riga che non sappiamo spedire va chiusa, o torna a ogni giro').toBeTruthy();
  });
});
