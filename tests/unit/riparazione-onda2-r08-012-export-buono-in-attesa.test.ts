import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R08-012 (onda 2) — «Scarica i miei dati» legge anche i buoni regalo comprati e non ancora pagati
 * (gift_card_in_attesa, migrazione 999j): lì stanno nome, email e messaggio del destinatario scritti
 * da chi compra. Finché la migrazione non è applicata la tabella non c'è: la sezione esce vuota (è la
 * verità) e il file non si dichiara incompleto per questo. Un guasto vero resta un guasto.
 */

const UTENTE = { id: 'user-123', email: 'marco@example.com' };

vi.mock('@/lib/api/middleware', () => ({
  withAuth: (h: (c: { user: typeof UTENTE }) => unknown) => () => h({ user: UTENTE }),
  withAuthRateLimit: (_o: unknown, h: (c: { user: typeof UTENTE }) => unknown) => () => h({ user: UTENTE }),
}));

const risposte: Record<string, { data: unknown; error: unknown }> = {};
function catena(tabella: string) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'or', 'single', 'update', 'insert', 'order', 'limit', 'range']) {
    c[m] = vi.fn(() => (m === 'single' ? Promise.resolve(risposte[tabella] ?? { data: null, error: null }) : c));
  }
  (c as { then?: unknown }).then = (ok: (v: unknown) => void) => ok(risposte[tabella] ?? { data: [], error: null });
  return c;
}
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({ from: vi.fn((t: string) => catena(t)), auth: { admin: {} } })),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { GET } from '@/app/api/account/export/route';

async function scarica() {
  const res = await (GET as unknown as () => Promise<Response>)();
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  for (const k of Object.keys(risposte)) delete risposte[k];
});

describe('R08-012 · l\'export e il buono regalo in attesa', () => {
  it('il buono non ancora pagato esce nel file, senza la chiave tecnica del tentativo', async () => {
    risposte.gift_card_in_attesa = {
      data: [{ id: 'a1', amount_cents: 2500, recipient_name: 'Chiara', recipient_email: 'chiara@example.com', message: 'Auguri', created_at: '2026-11-28T10:00:00Z' }],
      error: null,
    };
    const corpo = await scarica();
    expect(corpo.buoni_regalo_in_attesa).toEqual([expect.objectContaining({ recipient_name: 'Chiara', amount_cents: 2500 })]);
  });

  it('senza la tabella (migrazione non applicata): sezione vuota e file completo', async () => {
    risposte.gift_card_in_attesa = { data: null, error: { code: '42P01', message: 'relation "public.gift_card_in_attesa" does not exist' } };
    const corpo = await scarica();
    expect(corpo.buoni_regalo_in_attesa).toEqual([]);
    expect((corpo.export_metadata as { export_completo: boolean }).export_completo).toBe(true);
  });

  it('un guasto vero resta un guasto: sezione null e file incompleto', async () => {
    risposte.gift_card_in_attesa = { data: null, error: { code: '57P01', message: 'connessione caduta' } };
    const corpo = await scarica();
    expect(corpo.buoni_regalo_in_attesa).toBeNull();
    expect((corpo.export_metadata as { export_completo: boolean }).export_completo).toBe(false);
  });
});
