import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 31/10/2026 (ondata 4) — /api/seller/apply: la richiesta di diventare negozio
 * la scrive il server, con la chiave di servizio, e decide lui chi può farla.
 *
 *  · un cliente diventa negozio «in attesa» (prima il database lo respingeva);
 *  · la partita IVA si chiede e si controlla (prima si approvava senza);
 *  · un negozio sospeso non torna «in attesa» rimandando il modulo;
 *  · un negozio approvato non si spegne la vetrina da solo;
 *  · con l'abbonamento spento non si fa accettare nessun addebito.
 */

const stato = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  scritture: [] as Record<string, unknown>[],
  filtri: [] as string[],
  righeScritte: [{ id: 'utente-1' }] as { id: string }[],
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: 'utente-1', email: 'mario@esempio.it' }, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      let scrive = false;
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.in = (col: string, v: unknown[]) => { stato.filtri.push(`${col} in ${v.join(',')}`); return c; };
      c.or = (f: string) => { stato.filtri.push(f); return c; };
      c.maybeSingle = async () => ({ data: stato.profilo, error: null });
      c.update = (valori: Record<string, unknown>) => { scrive = true; stato.scritture.push(valori); return c; };
      (c as { then: unknown }).then = (ok: (v: unknown) => void) =>
        ok(scrive ? { data: stato.righeScritte, error: null } : { data: null, error: null });
      return c;
    },
  }),
}));

const { POST } = await import('@/app/api/seller/apply/route');

// 01234567897: partita IVA con la cifra di controllo giusta.
const modulo = {
  contactPhone: '3331234567',
  legalFirstName: 'Mario',
  legalLastName: 'Rossi',
  legalFiscalCode: 'RSSMRA80E05G535X',
  legalBirthDate: '1980-05-05',
  legalResidenceAddr: 'Via Roma 1',
  legalResidenceCity: 'Piacenza',
  legalResidenceZip: '29121',
  businessLegalName: 'Salumeria Rossi',
  businessVatNumber: '01234567897',
  businessAddress: 'Via Roma 1',
  businessCity: 'Piacenza',
  businessZip: '29121',
  storeName: 'Salumeria Rossi',
  storeDescription: '',
  billingIban: '',
  storeLogo: null,
  storeMedia: [],
  storeAddress: 'Via Roma 1, Piacenza',
  storeLat: 45.05,
  storeLng: 9.69,
  acceptTos: true,
  acceptPrivacy: true,
  acceptAccuracy: true,
};

const invia = (corpo: unknown) =>
  (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/seller/apply', { method: 'POST', body: JSON.stringify(corpo) }),
  );

beforeEach(() => {
  stato.profilo = { role: 'buyer', approval_status: 'pending' };
  stato.scritture = [];
  stato.filtri = [];
  stato.righeScritte = [{ id: 'utente-1' }];
});

describe('POST /api/seller/apply', () => {
  it('un cliente diventa negozio in attesa, con la partita IVA salvata', async () => {
    const r = await invia(modulo);
    expect(r.status).toBe(200);
    expect(stato.scritture).toHaveLength(1);
    const v = stato.scritture[0];
    expect(v.role).toBe('seller');
    expect(v.approval_status).toBe('pending');
    expect(v.is_approved).toBe(false);
    expect(v.business_vat_number).toBe('01234567897');
    expect(v.business_legal_name).toBe('Salumeria Rossi');
    expect(v.business_city).toBe('Piacenza');
    expect(v.approval_requested_at).toBeTruthy();
  });

  it('la partita IVA scritta con IT e spazi si salva pulita', async () => {
    const r = await invia({ ...modulo, businessVatNumber: 'IT 0123456 7897' });
    expect(r.status).toBe(200);
    expect(stato.scritture[0].business_vat_number).toBe('01234567897');
  });

  it('senza partita IVA, o con la cifra di controllo sbagliata, non si scrive niente', async () => {
    const senza: Record<string, unknown> = { ...modulo };
    delete senza.businessVatNumber;
    expect((await invia(senza)).status).toBe(400);
    expect((await invia({ ...modulo, businessVatNumber: '01234567890' })).status).toBe(400);
    expect(stato.scritture).toHaveLength(0);
  });

  it('un negozio sospeso non torna in attesa', async () => {
    stato.profilo = { role: 'seller', approval_status: 'suspended' };
    const r = await invia(modulo);
    expect(r.status).toBe(403);
    expect(stato.scritture).toHaveLength(0);
  });

  it('un negozio approvato non si spegne la vetrina rimandando il modulo', async () => {
    stato.profilo = { role: 'seller', approval_status: 'approved' };
    expect((await invia(modulo)).status).toBe(409);
    expect(stato.scritture).toHaveLength(0);
  });

  it('un fattorino o un amministratore non perdono il loro ruolo', async () => {
    stato.profilo = { role: 'rider', approval_status: 'approved' };
    expect((await invia(modulo)).status).toBe(409);
    stato.profilo = { role: 'admin', approval_status: 'pending' };
    expect((await invia(modulo)).status).toBe(409);
    expect(stato.scritture).toHaveLength(0);
  });

  it('se lo stato cambia fra lettura e scrittura (sospeso nel frattempo) lo dice, non finge', async () => {
    stato.righeScritte = [];
    const r = await invia(modulo);
    expect(r.status).toBe(409);
    expect(stato.filtri.join(' | ')).toContain('approval_status');
    expect(stato.filtri.join(' | ')).not.toContain('suspended');
  });

  it('con l abbonamento spento non serve accettare nessun addebito', async () => {
    const { ABBONAMENTO_NEGOZI_ACCESO } = await import('@/lib/funzioni-al-lancio');
    if (ABBONAMENTO_NEGOZI_ACCESO) return;
    expect((await invia(modulo)).status).toBe(200);
  });

  it('i consensi obbligatori restano obbligatori', async () => {
    expect((await invia({ ...modulo, acceptTos: false })).status).toBe(400);
    expect(stato.scritture).toHaveLength(0);
  });
});
