import { describe, it, expect, vi, beforeEach } from 'vitest';
import { motivoPerNonApprovare } from '@/lib/admin/regole-approvazione';

/**
 * S05 · schede 2119, 2617, 89, 543, 226, 113, 125 — moderazione degli utenti.
 */

const stato = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  aggiornamenti: [] as Record<string, unknown>[],
  notifiche: [] as Record<string, unknown>[],
  email: [] as Array<{ to: string; text?: string }>,
  consegne: 0,
}));
const audit = vi.fn(async (_e: unknown) => {});
vi.mock('@/lib/audit', () => ({ writeAudit: (e: unknown) => audit(e) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async (e: { to: string; text?: string }) => { stato.email.push(e); return { ok: true, id: 'm1' }; } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (c: unknown) => unknown) => async (req: Request) =>
    req.headers.get('x-ruolo') === 'admin'
      ? h({ req, user: { id: 'admin-1' }, params: { id: 'bersaglio-1' } })
      : new Response('Solo admin', { status: 403 }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'forno@example.com' } } }) } },
    from: (t: string) => {
      if (t === 'profiles') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: stato.profilo, error: null }) }) }),
          update: (patch: Record<string, unknown>) => { stato.aggiornamenti.push(patch); return { eq: async () => ({ error: null }) }; },
        };
      }
      if (t === 'orders') {
        const b: Record<string, unknown> = {};
        Object.assign(b, { select: () => b, eq: () => b, in: async () => ({ count: stato.consegne, error: null }) });
        return b;
      }
      return { insert: async (r: Record<string, unknown>) => { stato.notifiche.push(r); return { error: null }; } };
    },
  }),
}));

import { POST as MODERA } from '@/app/api/admin/users/[id]/moderate/route';

const NEGOZIO = { id: 'bersaglio-1', role: 'seller', store_name: 'Forno Rossi', full_name: 'Mario Rossi', legal_birth_date: null,
  approval_status: 'approved', approved_by: 'admin-0', business_vat_number: '01234567897' };
const FATTORINO = { id: 'bersaglio-1', role: 'rider', store_name: null, full_name: 'Luca', legal_birth_date: '1990-01-01',
  approval_status: 'pending', approved_by: null, kyc_id_doc_front_url: 'f', kyc_selfie_url: 's',
  rider_license_url: 'p', rider_insurance_url: 'rc', rider_license_expires_on: '2099-01-01', rider_insurance_expires_on: '2025-01-01' };

function modera(azione: string, motivo?: string, ruolo = 'admin') {
  return (MODERA as unknown as (r: Request) => Promise<Response>)(new Request('http://x', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-ruolo': ruolo },
    body: JSON.stringify(motivo ? { action: azione, reason: motivo } : { action: azione }),
  }));
}

beforeEach(() => {
  stato.aggiornamenti = []; stato.notifiche = []; stato.email = []; stato.consegne = 0;
  audit.mockClear();
});

describe('moderazione', () => {
  it('chi non è admin riceve ancora 403 e niente cambia', async () => {
    stato.profilo = { ...NEGOZIO };
    expect((await modera('suspend', 'x', 'seller')).status).toBe(403);
    expect(stato.aggiornamenti).toEqual([]);
  });

  it('2119: «Riattiva» su un negozio in attesa o respinto non lo approva', async () => {
    for (const s of ['pending', 'rejected']) {
      stato.profilo = { ...NEGOZIO, approval_status: s };
      expect((await modera('reactivate')).status).toBe(400);
    }
    expect(stato.aggiornamenti).toEqual([]);
  });

  it('2617: il server non approva un fattorino con la polizza scaduta', async () => {
    stato.profilo = { ...FATTORINO };
    const r = await modera('approve');
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).toMatch(/polizza RC scaduta/);
    expect(motivoPerNonApprovare({ ...FATTORINO, rider_insurance_expires_on: '2099-01-01' }, 'approve', '2026-11-05')).toBeNull();
    expect(motivoPerNonApprovare({ ...FATTORINO, rider_insurance_expires_on: null }, 'approve', '2026-11-05')).toMatch(/senza data di scadenza/);
  });

  it('89: chi viene sospeso riceve il motivo, in campanella e per email (543)', async () => {
    stato.profilo = { ...NEGOZIO };
    const r = await modera('suspend', 'Foto dei prodotti non conformi');
    expect(r.status).toBe(200);
    expect(String(stato.notifiche[0]?.body)).toContain('Motivo: Foto dei prodotti non conformi');
    expect(stato.email[0]?.to).toBe('forno@example.com');
    expect(stato.email[0]?.text).toContain('Foto dei prodotti non conformi');
    expect(((await r.json()) as { email_inviata: boolean }).email_inviata).toBe(true);
  });

  it('543: anche l’approvazione arriva per email', async () => {
    stato.profilo = { ...FATTORINO, rider_insurance_expires_on: '2099-01-01' };
    expect((await modera('approve')).status).toBe(200);
    expect(stato.email).toHaveLength(1);
  });

  it('113/125: il registro tiene ruolo e id, non il nome della persona', async () => {
    stato.profilo = { ...NEGOZIO };
    await modera('suspend', 'motivo qualsiasi');
    const meta = (audit.mock.calls[0][0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta).not.toHaveProperty('name');
    expect(JSON.stringify(meta)).not.toMatch(/Rossi/);
  });

  it('2617: un fattorino sospeso con la polizza scaduta non torna attivo con «Riattiva»', async () => {
    stato.profilo = { ...FATTORINO, approval_status: 'suspended', approved_by: 'admin-0' };
    expect((await modera('reactivate')).status).toBe(400);
    expect(stato.aggiornamenti).toEqual([]);
  });

  it('226: sospendere un fattorino con consegne in corso lo dice all’amministratore', async () => {
    stato.profilo = { ...FATTORINO, approval_status: 'approved', approved_by: 'admin-0', rider_insurance_expires_on: '2099-01-01' };
    stato.consegne = 2;
    const r = await modera('suspend', 'Reclami ripetuti');
    const j = (await r.json()) as { consegne_in_corso: number; avviso?: string };
    expect(j.consegne_in_corso).toBe(2);
    expect(j.avviso).toMatch(/2 consegne in corso/);
  });
});

describe('125: cancellazione dell’account dal pannello', () => {
  it('il registro della cancellazione non scrive il nome (lettura del sorgente)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('app/api/admin/users/[id]/delete/route.ts', 'utf8');
    const da = src.indexOf("action: 'user.delete'");
    const audit = src.slice(da, src.indexOf('});', da));
    expect(audit).not.toMatch(/name:/);
  });
});
