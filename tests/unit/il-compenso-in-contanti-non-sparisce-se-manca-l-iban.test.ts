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
 * `releaseRiderPayout` riscrive quello stato (lib/stripe/payout.ts). Da quel
 * momento l'ordine era fuori da tutte e due le ricerche del giro: quella dei
 * pagamenti con carta filtra `payment_method='card'`, quella dei contanti
 * cercava solo 'HELD'. Il compenso restava dovuto e non partiva mai piu' — lo
 * stesso guasto che la riparazione precedente diceva di aver chiuso, spostato
 * di un passo. E nessuno vieta a un fattorino di prendere ordini prima di
 * collegare l'IBAN: il controllo su Stripe esiste solo per i negozi.
 *
 * 31/8/2026 — PERCHE' QUI NON C'E' NESSUN SOSIA DI `releaseRiderPayout`.
 *
 * La versione precedente di questa prova sostituiva quella funzione con un
 * finto che scriveva 'PENDING_RIDER_ONBOARDING' battuto a mano qui dentro.
 * Cosi' i due capi della storia — lo stato che il pagamento SCRIVE e lo stato
 * che il giro CERCA — non erano legati dal codice ma da un doppione di testo:
 * il collaudo ha fatto scrivere alla riga vera di produzione un altro stato
 * gia' ammesso dal database ('AWAITING_REMITTANCE'), il compenso in contanti e'
 * tornato a sparire, e la prova e' rimasta verde.
 *
 * Adesso gira la funzione vera. Il primo giro non dice piu' quale stato si
 * aspetta: legge quello che il pagamento ha davvero scritto e pretende che il
 * giro dopo lo ritrovi e paghi. Chi cambia una delle due estremita' rompe la
 * prova, che e' l'unico motivo per cui questa prova esiste.
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
  rider_payout_at?: string | null;
  rider_transfer_id?: string | null;
  rider_payout_tentativo?: number | null;
  payout_claimed_at?: string | null;
  delivered_at?: string | null;
  /** Il contante che il fattorino ha davvero in mano: qui zero, se l'e' mangiato il credito. */
  total_price?: number | null;
  rider_fee_cents?: number | null;
  shipping_cost?: number | null;
  pickup_in_store?: boolean | null;
  cash_confirmed_at?: string | null;
  stripe_charge_id?: string | null;
  stripe_transfer_group?: string | null;
};

/** Il compenso del fattorino su questa consegna: tre euro. */
const COMPENSO_CENTS = 300;
const CONTO_STRIPE_DEL_FATTORINO = 'acct_fattorino';

const state: { ordini: Ordine[]; fattorinoHaCollegatoIban: boolean } = {
  ordini: [],
  fattorinoHaCollegatoIban: false,
};

/** Ogni bonifico davvero partito verso Stripe: e' la cassa, non un contatore. */
const bonificiPartiti: { amount: number; destination: string }[] = [];

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/email/templates', () => ({ refundIssuedTemplate: () => ({ subject: 's', html: 'h', text: 't' }) }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));

vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    balance: { retrieve: async () => ({ available: [{ currency: 'eur', amount: 10_000_000 }] }) },
    transfers: {
      create: async (p: { amount: number; destination: string }) => {
        bonificiPartiti.push({ amount: p.amount, destination: p.destination });
        return { id: `tr_${bonificiPartiti.length}` };
      },
    },
  }),
}));

/**
 * Del modulo dei bonifici NON si sostituisce niente: `releaseRiderPayout` e'
 * quella di produzione. La spia serve solo a contare le chiamate e passa la
 * mano alla funzione vera, che scrive negli ordini quello che scriverebbe in
 * produzione. Se qui ci fosse un sosia, cambiare la riga di produzione non
 * farebbe diventare rossa nemmeno una riga di questo file.
 */
// `vi.hoisted` perche' la finta viene costruita prima di questo file: senza,
// la spia non esiste ancora quando il modulo dei bonifici viene caricato.
const { spiaCompensoFattorino } = vi.hoisted(() => ({
  spiaCompensoFattorino: vi.fn<(id: string) => Promise<unknown>>(),
}));
vi.mock('@/lib/stripe/payout', async (originale) => {
  const vero = await originale<typeof import('@/lib/stripe/payout')>();
  spiaCompensoFattorino.mockImplementation((id: string) => vero.releaseRiderPayout(id));
  return { ...vero, releaseRiderPayout: (id: string) => spiaCompensoFattorino(id) };
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

  const filtra = (): Ordine[] =>
    righe.filter((o) => {
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

  /** Una lettura sola: applicare la scrittura due volte falserebbe il conto. */
  const esegui = (): Ordine[] => {
    const trovate = filtra();
    if (scrittura) for (const o of trovate) Object.assign(o, scrittura);
    return trovate;
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
    /**
     * La riga che il pagamento rilegge prima di decidere. Torna una COPIA, come
     * farebbe il database: cosi' il codice di produzione non puo' cambiare lo
     * stato di un ordine se non passando da una `update` — che e' esattamente
     * il passaggio che questa prova deve poter osservare.
     */
    single: () => {
      const riga = esegui()[0];
      return Promise.resolve({ data: riga ? { ...riga } : null, error: null });
    },
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (risolvi: (x: unknown) => unknown) => risolvi({ data: esegui().map((o) => ({ ...o })), error: null }),
  };
  return b;
}

/** Il fattorino come lo vede Stripe: senza IBAN collegato non gli si bonifica niente. */
function tabellaFattorini() {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    update: () => b,
    single: () =>
      Promise.resolve({
        data: state.fattorinoHaCollegatoIban
          ? { stripe_account_id: CONTO_STRIPE_DEL_FATTORINO, stripe_payouts_enabled: true }
          : { stripe_account_id: null, stripe_payouts_enabled: false },
        error: null,
      }),
    then: (risolvi: (x: unknown) => unknown) => risolvi({ data: null, error: null }),
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'orders') return tabellaOrdini(state.ordini);
      if (tabella === 'profiles') return tabellaFattorini();
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
  // Il credito MyCity ha coperto tutto l'ordine: in mano al fattorino non e'
  // arrivato un euro, quindi i suoi tre euro di compenso non se li e' potuti
  // tenere da nessuna parte e restano dovuti per bonifico.
  total_price: 0,
  rider_fee_cents: COMPENSO_CENTS,
  pickup_in_store: false,
  cash_confirmed_at: dueOreFa(),
});

beforeEach(() => {
  state.ordini = [];
  state.fattorinoHaCollegatoIban = false;
  bonificiPartiti.length = 0;
  spiaCompensoFattorino.mockClear();
});

describe('il residuo di un contrassegno quando il fattorino non ha ancora l IBAN', () => {
  it('viene ripescato al giro dopo, invece di sparire per sempre', async () => {
    state.ordini = [contrassegnoScoperto('HELD')];

    // Primo giro: il fattorino non ha ancora collegato l'IBAN.
    const primo = await giro();
    expect(
      spiaCompensoFattorino,
      'il primo giro non prova nemmeno a pagare il compenso rimasto scoperto dal credito',
    ).toHaveBeenCalledWith('contrassegno-scoperto');
    expect(primo.riderSkipped, 'un compenso non pagabile oggi va contato fra quelli rimandati').toBe(1);
    expect(bonificiPartiti, 'senza IBAN collegato non si puo bonificare niente a nessuno').toHaveLength(0);

    // Lo stato in cui il pagamento vero ha parcheggiato l'ordine. Qui non si
    // controlla: e' il giro dopo che deve saperlo ritrovare, e la prima cosa
    // che deve diventare rossa sono i soldi non partiti, non un'etichetta.
    const statoDopoIlPrimoGiro = state.ordini[0].rider_payout_status;

    // Secondo giro: il fattorino ha collegato l'IBAN, i soldi devono partire.
    spiaCompensoFattorino.mockClear();
    state.fattorinoHaCollegatoIban = true;
    const secondo = await giro();
    expect(
      spiaCompensoFattorino,
      `il fattorino ha consegnato e collegato l IBAN, ma il pagamento lo aveva lasciato in "${statoDopoIlPrimoGiro}" e il giro dei bonifici quello stato non lo cerca: quei soldi restano suoi e non partono mai`,
    ).toHaveBeenCalledWith('contrassegno-scoperto');
    expect(
      bonificiPartiti,
      'al fattorino devono arrivare i tre euro di compenso che il credito del cliente gli aveva mangiato',
    ).toEqual([{ amount: COMPENSO_CENTS, destination: CONTO_STRIPE_DEL_FATTORINO }]);
    expect(secondo.riderReleased, 'il compenso doveva essere versato al secondo giro').toBe(1);
    expect(state.ordini[0].rider_payout_status).toBe('TRANSFERRED');

    /**
     * Il nodo di tutta la storia, e il motivo per cui qui non c'e' scritto
     * nessuno stato a mano: lo stato lo ha scritto il pagamento vero, e deve
     * essere uno di quelli che il giro dei bonifici va a ripescare. Se le due
     * estremita' si scollano, il fattorino resta senza compenso.
     */
    expect(
      [...STATI_RIDER_RITENTABILI] as string[],
      `il pagamento ha lasciato l ordine in "${statoDopoIlPrimoGiro}", che il giro dei bonifici non va a cercare`,
    ).toContain(statoDopoIlPrimoGiro);
  });

  it('viene ripescato anche dopo un bonifico fallito (FAILED)', async () => {
    state.ordini = [contrassegnoScoperto('FAILED')];
    state.fattorinoHaCollegatoIban = true;

    const esito = await giro();
    expect(
      spiaCompensoFattorino,
      'un bonifico fallito una volta non veniva piu ritentato sui contrassegni',
    ).toHaveBeenCalledWith('contrassegno-scoperto');
    expect(esito.riderReleased).toBe(1);
    expect(
      bonificiPartiti,
      'ritentare vuol dire far partire davvero i soldi, non solo riprovare',
    ).toEqual([{ amount: COMPENSO_CENTS, destination: CONTO_STRIPE_DEL_FATTORINO }]);
  });

  it('lo stato che il pagamento scrive quando manca l IBAN e uno di quelli da cui si ritenta', async () => {
    // Qui il giro non c'entra: si chiama il pagamento vero e si guarda cosa
    // lascia scritto sull'ordine. Se un domani quello stato uscisse dall'elenco
    // dei ritentabili — o il pagamento ne scrivesse un altro — il giro
    // tornerebbe a perdere il residuo, e nessuno lo verrebbe a sapere.
    const { releaseRiderPayout } =
      await vi.importActual<typeof import('@/lib/stripe/payout')>('@/lib/stripe/payout');
    state.ordini = [contrassegnoScoperto('HELD')];

    const esito = await releaseRiderPayout('contrassegno-scoperto');

    expect(esito.ok, 'senza IBAN collegato il bonifico non puo riuscire').toBe(false);
    const statoScritto = state.ordini[0].rider_payout_status;
    expect(
      [...STATI_RIDER_RITENTABILI] as string[],
      `il pagamento parcheggia l ordine in "${statoScritto}" e il giro dei bonifici quello stato non lo cerca: il compenso resta dovuto per sempre`,
    ).toContain(statoScritto);
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
      spiaCompensoFattorino,
      'il fattorino si e gia tenuto il compenso dal contante: un bonifico qui glielo pagherebbe due volte',
    ).not.toHaveBeenCalled();
    expect(bonificiPartiti, 'nessun euro deve uscire su un compenso gia trattenuto dal contante').toHaveLength(0);
  });

  it('quello gia versato (TRANSFERRED) non torna in coda', async () => {
    state.ordini = [contrassegnoScoperto('TRANSFERRED')];
    state.fattorinoHaCollegatoIban = true;

    await giro();
    expect(spiaCompensoFattorino, 'un compenso gia versato non si ripaga').not.toHaveBeenCalled();
    expect(bonificiPartiti, 'nessun euro deve uscire due volte sullo stesso compenso').toHaveLength(0);
  });

  it('quello senza niente da versare (nessuno stato scritto) resta fuori', async () => {
    state.ordini = [contrassegnoScoperto(null)];
    state.fattorinoHaCollegatoIban = true;

    await giro();
    expect(
      spiaCompensoFattorino,
      'sul contrassegno lo stato vuoto vuol dire «niente da versare»: cercarlo riempirebbe il giro di ordini da scartare',
    ).not.toHaveBeenCalled();
  });

  it('quello con un turno appena preso (PROCESSING) non viene scavalcato', async () => {
    state.ordini = [{ ...contrassegnoScoperto('PROCESSING'), rider_payout_claimed_at: new Date().toISOString() }];
    state.fattorinoHaCollegatoIban = true;

    await giro();
    expect(
      spiaCompensoFattorino,
      'quel compenso e in lavorazione adesso: prenderlo di nuovo vuol dire due bonifici in volo',
    ).not.toHaveBeenCalled();
    expect(bonificiPartiti, 'due bonifici in volo sullo stesso compenso vogliono dire pagarlo due volte').toHaveLength(0);
  });
});
