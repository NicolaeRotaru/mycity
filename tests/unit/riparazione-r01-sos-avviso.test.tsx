/**
 * @vitest-environment jsdom
 */
/**
 * R01-004 — L'SOS DEL FATTORINO NON ARRIVAVA DAVVERO A NESSUNO.
 *
 * Il trigger della 037 scrive solo una notifica nel pannello, e il push partiva dal lavoro
 * periodico ogni cinque minuti. Qui si prova la strada nuova, dall'inizio alla fine:
 *  1. il pulsante, scritto l'evento, chiama /api/rider/sos/avvisa;
 *  2. la rotta manda subito un push ad alta urgenza a OGNI amministratore, per l'SOS aperto
 *     di chi chiama (mai di un altro), e rifiuta chi non e' fattorino;
 *  3. il guscio del fattorino passa l'ordine della consegna in corso al pulsante.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const stato = vi.hoisted(() => ({
  insert: vi.fn(),
  getSession: vi.fn(),
  push: vi.fn(),
  profilo: { role: 'rider' as string },
  sos: { id: 'sos-1', order_id: 'ordine-abcdef12-x', triggered_at: '2026-11-12T10:00:00Z' } as Record<string, unknown> | null,
  admin: [{ id: 'admin-1' }, { id: 'admin-2' }],
  filtriSos: [] as Array<[string, unknown]>,
  pathname: '/rider',
  propsSos: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: stato.getSession, getUser: stato.getSession },
    from: () => ({ insert: stato.insert }),
  },
}));
vi.mock('@/lib/analytics/sentry', () => ({ captureError: () => undefined }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, h: (ctx: unknown) => unknown) => (req: Request) =>
    h({ user: { id: 'rider-1' }, profile: { role: stato.profilo.role, is_approved: true }, req }),
}));
vi.mock('@/lib/push/send', () => ({
  isPushConfigured: () => true,
  iscrizioniPerUtenti: async (_s: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, [{ id: `sub-${id}`, endpoint: 'e', p256dh: 'p', auth: 'a' }]])),
  sendPushToUser: stato.push,
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'rider_sos_events') {
        const q = {
          select: () => q,
          eq: (c: string, v: unknown) => { stato.filtriSos.push([c, v]); return q; },
          is: (c: string, v: unknown) => { stato.filtriSos.push([c, v]); return q; },
          gte: () => q,
          order: () => q,
          limit: () => q,
          maybeSingle: async () => ({ data: stato.sos, error: null }),
        };
        return q;
      }
      if (tabella === 'profiles') {
        return { select: () => ({ eq: async () => ({ data: stato.admin, error: null }) }) };
      }
      throw new Error(`tabella inattesa ${tabella}`);
    },
  }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => stato.pathname }));

import { POST } from '@/app/api/rider/sos/avvisa/route';
import SOSButton from '@/components/rider/SOSButton';

const accesi: Root[] = [];
beforeEach(() => {
  stato.profilo.role = 'rider';
  stato.filtriSos = [];
  stato.push.mockReset();
  stato.push.mockResolvedValue({ delivered: 1, total: 1 });
});
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const chiama = () => (POST as unknown as (r: Request) => Promise<Response>)(new Request('http://x/api/rider/sos/avvisa', { method: 'POST' }));

describe('R01-004 · la rotta dell\'SOS manda subito il push agli amministratori', () => {
  it('un SOS aperto fa partire un push ad alta urgenza per ogni amministratore', async () => {
    const r = await chiama();
    expect(r.status).toBe(200);
    expect(stato.push).toHaveBeenCalledTimes(2);
    const destinatari = stato.push.mock.calls.map((c) => c[1]).sort();
    expect(destinatari).toEqual(['admin-1', 'admin-2']);
    const [, , payload, iscrizioni, consegna] = stato.push.mock.calls[0];
    expect(payload).toMatchObject({ url: '/admin/sos', tag: 'sos-sos-1' });
    expect(String(payload.body)).toMatch(/consegna #ordine-a/);
    expect(iscrizioni).toHaveLength(1);
    expect(consegna).toMatchObject({ urgency: 'high' });
    // L'SOS si cerca per CHI chiama, e solo fra quelli aperti.
    expect(stato.filtriSos).toContainEqual(['rider_id', 'rider-1']);
    expect(stato.filtriSos).toContainEqual(['resolved_at', null]);
  });

  it('chi non e\' fattorino non fa suonare nessun telefono', async () => {
    stato.profilo.role = 'buyer';
    const r = await chiama();
    expect(r.status).toBe(403);
    expect(stato.push).not.toHaveBeenCalled();
  });

  it('senza un SOS aperto negli ultimi minuti non parte niente', async () => {
    const prima = stato.sos;
    stato.sos = null;
    const r = await chiama();
    stato.sos = prima;
    expect(r.status).toBe(404);
    expect(stato.push).not.toHaveBeenCalled();
  });
});

describe('R01-004 · il pulsante e il guscio del fattorino', () => {
  it('scritto l\'evento, il pulsante chiama la rotta dell\'avviso immediato', async () => {
    const fetchFinto = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchFinto);
    stato.getSession.mockResolvedValue({ data: { session: { user: { id: 'rider-1' } } } });
    stato.insert.mockResolvedValue({ error: null });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 45, longitude: 9 } }) },
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never);
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    accesi.push(root);
    await act(async () => { root.render(createElement(SOSButton, { orderId: 'ordine-1' })); });
    await act(async () => { radice.querySelector<HTMLButtonElement>('button[aria-label="SOS emergenza"]')!.click(); });
    const conferma = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => /Conferma SOS/.test(b.textContent ?? ''));
    await act(async () => { conferma!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(stato.insert.mock.calls[0][0]).toMatchObject({ order_id: 'ordine-1' });
    expect(fetchFinto).toHaveBeenCalledWith('/api/rider/sos/avvisa', expect.objectContaining({ method: 'POST' }));
  });
});
