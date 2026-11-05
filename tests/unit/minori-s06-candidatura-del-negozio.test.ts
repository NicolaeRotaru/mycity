import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * S06 — La candidatura del negozio (/sell → /api/seller/apply).
 *
 * 2591: l'accettazione dei Termini va a verbale (consent_log, privacy_terms).
 * 186:  Nicola riceve un avviso quando un negozio chiede di entrare.
 * 47:   l'IBAN con gli spazi passa, quello con la cifra di controllo sbagliata no.
 * 2490: PEC e codice SDI si raccolgono e si salvano.
 */

const stato = vi.hoisted(() => ({
  scritture: [] as Record<string, unknown>[],
  inserimenti: [] as { tabella: string; valori: Record<string, unknown> }[],
  avvisi: [] as string[][],
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: 'utente-1' }, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  notifyAdmins: async (...a: string[]) => { stato.avvisi.push(a); return 'scritto'; },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      let scrive = false;
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.in = () => c;
      c.or = () => c;
      c.maybeSingle = async () => ({ data: { role: 'buyer', approval_status: 'pending' }, error: null });
      c.update = (v: Record<string, unknown>) => { scrive = true; stato.scritture.push(v); return c; };
      c.insert = async (v: Record<string, unknown>) => { stato.inserimenti.push({ tabella, valori: v }); return { error: null }; };
      (c as { then: unknown }).then = (ok: (v: unknown) => void) =>
        ok(scrive ? { data: [{ id: 'utente-1' }], error: null } : { data: null, error: null });
      return c;
    },
  }),
}));

const { POST } = await import('@/app/api/seller/apply/route');
const { ibanValido } = await import('@/app/sell/iban');

const modulo = {
  contactPhone: '3331234567', legalFirstName: 'Mario', legalLastName: 'Rossi',
  legalFiscalCode: 'RSSMRA80E05G535X', legalBirthDate: '1980-05-05', legalResidenceAddr: 'Via Roma 1',
  legalResidenceCity: 'Piacenza', legalResidenceZip: '29121', businessLegalName: 'Forno Rossi',
  businessVatNumber: '01234567897', businessAddress: 'Via Roma 1', businessCity: 'Piacenza',
  businessZip: '29121', storeName: 'Forno Rossi', storeDescription: '', billingIban: '',
  storeLogo: null, storeMedia: [], storeAddress: 'Via Roma 1, Piacenza', storeLat: 45.05, storeLng: 9.69,
  acceptTos: true, acceptPrivacy: true, acceptAccuracy: true,
};
const invia = (corpo: unknown) =>
  (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/seller/apply', { method: 'POST', body: JSON.stringify(corpo) }),
  );

beforeEach(() => { stato.scritture = []; stato.inserimenti = []; stato.avvisi = []; });

describe('2591 — i Termini accettati vanno a verbale', () => {
  it('scrive una riga privacy_terms con la versione del testo', async () => {
    expect((await invia(modulo)).status).toBe(200);
    const riga = stato.inserimenti.find((i) => i.tabella === 'consent_log');
    expect(riga?.valori.categoria).toBe('privacy_terms');
    expect(riga?.valori.versione_testo).toBeTruthy();
  });
});

describe('186 — Nicola viene avvisato', () => {
  it('manda un avviso agli amministratori col nome del negozio', async () => {
    await invia(modulo);
    expect(stato.avvisi).toHaveLength(1);
    expect(stato.avvisi[0][1]).toContain('Forno Rossi');
  });
});

describe('47 — l\'IBAN', () => {
  it('scritto a gruppi e in minuscolo si accetta e si salva pulito', async () => {
    const r = await invia({ ...modulo, billingIban: 'it60 x054 2811 1010 0000 0123 456' });
    expect(r.status).toBe(200);
    expect(stato.scritture[0].billing_iban).toBe('IT60X0542811101000000123456');
  });
  it('con la cifra di controllo sbagliata si rifiuta', async () => {
    expect((await invia({ ...modulo, billingIban: 'IT61X0542811101000000123456' })).status).toBe(400);
    expect(ibanValido('IT61X0542811101000000123456')).toBe(false);
    expect(ibanValido('DE89 3704 0044 0532 0130 00')).toBe(true);
  });
  it('il modulo usa lo stesso controllo', () => {
    expect(readFileSync('components/SellerApplicationForm.tsx', 'utf8')).toMatch(/ibanValido\(v\)/);
  });
});

describe('2490 — PEC e codice SDI', () => {
  it('si salvano quando ci sono', async () => {
    await invia({ ...modulo, businessPec: 'forno@pec.it', businessSdi: 'abc1234' });
    expect(stato.scritture[0].business_pec).toBe('forno@pec.it');
    expect(stato.scritture[0].business_sdi).toBe('ABC1234');
  });
  it('il modulo li chiede', () => {
    const src = readFileSync('components/SellerApplicationForm.tsx', 'utf8');
    expect(src).toContain("register('businessPec')");
    expect(src).toContain("register('businessSdi')");
  });
});

describe('2122 · 2123 — il riquadro «Richiesta in valutazione» di /sell', () => {
  const src = readFileSync('app/sell/page.tsx', 'utf8');
  const riquadro = src.slice(src.indexOf('function PendingNotice'));
  it('«Continua a comprare» entra in modalità acquisto, non nella dashboard', () => {
    expect(riquadro).toContain('href="/?shop=1"');
    expect(riquadro).not.toMatch(/href="\/"/);
  });
  it('la richiesta in attesa si può modificare: il pulsante riapre il modulo', () => {
    expect(riquadro).toContain('Modifica la richiesta');
    expect(src).toMatch(/approval_requested_at && !modifica/);
  });
});
