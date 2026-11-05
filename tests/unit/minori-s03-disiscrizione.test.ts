import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

/** S03 — la disiscrizione chiede conferma e dice com'è andata (schede 503, 421). */
const rpcMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({ rpc: rpcMock }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { GET, POST } from '@/app/api/unsubscribe/route';
import { firmaDisiscrizione } from '@/lib/email/unsubscribe';

const TOKEN = firmaDisiscrizione('maria@example.it', 'marketing');
const url = `https://x.test/api/unsubscribe?token=${encodeURIComponent(TOKEN)}`;

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('disiscrizione', () => {
  it('503 — aprire il link (GET, come un antivirus) non disiscrive: porta alla conferma', async () => {
    const r = await GET(new Request(url, { headers: { 'x-forwarded-for': '198.51.100.1' } }));
    expect(rpcMock).not.toHaveBeenCalled();
    expect(r.headers.get('location')).toMatch(/\/disiscrizione\?token=/);
  });

  it('503 — la POST (pulsante «Conferma» o «con un clic») disiscrive', async () => {
    const r = await POST(new Request(url, { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.2' } }));
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(303);
  });

  it('503 (revisore) — la pagina dell esito si apre sullo stesso indirizzo della richiesta (form-action self)', async () => {
    const r = await POST(new Request(`https://anteprima.example.test/api/unsubscribe?token=${encodeURIComponent(TOKEN)}`, { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.4' } }));
    expect(r.headers.get('location')).toMatch(/^https:\/\/anteprima\.example\.test\/disiscrizione\?/);
  });

  it('421 — l esito porta a una pagina che lo legge, non alla home', async () => {
    const r = await POST(new Request(url, { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.3' } }));
    expect(r.headers.get('location')).toMatch(/\/disiscrizione\?disiscrizione=fatta$/);
    const pagina = readFileSync('app/disiscrizione/page.tsx', 'utf8');
    for (const esito of ['fatta', 'non-trovato', 'non-riuscita', 'link-non-valido']) {
      expect(pagina).toContain(esito.includes('-') ? `'${esito}':` : `${esito}:`);
    }
    expect(pagina).toMatch(/<form method="post" action=\{`\/api\/unsubscribe\?token=/);
  });
});
