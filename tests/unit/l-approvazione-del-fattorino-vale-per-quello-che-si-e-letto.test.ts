import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * L'approvazione di un fattorino si scrive solo se mezzo, scadenze e documenti sono ancora quelli
 * letti e controllati dalla rotta (app/api/admin/users/[id]/moderate/route.ts).
 *
 * Il finto Supabase si comporta come il database: l'update tocca la riga solo se TUTTI i filtri
 * combaciano e dice quante righe ha toccato. Fra la lettura e la scrittura la prova fa cambiare al
 * fattorino il proprio profilo (le colonne che può scriversi da sé: mezzo e scadenze).
 */

type Riga = Record<string, unknown>;
const db = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  dopoLaLettura: null as Record<string, unknown> | null,
  notifiche: [] as Record<string, unknown>[],
}));
const audit = vi.fn(async (_e: unknown) => {});

vi.mock('@/lib/audit', () => ({ writeAudit: (e: unknown) => audit(e) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true, id: 'm' }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (c: unknown) => unknown) => async (req: Request) =>
    h({ req, user: { id: 'admin-1' }, params: { id: 'fattorino-1' } }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'luca@example.com' } } }) } },
    from: (t: string) => {
      if (t === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => {
                const fotografia = db.profilo ? { ...db.profilo } : null;
                // Il fattorino scrive sul proprio profilo subito dopo la lettura della rotta.
                if (db.profilo && db.dopoLaLettura) db.profilo = { ...db.profilo, ...db.dopoLaLettura };
                return { data: fotografia, error: null };
              },
            }),
          }),
          update: (patch: Riga) => {
            const filtri: Array<(r: Riga) => boolean> = [];
            const b: Record<string, unknown> = {
              eq: (c: string, v: unknown) => { filtri.push((r) => r[c] != null && String(r[c]) === v); return b; },
              is: (c: string, v: unknown) => { filtri.push((r) => (r[c] ?? null) === v); return b; },
              then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
                const r = db.profilo;
                const tocca = !!r && filtri.every((f) => f(r));
                if (tocca) db.profilo = { ...r, ...patch };
                return Promise.resolve({ error: null, count: tocca ? 1 : 0 }).then(ok, ko);
              },
            };
            return b;
          },
        };
      }
      return { insert: async (r: Riga) => { db.notifiche.push(r); return { error: null }; } };
    },
  }),
}));

import { POST } from '@/app/api/admin/users/[id]/moderate/route';
const MODERA = POST as unknown as (r: Request) => Promise<Response>;

function approva() {
  return MODERA(new Request('http://x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'approve' }),
  }));
}

/** In attesa, in bici: documento e selfie bastano, patente e polizza non servono. */
const IN_BICI = {
  id: 'fattorino-1', role: 'rider', store_name: null, full_name: 'Luca', legal_birth_date: '1990-01-01',
  approval_status: 'pending', approved_by: null,
  legal_first_name: 'Luca', legal_last_name: 'Bianchi', legal_fiscal_code: 'BNCLCU90A01G535X',
  kyc_id_doc_front_url: 'fronte', kyc_selfie_url: 'selfie', rider_license_url: null, rider_insurance_url: null,
  rider_license_expires_on: null, rider_insurance_expires_on: null, rider_vehicle_type: 'BIKE',
};

beforeEach(() => {
  db.profilo = { ...IN_BICI };
  db.dopoLaLettura = null;
  db.notifiche = [];
  audit.mockClear();
});

describe('l\'approvazione del fattorino si scrive solo su quello che si è controllato', () => {
  it('senza cambi nel frattempo il fattorino in bici si approva', async () => {
    const r = await approva();
    expect(r.status).toBe(200);
    expect(db.profilo?.approval_status).toBe('approved');
    expect(db.profilo?.is_approved).toBe(true);
  });

  it('passato a SCOOTER con le sue scadenze dopo la lettura: 409, resta in attesa, niente esito', async () => {
    db.dopoLaLettura = { rider_vehicle_type: 'SCOOTER', rider_license_expires_on: '2099-01-01', rider_insurance_expires_on: '2099-01-01' };
    const r = await approva();
    expect(r.status).toBe(409);
    expect(db.profilo?.approval_status).toBe('pending');
    expect(db.profilo?.is_approved).not.toBe(true);
    expect(db.notifiche).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it.each([
    ['solo il mezzo (a CAR)', { rider_vehicle_type: 'CAR' }],
    ['solo la scadenza della patente', { rider_license_expires_on: '2099-12-31' }],
    ['solo la scadenza della polizza', { rider_insurance_expires_on: '2099-12-31' }],
  ])('cambiato %s dopo la lettura: 409', async (_nome, cambio) => {
    db.dopoLaLettura = cambio;
    const r = await approva();
    expect(r.status).toBe(409);
    expect(db.profilo?.approval_status).toBe('pending');
  });

  it('un fattorino a motore con scadenze in regola che le cambia dopo la lettura: 409', async () => {
    db.profilo = {
      ...IN_BICI, rider_vehicle_type: 'SCOOTER', rider_license_url: 'patente', rider_insurance_url: 'polizza',
      rider_license_expires_on: '2099-01-01', rider_insurance_expires_on: '2099-01-01',
    };
    db.dopoLaLettura = { rider_license_expires_on: '2000-01-01' };
    const r = await approva();
    expect(r.status).toBe(409);
    expect(db.profilo?.approval_status).toBe('pending');
  });
});
