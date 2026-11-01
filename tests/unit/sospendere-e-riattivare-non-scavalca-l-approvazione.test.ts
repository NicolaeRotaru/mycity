import { describe, it, expect, vi } from 'vitest';

const ADMIN = { id: 'admin-1', email: 'a@x.com' };
let idBersaglio = 'x';
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: { req: Request; user: typeof ADMIN; params: { id: string } }) => unknown) =>
    (req: Request) => h({ req, user: ADMIN, params: { id: idBersaglio } }),
}));
let profilo: Record<string, unknown> = {};
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) =>
      tabella === 'profiles'
        ? {
            select: (colonne: string) => {
              const riga = Object.fromEntries(colonne.split(',').map((c) => c.trim()).map((c) => [c, profilo[c] ?? null]));
              return { eq: () => ({ single: () => Promise.resolve({ data: riga, error: null }) }) };
            },
            update: (patch: Record<string, unknown>) => {
              profilo = { ...profilo, ...patch };
              return { eq: () => Promise.resolve({ error: null }) };
            },
          }
        : { insert: () => Promise.resolve({ error: null }) },
  }),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: () => Promise.resolve() }));
import { POST as MODERA } from '@/app/api/admin/users/[id]/moderate/route';
const req = (action: string) => new Request('http://localhost/x', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }),
}) as never;

describe('collaudo B: sospendi e riattiva aggira il controllo', () => {
  it('fattorino in attesa senza documenti: approve e 400, sospendi+riattiva non deve approvarlo', async () => {
    profilo = { id: 'rider-1', role: 'rider', full_name: 'Luca', legal_birth_date: null, approval_status: 'pending', is_approved: false };
    idBersaglio = 'rider-1';
    expect((await MODERA(req('approve'))).status).toBe(400);
    const s = await MODERA(req('suspend'));
    const r = await MODERA(req('reactivate'));
    console.log('suspend', s.status, 'reactivate', r.status, 'stato finale', profilo.approval_status, profilo.is_approved);
    expect(profilo.is_approved, 'approvato senza documenti passando da sospeso').not.toBe(true);
  });
  it('negozio in attesa senza partita IVA: sospendi+riattiva non deve approvarlo', async () => {
    profilo = { id: 'seller-9', role: 'seller', store_name: 'Nuovo', legal_birth_date: null, approval_status: 'pending', is_approved: false, business_vat_number: null };
    idBersaglio = 'seller-9';
    expect((await MODERA(req('approve'))).status).toBe(400);
    await MODERA(req('suspend'));
    await MODERA(req('reactivate'));
    console.log('negozio stato finale', profilo.approval_status, profilo.is_approved);
    expect(profilo.is_approved, 'negozio approvato senza partita IVA passando da sospeso').not.toBe(true);
  });

  for (const stato of ['rejected', null] as const) {
    it(`si sospende solo un approvato: con stato ${stato ?? 'vuoto'} risponde 400 e non scrive`, async () => {
      profilo = { id: 'rider-2', role: 'rider', full_name: 'Ugo', legal_birth_date: null, approval_status: stato, is_approved: false };
      idBersaglio = 'rider-2';
      expect((await MODERA(req('suspend'))).status).toBe(400);
      expect(profilo.approval_status).toBe(stato);
    });
  }

  it('il doppio clic su «sospendi» dice che è già sospeso', async () => {
    profilo = { id: 'seller-3', role: 'seller', store_name: 'Bar', legal_birth_date: null, approval_status: 'suspended', approved_by: 'admin-0', is_approved: false };
    idBersaglio = 'seller-3';
    const r = await MODERA(req('suspend'));
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).toMatch(/già sospeso/);
  });
});

describe('ricollaudo: un sospeso mai approvato non torna attivo senza documenti', () => {
  it('fattorino sospeso, mai approvato, senza documenti: «riattiva» risponde 400 e resta sospeso', async () => {
    // Il caso trovato in produzione il 1/11: approved_at e approved_by vuoti, nessun documento.
    profilo = { id: 'rider-9', role: 'rider', full_name: 'Dati vecchi', legal_birth_date: null, approval_status: 'suspended', is_approved: false, approved_at: null, approved_by: null };
    idBersaglio = 'rider-9';
    expect((await MODERA(req('reactivate'))).status).toBe(400);
    expect(profilo.approval_status).toBe('suspended');
    expect(profilo.is_approved).toBe(false);
  });

  it('approvato, sospeso, riattivato: torna attivo senza rifare i documenti', async () => {
    profilo = { id: 'rider-8', role: 'rider', full_name: 'Già bravo', legal_birth_date: null, approval_status: 'pending', is_approved: false,
      kyc_id_doc_front_url: 'f', kyc_selfie_url: 's', rider_license_url: 'p', rider_insurance_url: 'rc' };
    idBersaglio = 'rider-8';
    expect((await MODERA(req('approve'))).status).toBe(200);
    expect((await MODERA(req('suspend'))).status).toBe(200);
    // I documenti spariscono nel frattempo (per esempio la potatura): la riattivazione non li richiede.
    profilo = { ...profilo, kyc_id_doc_front_url: null, rider_license_url: null };
    expect((await MODERA(req('reactivate'))).status).toBe(200);
    expect(profilo.is_approved).toBe(true);
  });
});
