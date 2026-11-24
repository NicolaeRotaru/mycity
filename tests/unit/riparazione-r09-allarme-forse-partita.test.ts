/**
 * R09-001 — La notte dopo una spiegazione spedita ma non segnata, se il secondo invio cade l'allarme
 * agli amministratori diceva «non è partita per email» per un'email forse già arrivata. La rotta
 * notturna legge `forsePartita` e dice «può essere arrivata». La seconda spedizione resta voluta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

const mondo = vi.hoisted(() => ({ admin: null as unknown, posta: true }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async () => ({ ok: mondo.posta })),
}));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: vi.fn(async () => ({ ok: false, motivo: 'cassa_da_versare', errore: 'contanti da versare', fileRimossi: 0, erroriFile: [] })),
}));

import { POST } from '@/app/api/cron/process-deletions/route';

const ADESSO = new Date('2026-11-21T04:00:00+01:00').getTime();
const GIORNO = 86_400_000;
const CHIESTA_IL = new Date(ADESSO - 8 * GIORNO).toISOString();
const PERSONA = '00000000-0000-4000-8000-000000000001';
const EMAIL_PARTITA = 'privacy.avviso_cancellazione.email_partita';

function laNotte() {
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [{ id: 'admin-1', role: 'admin' }],
      notifications: [],
      audit_logs: [],
      cron_heartbeats: [],
    },
    rpc: { process_expired_deletions: { data: [{ user_id: PERSONA, deleted_at: CHIESTA_IL }], error: null } },
    indirizzi: { [PERSONA]: 'persona@example.it' },
    chiaviUniche: true,
  });
  mondo.admin = giro.admin;
  return giro;
}

const unaNotte = async (n: number) => {
  vi.setSystemTime(ADESSO + n * GIORNO);
  const p = POST(
    new Request('http://localhost/api/cron/process-deletions?a_mano=1&cancella=1', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );
  await vi.runAllTimersAsync();
  return (await p).status;
};

const allarmi = (giro: ReturnType<typeof laNotte>) =>
  giro.notifiche().filter((n) => n.user_id === 'admin-1' && /email/i.test(String(n.body)) && /Chi aspetta/.test(String(n.body)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
  vi.setSystemTime(ADESSO);
  mondo.posta = true;
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => vi.useRealTimers());

describe('R09-001 · l allarme dell email ferma sa quando può essere arrivata', () => {
  it('spedita senza segno la prima notte, caduta la seconda: l allarme dice «può essere arrivata»', async () => {
    const giro = laNotte();
    giro.guasti.push({
      tabella: 'audit_logs', azione: 'insert', messaggio: 'canceling statement due to statement timeout',
      seRiga: (r: Record<string, unknown>) => r.action === EMAIL_PARTITA,
    });
    await unaNotte(0);
    giro.guasti.splice(0, giro.guasti.length);
    mondo.posta = false;
    await unaNotte(1);
    const a = allarmi(giro);
    expect(a, 'un allarme per l amministratore').toHaveLength(1);
    expect(String(a[0].body)).toMatch(/può essere arrivata/);
    expect(String(a[0].body)).not.toMatch(/non è partita per email/);
  });

  it('due notti di posta che dice di no: l allarme dice ancora «non è partita per email»', async () => {
    const giro = laNotte();
    mondo.posta = false;
    await unaNotte(0);
    await unaNotte(1);
    const a = allarmi(giro);
    expect(a).toHaveLength(1);
    expect(String(a[0].body)).toMatch(/non è partita per email/);
    expect(String(a[0].body)).not.toMatch(/può essere arrivata/);
  });
});
