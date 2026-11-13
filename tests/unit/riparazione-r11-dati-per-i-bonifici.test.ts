import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R11-003 — Un negozio già approvato può scrivere IBAN e dati della ditta.
 * Prima si scrivevano solo dal modulo d'iscrizione: /sell rimanda l'approvato a
 * /seller/profile (senza quei campi) e il POST di /api/seller/apply gli risponde
 * «già approvato». Pane Quotidiano, approvato prima del modulo nuovo, non poteva
 * scrivere l'IBAN e il bonifico del lunedì non sapeva dove andare.
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
  stato.profilo = { role: 'seller', approval_status: 'approved', billing_iban: null, store_name: 'Pane Quotidiano' };
  stato.scritture = [];
  stato.filtri = [];
  stato.avvisi = [];
});

describe('R11-003 — dati per i bonifici di un negozio approvato', () => {
  it('il negozio approvato salva IBAN e dati della ditta, puliti', async () => {
    const r = await salva(dati);
    expect(r.status, 'il negozio approvato non ha nessun posto dove scrivere l IBAN').toBe(200);
    expect(stato.scritture).toHaveLength(1);
    expect(stato.scritture[0]).toMatchObject({
      billing_iban: 'IT60X0542811101000000123456',
      business_vat_number: '01234567897',
      business_legal_name: 'Pane Quotidiano snc',
    });
  });

  it('non tocca ruolo né stato del negozio', async () => {
    await salva(dati);
    const v = stato.scritture[0] ?? {};
    expect(v).not.toHaveProperty('role');
    expect(v).not.toHaveProperty('approval_status');
    expect(v).not.toHaveProperty('is_approved');
  });

  it('IBAN o partita IVA sbagliati non si salvano', async () => {
    expect((await salva({ ...dati, billingIban: 'IT60X0542811101000000123457' })).status).toBe(400);
    expect((await salva({ ...dati, businessVatNumber: '01234567890' })).status).toBe(400);
    expect(stato.scritture).toHaveLength(0);
  });

  it('un negozio sospeso o un cliente non scrivono', async () => {
    stato.profilo = { role: 'seller', approval_status: 'suspended' };
    expect((await salva(dati)).status).toBe(403);
    stato.profilo = { role: 'buyer', approval_status: null };
    expect((await salva(dati)).status).toBe(403);
    expect(stato.scritture).toHaveLength(0);
  });

  it('un IBAN nuovo o cambiato lo sanno subito gli amministratori', async () => {
    await salva(dati);
    expect(stato.avvisi).toContain('IBAN del negozio inserito');
    stato.profilo = { role: 'seller', approval_status: 'approved', billing_iban: 'IT60X0542811101000000123456', store_name: 'P', business_vat_number: '01234567897', business_legal_name: 'Pane Quotidiano snc', business_address: 'Via Calzolai 1', business_city: 'Piacenza', business_zip: '29121' };
    stato.avvisi = [];
    await salva(dati);
    expect(stato.avvisi).toHaveLength(0);
  });
});
