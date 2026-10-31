/**
 * 31/10/2026 — IL FILTRO ANTIVIRUS DELLA POSTA NON DEVE USARE IL LINK AL POSTO
 * DELLA PERSONA.
 *
 * I filtri delle caselle aziendali (Microsoft 365 con la protezione dei link,
 * i gateway antivirus) aprono ogni link in anteprima con una GET. I link di
 * Supabase sono monouso: se la GET di /auth/confirm chiamava `verifyOtp`, il
 * link era gia' consumato quando la persona cliccava, e lei leggeva «link
 * scaduto». Qui: la GET mostra un pulsante, il POST del pulsante consuma il link.
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

import { GET, POST } from '@/app/auth/confirm/route';

function apri(percorso: string, chi = 'filtro-antivirus'): NextRequest {
  return new NextRequest(`${APP}${percorso}`, { headers: { 'user-agent': chi } });
}

function premi(campi: Record<string, string>, origine: string | null = APP): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'lucia' };
  if (origine) headers.origin = origine;
  return new NextRequest(`${APP}/auth/confirm`, { method: 'POST', headers, body: new URLSearchParams(campi).toString() });
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

  it('il filtro apre, la persona apre, poi preme il pulsante: entra, e il link si usa una volta sola', async () => {
    linkValidi.set('pkce_cccc3333dddd4444', { id: 'marta', email: 'marta@studio.it' });
    await GET(apri('/auth/confirm?token_hash=pkce_cccc3333dddd4444&type=signup&next=%2Fcheckout'));
    const pagina = await GET(apri('/auth/confirm?token_hash=pkce_cccc3333dddd4444&type=signup&next=%2Fcheckout', 'marta'));
    const res = await POST(premi(campiDelModulo(await pagina.text())));

    expect(chiamateVerifyOtp).toEqual([{ token_hash: 'pkce_cccc3333dddd4444', type: 'signup' }]);
    expect(res.status, 'dopo un POST serve 303, o il browser rimanda il POST alla destinazione').toBe(303);
    const dove = new URL(res.headers.get('location') ?? '');
    expect(dove.origin).toBe(APP);
    expect(dove.pathname).toBe('/checkout');
    expect(sessioneScritta(res)).toBeTruthy();
  });

  it('il link della password: dopo il pulsante si va sempre a /reset-password, con la sessione', async () => {
    linkValidi.set('pkce_eeee5555ffff6666', { id: 'lucia', email: 'lucia@studio.it' });
    const pagina = await GET(apri('/auth/confirm?token_hash=pkce_eeee5555ffff6666&type=recovery&next=https://sito-truffa.it/x'));
    const res = await POST(premi(campiDelModulo(await pagina.text())));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/reset-password');
    expect(sessioneScritta(res)).toBeTruthy();
  });

  it('un modulo spedito da un altro sito non apre nessuna sessione', async () => {
    linkValidi.set('pkce_gggg7777hhhh8888', { id: 'attaccante', email: 'x@truffa.it' });
    const res = await POST(premi({ token_hash: 'pkce_gggg7777hhhh8888', type: 'signup', next: '/' }, 'https://sito-truffa.it'));
    expect(chiamateVerifyOtp).toEqual([]);
    expect(sessioneScritta(res)).toBeUndefined();
    expect(res.status).toBe(303);
  });

  it('un modulo manomesso (token con caratteri estranei) non arriva nemmeno a Supabase', async () => {
    const res = await POST(premi({ token_hash: 'abc"><script>x</script>', type: 'signup' }));
    expect(chiamateVerifyOtp).toEqual([]);
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location') ?? '').searchParams.get('error')).toBe('link_non_valido');
  });

  it('un link gia usato, dopo il pulsante, dice «link scaduto» e non apre sessioni', async () => {
    const res = await POST(premi({ token_hash: 'pkce_giausatogiausato', type: 'signup' }));
    expect(chiamateVerifyOtp).toHaveLength(1);
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location') ?? '').searchParams.get('error')).toBe('link_scaduto');
    expect(sessioneScritta(res)).toBeUndefined();
  });

  it('la pagina col pulsante non si lascia iniettare HTML dal `next` del link', async () => {
    const res = await GET(apri('/auth/confirm?token_hash=pkce_iiii9999jjjj0000&type=signup&next=%2Fcheckout%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E'));
    const html = await res.text();
    expect(html).not.toMatch(/<script/i);
  });
});
