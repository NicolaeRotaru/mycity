import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R11-008 — Se la domanda per diventare negozio parte due volte insieme (doppio
 * clic, rete lenta), veniva registrata due volte e gli amministratori ricevevano
 * l'avviso due volte. Il finto database qui sotto applica davvero i filtri della
 * scrittura su una riga sola, e le due richieste leggono prima che una scriva.
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
  stato.riga = { id: 'utente-1', role: 'buyer', approval_status: null, approval_requested_at: null };
  stato.consensi = 0;
  stato.avvisi = 0;
});

describe('R11-008 — la domanda partita due volte insieme', () => {
  it('si registra una volta e gli amministratori ricevono un avviso solo', async () => {
    const [a, b] = await Promise.all([invia(), invia()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(stato.avvisi, 'due avvisi per la stessa domanda').toBe(1);
    expect(stato.consensi, 'due righe di consenso per la stessa domanda').toBe(1);
  });

  it('una domanda sola: come prima', async () => {
    expect((await invia()).status).toBe(200);
    expect(stato.avvisi).toBe(1);
    expect(stato.riga.approval_status).toBe('pending');
  });
});

describe('R11-008 — collaudo K04', () => {
  it('il secondo invio due secondi dopo non aggiunge un altra riga al verbale né un altro avviso', async () => {
    expect((await invia()).status).toBe(200);
    expect((await invia()).status).toBe(200);
    expect(stato.consensi, 'la stessa domanda finisce due volte a verbale').toBe(1);
    expect(stato.avvisi).toBe(1);
  });
});
