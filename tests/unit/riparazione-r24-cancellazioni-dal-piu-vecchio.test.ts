/**
 * R24-005 — IL TETTO DELLA NOTTE LASCIAVA INDIETRO GLI ACCOUNT NELL'ORDINE DELLA RPC.
 *
 * `process_expired_deletions` non ordina. Il giro prende un account dopo l'altro finché non arriva
 * al tetto di tempo, e chi resta fuori non entra nei tentativi: chi era già oltre il mese poteva
 * stare in fondo alla lista ogni notte, senza che né lui né gli amministratori ricevessero l'avviso
 * del termine scaduto. Adesso si comincia da chi ha chiesto da più tempo.
 *
 * Orologio finto: ogni account «dura» un minuto, quindi stanotte se ne prendono tre su cinque.
 * Supabase finto (in memoria): nessun database vero.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

const mondo = vi.hoisted(() => ({ admin: null as unknown, presi: [] as string[] }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/account/cancellazione', () => ({
  // Un rinvio deciso da noi (contanti da versare): l'account resta e la notte deve dire perché.
  cancellaAccount: vi.fn(async (_admin: unknown, userId: string) => {
    mondo.presi.push(userId);
    vi.setSystemTime(Date.now() + 60_000);
    return { ok: false, motivo: 'cassa_da_versare', errore: 'contanti da versare', fileRimossi: 0, erroriFile: [] };
  }),
}));

import { POST } from '@/app/api/cron/process-deletions/route';

const ADESSO = new Date('2026-11-26T04:00:00+01:00').getTime();
const giorniFa = (g: number) => new Date(ADESSO - g * 86_400_000).toISOString();
const utente = (n: number) => `00000000-0000-4000-8000-00000000002${n}`;

// L'ordine in cui la RPC li restituisce: i due oltre il mese stanno in mezzo e in fondo.
const SCADUTE = [
  { user_id: utente(1), deleted_at: giorniFa(8) },
  { user_id: utente(2), deleted_at: giorniFa(9) },
  { user_id: utente(3), deleted_at: giorniFa(40) },
  { user_id: utente(4), deleted_at: giorniFa(10) },
  { user_id: utente(5), deleted_at: giorniFa(45) },
];

function laNotte() {
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [
        { id: 'admin-1', role: 'admin' },
        ...SCADUTE.map((r) => ({ id: r.user_id, role: 'rider', deletion_requested_at: r.deleted_at })),
      ],
      notifications: [],
      audit_logs: [],
      cron_heartbeats: [],
      cod_reconciliations: [],
    },
    rpc: { process_expired_deletions: { data: SCADUTE, error: null } },
  });
  mondo.admin = giro.admin;
  return giro;
}

const unGiro = () =>
  POST(
    new Request('http://localhost/api/cron/process-deletions?a_mano=1&cancella=1', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  mondo.presi = [];
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R24-005 · il tetto della notte lascia indietro i più recenti, non chi capita in fondo alla RPC', () => {
  it('con tre posti su cinque passano i tre che aspettano da più tempo, dal più vecchio', async () => {
    laNotte();
    const r = await unGiro();
    const corpo = (await r.json()) as { rimandateAlGiroDopo?: number; scadute?: number };

    expect(mondo.presi, 'il giro ha seguito l’ordine della RPC invece di partire da chi aspetta da più tempo').toEqual([
      utente(5),
      utente(3),
      utente(4),
    ]);
    expect(corpo.rimandateAlGiroDopo).toBe(2);
  });

  it('chi è già oltre il mese entra nei tentativi: il termine scaduto si dice per tutti e due', async () => {
    const giro = laNotte();
    const r = await unGiro();
    const corpo = (await r.json()) as { scadute?: number };

    expect(corpo.scadute, 'qualcuno oltre il mese è rimasto fuori dal giro, senza avviso del termine').toBe(2);
    const termini = giro
      .righe('notifications')
      .filter((n) => n.user_id === utente(3) || n.user_id === utente(5))
      .map((n) => n.user_id);
    expect(new Set(termini)).toEqual(new Set([utente(3), utente(5)]));
  });
});
