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
});
