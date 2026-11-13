import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R22-007 — L'«annulla iscrizione» con un clic di Gmail non si perde dopo 30 richieste in dieci
 * minuti dallo stesso indirizzo IP. La rotta vera, i gettoni veri, il freno vero (in memoria);
 * finta solo la funzione del database `disiscrivi`.
 */
const disiscritti: string[] = [];
const rpc = vi.fn(async (_nome: string, args: { p_email: string }) => {
  disiscritti.push(args.p_email);
  return { data: { ok: true, newsletter: 0, profilo: 1 }, error: null };
});
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({ rpc }) }));
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));

import { POST } from '@/app/api/unsubscribe/route';
import { firmaDisiscrizione } from '@/lib/email/unsubscribe';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

/** Il server di posta di Google: sempre lo stesso indirizzo, corpo «List-Unsubscribe=One-Click». */
function conUnClic(token: string) {
  return POST(new Request(`https://mycity.example/api/unsubscribe?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'x-forwarded-for': '209.85.220.41', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  }));
}

beforeEach(() => {
  __resetRateLimitBuckets();
  disiscritti.length = 0;
  rpc.mockClear();
  logger.error.mockClear();
});

describe('quaranta persone premono «Annulla iscrizione» in Gmail nello stesso quarto d\'ora', () => {
  it('tutte e quaranta vengono disiscritte, anche se le richieste arrivano dallo stesso server di Google', async () => {
    const esiti: string[] = [];
    for (let i = 1; i <= 40; i++) {
      const r = await conUnClic(firmaDisiscrizione(`persona${i}@gmail.com`, 'marketing'));
      esiti.push(String(r.headers.get('location')));
    }
    expect(disiscritti, 'dalla 31ª il consenso è rimasto acceso').toHaveLength(40);
    expect(esiti.every((e) => e.endsWith('disiscrizione=fatta'))).toBe(true);
  });

  it('lo stesso gettone ripetuto a raffica smette di chiamare il database, e lo scrive nei log', async () => {
    const token = firmaDisiscrizione('mario@gmail.com', 'marketing');
    for (let i = 0; i < 30; i++) await conUnClic(token);
    expect(disiscritti).toHaveLength(30);
    const r = await conUnClic(token);
    expect(disiscritti).toHaveLength(30);
    expect(r.headers.get('location')).toContain('disiscrizione=non-riuscita');
    expect(logger.error, 'una disiscrizione fermata non lascia traccia').toHaveBeenCalled();
  });

  it('controprova: senza gettone valido il freno per indirizzo IP resta', async () => {
    for (let i = 0; i < 30; i++) {
      const r = await conUnClic('v2.gettone-falso');
      expect(r.headers.get('location')).toContain('disiscrizione=link-non-valido');
    }
    const r = await conUnClic('v2.gettone-falso');
    expect(r.headers.get('location')).toContain('disiscrizione=non-riuscita');
    expect(rpc).not.toHaveBeenCalled();
  });
});
