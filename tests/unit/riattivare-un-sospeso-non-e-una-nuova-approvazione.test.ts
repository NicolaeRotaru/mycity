import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 1/11/2026 — RIATTIVARE UN SOSPESO NON È UNA NUOVA APPROVAZIONE.
 *
 * Dal collaudo: un negozio storico senza partita IVA, sospeso e poi riattivato,
 * prendeva 400 e restava sospeso per sempre — non ha una pagina dove inserirla
 * e /sell risponde «sei sospeso». Il controllo di partita IVA e documenti resta
 * per «approva» e per «riattiva» da rifiutato o in attesa. E «00000000000»
 * torna col calcolo del carattere di controllo ma non è una partita IVA.
 */

const ADMIN = { id: 'admin-1', email: 'a@x.com' };
let idBersaglio = 'x';

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: { req: Request; user: typeof ADMIN; params: { id: string } }) => unknown) =>
    (req: Request) =>
      h({ req, user: ADMIN, params: { id: idBersaglio } }),
}));

let profilo: Record<string, unknown> = {};
let aggiornamenti: Record<string, unknown>[] = [];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) =>
      tabella === 'profiles'
        ? {
            select: (colonne: string) => {
              // Solo le colonne chieste: se la rotta non legge lo stato, per lei non c'è.
              const riga = Object.fromEntries(colonne.split(',').map((c) => c.trim()).map((c) => [c, profilo[c] ?? null]));
              return { eq: () => ({ single: () => Promise.resolve({ data: riga, error: null }) }) };
            },
            update: (patch: Record<string, unknown>) => {
              aggiornamenti.push(patch);
              return { eq: () => Promise.resolve({ error: null }) };
            },
          }
        : { insert: () => Promise.resolve({ error: null }) },
  }),
}));

vi.mock('@/lib/audit', () => ({ writeAudit: () => Promise.resolve() }));

import { POST as MODERA } from '@/app/api/admin/users/[id]/moderate/route';

function richiesta(action: string): never {
  return new Request('http://localhost/api/admin/users/x/moderate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  }) as never;
}

const NEGOZIO_STORICO = { id: 'seller-1', role: 'seller', store_name: 'Pane', full_name: null, legal_birth_date: null, business_vat_number: null };
const FATTORINO_SENZA_DOC = { id: 'rider-1', role: 'rider', store_name: null, full_name: 'Luca', legal_birth_date: null };

function usa(p: Record<string, unknown>) {
  profilo = { ...p };
  idBersaglio = String(p.id);
}

beforeEach(() => {
  aggiornamenti = [];
});

describe('riattivare un sospeso', () => {
  it('il negozio storico senza partita IVA, sospeso, si riattiva', async () => {
    usa({ ...NEGOZIO_STORICO, approval_status: 'suspended', approved_by: 'admin-0' });
    const r = await MODERA(richiesta('reactivate'));
    expect(r.status, 'il negozio sospeso resta fermo per sempre: non ha una pagina per la partita IVA').toBe(200);
    expect(aggiornamenti[0]).toMatchObject({ approval_status: 'approved', is_approved: true });
  });

  it('il fattorino sospeso si riattiva anche se i documenti non sono sul profilo', async () => {
    usa({ ...FATTORINO_SENZA_DOC, approval_status: 'suspended', approved_by: 'admin-0' });
    expect((await MODERA(richiesta('reactivate'))).status).toBe(200);
  });
});

describe('il controllo resta dove porta ad «approvato» chi non lo era', () => {
  it('riattivare un rifiutato senza partita IVA: 400, e il testo parla di riattivare', async () => {
    usa({ ...NEGOZIO_STORICO, approval_status: 'rejected' });
    const r = await MODERA(richiesta('reactivate'));
    expect(r.status).toBe(400);
    expect(aggiornamenti).toEqual([]);
    const testo = JSON.stringify(await r.json());
    expect(testo).toMatch(/riattiv/i);
    expect(testo).not.toMatch(/approv/i);
  });

  it('riattivare chi è in attesa senza documenti: 400', async () => {
    usa({ ...FATTORINO_SENZA_DOC, approval_status: 'pending' });
    expect((await MODERA(richiesta('reactivate'))).status).toBe(400);
    expect(aggiornamenti).toEqual([]);
  });

  it('approvare un sospeso senza partita IVA resta bloccato: «approva» controlla sempre', async () => {
    usa({ ...NEGOZIO_STORICO, approval_status: 'suspended', approved_by: 'admin-0' });
    expect((await MODERA(richiesta('approve'))).status).toBe(400);
  });
});

describe('la partita IVA di soli zeri non è una partita IVA', () => {
  it('«00000000000» non si approva', async () => {
    usa({ ...NEGOZIO_STORICO, approval_status: 'pending', business_vat_number: '00000000000' });
    expect((await MODERA(richiesta('approve'))).status).toBe(400);
    expect(aggiornamenti).toEqual([]);
  });
});
