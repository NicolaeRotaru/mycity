import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STATI_RIDER_RITENTABILI } from '@/lib/stripe/payout';

/**
 * 31/8/2026 (R120) — IL RESIDUO DEL CONTRASSEGNO SPARIVA SE IL FATTORINO NON
 * AVEVA ANCORA COLLEGATO L'IBAN.
 *
 * Il credito MyCity puo' portare il contante sotto il compenso del fattorino:
 * lui consegna, non incassa niente, e una parte del compenso resta dovuta. La
 * conferma dell'incasso lascia quell'ordine in 'HELD', ed e' li' che il giro
 * dei bonifici lo andava a prendere — cercando pero' ESATTAMENTE 'HELD'.
 *
 * Al primo passaggio, se il fattorino non ha ancora agganciato Stripe,
 * `releaseRiderPayout` riscrive quello stato in 'PENDING_RIDER_ONBOARDING'
 * (lib/stripe/payout.ts). Da quel momento l'ordine era fuori da tutte e due le
 * ricerche del giro: quella dei pagamenti con carta filtra
 * `payment_method='card'`, quella dei contanti cercava solo 'HELD'. Il compenso
 * restava dovuto e non partiva mai piu' — lo stesso guasto che la riparazione
 * precedente diceva di aver chiuso, spostato di un passo. E nessuno vieta a un
 * fattorino di prendere ordini prima di collegare l'IBAN: il controllo su
 * Stripe esiste solo per i negozi.
 *
 * Sulla strada della carta lo stesso stato era gia' trattato come ritentabile.
 * Era solo la strada dei contanti a essere un vicolo cieco.
 */

type Ordine = {
  id: string;
  payment_method?: string;
  payout_status?: string | null;
  delivery_status?: string;
  dispute_status?: string | null;
  internal_dispute_status?: string | null;
  rider_id?: string | null;
  rider_payout_status?: string | null;
  rider_payout_claimed_at?: string | null;
  payout_claimed_at?: string | null;
  delivered_at?: string | null;
};

const state: { ordini: Ordine[]; fattorinoHaCollegatoIban: boolean } = {
  ordini: [],
  fattorinoHaCollegatoIban: false,
};

const releaseOrderPayoutMock = vi.fn(async (_id: string) => ({ ok: true as const, transferId: 'tr_negozio' }));

/**
 * Il compenso del fattorino come lo scrive la funzione vera: senza Connect
 * attivo l'ordine NON resta com'era, viene riscritto in
 * 'PENDING_RIDER_ONBOARDING'. E' quella riscrittura a far sparire l'ordine
 * dalla ricerca del giro dopo, quindi la prova deve metterla in scena: un finto
 * che lascia lo stato a 'HELD' collauderebbe un mondo che non esiste.
 */
const releaseRiderPayoutMock = vi.fn(async (id: string) => {
  const ordine = state.ordini.find((o) => o.id === id);
  if (!ordine) return { ok: false as const, code: 'NOT_FOUND' as const, reason: 'Ordine non trovato' };
  if (!state.fattorinoHaCollegatoIban) {
    ordine.rider_payout_status = 'PENDING_RIDER_ONBOARDING';
    return { ok: false as const, code: 'RIDER_NOT_READY' as const, reason: 'Rider senza Connect/IBAN attivo' };
  }
  ordine.rider_payout_status = 'TRANSFERRED';
  return { ok: true as const, transferId: 'tr_fattorino' };
});

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/email/templates', () => ({ refundIssuedTemplate: () => ({ subject: 's', html: 'h', text: 't' }) }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    balance: { retrieve: async () => ({ available: [{ currency: 'eur', amount: 10_000_000 }] }) },
  }),
}));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));

/**
 * Del modulo dei bonifici si sostituiscono SOLO le due funzioni che chiamano
 * Stripe: gli elenchi di stati restano quelli veri, cosi' la prova non collauda
 * una copia comoda del filtro scritta qui dentro.
 */
vi.mock('@/lib/stripe/payout', async (originale) => {
  const vero = await originale<typeof import('@/lib/stripe/payout')>();
  return {
    ...vero,
    releaseOrderPayout: (id: string) => releaseOrderPayoutMock(id),
    releaseRiderPayout: (id: string) => releaseRiderPayoutMock(id),
  };
});

/**
 * Finta tabella `orders` che applica DAVVERO i filtri, anche quelli scritti
 * alla PostgREST dentro un `or`. Se ignorasse i filtri, il giro vedrebbe tutti
 * gli ordini e la prova sarebbe verde qualunque cosa cerchi il codice: e' il
 * modo piu' facile di collaudare niente.
 */
function tabellaOrdini(righe: Ordine[]) {
  const uguali: Record<string, unknown> = {};
  const dentro: Record<string, readonly unknown[]> = {};
  const nulli: string[] = [];
  const nonNulli: string[] = [];
  const minoriDi: Record<string, string> = {};
  const nonOltre: Record<string, string> = {};
  const gruppiOr: string[] = [];
  let scrittura: Record<string, unknown> | null = null;

  const valoreDi = (o: Ordine, colonna: string): unknown => (o as Record<string, unknown>)[colonna] ?? null;
  /**
   * Le condizioni dentro un `or` sono separate da virgole, ma una virgola
   * dentro `in.(A,B,C)` appartiene all'elenco e non separa niente. Tagliare a
   * ogni virgola spezzava proprio il filtro che questa prova deve verificare.
   */
  const condizioniDi = (gruppo: string): string[] => {
    const condizioni: string[] = [];
    let dentroParentesi = 0;
    let corrente = '';
    for (const carattere of gruppo) {
      if (carattere === '(') dentroParentesi++;
      if (carattere === ')') dentroParentesi--;
      if (carattere === ',' && dentroParentesi === 0) {
        condizioni.push(corrente);
        corrente = '';
        continue;
      }
      corrente += carattere;
    }
    if (corrente) condizioni.push(corrente);
    return condizioni;
  };
  const passaUnaCondizione = (o: Ordine, cond: string): boolean => {
    const valore = valoreDi(o, cond.split('.')[0]);
    if (cond.includes('.is.null')) return valore == null;
    const inMatch = cond.match(/^[a-z_]+\.in\.\((.*)\)$/);
    if (inMatch) return inMatch[1].split(',').includes(String(valore));
    const eqMatch = cond.match(/^[a-z_]+\.eq\.(.*)$/);
    if (eqMatch) return String(valore) === eqMatch[1];
    throw new Error(`condizione PostgREST non riconosciuta dalla finta tabella: ${cond}`);
  };

  const b: Record<string, unknown> = {
    select: () => b,
    update: (v: Record<string, unknown>) => ((scrittura = v), b),
    eq: (c: string, v: unknown) => ((uguali[c] = v), b),
    in: (c: string, v: readonly unknown[]) => ((dentro[c] = v), b),
    is: (c: string, v: unknown) => (v === null ? nulli.push(c) : null, b),
    not: (c: string, _op: string, v: unknown) => (v === null ? nonNulli.push(c) : null, b),
    or: (expr: string) => (gruppiOr.push(expr), b),
    lte: (c: string, v: string) => ((nonOltre[c] = v), b),
    lt: (c: string, v: string) => ((minoriDi[c] = v), b),
    limit: () => b,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (risolvi: (x: unknown) => unknown) => {
      const trovate = righe.filter((o) => {
        for (const [c, v] of Object.entries(uguali)) if (valoreDi(o, c) !== v) return false;
        for (const [c, v] of Object.entries(dentro)) if (!v.includes(valoreDi(o, c))) return false;
        for (const c of nulli) if (valoreDi(o, c) != null) return false;
        for (const c of nonNulli) if (valoreDi(o, c) == null) return false;
        for (const [c, v] of Object.entries(minoriDi)) {
          const attuale = valoreDi(o, c);
          if (attuale == null || String(attuale) >= v) return false;
        }
        for (const [c, v] of Object.entries(nonOltre)) {
          const attuale = valoreDi(o, c);
          if (attuale == null || String(attuale) > v) return false;
        }
        return gruppiOr.every((gruppo) => condizioniDi(gruppo).some((cond) => passaUnaCondizione(o, cond)));
      });
      if (scrittura) for (const o of trovate) Object.assign(o, scrittura);
      return risolvi({ data: trovate.map((o) => ({ ...o })), error: null });
    },
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'orders') return tabellaOrdini(state.ordini);
      if (tabella === 'operational_alert_log') {
        return {
          select: () => ({ eq: () => ({ gte: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
          upsert: () => Promise.resolve({ error: null }),
        };
      }
      // Nessun reso e nessuna contestazione aperta.
      return { select: () => ({ in: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }) };
    },
  }),
}));

async function giro(): Promise<Record<string, number | boolean>> {
  const { POST } = await import('@/app/api/cron/release-payouts/route');
  const res = await (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://x', { method: 'POST' }),
  );
  return res.json();
}

const dueOreFa = () => new Date(Date.now() - 2 * 3_600_000).toISOString();

/** Il contrassegno col compenso rimasto scoperto dal credito: l'ordine di questa storia. */
const contrassegnoScoperto = (rider_payout_status: string | null): Ordine => ({
  id: 'contrassegno-scoperto',
  payment_method: 'cod',
  // Il negozio non c'entra: la rimessa del contante non e' ancora stata
  // confermata da un amministratore, quindi il passaggio dei negozi lo salta.
  payout_status: 'AWAITING_REMITTANCE',
  delivery_status: 'DELIVERED',
  dispute_status: null,
  internal_dispute_status: null,
  rider_id: 'fattorino-1',
  rider_payout_status,
  rider_payout_claimed_at: null,
  delivered_at: dueOreFa(),
});

beforeEach(() => {
  state.ordini = [];
  state.fattorinoHaCollegatoIban = false;
  releaseOrderPayoutMock.mockClear();
  releaseRiderPayoutMock.mockClear();
});

describe('il residuo di un contrassegno quando il fattorino non ha ancora l IBAN', () => {
  it('viene ripescato al giro dopo, invece di sparire per sempre', async () => {
    state.ordini = [contrassegnoScoperto('HELD')];

    // Primo giro: il fattorino non ha ancora collegato l'IBAN.
    const primo = await giro();
    expect(
      releaseRiderPayoutMock,
      'il primo giro non prova nemmeno a pagare il compenso rimasto scoperto dal credito',
    ).toHaveBeenCalledWith('contrassegno-scoperto');
    expect(primo.riderSkipped, 'un compenso non pagabile oggi va contato fra quelli rimandati').toBe(1);
    expect(state.ordini[0].rider_payout_status).toBe('PENDING_RIDER_ONBOARDING');

    // Secondo giro: il fattorino ha collegato l'IBAN, i soldi devono partire.
    releaseRiderPayoutMock.mockClear();
    state.fattorinoHaCollegatoIban = true;
    const secondo = await giro();
    expect(
      releaseRiderPayoutMock,
      'il fattorino ha consegnato e collegato l IBAN, e il suo compenso non lo cerca piu nessuno: quei soldi restano suoi e non partono mai',
    ).toHaveBeenCalledWith('contrassegno-scoperto');
    expect(secondo.riderReleased, 'il compenso doveva essere versato al secondo giro').toBe(1);
    expect(state.ordini[0].rider_payout_status).toBe('TRANSFERRED');
  });

  it('viene ripescato anche dopo un bonifico fallito (FAILED)', async () => {
    state.ordini = [contrassegnoScoperto('FAILED')];
    state.fattorinoHaCollegatoIban = true;

    const esito = await giro();
    expect(
      releaseRiderPayoutMock,
      'un bonifico fallito una volta non veniva piu ritentato sui contrassegni',
    ).toHaveBeenCalledWith('contrassegno-scoperto');
    expect(esito.riderReleased).toBe(1);
  });

  it('lo stato scritto quando manca l IBAN e uno di quelli da cui si ritenta', () => {
    // Se un domani quello stato uscisse dall'elenco dei ritentabili, il giro
    // tornerebbe a perdere il residuo senza che nessuna prova lo dica.
    expect(STATI_RIDER_RITENTABILI).toContain('PENDING_RIDER_ONBOARDING');
  });
});

/**
 * Il rovescio: allargare la ricerca dei contrassegni non deve tirare dentro
 * compensi che non sono dovuti. Se succedesse, il giro proverebbe a pagare due
 * volte lo stesso fattorino a ogni passaggio.
 */
describe('gli altri contrassegni restano fuori dalla ricerca dei compensi', () => {
  it('quello in cui il contante bastava (CASH_WITHHELD) non si paga una seconda volta', async () => {
    state.ordini = [contrassegnoScoperto('CASH_WITHHELD')];
    state.fattorinoHaCollegatoIban = true;

    await giro();
    expect(
      releaseRiderPayoutMock,
      'il fattorino si e gia tenuto il compenso dal contante: un bonifico qui glielo pagherebbe due volte',
    ).not.toHaveBeenCalled();
  });

  it('quello gia versato (TRANSFERRED) non torna in coda', async () => {
    state.ordini = [contrassegnoScoperto('TRANSFERRED')];
    state.fattorinoHaCollegatoIban = true;

    await giro();
    expect(releaseRiderPayoutMock, 'un compenso gia versato non si ripaga').not.toHaveBeenCalled();
  });

  it('quello senza niente da versare (nessuno stato scritto) resta fuori', async () => {
    state.ordini = [contrassegnoScoperto(null)];
    state.fattorinoHaCollegatoIban = true;

    await giro();
    expect(
      releaseRiderPayoutMock,
      'sul contrassegno lo stato vuoto vuol dire «niente da versare»: cercarlo riempirebbe il giro di ordini da scartare',
    ).not.toHaveBeenCalled();
  });

  it('quello con un turno appena preso (PROCESSING) non viene scavalcato', async () => {
    state.ordini = [{ ...contrassegnoScoperto('PROCESSING'), rider_payout_claimed_at: new Date().toISOString() }];
    state.fattorinoHaCollegatoIban = true;

    await giro();
    expect(
      releaseRiderPayoutMock,
      'quel compenso e in lavorazione adesso: prenderlo di nuovo vuol dire due bonifici in volo',
    ).not.toHaveBeenCalled();
  });
});
