import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * S05 · schede 49, 1614, 1615, 2501, 2494 (caricamento) e 36, 1866, 1862, 1865, 1864 (verifica).
 */

const UTENTE = { id: 'utente-1', email: 'u@example.com' };
const stato = vi.hoisted(() => ({
  profilo: {} as Record<string, unknown>,
  erroreLettura: null as null | { message: string; code?: string },
  erroreSalvataggio: null as null | { message: string },
  aggiornamenti: [] as Record<string, unknown>[],
  rimossi: [] as string[],
}));
const audit = vi.fn(async (_e: unknown) => {});
vi.mock('@/lib/audit', () => ({ writeAudit: (e: unknown) => audit(e) }));
const startCheck = vi.fn(async () => ({ ok: true, status: 'PENDING', providerCheckId: 'manual_1' }));
vi.mock('@/lib/kyc/providers', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  // In produzione la verifica è manuale: il fornitore risponde sempre «PENDING».
  getKycProvider: () => ({ startCheck }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, h: (c: unknown) => unknown) => (req: Request) => h({ user: UTENTE, req }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: stato.erroreLettura ? null : { ...stato.profilo }, error: stato.erroreLettura }) }) }),
      update: (patch: Record<string, unknown>) => {
        const q: Record<string, unknown> = {};
        Object.assign(q, {
          eq: () => q, is: () => q, select: () => q,
          then: (ok: (v: unknown) => unknown) => {
            if (stato.erroreSalvataggio) return Promise.resolve({ data: null, error: stato.erroreSalvataggio }).then(ok);
            stato.aggiornamenti.push(patch);
            Object.assign(stato.profilo, patch);
            return Promise.resolve({ data: [{ id: UTENTE.id }], error: null }).then(ok);
          },
        });
        return q;
      },
    }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async (p: string[]) => { stato.rimossi.push(...p); return { data: [], error: null }; },
        createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://firmato/${p}` }, error: null }),
      }),
    },
  }),
}));

function caricamento(kind: string): Request {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const form = new FormData();
  form.set('kind', kind);
  form.set('file', new File([png], 'doc.png', { type: 'image/png' }));
  return new Request('http://x/api/kyc/upload-document', { method: 'POST', body: form });
}
type H = (r: Request) => Promise<Response>;

beforeEach(() => {
  stato.erroreLettura = null; stato.erroreSalvataggio = null; stato.aggiornamenti = []; stato.rimossi = [];
  audit.mockClear();
});

describe('caricamento di un documento', () => {
  it('49: se il database non risponde, non dice «salva la data di nascita»', async () => {
    stato.erroreLettura = { message: 'timeout', code: '57014' };
    const { POST } = await import('@/app/api/kyc/upload-document/route');
    const r = await (POST as unknown as H)(caricamento('id_front'));
    expect(r.status).not.toBe(400);
    expect(JSON.stringify(await r.json())).not.toMatch(/data di nascita/);
  });

  it('1614: un cliente non carica carta d’identità e selfie; un negozio non carica la patente', async () => {
    const { POST } = await import('@/app/api/kyc/upload-document/route');
    stato.profilo = { legal_birth_date: '1980-01-01', role: 'buyer' };
    expect((await (POST as unknown as H)(caricamento('id_front'))).status).toBe(403);
    stato.profilo = { legal_birth_date: '1980-01-01', role: 'seller' };
    expect((await (POST as unknown as H)(caricamento('rider_license'))).status).toBe(403);
  });

  it('1615: l’ingresso del documento lascia una riga nel registro', async () => {
    const { POST } = await import('@/app/api/kyc/upload-document/route');
    stato.profilo = { legal_birth_date: '1980-01-01', role: 'rider', kyc_selfie_url: null };
    expect((await (POST as unknown as H)(caricamento('selfie'))).status).toBe(200);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'kyc.upload', targetId: UTENTE.id }));
  });

  it('2501: un vecchio link firmato salvato al posto del percorso si toglie dal secchio', async () => {
    const { POST } = await import('@/app/api/kyc/upload-document/route');
    stato.profilo = {
      legal_birth_date: '1980-01-01', role: 'rider',
      kyc_id_doc_front_url: `https://x.supabase.co/storage/v1/object/sign/kyc-docs/${UTENTE.id}/id_front-1.png?token=abc`,
    };
    expect((await (POST as unknown as H)(caricamento('id_front'))).status).toBe(200);
    expect(stato.rimossi).toContain(`${UTENTE.id}/id_front-1.png`);
  });

  it('2494: sostituire un documento già verificato riapre la verifica', async () => {
    const { POST } = await import('@/app/api/kyc/upload-document/route');
    stato.profilo = { legal_birth_date: '1980-01-01', role: 'rider', kyc_id_doc_front_url: `${UTENTE.id}/id_front-1.png`, kyc_provider_status: 'APPROVED' };
    expect((await (POST as unknown as H)(caricamento('id_front'))).status).toBe(200);
    expect(stato.profilo.kyc_provider_status).toBeNull();
  });
});

describe('avvio della verifica', () => {
  const VENDITORE = {
    id: UTENTE.id, role: 'seller', legal_first_name: 'Mario', legal_last_name: 'Rossi', legal_fiscal_code: null,
    legal_birth_date: '1980-01-01', business_vat_number: '01234567897', kyc_id_doc_front_url: 'u/f.png',
    kyc_id_doc_back_url: null, kyc_selfie_url: 'u/s.png', rider_license_url: null, rider_insurance_url: null,
    kyc_provider_check_id: null, kyc_provider_status: null,
  };
  const chiamate: string[] = [];
  beforeEach(() => {
    chiamate.length = 0;
    stato.profilo = { ...VENDITORE };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      chiamate.push(String(url));
      return new Response(JSON.stringify({ isValid: true, name: 'Forno' }), { status: 200 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('36: una P.IVA di sole 11 cifre (come la salva il modulo) si controlla come italiana', async () => {
    const { viesVatLookup } = await import('@/lib/kyc/providers');
    expect((await viesVatLookup('01234567897')).valid).toBe(true);
    expect(chiamate[0]).toMatch(/\/ms\/IT\/vat\/01234567897$/);
  });

  it('1866: VIES irraggiungibile non è «P.IVA non valida»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ETIMEDOUT'); }));
    const { POST } = await import('@/app/api/kyc/start-check/route');
    const r = await (POST as unknown as H)(new Request('http://x', { method: 'POST' }));
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toMatch(/non valida/);
  });

  it('1862: se lo stato non si salva, non risponde «PENDING»', async () => {
    stato.erroreSalvataggio = { message: 'giù' };
    const { POST } = await import('@/app/api/kyc/start-check/route');
    const r = await (POST as unknown as H)(new Request('http://x', { method: 'POST' }));
    expect(r.status).toBeGreaterThanOrEqual(500);
  });

  it('1865: l’invio in attesa (PENDING) lascia una riga nel registro', async () => {
    const { POST } = await import('@/app/api/kyc/start-check/route');
    const r1 = await (POST as unknown as H)(new Request('http://x', { method: 'POST' }));
    expect(r1.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'kyc.submit' }));
  });

  it('1864: con una verifica già in attesa non se ne apre un’altra dal fornitore', async () => {
    const { POST } = await import('@/app/api/kyc/start-check/route');
    stato.profilo = { ...VENDITORE, kyc_provider_status: 'PENDING', kyc_provider_check_id: 'manual_0' };
    startCheck.mockClear();
    const r = await (POST as unknown as H)(new Request('http://x', { method: 'POST' }));
    expect(r.status).toBe(200);
    expect(startCheck).not.toHaveBeenCalled();
    expect(stato.aggiornamenti).toEqual([]);
  });
});
