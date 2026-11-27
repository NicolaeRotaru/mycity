import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 26/11/2026 — IL PREVENTIVO ACCETTATO DUE VOLTE NELLO STESSO GIORNO CON SCELTE DIVERSE.
 *
 * L'avviso agli amministratori si scrive una volta per giorno e per fascia. Chi accettava Base e
 * poi, lo stesso giorno, Premium, lasciava a Nicola due avvisi: «sceglie Base» e «sceglie
 * Premium». Tornando a Base, il secondo Base era un doppione e restava in cima Premium: gli avvisi
 * dicevano il contrario dell'ultima scelta. Adesso resta solo l'avviso dell'ultima scelta.
 */

const stato = vi.hoisted(() => ({
  // Gli avvisi agli amministratori, come li tiene il database: uno per chiave.
  avvisi: new Map<string, string>(),
}));

vi.mock('@/lib/api/middleware', () => ({
  withSellerAnchePendingRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: 'negozio-1', email: 'bar@esempio.it' }, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  notifyAdmins: async (_titolo: string, corpo: string, _link: string, opzioni: { unaVoltaPer: string }) => {
    if (stato.avvisi.has(opzioni.unaVoltaPer)) return 'gia-mandato';
    stato.avvisi.set(opzioni.unaVoltaPer, corpo);
    return 'scritto';
  },
  togliLAvvisoAgliAmministratori: async (chiave: string) => {
    stato.avvisi.delete(chiave);
    return true;
  },
}));
vi.mock('@/lib/agenzia/leggi-preventivo', () => ({
  leggiPreventivo: async (_id: string, scelto: string) => ({
    preventivo: { numero: 'P-20261126-NEGOZI', attivita: 'Bar Roma', scelto, offerta: null },
    telefono: null,
    socials: null,
  }),
}));
vi.mock('@/lib/agenzia/preventivo', () => ({
  ABBONAMENTI: ['base', 'business', 'premium'],
  testoAvvisoPreventivo: (p: { scelto: string }) => `sceglie ${p.scelto}`,
}));
vi.mock('@/lib/agenzia/offerta-su-misura', () => ({ testoOffertaPerAvviso: () => '' }));
vi.mock('@/lib/agenzia/flusso-n8n', () => ({ inviaAlFlusso: async () => 'spento' }));

const { POST } = await import('@/app/api/seller/preventivo/route');

const accetta = async (abbonamento: string) => {
  const r = await (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/seller/preventivo', { method: 'POST', body: JSON.stringify({ abbonamento }) }),
  );
  expect(r.status).toBe(200);
};

beforeEach(() => {
  stato.avvisi.clear();
});

describe('preventivo accettato due volte nello stesso giorno con scelte diverse', () => {
  it('Base e poi Premium: resta solo l avviso di Premium', async () => {
    await accetta('base');
    await accetta('premium');
    expect([...stato.avvisi.values()]).toEqual(['sceglie premium']);
  });

  it('Base, Premium e di nuovo Base: resta solo l avviso di Base', async () => {
    await accetta('base');
    await accetta('premium');
    await accetta('base');
    expect([...stato.avvisi.values()]).toEqual(['sceglie base']);
  });

  it('lo stesso clic ripetuto resta un avviso solo', async () => {
    await accetta('business');
    await accetta('business');
    expect([...stato.avvisi.values()]).toEqual(['sceglie business']);
  });
});
