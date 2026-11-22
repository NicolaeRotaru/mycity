import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R30-003 — Il conto dei promemoria «inviati» non prende i carrelli chiusi senza email.
 *
 * Il giro dei carrelli abbandonati segnava con l'ora del giro anche i carrelli di chi non ha dato
 * il consenso, senza spedire niente; il conto della campagna (lib/carrelli-abbandonati.ts) leggeva
 * quel segno come «email partita». Ora il carrello chiuso senza email porta come segno la sua
 * ultima attività, scritto solo se il carrello è ancora quello letto, e il conto lo tiene fuori.
 */

vi.mock('@/lib/tempo-piacenza', async (orig) => ({ ...(await orig<object>()), oraPiacenza: () => 12 }));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (r: unknown) => unknown) => (r: unknown) => h(r) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'm' })) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), spesa: vi.fn() } }));

const stato = vi.hoisted(() => ({
  carrelli: [] as Array<Record<string, unknown>>,
  profili: [] as Array<{ id: string; email_marketing: boolean | null }>,
  rpc: [] as Array<{ nome: string; utente?: string }>,
  scritture: [] as Array<{ valori: Record<string, unknown>; filtri: string[] }>,
}));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async (nome: string, args: { p_user?: string }) => {
      stato.rpc.push({ nome, utente: args?.p_user });
      if (nome === 'list_abandoned_carts_to_recover') return { data: stato.carrelli, error: null };
      return { data: true, error: null };
    },
    from: (tabella: string) => {
      const filtri: string[] = [];
      let valori: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        delete: () => q,
        update: (v: Record<string, unknown>) => { valori = v; return q; },
        in: async () => (tabella === 'profiles' ? { data: stato.profili, error: null } : { data: [], error: null }),
        eq: (c: string, v: unknown) => (filtri.push(`eq:${c}=${String(v)}`), q),
        is: (c: string, v: unknown) => (filtri.push(`is:${c}=${String(v)}`), q),
        lt: (c: string, v: unknown) => (filtri.push(`lt:${c}=${String(v)}`), q),
        // R18-001 — La rivendicazione del carrello (segno solo se vuoto) rende la riga presa.
        maybeSingle: async () => {
          if (tabella === 'abandoned_carts' && valori) stato.scritture.push({ valori, filtri: [...filtri] });
          return { data: { user_id: 'u1' }, error: null };
        },
        then: (ok: (x: unknown) => unknown) => {
          if (tabella === 'abandoned_carts' && valori) stato.scritture.push({ valori, filtri: [...filtri] });
          return Promise.resolve({ data: [], error: null }).then(ok);
        },
      });
      return q;
    },
  }),
}));

import { contaRendimentoRecupero } from '@/lib/carrelli-abbandonati';

const ULTIMA = '2026-11-17T06:12:34.567891+00:00';

async function giro() {
  const { POST } = await import('@/app/api/cron/abandoned-carts/route');
  return (POST as unknown as (r: Request) => Promise<Response>)(new Request('http://localhost/api/cron/abandoned-carts', { method: 'POST' }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T12:00:00+01:00'));
  stato.rpc = [];
  stato.scritture = [];
  stato.carrelli = [{ user_id: 'u1', email: 'u1@example.it', full_name: 'Anna', cart_data: [], cart_total: 12, last_activity: ULTIMA }];
  stato.profili = [{ id: 'u1', email_marketing: false }];
  return () => vi.useRealTimers();
});

describe('R30-003 — il giro chiude il carrello senza consenso con un segno che non è un invio', () => {
  it('senza consenso: il segno è l ultima attività del carrello, e solo se il carrello è ancora quello letto', async () => {
    await giro();
    const segno = stato.scritture.find((s) => 'recovery_email_sent_at' in s.valori);
    expect(segno, 'il carrello senza consenso non è stato segnato con l ultima attività').toBeDefined();
    expect(segno?.valori.recovery_email_sent_at).toBe(ULTIMA);
    expect(segno?.filtri).toEqual(expect.arrayContaining(['eq:user_id=u1', `eq:last_activity=${ULTIMA}`, 'is:recovery_email_sent_at=null']));
    expect(stato.rpc.filter((r) => r.nome === 'mark_abandoned_cart_email_sent')).toEqual([]);
  });

  it('controprova: con il consenso il promemoria si rivendica e parte come prima', async () => {
    stato.profili = [{ id: 'u1', email_marketing: true }];
    stato.carrelli = [{ ...stato.carrelli[0], last_activity: '2026-11-17T05:00:00.000000+00:00' }];
    const res = await (await giro()).json();
    // R18-001 — La rivendicazione la scrive il giro: segno con l'ora del giro, solo se il segno è vuoto.
    const presa = stato.scritture.find((s) => s.filtri.includes('is:recovery_email_sent_at=null') && s.valori.recovery_email_sent_at !== stato.carrelli[0].last_activity);
    expect(presa, 'il promemoria è partito senza rivendicare il carrello').toBeDefined();
    expect(presa?.filtri).toContain('eq:user_id=u1');
    expect(res.sent).toBe(1);
  });
});

describe('R30-003 — il conto non prende per promemoria un carrello chiuso senza email', () => {
  it('segno uguale all ultima attività (anche scritto in un altro formato): nessuna email, e se torna è tornato da solo', () => {
    const conto = contaRendimentoRecupero([
      { recovery_email_sent_at: ULTIMA, last_activity: '2026-11-17T07:12:34.567+01:00', recovered: true, recovered_at: '2026-11-17T09:00:00Z' },
      { recovery_email_sent_at: '2026-11-17T10:30:00Z', last_activity: ULTIMA, recovered: true, recovered_at: '2026-11-17T11:00:00Z' },
    ]);
    expect(conto.emailInviate).toBe(1);
    expect(conto.tornatiDopoLEmail).toBe(1);
    expect(conto.tornatiDaSoli).toBe(1);
  });
});
