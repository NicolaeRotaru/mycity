import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/8/2026 (R169) — LA PULIZIA NOTTURNA DICEVA «FATTO» ANCHE QUANDO NON AVEVA
 * FATTO NIENTE, E SALTAVA META' DELLE RIGHE DA RIPULIRE.
 *
 * Due cose, tutte e due vere e tutte e due invisibili.
 *
 * ① Il filtro guardava una colonna diversa da quella che ripuliva:
 *    `.update({ metadata: null, summary: null }).not('metadata','is',null)`.
 *    Una riga con il `summary` scritto e i dati grezzi vuoti — cioe' quasi
 *    tutte, perche' `metadata` lo scrive solo la prima vista di una sessione —
 *    non veniva nemmeno guardata: il suo riassunto restava li' per sempre,
 *    oltre i quattordici mesi che dichiariamo nella pagina pubblica.
 *
 * ② Nessuna delle sei pulizie controllava l'esito. PostgREST non lancia: torna
 *    un oggetto con dentro l'errore, e il `try/catch` intorno non lo vede. Una
 *    pulizia rifiutata dai permessi lasciava tutto dov'era e il lavoro
 *    rispondeva «fatto» lo stesso — quindi nessun allarme, nessun sospetto, e
 *    la ritenzione dichiarata diventava una promessa che nessuno controllava.
 *
 * Questa prova fa girare il lavoro contro un finto database che i filtri li
 * applica DAVVERO, cosi' la domanda e' quella vera: dopo la notte, quella riga
 * ha ancora il suo riassunto addosso?
 */

type Riga = Record<string, unknown>;

const tabelle: Record<string, Riga[]> = {};
/** Le tabelle su cui la scrittura deve fallire, per provare il silenzio. */
const scrittureCheFalliscono = new Set<string>();
const loggerErrore = vi.fn();

const meseFa = (m: number) => new Date(Date.now() - m * 30 * 86_400_000).toISOString();

function vuoto(v: unknown) {
  return v === null || v === undefined;
}

/** Solo le due forme che il lavoro usa davvero: `col.not.is.null` e `col.is.null`. */
function passaOr(riga: Riga, espressione: string): boolean {
  return espressione.split(',').some((pezzo) => {
    const [colonna, ...resto] = pezzo.trim().split('.');
    const coda = resto.join('.');
    if (coda === 'not.is.null') return !vuoto(riga[colonna]);
    if (coda === 'is.null') return vuoto(riga[colonna]);
    throw new Error(`il finto database non sa leggere il filtro «${pezzo}»`);
  });
}

class FintaQuery {
  private filtri: Array<(r: Riga) => boolean> = [];
  private azione: { tipo: 'update'; valori: Riga } | { tipo: 'delete' } | null = null;

  constructor(private readonly tabella: string) {}

  update(valori: Riga) { this.azione = { tipo: 'update', valori }; return this; }
  delete() { this.azione = { tipo: 'delete' }; return this; }
  eq(c: string, v: unknown) { this.filtri.push((r) => r[c] === v); return this; }
  lt(c: string, v: unknown) { this.filtri.push((r) => String(r[c]) < String(v)); return this; }
  not(c: string, _op: string, v: unknown) {
    if (v !== null) throw new Error('il finto database conosce solo `.not(col, "is", null)`');
    this.filtri.push((r) => !vuoto(r[c]));
    return this;
  }
  or(espressione: string) { this.filtri.push((r) => passaOr(r, espressione)); return this; }

  then(risolvi: (v: { error: null | { message: string } }) => unknown) {
    if (scrittureCheFalliscono.has(this.tabella)) {
      return Promise.resolve(risolvi({ error: { message: 'permesso negato' } }));
    }
    const righe = tabelle[this.tabella] ?? [];
    const colpite = righe.filter((r) => this.filtri.every((f) => f(r)));
    if (this.azione?.tipo === 'update') {
      for (const r of colpite) Object.assign(r, this.azione.valori);
    } else if (this.azione?.tipo === 'delete') {
      tabelle[this.tabella] = righe.filter((r) => !colpite.includes(r));
    }
    return Promise.resolve(risolvi({ error: null }));
  }
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => new FintaQuery(tabella),
    rpc: async () => ({ data: [], error: null }),
    auth: { admin: { deleteUser: async () => ({ error: null }) } },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: (...a: unknown[]) => loggerErrore(...a), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: async () => ({ ok: true, fileRimossi: 0 }),
}));

async function passaLaNotte() {
  const { POST } = await import('@/app/api/cron/process-deletions/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://x/api/cron/process-deletions', {
      method: 'POST',
      headers: { authorization: 'Bearer secret123' },
    }),
  );
}

beforeEach(() => {
  process.env.CRON_SECRET = 'secret123';
  scrittureCheFalliscono.clear();
  loggerErrore.mockClear();
  for (const k of Object.keys(tabelle)) delete tabelle[k];
});

describe('la pulizia notturna dei dati oltre la finestra dichiarata', () => {
  it('toglie il riassunto anche alle righe che non hanno i dati grezzi', async () => {
    // La riga vera che restava scoperta: `metadata` vuoto (lo scrive solo la
    // prima vista di una sessione) e `summary` scritto. La sua categoria non e'
    // fra quelle che a fine notte vengono cancellate, quindi senza questa
    // pulizia il riassunto le resta addosso per sempre.
    tabelle.activity_events = [
      {
        id: 'vecchia',
        category: 'order',
        created_at: meseFa(20),
        metadata: null,
        summary: 'Ordine #A1B2C3 consegnato in Via Roma 12, Piacenza',
        ip: null,
        anon_id: null,
      },
    ];
    tabelle.audit_logs = [];
    tabelle.contact_messages = [];

    await passaLaNotte();

    expect(
      tabelle.activity_events[0].summary,
      'Dopo venti mesi il riassunto — che e la parte piu personale della riga — e ancora nel database, mentre la pagina pubblica promette quattordici mesi',
    ).toBeNull();
  });

  it('non tocca le righe dentro la finestra dichiarata', async () => {
    tabelle.activity_events = [
      { id: 'recente', category: 'order', created_at: meseFa(2), metadata: null, summary: 'Ordine #Z consegnato', ip: null, anon_id: null },
    ];
    tabelle.audit_logs = [];
    tabelle.contact_messages = [];

    await passaLaNotte();

    expect(tabelle.activity_events[0].summary).toBe('Ordine #Z consegnato');
  });

  it('una pulizia che non riesce non passa per fatta', async () => {
    tabelle.activity_events = [];
    tabelle.audit_logs = [];
    tabelle.contact_messages = [];
    scrittureCheFalliscono.add('audit_logs');

    const res = await passaLaNotte();
    const esito = (await res.json()) as { retentionFallite?: number };

    expect(
      esito.retentionFallite,
      'Il lavoro ha risposto «fatto» mentre una pulizia era stata rifiutata: nessuno poteva accorgersene',
    ).toBeGreaterThan(0);
    expect(loggerErrore, 'una pulizia rifiutata non ha lasciato nemmeno una riga nel registro').toHaveBeenCalled();
  });
});
