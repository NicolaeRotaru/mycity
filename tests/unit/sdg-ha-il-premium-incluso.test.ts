import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 28/11/2026 — SDG HA IL PREMIUM, INCLUSO, E NON SCEGLIE L'ABBONAMENTO.
 *
 * Nicola, dal telefono: «metti già di standard SDG è un abbonamento premium ed è l'unico che non paga,
 * quindi togli la funzione dentro SDG di scegliere l'abbonamento». Il pannello di SDG diceva «Nessun
 * abbonamento» e la dashboard gli mostrava «Scegli il tuo abbonamento ai servizi».
 *
 * Qui si chiama la rotta vera (/api/seller/preventivo) con un database finto: per SDG il calcolo del
 * server dice «Premium, attivo, incluso» anche senza nessuna riga in `abbonamenti_servizi`, e la scelta
 * (POST) è rifiutata senza mandare avvisi a Nicola. Per ogni altro negozio non cambia niente.
 * Sul codice di prima: `attivo` era `null` per SDG e il POST scriveva l'avviso «Preventivo accettato».
 */

const SDG = '11111111-1111-1111-1111-5d9000000001';

const stato = vi.hoisted(() => ({
  idUtente: '11111111-1111-1111-1111-5d9000000001',
  avvisi: [] as string[],
}));

vi.mock('@/lib/api/middleware', () => ({
  withSellerAnchePendingRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: stato.idUtente, email: 'chi@esempio.it' }, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  notifyAdmins: async (titolo: string) => {
    stato.avvisi.push(titolo);
    return 'scritto';
  },
  togliLAvvisoAgliAmministratori: async () => undefined,
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.in = () => c;
      c.order = () => c;
      // Nessun abbonamento pagato, nessun prodotto: SDG il Premium non l'ha mai comprato.
      c.limit = async () => ({ data: [], error: null });
      c.maybeSingle = async () =>
        tabella === 'profiles'
          ? { data: { store_name: 'Negozio', store_logo: null, store_media: [], business_type: 'bar', store_customization: {} }, error: null }
          : { data: null, error: null };
      return c;
    },
  }),
}));

const { GET, POST } = await import('@/app/api/seller/preventivo/route');
const { etichettaPiano } = await import('@/lib/agenzia/etichetta-piano');
const { statoRiquadro } = await import('@/lib/agenzia/riquadro-abbonamento');
const { abbonamentoIncluso } = await import('@/lib/agenzia/abbonamento-di-sdg');

const chiama = (metodo: 'GET' | 'POST', corpo?: unknown) => {
  const r = new Request('http://localhost/api/seller/preventivo', { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  return ((metodo === 'GET' ? GET : POST) as unknown as (r: Request) => Promise<Response>)(r);
};

beforeEach(() => {
  stato.idUtente = SDG;
  stato.avvisi = [];
});

describe('SDG ha il Premium incluso', () => {
  it('il calcolo del server dice Premium attivo e incluso, senza nessuna riga pagata', async () => {
    const r = await chiama('GET');
    expect(r.status).toBe(200);
    const { data } = (await r.json()) as { data: { attivo: unknown } };
    expect(data.attivo).toEqual({ fascia: 'premium', stato: 'active', rinnovoIl: null, incluso: true });
  });

  it('la scelta di un abbonamento è rifiutata e Nicola non riceve l avviso', async () => {
    const r = await chiama('POST', { abbonamento: 'base' });
    expect(r.status).toBe(409);
    expect(stato.avvisi).toEqual([]);
  });

  it('il menu in basso dice «Piano Premium · incluso», e la dashboard non chiede di scegliere', () => {
    const attivo = abbonamentoIncluso(SDG);
    expect(etichettaPiano(attivo, true)).toMatchObject({ testo: 'Piano Premium · incluso', tono: 'attivo', voce: 'Il tuo abbonamento' });
    expect(statoRiquadro(attivo, true).tipo).toBe('attivo');
  });
});

describe('per ogni altro negozio non cambia niente', () => {
  it('senza abbonamento pagato resta «nessuno», e può scegliere', async () => {
    stato.idUtente = 'a1b2c3d4-0000-0000-0000-000000000000';
    const { data } = (await (await chiama('GET')).json()) as { data: { attivo: unknown } };
    expect(data.attivo).toBeNull();
    expect(abbonamentoIncluso(stato.idUtente)).toBeNull();
    const r = await chiama('POST', { abbonamento: 'base' });
    expect(r.status).toBe(200);
    expect(stato.avvisi.length).toBe(1);
  });
});
