import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * R07-010 (12/11/2026) — la pagina che si apre dal link di conferma email non
 * sembrava MyCity: niente nome, carattere di sistema, bottone verde. Prova
 * leggera sull'HTML che la GET restituisce.
 */
vi.mock('@/lib/env', () => ({
  env: { appUrl: () => 'https://mycity.test' },
  requireSupabasePublic: () => ({ url: 'https://progetto.supabase.test', key: 'chiave-anonima' }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({}) }));
vi.mock('@/lib/auth/accettazione-testi', () => ({
  versioneAccettata: () => '2026-10',
  verbalizzaSenzaTrattenere: async () => 'scritta',
  vaChiestaSenzaTrattenere: async () => 'non-chiedere',
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: {} }) }));

import { GET } from '@/app/auth/confirm/route';

async function pagina(tipo: string) {
  const res = await GET(new NextRequest(`https://mycity.test/auth/confirm?token_hash=pkce_aaaa1111bbbb2222&type=${tipo}&next=%2F`));
  expect(res.status).toBe(200);
  return res.text();
}

describe('R07-010 · la pagina della conferma email ha il marchio MyCity', () => {
  it.each(['signup', 'recovery'])('%s: nome in testa, colori del marchio, niente verde né carattere di sistema da solo', async (tipo) => {
    const html = await pagina(tipo);
    const corpo = html.slice(html.indexOf('<body'));
    expect(corpo).toMatch(/>MyCity</);
    expect(corpo).toContain('#C0492C');
    expect(corpo).toContain('#FBF7F0');
    expect(corpo).not.toContain('#1f6f43');
    expect(corpo).not.toMatch(/font-family:system-ui,sans-serif/);
    expect(corpo).toContain('così');
    expect(corpo).not.toContain("cosi'");
  });
});
