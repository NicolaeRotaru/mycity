import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 25/11/2026 — IL MODULO CORTO DI /sell, VISTO DAL SERVER.
 *
 * Nicola: «questa pagina è troppo lunga, lascia il minimo indispensabile per identificare
 * quella attività facilmente». /sell adesso manda solo tipo, nome, indirizzo, partita IVA,
 * telefono e le spunte. Qui si prova che:
 *  · la richiesta corta entra (prima il server la respingeva: pretendeva titolare, ditta, sede);
 *  · senza partita IVA non entra: è l'unico dato che lo staff deve avere per approvare;
 *  · chi corregge la richiesta col modulo corto non perde logo, foto, IBAN, ditta e titolare
 *    già salvati: un campo che non arriva non si scrive;
 *  · un modulo vecchio con una data di nascita da minorenne è respinto come prima;
 *  · i dati del titolare si scrivono dopo, dal Profilo, con lo stesso freno dei 18 anni.
 */

const stato = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  scritture: [] as Record<string, unknown>[],
  avvisi: [] as string[][],
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: 'utente-1', email: 'forno@esempio.it' }, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  notifyAdmins: async (...a: string[]) => { stato.avvisi.push(a); return 'scritto'; },
}));
vi.mock('@/lib/agenzia/nuovo-cliente-n8n', () => ({ inviaNuovaAttivitaAlFlusso: async () => undefined }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      let valori: Record<string, unknown> | null = null;
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.neq = () => c;
      c.in = () => c;
      c.or = () => c;
      c.insert = async () => ({ error: null });
      c.maybeSingle = async () => ({ data: stato.profilo, error: null });
      c.update = (v: Record<string, unknown>) => { valori = v; stato.scritture.push(v); return c; };
      (c as { then: unknown }).then = (ok: (v: unknown) => void) =>
        ok(valori ? { data: [{ id: 'utente-1' }], error: null } : { data: null, error: null });
      return c;
    },
  }),
}));

const { POST } = await import('@/app/api/seller/apply/route');
const { PATCH: salvaTitolare } = await import('@/app/api/seller/titolare/route');

/** Esattamente quello che manda il modulo corto (components/SellerApplicationForm). */
const corto = {
  businessType: 'bar',
  businessTypeDetail: '',
  storeName: 'Bar Roma',
  businessVatNumber: '01234567897',
  contactPhone: '3331234567',
  acceptTos: true,
  acceptPrivacy: true,
  acceptAccuracy: true,
  acceptBilling: false,
  storeAddress: 'Via Roma 1, 29121 Piacenza',
  storeLat: 45.05,
  storeLng: 9.69,
};

const chiama = (gestore: unknown, corpo: unknown, metodo = 'POST') =>
  (gestore as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/seller/x', { method: metodo, body: JSON.stringify(corpo) }),
  );

/** Un anno di nascita che oggi dà 15 anni, così la prova non scade col calendario. */
const nascitaDaMinorenne = () => `${new Date().getFullYear() - 15}-01-01`;

beforeEach(() => {
  stato.profilo = { role: 'buyer', approval_status: 'pending', approval_requested_at: null };
  stato.scritture = [];
  stato.avvisi = [];
});

describe('il modulo corto arriva al server', () => {
  it('la richiesta con i soli dati per riconoscere l attività entra', async () => {
    const r = await chiama(POST, corto);
    expect(r.status).toBe(200);
    expect(stato.scritture).toHaveLength(1);
    expect(stato.scritture[0]).toMatchObject({
      store_name: 'Bar Roma',
      business_vat_number: '01234567897',
      phone: '3331234567',
      store_address: 'Via Roma 1, 29121 Piacenza',
      role: 'seller',
      approval_status: 'pending',
    });
  });

  it('senza partita IVA non entra: lo staff non potrebbe approvarla', async () => {
    const senza: Record<string, unknown> = { ...corto };
    delete senza.businessVatNumber;
    expect((await chiama(POST, senza)).status).toBe(400);
    expect((await chiama(POST, { ...corto, businessVatNumber: '01234567890' })).status).toBe(400);
    expect(stato.scritture).toHaveLength(0);
  });

  it('chi corregge la richiesta col modulo corto non perde quello che aveva già salvato', async () => {
    stato.profilo = { role: 'seller', approval_status: 'pending', approval_requested_at: '2026-11-20T10:00:00Z' };
    expect((await chiama(POST, corto)).status).toBe(200);
    const scritto = stato.scritture[0];
    for (const colonna of [
      'store_logo', 'store_media', 'store_description', 'billing_iban',
      'business_legal_name', 'business_address', 'business_city', 'business_zip', 'business_pec', 'business_sdi',
      'legal_first_name', 'legal_last_name', 'legal_fiscal_code', 'legal_birth_date',
      'legal_residence_addr', 'legal_residence_city', 'legal_residence_zip',
    ]) {
      expect(colonna in scritto, `il modulo corto cancellerebbe ${colonna}`).toBe(false);
    }
  });

  it('un modulo vecchio, ancora aperto in un browser, si salva come prima', async () => {
    const vecchio = {
      ...corto,
      legalFirstName: 'Mario', legalLastName: 'Rossi', legalFiscalCode: 'rssmra80e05g535x', legalBirthDate: '1980-05-05',
      legalResidenceAddr: 'Via Roma 1', legalResidenceCity: 'Piacenza', legalResidenceZip: '29121',
      businessLegalName: 'Bar Roma di Mario Rossi', businessAddress: 'Via Roma 1', businessCity: 'Piacenza', businessZip: '29121',
      businessPec: '', businessSdi: 'abc1234', billingIban: '', storeDescription: '', storeLogo: null, storeMedia: [],
    };
    expect((await chiama(POST, vecchio)).status).toBe(200);
    expect(stato.scritture[0]).toMatchObject({
      legal_fiscal_code: 'RSSMRA80E05G535X', business_legal_name: 'Bar Roma di Mario Rossi', business_sdi: 'ABC1234',
      business_pec: null, billing_iban: null, store_logo: null, store_media: [],
    });
  });

  it('un modulo vecchio con la data di nascita di un quindicenne resta fuori', async () => {
    expect((await chiama(POST, { ...corto, legalBirthDate: nascitaDaMinorenne() })).status).toBe(400);
    expect(stato.scritture).toHaveLength(0);
  });
});

describe('i dati del titolare si scrivono dal Profilo', () => {
  const titolare = {
    legalFirstName: 'Mario', legalLastName: 'Rossi', legalFiscalCode: 'rssmra80e05g535x', legalBirthDate: '1980-05-05',
    legalResidenceAddr: 'Via Roma 1', legalResidenceCity: 'Piacenza', legalResidenceZip: '29121',
  };

  it('un negozio li salva, col codice fiscale in maiuscolo', async () => {
    stato.profilo = { role: 'seller', approval_status: 'approved', store_name: 'Bar Roma' };
    expect((await chiama(salvaTitolare, titolare, 'PATCH')).status).toBe(200);
    expect(stato.scritture[0]).toEqual({
      legal_first_name: 'Mario', legal_last_name: 'Rossi', legal_fiscal_code: 'RSSMRA80E05G535X', legal_birth_date: '1980-05-05',
      legal_residence_addr: 'Via Roma 1', legal_residence_city: 'Piacenza', legal_residence_zip: '29121',
    });
    expect(stato.avvisi, 'la prima volta è il negozio che completa il profilo: niente avviso').toHaveLength(0);
  });

  it('un quindicenne non passa: le condizioni d uso dicono diciotto anni', async () => {
    stato.profilo = { role: 'seller', approval_status: 'approved' };
    expect((await chiama(salvaTitolare, { ...titolare, legalBirthDate: nascitaDaMinorenne() }, 'PATCH')).status).toBe(400);
    expect(stato.scritture).toHaveLength(0);
  });

  it('chi non è un negozio non li scrive', async () => {
    stato.profilo = { role: 'buyer', approval_status: 'pending' };
    expect((await chiama(salvaTitolare, titolare, 'PATCH')).status).toBe(403);
    expect(stato.scritture).toHaveLength(0);
  });

  it('un cambio di chi firma lo sa subito lo staff', async () => {
    stato.profilo = {
      role: 'seller', approval_status: 'approved', store_name: 'Bar Roma',
      legal_first_name: 'Mario', legal_last_name: 'Rossi', legal_fiscal_code: 'RSSMRA80E05G535X', legal_birth_date: '1980-05-05',
      legal_residence_addr: 'Via Roma 1', legal_residence_city: 'Piacenza', legal_residence_zip: '29121',
    };
    expect((await chiama(salvaTitolare, { ...titolare, legalFiscalCode: 'BNCLRA85M41G535Y' }, 'PATCH')).status).toBe(200);
    expect(stato.avvisi).toHaveLength(1);
    expect(stato.avvisi[0][1]).toContain('legal_fiscal_code');
    expect(stato.avvisi[0][1]).not.toContain('legal_first_name');
  });
});
