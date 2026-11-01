import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * LA ROTTA /api/segnalazioni MANDA L'ESITO DECISO.
 *
 * 1/11/2026 — L'amministratore registrava decisione e motivazione, ma la rotta
 * delle segnalazioni non aveva nessun modo di comunicarle: chi aveva segnalato
 * e il venditore non ricevevano niente (regolamento sui servizi digitali, art.
 * 16.5 e 17). Questa prova chiama la rotta come la chiamera' la pagina admin.
 * Se la rotta non gestisce PATCH, risponde 405 come fa Next.js: nessuna email,
 * nessuna notifica, e la prova lo vede.
 */
const email: Array<{ to: string; text?: string }> = [];
const notifiche: Array<Record<string, unknown>> = [];
let riga: Record<string, unknown> | null;

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string; text?: string }) => { email.push(m); return { ok: true, id: 'em-1' }; },
}));
vi.mock('@/lib/api/middleware', () => ({
  // l'amministratore e' gia' autenticato: qui si prova cosa fa la rotta dopo
  withAdminAuth: (h: (a: { req: NextRequest }) => Promise<NextResponse>) => (req: NextRequest) => h({ req }),
}));

const admin = {
  from: (tabella: string) => {
    if (tabella === 'segnalazioni') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: riga, error: null }) }) }) };
    }
    if (tabella === 'products') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { seller_id: 'venditore-1' }, error: null }) }) }) };
    }
    if (tabella === 'notifications') {
      return { insert: async (r: Record<string, unknown>) => { notifiche.push(r); return { error: null }; } };
    }
    throw new Error(`tabella inattesa ${tabella}`);
  },
};
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => admin, getServerSupabase: async () => admin }));

const ID = '00000000-0000-4000-8000-000000000042';
const MOTIVAZIONE = 'Il prodotto riporta un marchio non autorizzato e viene rimosso.';

async function chiamaPatch(corpo: unknown): Promise<Response> {
  const rotta = (await import('@/app/api/segnalazioni/route')) as Record<string, unknown>;
  const req = new NextRequest('http://localhost/api/segnalazioni', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
  });
  const gestore = rotta.PATCH as ((r: NextRequest) => Promise<Response>) | undefined;
  // Next.js risponde 405 quando la rotta non esporta il metodo
  return gestore ? gestore(req) : new Response(null, { status: 405 });
}

describe('PATCH /api/segnalazioni', () => {
  beforeEach(() => {
    email.length = 0;
    notifiche.length = 0;
    riga = {
      id: ID, tipo: 'prodotto', oggetto_id: 'prod-1', motivo: 'contraffatto',
      segnalante_id: 'utente-1', email_contatto: 'chi@segnala.it',
      stato: 'accolta', esito_motivato: MOTIVAZIONE,
    };
  });

  it('a decisione registrata, la motivazione arriva a chi ha segnalato e al venditore', async () => {
    const res = await chiamaPatch({ id: ID });
    expect(res.status).toBe(200);
    expect(email.map((m) => m.to)).toEqual(['chi@segnala.it']);
    expect(email[0].text).toContain(MOTIVAZIONE);
    expect(notifiche.map((n) => n.user_id).sort()).toEqual(['utente-1', 'venditore-1']);
  });

  it('senza decisione non parte niente e la rotta lo dice', async () => {
    riga = { ...riga!, stato: 'in_esame', esito_motivato: null };
    const res = await chiamaPatch({ id: ID });
    expect(res.status).toBe(409);
    expect(email).toHaveLength(0);
    expect(notifiche).toHaveLength(0);
  });
});
