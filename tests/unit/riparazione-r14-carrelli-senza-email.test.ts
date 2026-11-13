/**
 * R14-009 — Il conto dei promemoria «inviati» non conta i carrelli chiusi senza email.
 *
 * Il giro dei carrelli abbandonati chiude senza scrivere due tipi di carrello:
 * quello troppo vecchio (oltre 48 ore) e quello di chi non ha dato il consenso.
 * Li segna «gestiti» con lo stesso segno dell'invio (`recovery_email_sent_at`),
 * cosi' il giro dopo non li riprende. Ma `contaRendimentoRecupero` contava come
 * email partita ogni carrello con quel segno: il numero dei promemoria inviati,
 * e il merito della campagna, uscivano gonfiati.
 *
 * Qui il giro vero gira su una tabella finta che fa quello che fa il database
 * (la lista dei carrelli da ricontattare, la marcatura della 166, gli UPDATE),
 * e poi si fa il conto sulle stesse righe. L'orologio e' finto.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/tempo-piacenza', async (orig) => ({ ...(await orig<object>()), oraPiacenza: () => 12 }));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (r: unknown) => unknown) => (r: unknown) => h(r) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), spesa: vi.fn() } }));

const posta = vi.hoisted(() => ({ spedite: [] as string[] }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string }) => { posta.spedite.push(m.to); return { ok: true, id: 'msg' }; },
}));

type Riga = {
  user_id: string;
  cart_data: unknown[];
  cart_total: number;
  last_activity: string;
  recovery_email_sent_at: string | null;
  recovered: boolean;
  recovered_at: string | null;
};

const db = vi.hoisted(() => ({
  righe: [] as Array<Record<string, unknown>>,
  consensi: [] as Array<{ id: string; email_marketing: boolean }>,
}));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async (nome: string, args: { p_user?: string; min_hours?: number }) => {
      const adesso = Date.now();
      if (nome === 'list_abandoned_carts_to_recover') {
        const dati = db.righe
          .filter((r) => r.recovery_email_sent_at === null && r.recovered === false
            && Date.parse(String(r.last_activity)) < adesso - (args.min_hours ?? 4) * 3_600_000)
          .map((r) => ({ user_id: r.user_id, email: `${r.user_id}@example.it`, full_name: 'Maria', cart_data: r.cart_data, cart_total: r.cart_total, last_activity: r.last_activity }));
        return { data: dati, error: null };
      }
      if (nome === 'mark_abandoned_cart_email_sent') {
        // Come la 166: segna solo se il segno non c'era, e dice se l'ha messo lui.
        const r = db.righe.find((x) => x.user_id === args.p_user);
        if (!r || r.recovery_email_sent_at !== null) return { data: false, error: null };
        r.recovery_email_sent_at = new Date(adesso).toISOString();
        return { data: true, error: null };
      }
      return { data: null, error: null };
    },
    from: (tabella: string) => {
      if (tabella === 'profiles') {
        return { select: () => ({ in: async () => ({ data: db.consensi, error: null }) }) };
      }
      const potatura: Record<string, unknown> = {};
      Object.assign(potatura, { eq: () => potatura, lt: () => potatura, is: () => potatura, select: async () => ({ data: [], error: null }) });
      return {
        update: (campi: Record<string, unknown>) => ({
          eq: async (colonna: string, valore: unknown) => {
            for (const r of db.righe) if (r[colonna] === valore) Object.assign(r, campi);
            return { error: null };
          },
        }),
        delete: () => potatura,
        select: async (colonne: string) => ({
          data: db.righe.map((r) => Object.fromEntries(colonne.split(',').map((c) => c.trim()).map((c) => [c, r[c] ?? null]))),
          error: null,
        }),
      };
    },
  }),
}));

import { contaRendimentoRecupero, rendimentoRecuperoCarrelli } from '@/lib/carrelli-abbandonati';
import { getAdminSupabase } from '@/lib/supabase/server';

const ORA = 3_600_000;
const MEZZOGIORNO = Date.UTC(2026, 10, 13, 11, 0, 0); // le 12 a Piacenza
const fa = (ms: number) => new Date(MEZZOGIORNO - ms).toISOString();

function carrello(user: string, ultimaAttivitaFa: number): Riga {
  return {
    user_id: user, cart_data: [{ quantity: 1, name: 'Pane' }], cart_total: 12,
    last_activity: fa(ultimaAttivitaFa), recovery_email_sent_at: null, recovered: false, recovered_at: null,
  };
}

async function giroDeiCarrelli() {
  const { POST } = await import('@/app/api/cron/abandoned-carts/route');
  const res = await (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/cron/abandoned-carts', { method: 'POST' }),
  );
  return res.json() as Promise<{ sent: number; skipped: number; candidates: number }>;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MEZZOGIORNO);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
  posta.spedite = [];
  db.righe = [
    carrello('con-consenso', 5 * ORA),   // riceve il promemoria
    carrello('senza-consenso', 6 * ORA), // chiuso senza email: niente consenso
    carrello('troppo-vecchio', 72 * ORA), // chiuso senza email: oltre 48 ore
  ];
  db.consensi = [
    { id: 'con-consenso', email_marketing: true },
    { id: 'senza-consenso', email_marketing: false },
    { id: 'troppo-vecchio', email_marketing: true },
  ];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('R14-009 — i promemoria «inviati» sono quelli partiti davvero', () => {
  it('un giro con un invio e due carrelli chiusi senza email: il conto dice 1 promemoria, non 3', async () => {
    const giro = await giroDeiCarrelli();
    expect(giro.sent).toBe(1);
    expect(giro.skipped).toBe(2);
    expect(posta.spedite).toEqual(['con-consenso@example.it']);

    const conto = await rendimentoRecuperoCarrelli(getAdminSupabase() as never);
    expect(conto.emailInviate, 'i carrelli segnati senza nessuna email contano come promemoria inviati').toBe(1);
  });

  it('i carrelli chiusi senza email restano gestiti: il giro dopo non li riprende', async () => {
    await giroDeiCarrelli();
    vi.setSystemTime(MEZZOGIORNO + ORA);
    const secondo = await giroDeiCarrelli();
    expect(secondo.candidates).toBe(0);
    expect(posta.spedite).toHaveLength(1);
  });

  it('chi torna dopo un carrello chiuso senza email e\' tornato da solo, non per merito del promemoria', async () => {
    await giroDeiCarrelli();
    for (const r of db.righe) {
      r.recovered = true;
      r.recovered_at = new Date(MEZZOGIORNO + 2 * ORA).toISOString();
    }
    const conto = await rendimentoRecuperoCarrelli(getAdminSupabase() as never);
    expect(conto.tornatiInTutto).toBe(3);
    expect(conto.tornatiDopoLEmail, 'il merito della campagna conta chi non ha ricevuto niente').toBe(1);
    expect(conto.tornatiDaSoli).toBe(2);
  });

  it('il conto, da solo: il segno uguale all\'ultima attivita\' e\' «gestito senza email»', () => {
    const conto = contaRendimentoRecupero([
      { recovered: false, recovered_at: null, recovery_email_sent_at: fa(1 * ORA), last_activity: fa(6 * ORA) },
      { recovered: false, recovered_at: null, recovery_email_sent_at: fa(6 * ORA), last_activity: fa(6 * ORA) },
    ] as never);
    expect(conto.emailInviate).toBe(1);
  });
});
