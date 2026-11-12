import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La PATCH dei dati per i bonifici non riscrive in silenzio i dati fiscali.
 * Il controllore C01 (12/11) ha visto che riscriveva senza condizioni partita IVA,
 * ragione sociale, sede, PEC e SDI di un negozio approvato, avvisando gli
 * amministratori solo per l'IBAN: così aggirava il «una volta sola» della rotta
 * della partita IVA. Ora la partita IVA già presente non si cambia da qui, e ogni
 * cambio degli altri dati fiscali avvisa gli amministratori.
 */

const stato = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  scritture: [] as Record<string, unknown>[],
  filtri: [] as string[],
  avvisi: [] as string[],
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: 'forno-1', email: 'forno@esempio.it' }, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  notifyAdmins: vi.fn(async (titolo: string) => {
    stato.avvisi.push(titolo);
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      let scrive = false;
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = (col: string, v: unknown) => { stato.filtri.push(`${col}=${String(v)}`); return c; };
      c.neq = (col: string, v: unknown) => { stato.filtri.push(`${col}!=${String(v)}`); return c; };
      c.or = (f: string) => { stato.filtri.push(`or:${f}`); return c; };
      c.maybeSingle = async () => ({ data: stato.profilo, error: null });
      c.update = (valori: Record<string, unknown>) => { scrive = true; stato.scritture.push(valori); return c; };
      (c as { then: unknown }).then = (ok: (v: unknown) => void) =>
        ok(scrive ? { data: [{ id: 'forno-1' }], error: null } : { data: null, error: null });
      return c;
    },
  }),
}));

const rotta = (await import('@/app/api/seller/apply/route')) as Record<string, unknown>;
const salva = (corpo: unknown) => {
  const gestore = rotta['PATCH'] as ((r: Request) => Promise<Response>) | undefined;
  if (typeof gestore !== 'function') return Promise.resolve(new Response(null, { status: 405 }));
  return gestore(new Request('http://localhost/api/seller/apply', { method: 'PATCH', body: JSON.stringify(corpo) }));
};

const dati = {
  billingIban: 'it60 x054 2811 1010 0000 0123 456',
  businessLegalName: 'Pane Quotidiano snc',
  businessVatNumber: '01234567897',
  businessAddress: 'Via Calzolai 1',
  businessCity: 'Piacenza',
  businessZip: '29121',
  businessPec: '',
  businessSdi: '',
};

beforeEach(() => {
  stato.profilo = {
    role: 'seller', approval_status: 'approved', billing_iban: 'IT60X0542811101000000123456', store_name: 'Pane Quotidiano',
    business_legal_name: 'Pane Quotidiano snc', business_vat_number: '01234567897',
    business_address: 'Via Calzolai 1', business_city: 'Piacenza', business_zip: '29121',
    business_pec: null, business_sdi: null,
  };
  stato.scritture = [];
  stato.filtri = [];
  stato.avvisi = [];
});

describe('i dati fiscali del negozio non si cambiano in silenzio', () => {
  it('una partita IVA già presente non si sostituisce dalla PATCH', async () => {
    const r = await salva({ ...dati, businessVatNumber: '12345678903' });
    expect(r.status, 'la PATCH ha sostituito la partita IVA verificata').toBe(409);
    expect(stato.scritture).toHaveLength(0);
  });

  it('la stessa partita IVA con la ragione sociale cambiata si salva e avvisa gli amministratori', async () => {
    const r = await salva({ ...dati, businessLegalName: 'Altra Ditta srl' });
    expect(r.status).toBe(200);
    expect(stato.scritture).toHaveLength(1);
    expect(stato.avvisi, 'nessun avviso sul cambio dei dati fiscali').toContain('Dati fiscali del negozio cambiati');
  });

  it('salvare gli stessi dati non manda avvisi', async () => {
    const r = await salva(dati);
    expect(r.status).toBe(200);
    expect(stato.avvisi).toHaveLength(0);
  });

  it('la prima partita IVA inserita da qui avvisa gli amministratori, come la rotta della partita IVA', async () => {
    stato.profilo = { role: 'seller', approval_status: 'approved', billing_iban: null, store_name: 'Pane Quotidiano' };
    const r = await salva(dati);
    expect(r.status).toBe(200);
    expect(stato.avvisi).toContain('Dati fiscali del negozio cambiati');
    expect(stato.filtri, 'due salvataggi insieme dal campo vuoto scrivono senza condizione').toContain(
      'or:business_vat_number.is.null,business_vat_number.eq.',
    );
  });

  it('una partita IVA vecchia salvata con «IT» davanti non blocca chi rimanda la stessa', async () => {
    stato.profilo = { ...stato.profilo, business_vat_number: 'IT01234567897' };
    const r = await salva(dati);
    expect(r.status, 'falso 409: la stessa partita IVA col prefisso IT è stata presa per un cambio').toBe(200);
  });
});
