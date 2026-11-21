import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R03-009 — UN PROFILO «IN ATTESA» CON LA DATA DELLA RICHIESTA RIMASTA DA UN TENTATIVO PRECEDENTE.
 *
 * Ogni profilo nasce «pending»: per un cliente vuol dire «attivo», e la coda dell'amministrazione
 * non lo mostra. Se gli restava valorizzata `approval_requested_at` (un tentativo di prima, un ruolo
 * tolto, o la colonna scritta da lui), la sua domanda vera per diventare negozio veniva presa per
 * «già in attesa»: niente consenso a verbale e niente avviso agli amministratori, mai. Adesso
 * «già in attesa» è solo il NEGOZIO in attesa con la data, come lo leggono /sell e la coda.
 */

const stato = vi.hoisted(() => ({
  riga: {} as Record<string, unknown>,
  consensi: 0,
  avvisi: 0,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: 'utente-1', email: 'mario@esempio.it' }, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => { stato.avvisi += 1; }) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'consent_log') return { insert: async () => { stato.consensi += 1; return { error: null }; } };
      let valori: Record<string, unknown> | null = null;
      const condizioni: Array<(r: Record<string, unknown>) => boolean> = [];
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = (col: string, v: unknown) => { condizioni.push((r) => r[col] === v); return c; };
      c.in = (col: string, v: unknown[]) => { condizioni.push((r) => v.includes(r[col])); return c; };
      c.or = (f: string) => {
        if (f === 'approval_requested_at.is.null') condizioni.push((r) => r.approval_requested_at == null);
        return c;
      };
      c.update = (v: Record<string, unknown>) => { valori = v; return c; };
      c.maybeSingle = async () => ({ data: { ...stato.riga }, error: null });
      (c as { then: unknown }).then = (ok: (v: unknown) => void) => {
        if (!valori) return ok({ data: null, error: null });
        if (condizioni.every((f) => f(stato.riga))) {
          stato.riga = { ...stato.riga, ...valori };
          return ok({ data: [{ id: 'utente-1' }], error: null });
        }
        return ok({ data: [], error: null });
      };
      return c;
    },
  }),
}));

const { POST } = await import('@/app/api/seller/apply/route');

const modulo = {
  contactPhone: '3331234567', legalFirstName: 'Mario', legalLastName: 'Rossi', legalFiscalCode: 'RSSMRA80E05G535X',
  legalBirthDate: '1980-05-05', legalResidenceAddr: 'Via Roma 1', legalResidenceCity: 'Piacenza', legalResidenceZip: '29121',
  businessLegalName: 'Salumeria Rossi', businessVatNumber: '01234567897', businessAddress: 'Via Roma 1',
  businessCity: 'Piacenza', businessZip: '29121', storeName: 'Salumeria Rossi', storeDescription: '', billingIban: '',
  storeLogo: null, storeMedia: [], storeAddress: 'Via Roma 1, Piacenza', storeLat: 45.05, storeLng: 9.69,
  acceptTos: true, acceptPrivacy: true, acceptAccuracy: true, acceptBilling: true,
};
const invia = () =>
  (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/seller/apply', { method: 'POST', body: JSON.stringify(modulo) }),
  );

beforeEach(() => {
  stato.consensi = 0;
  stato.avvisi = 0;
});

describe('R03-009 · la data rimasta da un tentativo precedente non ferma verbale e avviso', () => {
  it('cliente «pending» con approval_requested_at rimasta → la domanda va a verbale e gli amministratori lo sanno', async () => {
    stato.riga = { id: 'utente-1', role: 'buyer', approval_status: 'pending', approval_requested_at: '2026-03-01T10:00:00.000Z' };
    const res = await invia();
    expect(res.status).toBe(200);
    expect(stato.riga.role).toBe('seller');
    expect(stato.consensi, 'la domanda vera non è finita a verbale').toBe(1);
    expect(stato.avvisi, 'gli amministratori non sono stati avvisati del negozio nuovo').toBe(1);
  });

  it('controprova: un negozio già in coda che corregge la domanda non fa un secondo verbale né un secondo avviso', async () => {
    stato.riga = { id: 'utente-1', role: 'seller', approval_status: 'pending', approval_requested_at: '2026-11-20T10:00:00.000Z' };
    const res = await invia();
    expect(res.status).toBe(200);
    expect(stato.consensi).toBe(0);
    expect(stato.avvisi).toBe(0);
  });
});
