import { describe, it, expect, vi } from 'vitest';

/**
 * R04-006 — Le rotte che rimandano `issues[0].message` (qui admin/categories e chat/messages)
 * rispondevano in inglese ai controlli senza messaggio suo («String must contain at most 60
 * character(s)») perche' il traduttore di Zod (lib/zod-i18n) si accendeva solo nel browser.
 * Adesso lo accende lib/api/responses, che tutte importano.
 *
 * ⚠️ Questo file non importa lib/errors ne' lib/zod-i18n: se lo facesse, il traduttore si
 * accenderebbe per tutto il processo e la prova non guarderebbe piu' le rotte. L'accesso e il
 * database sono finti; le rotte e lib/api/responses sono quelli veri.
 */
vi.mock('@/lib/api/middleware', () => {
  const conUtente = (handler: (c: unknown) => unknown) => (req: Request, ctx?: { params?: unknown }) =>
    handler({ user: { id: 'u1' }, profile: { role: 'admin' }, req, supaUtente: null, params: ctx?.params ?? {} });
  return { withAdminAuth: conUtente, withAuth: conUtente };
});
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: vi.fn(() => ({})), getServerSupabase: vi.fn(async () => ({})) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => undefined) }));

import { POST as creaCategoria } from '@/app/api/admin/categories/route';
import { POST as mandaMessaggio } from '@/app/api/chat/messages/route';

const richiesta = (url: string, corpo: unknown) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

describe('le rotte rispondono in italiano ai controlli senza messaggio proprio', () => {
  it('admin/categories: un nome troppo lungo non torna come «String must contain at most 60 character(s)»', async () => {
    const r = await (creaCategoria as unknown as (q: Request) => Promise<Response>)(
      richiesta('http://localhost/api/admin/categories', { name: 'A'.repeat(61), slug: 'ok' }),
    );
    expect(r.status).toBe(400);
    const m = (await r.json()).error.message as string;
    expect(m).not.toMatch(/String must contain|character/);
    expect(m).toBe('Massimo 60 caratteri');
  });

  it('admin/categories: un nome vuoto diventa «Campo obbligatorio»', async () => {
    const r = await (creaCategoria as unknown as (q: Request) => Promise<Response>)(
      richiesta('http://localhost/api/admin/categories', { name: '', slug: 'ok' }),
    );
    expect((await r.json()).error.message).toBe('Campo obbligatorio');
  });

  it('chat/messages: una conversazione senza identificativo valido non torna come «Invalid uuid»', async () => {
    const r = await (mandaMessaggio as unknown as (q: Request) => Promise<Response>)(
      richiesta('http://localhost/api/chat/messages', { conversationId: 'non-un-uuid', body: 'Ciao' }),
    );
    expect(r.status).toBe(400);
    const m = (await r.json()).error.message as string;
    expect(m).not.toMatch(/Invalid/i);
    expect(m).toBe('ID non valido');
  });
});
