import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { esameRider } from '@/lib/kyc/esame-rider';

/**
 * S05 · schede 170, 2607, 532, 2664, 2608, 2614, 299 — l'esame di un fattorino.
 */

const stato = vi.hoisted(() => ({ profilo: null as Record<string, unknown> | null }));
const audit = vi.fn(async (_e: unknown) => {});
vi.mock('@/lib/audit', () => ({ writeAudit: (e: unknown) => audit(e) }));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: () => '127.0.0.1' }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      Object.assign(b, { select: () => b, eq: () => b, maybeSingle: async () => ({ data: stato.profilo, error: null }) });
      return b;
    },
    storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://firmato/${p}` } }) }) },
  }),
}));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (c: unknown) => unknown) => async (req: Request) =>
    req.headers.get('x-ruolo') === 'admin'
      ? h({ req, user: { id: 'admin-1' }, params: { id: '00000000-0000-4000-8000-000000000001' } })
      : new Response('Solo admin', { status: 403 }),
}));

const RIDER = {
  id: '00000000-0000-4000-8000-000000000001', role: 'rider', legal_birth_date: '1990-01-01',
  kyc_id_doc_front_url: 'r/fronte.png', kyc_id_doc_back_url: null, kyc_selfie_url: 'r/selfie.png',
  rider_license_url: 'r/patente.png', rider_license_expires_on: '2030-01-01',
  rider_insurance_url: 'r/polizza.png', rider_insurance_expires_on: '2030-01-01',
  rider_haccp_url: 'r/haccp.pdf', rider_haccp_expires_on: '2027-06-01',
  rider_vehicle_type: 'EBIKE', rider_vehicle_plate: null,
};
type H = (r: Request) => Promise<Response>;
const req = (ruolo: string) => new Request('http://x', { headers: { 'x-ruolo': ruolo } });

beforeEach(() => { audit.mockClear(); stato.profilo = { ...RIDER }; });

describe('documenti del fattorino per l’amministratore', () => {
  it('chi non è admin riceve ancora 403', async () => {
    const { GET } = await import('@/app/api/kyc/documenti-rider/[id]/route');
    expect((await (GET as unknown as H)(req('rider'))).status).toBe(403);
    expect(audit).not.toHaveBeenCalled();
  });

  it('170: l’attestato HACCP arriva al pannello, firmato; 2664: arriva anche il veicolo', async () => {
    const { GET } = await import('@/app/api/kyc/documenti-rider/[id]/route');
    const j = (await (await (GET as unknown as H)(req('admin'))).json()) as {
      documenti: Array<{ chiave: string; url: string | null }>; veicolo: { tipo: string };
    };
    expect(j.documenti.find((d) => d.chiave === 'haccp')?.url).toBe('https://firmato/r/haccp.pdf');
    expect(j.veicolo.tipo).toBe('EBIKE');
    // L'HACCP non è obbligatorio: non blocca l'approvazione.
    expect(esameRider(j as never, '2026-11-05').puoApprovare).toBe(true);
    expect(esameRider(j as never, '2026-11-05').documenti.map((d) => d.chiave)).toContain('haccp');
  });

  it('2607: aprire i documenti finisce nel registro come lettura, non come «KYC approvato»', async () => {
    const { GET } = await import('@/app/api/kyc/documenti-rider/[id]/route');
    await (GET as unknown as H)(req('admin'));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'kyc.view' }));
  });

  it('532: guardare codice fiscale e P.IVA non è un’approvazione', async () => {
    const { GET } = await import('@/app/api/admin/users/[id]/kyc/route');
    stato.profilo = { id: RIDER.id, legal_fiscal_code: 'RSSMRA', business_vat_number: null };
    expect((await (GET as unknown as H)(req('buyer'))).status).toBe(403);
    await (GET as unknown as H)(req('admin'));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'kyc.view' }));
    const { etichettaAzioneAudit } = await import('@/lib/audit-azioni');
    expect(etichettaAzioneAudit('kyc.view')).not.toMatch(/approvat/i);
  });
});

describe('pannello utenti (lettura del sorgente)', () => {
  const src = readFileSync('app/admin/users/page.tsx', 'utf8');
  it('2614: il motivo del rifiuto non dice «visibile al venditore» a un fattorino', () => {
    expect(src).not.toContain("'Motivo del rifiuto (visibile al venditore):'");
    expect(src).toMatch(/al fattorino/);
  });
  it('2608: a scheda aperta i link dei documenti si rileggono prima dei 120 secondi', () => {
    expect(src).toMatch(/refetchInterval: 90_000/);
  });
  it('299: le schede mobili usano la stessa regola della tabella (anche i fattorini)', () => {
    expect(src).not.toMatch(/const isSeller\s+= p\.role === 'seller';\s*\n\s*const isPending\s+= isSeller/);
    expect((src.match(/const moderabile\s+= siPuoModerare\(p\.role\)/g) ?? []).length).toBe(2);
  });
});
