/**
 * 1/11/2026 — IL RIENTRO COL LINK DI RECUPERO: IL SEGNO LO METTE IL SERVER.
 *
 * /auth/confirm, dopo un verifyOtp di tipo recovery riuscito, lascia un
 * biscotto httpOnly firmato e legato alla sessione appena aperta. /auth/recupero
 * risponde sì solo per quella sessione. Una conferma d'iscrizione non lascia
 * nessun segno, e un segno di un'altra sessione non vale.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const APP = 'https://mycity.test';

vi.mock('@/lib/env', () => ({
  env: { appUrl: () => 'https://mycity.test' },
  requireSupabasePublic: () => ({ url: 'https://progetto.supabase.test', key: 'chiave-anonima' }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

function gettone(sessione: string): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256' })}.${b({ sub: 'u1', session_id: sessione, amr: [{ method: 'otp', timestamp: 1 }] })}.firma`;
}

let sessioneDiAdesso = 'sessione-del-link';
const utente = { id: 'u1', email: 'maria@example.com', created_at: '2026-10-01T00:00:00Z', user_metadata: { tos_version: 'v1' }, app_metadata: {} };

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      const fine = async () => ({ data: null, error: null });
      for (const k of ['select', 'eq', 'order', 'limit', 'insert', 'update', 'upsert']) q[k] = () => q;
      q.maybeSingle = fine;
      q.single = fine;
      q.then = (r: (v: unknown) => unknown) => r({ data: null, error: null });
      return q;
    },
  }),
  getServerSupabase: async () => ({
    auth: {
      getUser: async () => ({ data: { user: utente }, error: null }),
      getSession: async () => ({ data: { session: { access_token: gettone(sessioneDiAdesso) } } }),
    },
  }),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      async verifyOtp(p: { token_hash: string; type: string }) {
        if (p.token_hash !== 'hash-valido-0123456789') return { data: { user: null, session: null }, error: { code: 'otp_expired' } };
        return { data: { user: utente, session: { access_token: gettone('sessione-del-link'), refresh_token: 'r' } }, error: null };
      },
    },
  }),
}));

import { POST as premiIlPulsante } from '@/app/auth/confirm/route';
import { GET as chiediIlSegno } from '@/app/auth/recupero/route';
import { BISCOTTO_RECUPERO } from '@/lib/auth/segno-recupero';

async function conferma(tipo: string, hash = 'hash-valido-0123456789'): Promise<Response> {
  const campi = new URLSearchParams({ token_hash: hash, type: tipo });
  return premiIlPulsante(
    new NextRequest(`${APP}/auth/confirm`, {
      method: 'POST',
      headers: { origin: APP, 'content-type': 'application/x-www-form-urlencoded' },
      body: campi.toString(),
    }),
  );
}

function segnoLasciato(r: Response): string | null {
  for (const riga of r.headers.getSetCookie()) {
    if (riga.startsWith(`${BISCOTTO_RECUPERO}=`)) return riga;
  }
  return null;
}

async function ilServerDice(biscotto: string | null): Promise<boolean> {
  const headers: Record<string, string> = {};
  if (biscotto) headers.cookie = biscotto.split(';')[0];
  const r = await chiediIlSegno(new NextRequest(`${APP}/auth/recupero`, { headers }));
  return ((await r.json()) as { recupero: boolean }).recupero;
}

beforeEach(() => {
  process.env.RECUPERO_PASSWORD_SECRET = 'segreto-di-prova';
  sessioneDiAdesso = 'sessione-del-link';
});

describe('il rientro col link di recupero passato da /auth/confirm', () => {
  it('dopo il verifyOtp di tipo recovery il server lascia il segno, httpOnly, e lo riconosce', async () => {
    const r = await conferma('recovery');
    const segno = segnoLasciato(r);
    expect(segno, 'nessun segno del recupero dopo il link').not.toBeNull();
    expect(segno!.toLowerCase()).toContain('httponly');
    expect(await ilServerDice(segno)).toBe(true);
  });

  it('la conferma dell\'iscrizione non lascia nessun segno', async () => {
    expect(segnoLasciato(await conferma('signup'))).toBeNull();
  });

  it('un link scaduto non lascia nessun segno', async () => {
    expect(segnoLasciato(await conferma('recovery', 'hash-scaduto-0123456789'))).toBeNull();
  });

  it('il segno non vale per un\'altra sessione, né scritto a mano', async () => {
    const segno = segnoLasciato(await conferma('recovery'));
    sessioneDiAdesso = 'un-altra-sessione';
    expect(await ilServerDice(segno)).toBe(false);
    sessioneDiAdesso = 'sessione-del-link';
    expect(await ilServerDice(`${BISCOTTO_RECUPERO}=sessione-del-link.9999999999.firmafinta`)).toBe(false);
    expect(await ilServerDice(null)).toBe(false);
  });
});
