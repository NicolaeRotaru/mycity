import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 31/10/2026 (ondata 4) — UN CLIENTE CHE CHIEDE DI DIVENTARE NEGOZIO VENIVA
 * RESPINTO DAL DATABASE DOPO AVER COMPILATO TUTTO IL MODULO.
 *
 * La pagina /sell scriveva il profilo dal browser con `role: 'seller'`. La
 * guardia sui profili (migrazione 119, l'ultima versione) lascia cambiare a una
 * persona solo le colonne del suo elenco `consentiti`, e `role` non c'è.
 *
 * La prova non cerca parole nella pagina: fa partire l'invio vero della pagina
 * e confronta OGNI scrittura che il browser fa su `profiles` con l'elenco letto
 * dalla migrazione — cioè con quello che il database accetterebbe davvero.
 *
 * E un negozio sospeso non deve più vedere il modulo: rimandarlo lo rimetteva
 * «in attesa», nella coda delle richieste nuove.
 */

const stato = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  mutationFn: null as null | ((f: unknown) => Promise<unknown>),
  scrittureBrowser: [] as { tabella: string; valori: Record<string, unknown> }[],
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/client', () => {
  const catena = (tabella: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'single', 'maybeSingle', 'in', 'or']) c[m] = () => c;
    c.update = (valori: Record<string, unknown>) => {
      stato.scrittureBrowser.push({ tabella, valori });
      return c;
    };
    (c as { then: unknown }).then = (ok: (v: unknown) => void) => ok({ data: null, error: null });
    return c;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'utente-1', email: 'mario@esempio.it' } } }) },
      from: catena,
    },
  };
});
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isAuthenticated: true, isLoading: false, isSeller: stato.profilo?.role === 'seller' }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: stato.profilo, isLoading: false }),
  useMutation: (opzioni: { mutationFn: (f: unknown) => Promise<unknown> }) => {
    stato.mutationFn = opzioni.mutationFn;
    return { mutate: vi.fn(), isPending: false };
  },
  useQueryClient: () => ({}),
}));
vi.mock('@/components/SellerApplicationForm', () => ({
  default: () => <form data-prova="modulo-venditore" />,
}));

const { default: SellPage } = await import('@/app/sell/page');

/** L'elenco delle colonne che la guardia del database lascia scrivere a una persona. */
function colonneConsentiteDalDatabase(): string[] {
  const sql = readFileSync('migrations/119_radiografia_18_agosto.sql', 'utf8');
  const blocco = sql.match(/consentiti constant text\[\] := ARRAY\[([\s\S]*?)\];/);
  if (!blocco) throw new Error('elenco consentiti non trovato nella migrazione 119');
  return [...blocco[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

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

beforeEach(() => {
  stato.profilo = null;
  stato.mutationFn = null;
  stato.scrittureBrowser = [];
});

describe('/sell: la richiesta di un cliente arriva davvero', () => {
  it('nessuna scrittura del browser sul profilo tocca colonne che il database rifiuta (role compreso)', async () => {
    const consentite = colonneConsentiteDalDatabase();
    expect(consentite, 'la guardia del database non deve lasciar scrivere il ruolo').not.toContain('role');

    stato.profilo = { role: 'buyer', approval_status: 'pending', approval_requested_at: null, email: 'mario@esempio.it' };
    const fetchFinto = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchFinto);

    renderToStaticMarkup(<SellPage />);
    expect(stato.mutationFn).toBeTypeOf('function');
    await stato.mutationFn!(modulo);

    for (const s of stato.scrittureBrowser.filter((x) => x.tabella === 'profiles')) {
      const rifiutate = Object.keys(s.valori).filter((k) => !consentite.includes(k));
      expect(rifiutate, 'il database risponderebbe «campo riservato non modificabile»').toEqual([]);
    }
    expect(fetchFinto).toHaveBeenCalledWith('/api/seller/apply', expect.objectContaining({ method: 'POST' }));
    vi.unstubAllGlobals();
  });

  it('se il server rifiuta, il messaggio arriva alla persona (non si inghiotte)', async () => {
    stato.profilo = { role: 'buyer', approval_status: 'pending', approval_requested_at: null, email: 'mario@esempio.it' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ ok: false, error: { message: 'Partita IVA non valida: controlla le 11 cifre' } }),
      { status: 400 },
    )));
    renderToStaticMarkup(<SellPage />);
    await expect(stato.mutationFn!(modulo)).rejects.toThrow('Partita IVA non valida');
    vi.unstubAllGlobals();
  });
});

describe('/sell: un negozio sospeso non si rimette da solo in coda', () => {
  it('sospeso: niente modulo, gli diciamo di scrivere all assistenza', () => {
    stato.profilo = {
      role: 'seller', approval_status: 'suspended', approval_requested_at: '2026-09-01T10:00:00Z', email: 'a@b.it',
    };
    const html = renderToStaticMarkup(<SellPage />);
    expect(html, 'rimandare il modulo lo riporterebbe «in attesa»').not.toContain('modulo-venditore');
    expect(html).toContain('sospeso');
  });

  it('rifiutato: il modulo resta, si può ripresentare', () => {
    stato.profilo = { role: 'seller', approval_status: 'rejected', approval_requested_at: '2026-09-01T10:00:00Z', email: 'a@b.it' };
    const html = renderToStaticMarkup(<SellPage />);
    expect(html).toContain('modulo-venditore');
  });
});
