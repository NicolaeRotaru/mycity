/**
 * 31/10/2026 — IL FILTRO ANTIVIRUS DELLA POSTA NON DEVE USARE IL LINK AL POSTO
 * DELLA PERSONA.
 *
 * I filtri delle caselle aziendali (Microsoft 365 con la protezione dei link,
 * i gateway antivirus) aprono ogni link in anteprima con una GET. I link di
 * Supabase sono monouso: se la GET di /auth/confirm chiamava `verifyOtp`, il
 * link era gia' consumato quando la persona cliccava, e lei leggeva «link
 * scaduto». Qui: la GET mostra un pulsante, il POST del pulsante consuma il link.
 *
 * Questo file prova solo l'apertura (GET), quella che fa il filtro; il pulsante
 * (POST) e' provato in il-link-di-conferma-non-lo-brucia-l-antivirus.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const APP = 'https://mycity.test';

vi.mock('@/lib/env', () => ({
  env: { appUrl: () => 'https://mycity.test' },
  requireSupabasePublic: () => ({ url: 'https://progetto.supabase.test', key: 'chiave-anonima' }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({}) }));
vi.mock('@/lib/auth/accettazione-testi', () => ({
  versioneAccettata: () => '2026-10',
  verbalizzaSenzaTrattenere: async () => 'scritta',
  vaChiestaSenzaTrattenere: async () => 'non-chiedere',
}));

const COOKIE_SESSIONE = 'sb-progetto-auth-token';
/** I token_hash ancora buoni: Supabase li cancella al primo uso. */
const linkValidi = new Map<string, { id: string; email: string }>();
const chiamateVerifyOtp: Array<{ token_hash: string; type: string }> = [];

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _u: string,
    _k: string,
    { cookies }: { cookies: { set(n: string, v: string, o: Record<string, unknown>): void } },
  ) => ({
    auth: {
      async verifyOtp(p: { token_hash: string; type: string }) {
        chiamateVerifyOtp.push(p);
        const utente = linkValidi.get(p.token_hash);
        if (!utente) {
          return { data: { user: null, session: null }, error: { code: 'otp_expired', message: 'Email link is invalid or has expired' } };
        }
        linkValidi.delete(p.token_hash); // monouso, come quello vero
        cookies.set(COOKIE_SESSIONE, `sessione-di-${utente.id}`, { path: '/' });
        return { data: { user: { ...utente, user_metadata: {}, app_metadata: {} }, session: { access_token: 'a' } }, error: null };
      },
    },
  }),
}));

import { GET } from '@/app/auth/confirm/route';

function apri(percorso: string, chi = 'filtro-antivirus'): NextRequest {
  return new NextRequest(`${APP}${percorso}`, { headers: { 'user-agent': chi } });
}

/** I campi nascosti del modulo, come li rimanderebbe il browser. */
function campiDelModulo(html: string): Record<string, string> {
  const campi: Record<string, string> = {};
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) {
    campi[m[1]] = m[2].replace(/&#(\d+);/g, (_t, n) => String.fromCharCode(Number(n)));
  }
  return campi;
}

function sessioneScritta(res: Response): string | undefined {
  const tutti = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''];
  return tutti.find((c) => c.startsWith(`${COOKIE_SESSIONE}=`) && !c.startsWith(`${COOKIE_SESSIONE}=;`));
}

beforeEach(() => {
  linkValidi.clear();
  chiamateVerifyOtp.length = 0;
});

describe('il filtro della posta apre il link prima della persona', () => {
  it('IL CASO CHE ROMPEVA — aprire il link non lo consuma: niente verifyOtp, niente sessione, solo il pulsante', async () => {
    linkValidi.set('pkce_aaaa1111bbbb2222', { id: 'marta', email: 'marta@studio.it' });
    const res = await GET(apri('/auth/confirm?token_hash=pkce_aaaa1111bbbb2222&type=signup&next=%2Fcheckout'));

    expect(chiamateVerifyOtp, 'la GET del filtro ha bruciato il link monouso').toEqual([]);
    expect(linkValidi.has('pkce_aaaa1111bbbb2222')).toBe(true);
    expect(sessioneScritta(res)).toBeUndefined();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const html = await res.text();
    expect(html).toMatch(/<form method="post" action="\/auth\/confirm">/);
    expect(campiDelModulo(html)).toEqual({ token_hash: 'pkce_aaaa1111bbbb2222', type: 'signup', next: '/checkout' });
  });

  it('la pagina col pulsante non si lascia iniettare HTML dal `next` del link', async () => {
    const res = await GET(apri('/auth/confirm?token_hash=pkce_iiii9999jjjj0000&type=signup&next=%2Fcheckout%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E'));
    const html = await res.text();
    expect(html).not.toMatch(/<script/i);
  });
});
