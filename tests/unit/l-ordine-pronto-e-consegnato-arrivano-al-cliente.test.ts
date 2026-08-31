import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { preparaEmailCicloDiVita, TEMPLATE_DI_SERVIZIO } from '@/lib/email/templates';

/**
 * 30/8/2026 (R007) — DUE DEI TRE MOMENTI IN CUI LA POSTA SERVE DAVVERO NON
 * ARRIVAVANO MAI.
 *
 * In `lib/email/templates.ts` c'erano, scritti e impaginati, il messaggio
 * «ordine pronto» e il messaggio «ordine consegnato». Non li chiamava nessuno:
 * cercandone il nome in tutto il progetto si trovava solo la riga che li
 * definisce. Il cliente riceveva la conferma d'ordine e poi piu' niente —
 * niente quando la spesa e' pronta, niente quando e' stata consegnata.
 *
 * Il motivo era strutturale, e per questo nessuno l'aveva chiuso: il passaggio
 * di stato lo scrive il BROWSER del negoziante, direttamente sulla tabella
 * degli ordini, e le due chiusure vere («consegnato») le scrivono due funzioni
 * dentro il database. Non esisteva nessun punto sul server dove agganciare un
 * invio. L'unica cosa che partiva era la notifica in-app del trigger della
 * migrazione 086 — che si vede solo se apri l'app.
 *
 * Adesso la strada e' quella che il database gia' usa per le notifiche: al
 * cambio di stato un trigger scrive una riga nella coda della posta, col
 * template giusto e con i dati che servono (numero d'ordine, totale, e per il
 * ritiro in negozio indirizzo e codice). Il giro della coda la spedisce.
 *
 * Perche' le due email siano di SERVIZIO e non di marketing conta: chi non ha
 * dato il consenso commerciale deve riceverle lo stesso. E' il suo ordine.
 */

const spedite: Array<{ to: string; subject: string; html: string; text?: string; tags?: unknown }> = [];

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string; subject: string; html: string; text?: string }) => {
    spedite.push(m);
    return { ok: true, id: 'msg-1' };
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

type RigaCoda = { id: string; user_id: string; template: string; metadata?: Record<string, unknown> | null };
let coda: RigaCoda[] = [];
let profili: Array<{ id: string; full_name: string | null; email_marketing: boolean | null }> = [];
const indirizzi: Record<string, string> = { u1: 'maria@example.it' };
const scritture: Array<Record<string, unknown>> = [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async () => ({ data: coda, error: null }),
    auth: {
      admin: { getUserById: async (id: string) => ({ data: { user: { email: indirizzi[id] ?? null } } }) },
    },
    from: (tabella: string) => {
      if (tabella === 'profiles') {
        return { select: () => ({ in: async () => ({ data: profili, error: null }) }) };
      }
      return {
        update: (valori: Record<string, unknown>) => ({
          eq: async (_c: string, id: string) => { scritture.push({ id, ...valori }); return { error: null }; },
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
afterEach(() => { vi.unstubAllEnvs(); });

describe('i due messaggi che non partivano mai', () => {
  it('«ordine pronto» esiste come messaggio della coda, non solo come funzione che non chiama nessuno', () => {
    const m = preparaEmailCicloDiVita('order_ready', {
      orderId: '11111111-2222-3333-4444-555555555555',
      pickupInStore: true,
      storeName: 'Pane Quotidiano',
      storeAddress: 'Via Roma 12, Piacenza',
      pickupCode: '482913',
    });
    expect(m, 'il template «ordine pronto» non e collegato a nessun nome della coda').not.toBeNull();
    expect(m!.html, 'senza indirizzo il cliente non sa dove andare a ritirare').toContain('Via Roma 12');
    expect(m!.html, 'senza il codice il negoziante non puo chiudere il ritiro').toContain('482913');
    expect(m!.text).toContain('482913');
  });

  it('sul ritiro a domicilio non promette un ritiro in negozio che non c\'e', () => {
    const m = preparaEmailCicloDiVita('order_ready', {
      orderId: 'ord-2',
      pickupInStore: false,
      storeName: 'Pane Quotidiano',
    })!;
    expect(m.html).not.toContain('482913');
    expect(m.html.toLowerCase(), 'a chi aspetta a casa va detto che arriva un fattorino').toMatch(/rider|fattorino/);
  });

  it('«ordine consegnato» invita a lasciare una recensione', () => {
    const m = preparaEmailCicloDiVita('order_delivered', {
      orderId: 'ord-3', name: 'Maria', totalEuro: 24.5,
    });
    expect(m, 'il template «consegnato» non e collegato a nessun nome della coda').not.toBeNull();
    expect(m!.html).toContain('/orders/ord-3');
    expect(m!.html).toContain('Maria');
  });

  it('il nome del negozio arriva come testo, non come codice', () => {
    // Il nome del negozio lo scrive il negoziante: e' testo di un altro.
    const m = preparaEmailCicloDiVita('order_ready', {
      orderId: 'ord-4',
      pickupInStore: true,
      storeName: '<script>alert(1)</script>',
      storeAddress: 'Via Roma 12',
      pickupCode: '000111',
    })!;
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
  });
});

describe('il giro della coda spedisce davvero le due email', () => {
  it('manda «ordine pronto» col codice di ritiro che arriva dalla riga in coda', async () => {
    coda = [{
      id: 'q1', user_id: 'u1', template: 'order_ready',
      metadata: {
        orderId: '11111111-2222-3333-4444-555555555555',
        pickupInStore: true,
        storeName: 'Pane Quotidiano',
        storeAddress: 'Via Roma 12, Piacenza',
        pickupCode: '482913',
      },
    }];
    profili = [{ id: 'u1', full_name: 'Maria Rossi', email_marketing: true }];

    await giroDellaPosta();

    expect(spedite, 'l\'email «ordine pronto» non e partita').toHaveLength(1);
    expect(
      spedite[0].html,
      'I dati della riga in coda non arrivano al template: il messaggio parte vuoto, senza codice e senza indirizzo',
    ).toContain('482913');
    expect(spedite[0].html).toContain('Via Roma 12');
  });

  it('manda «consegnato» ANCHE a chi non ha dato il consenso commerciale', async () => {
    // E' il suo ordine: dirgli che e' arrivato non e' marketing. Trattarlo come
    // tale vorrebbe dire non dire mai niente a chi ha detto no alle promozioni.
    coda = [{
      id: 'q2', user_id: 'u1', template: 'order_delivered',
      metadata: { orderId: 'ord-9', totalEuro: 24.5 },
    }];
    profili = [{ id: 'u1', full_name: 'Maria Rossi', email_marketing: false }];

    await giroDellaPosta();

    expect(
      spedite,
      'La conferma di consegna e stata trattata come una promozione e buttata via: chi ha detto no alle offerte non sa piu niente del proprio ordine',
    ).toHaveLength(1);
    expect(spedite[0].html).toContain('/orders/ord-9');
  });

  it('i sei messaggi del ciclo di vita partono ancora come prima', async () => {
    coda = [
      { id: 'q1', user_id: 'u1', template: 'welcome' },
      { id: 'q2', user_id: 'u1', template: 'tutorial_day2' },
      { id: 'q3', user_id: 'u1', template: 'first_order_promo' },
      { id: 'q4', user_id: 'u1', template: 'reengagement_14d' },
      { id: 'q5', user_id: 'u1', template: 'winback_60d' },
      { id: 'q6', user_id: 'u1', template: 'abandoned_cart_4h' },
    ];
    profili = [{ id: 'u1', full_name: 'Maria Rossi', email_marketing: true }];
    await giroDellaPosta();
    expect(spedite).toHaveLength(6);
  });
});

describe('il trigger del database e i template parlano la stessa lingua', () => {
  /**
   * Il pezzo che mette la riga in coda e' SQL, e da qui non gira: in questa
   * macchina c'e' il client di Postgres ma non il server, quindi la prova che
   * lo esercita davvero non si puo' scrivere (vive in tests/sql, che vuole un
   * database vero). Quello che si puo' tenere fermo da qui e' il punto di
   * giunzione: i nomi che il trigger scrive devono essere nomi che il codice sa
   * spedire. Se qualcuno rinomina un template, questa diventa rossa invece di
   * lasciare che la coda si riempia di righe che nessuno sa cosa siano.
   */
  const sql = readdirSync(join(process.cwd(), 'migrations'))
    .filter((f) => f.startsWith('150_'))
    .map((f) => readFileSync(join(process.cwd(), 'migrations', f), 'utf8'))
    .join('\n');

  it('la migrazione del trigger esiste', () => {
    expect(sql.length, 'senza la migrazione nessuna riga arriva mai in coda').toBeGreaterThan(0);
  });

  it.each(['order_ready', 'order_delivered'])('il template «%s» che il trigger scrive lo sa spedire il codice', (nome) => {
    expect(sql).toContain(`'${nome}'`);
    expect(
      preparaEmailCicloDiVita(nome, { orderId: 'ord-x' }),
      `il trigger mette in coda «${nome}» e il codice non sa cosa sia: la riga verrebbe annullata a ogni giro`,
    ).not.toBeNull();
    expect(
      TEMPLATE_DI_SERVIZIO.has(nome),
      `«${nome}» riguarda un ordine della persona, non le nostre offerte: se conta come marketing non arriva a chi ha detto no`,
    ).toBe(true);
  });

  it('la coda restituisce i dati della riga, o i due messaggi partirebbero vuoti', () => {
    expect(sql).toMatch(/RETURNS TABLE[^;]*metadata jsonb/);
  });
});
