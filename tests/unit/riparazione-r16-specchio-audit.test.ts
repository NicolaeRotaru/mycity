import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R16-014 — Lo specchio activity_events chiamava «Azione admin» anche le azioni degli utenti.
 *
 * `writeAudit` lo chiamano anche fattorini e negozi (kyc.upload, kyc.submit, prodotti caricati dal
 * file). Lo specchio scriveva sempre `action: 'admin'` e «Azione admin: …»: nel pannello di
 * sorveglianza un documento caricato da un fattorino sembrava un'azione dello staff.
 * Qui il client del database è finto: dice il ruolo di chi agisce e raccoglie le righe scritte.
 */

const stato = vi.hoisted(() => ({
  ruoli: {} as Record<string, string>,
  profiloRotto: false,
  scritte: [] as Array<{ tabella: string; riga: Record<string, unknown> }>,
}));

function tabella(nome: string) {
  return {
    insert: async (riga: Record<string, unknown>) => {
      stato.scritte.push({ tabella: nome, riga });
      return { data: null, error: null };
    },
    select: () => ({
      eq: (_colonna: string, id: string) => ({
        maybeSingle: async () => {
          if (stato.profiloRotto) return { data: null, error: { message: 'rete giù' } };
          return { data: stato.ruoli[id] ? { role: stato.ruoli[id] } : null, error: null };
        },
      }),
    }),
  };
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ from: (nome: string) => tabella(nome) }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

import { writeAudit } from '@/lib/audit';

const specchio = () => stato.scritte.find((s) => s.tabella === 'activity_events')?.riga;

beforeEach(() => {
  stato.ruoli = { 'rider-1': 'rider', 'negozio-1': 'seller', 'admin-1': 'admin' };
  stato.profiloRotto = false;
  stato.scritte = [];
});

describe('R16-014 · lo specchio activity_events dice chi ha fatto l’azione', () => {
  it('un fattorino che carica un documento non esce come «Azione admin»', async () => {
    await writeAudit({ actorId: 'rider-1', action: 'kyc.upload', targetTable: 'profiles', targetId: 'rider-1' });
    const riga = specchio();
    expect(riga).toBeTruthy();
    expect(riga!.action).not.toBe('admin');
    expect(String(riga!.summary)).not.toMatch(/admin/i);
    expect(String(riga!.summary)).toContain('kyc.upload');
    expect(riga!.actor_id).toBe('rider-1');
  });

  it('un negozio che carica prodotti dal file non esce come «Azione admin»', async () => {
    await writeAudit({ actorId: 'negozio-1', action: 'product.create', targetTable: 'products' });
    expect(specchio()!.action).not.toBe('admin');
    expect(String(specchio()!.summary)).not.toMatch(/admin/i);
  });

  it('un amministratore resta «Azione admin»', async () => {
    await writeAudit({ actorId: 'admin-1', action: 'user.suspend', targetTable: 'profiles', targetId: 'u-9' });
    expect(specchio()!.action).toBe('admin');
    expect(String(specchio()!.summary)).toBe('Azione admin: user.suspend');
  });

  it('se il ruolo non si legge, non si indovina «admin», e il registro e lo specchio si scrivono lo stesso', async () => {
    stato.profiloRotto = true;
    await writeAudit({ actorId: 'rider-1', action: 'kyc.submit' });
    expect(stato.scritte.map((s) => s.tabella).sort()).toEqual(['activity_events', 'audit_logs']);
    expect(specchio()!.action).not.toBe('admin');
    expect(String(specchio()!.summary)).not.toMatch(/admin/i);
  });
});
