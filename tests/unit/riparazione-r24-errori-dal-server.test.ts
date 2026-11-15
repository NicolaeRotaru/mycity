import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 13/11/2026 (R24-007) — GLI ERRORI DEL MODULO CONTATTI, CONTROLLATI DAL SERVER, IN ITALIANO.
 *
 * Il traduttore italiano di Zod (lib/zod-i18n) era acceso solo nel browser, da
 * QueryProvider. Sul server la rotta dei contatti rimandava il testo predefinito
 * inglese per ogni controllo senza messaggio suo: un campo mancante («Required»), un
 * tipo sbagliato («Expected string, received number»).
 *
 * ⚠️ Questo file non importa lib/errors né lib/zod-i18n: se lo facesse, il traduttore
 * si accenderebbe per tutto il processo e la prova non guarderebbe più la rotta.
 */

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({ from: vi.fn(() => ({ insert: vi.fn(async () => ({ error: null })) })) })),
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

import { POST } from '@/app/api/contact/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const manda = (corpo: unknown, ip: string) =>
  POST(
    new Request('http://localhost/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(corpo),
    }),
  );

describe('la rotta dei contatti risponde in italiano anche ai controlli senza messaggio suo', () => {
  beforeEach(() => __resetRateLimitBuckets());

  it('IL CASO CHE ROMPEVA — il nome mancante non torna come «Required»', async () => {
    const r = await manda({ email: 'mario@example.com', message: 'Un messaggio abbastanza lungo.' }, '7.0.0.1');
    expect(r.status).toBe(400);
    const corpo = await r.json();
    expect(corpo.error.message).not.toMatch(/Required/);
    expect(corpo.error.message).toBe('Campo obbligatorio');
  });

  it('un tipo sbagliato non torna come «Expected string, received number»', async () => {
    const r = await manda({ name: 12345, email: 'mario@example.com', message: 'Un messaggio abbastanza lungo.' }, '7.0.0.2');
    const corpo = await r.json();
    expect(corpo.error.message).not.toMatch(/Expected|received/);
    expect(corpo.error.message).toBe('Valore non valido: serve un testo');
  });

  it('i messaggi scritti a mano nello schema restano quelli', async () => {
    const r = await manda({ name: 'A'.repeat(121), email: 'mario@example.com', message: 'Un messaggio abbastanza lungo.' }, '7.0.0.3');
    expect((await r.json()).error.message).toBe('Nome troppo lungo: massimo 120 caratteri');
  });
});
