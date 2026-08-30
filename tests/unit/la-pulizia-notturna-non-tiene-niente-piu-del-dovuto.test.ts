import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 27/8/2026 (R059, R056, R058, R066) — QUELLO CHE DICEVAMO DI CANCELLARE
 * RESTAVA LI'.
 *
 * L'informativa dichiara dei tempi, e i tempi dichiarati sono una promessa che
 * facciamo per iscritto a chi si iscrive. Il lavoro notturno che deve mantenerla
 * ne mancava quattro pezzi:
 *
 *  · i dati di rete dei log restavano 14 mesi contro i 12 dichiarati;
 *  · le righe di ACCESSO (chi entra, da che apparecchio, con che programma) non
 *    venivano cancellate mai: si cancellavano solo quelle di navigazione;
 *  · i documenti d'identita' di chi era stato RESPINTO non li toglieva nessuno;
 *  · le due foto della consegna in contanti — i contanti e la porta di casa del
 *    cliente — non avevano nessuna scadenza.
 *
 * Queste prove guidano il lavoro notturno vero con un database finto che
 * registra tutto quello che gli viene chiesto, e guardano cosa ha chiesto.
 */

/** Un filtro applicato a una query: `.lt('created_at', …)`, `.eq('category', …)`. */
type Filtro = { metodo: string; argomenti: unknown[] };
type Operazione = {
  tabella: string;
  azione: string;
  valori?: Record<string, unknown>;
  filtri: Filtro[];
};

const operazioni: Operazione[] = [];
const chiamateRpc: Array<{ nome: string; argomenti: unknown }> = [];
const rimozioni: Array<{ secchio: string; percorsi: string[] }> = [];
const rispostaRpc = new Map<string, unknown>();

/** Catena di filtri: qualunque metodo la allunga, l'attesa la chiude. */
function catena(op: Operazione): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(ok, ko);
        }
        return (...argomenti: unknown[]) => {
          op.filtri.push({ metodo: String(prop), argomenti });
          return proxy;
        };
      },
    },
  );
  return proxy;
}

function fintoAdmin() {
  return {
    from(tabella: string) {
      const nuova = (azione: string, valori?: Record<string, unknown>) => {
        const op: Operazione = { tabella, azione, valori, filtri: [] };
        operazioni.push(op);
        return catena(op);
      };
      return {
        update: (valori: Record<string, unknown>) => nuova('update', valori),
        delete: () => nuova('delete'),
        upsert: (valori: Record<string, unknown>) => nuova('upsert', valori),
        select: () => nuova('select'),
      };
    },
    async rpc(nome: string, argomenti?: unknown) {
      chiamateRpc.push({ nome, argomenti });
      return { data: rispostaRpc.get(nome) ?? [], error: null };
    },
    storage: {
      from(secchio: string) {
        return {
          async list() { return { data: [], error: null }; },
          async remove(percorsi: string[]) {
            rimozioni.push({ secchio, percorsi });
            return { error: null };
          },
        };
      },
    },
    auth: { admin: { deleteUser: async () => ({ error: null }) } },
  };
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => fintoAdmin(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

const { POST } = await import('@/app/api/cron/process-deletions/route');

/** Quanti mesi indietro (da 30 giorni) sta la data passata a un filtro. */
function mesiIndietro(iso: unknown): number {
  const quando = Date.parse(String(iso));
  return (Date.now() - quando) / (30 * 86_400_000);
}

function trovaFiltro(op: Operazione, metodo: string, primo: string): Filtro | undefined {
  return op.filtri.find((f) => f.metodo === metodo && f.argomenti[0] === primo);
}

async function eseguiIlLavoroNotturno() {
  operazioni.length = 0;
  chiamateRpc.length = 0;
  rimozioni.length = 0;
  const res = await POST(
    new Request('http://localhost/api/cron/process-deletions', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-di-prova' },
    }) as never,
  );
  expect(res.status, 'il lavoro notturno non è nemmeno partito').toBe(200);
}

describe('il lavoro notturno che tiene le promesse dell informativa', () => {
  const salvato = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = 'segreto-di-prova';
    rispostaRpc.clear();
    rispostaRpc.set('process_expired_deletions', []);
    rispostaRpc.set('documenti_da_cancellare_respinti', [
      { user_id: 'respinto-1', percorsi: ['respinto-1/carta-fronte.jpg', 'respinto-1/selfie.jpg'] },
    ]);
    rispostaRpc.set('foto_consegna_da_cancellare', [
      { order_id: 'ordine-1', percorsi: ['fattorino-1/ordine-1/delivery-1.jpg'] },
    ]);
  });

  afterEach(() => {
    process.env.CRON_SECRET = salvato;
  });

  // ------------------------------------------------------------------ R059
  it('i dati di rete dei log spariscono dopo i 12 mesi dichiarati, non dopo 14', async () => {
    await eseguiIlLavoroNotturno();
    const op = operazioni.find(
      (o) => o.tabella === 'activity_events' && o.azione === 'update' && o.valori?.ip === null,
    );
    expect(op, 'nessuno azzera più indirizzo IP e programma di navigazione').toBeTruthy();
    const quando = trovaFiltro(op!, 'lt', 'created_at');
    expect(
      mesiIndietro(quando?.argomenti[1]),
      'l’informativa promette 12 mesi per i log di accesso: qui se ne applicano altri',
    ).toBeCloseTo(12, 1);
  });

  it('le righe di accesso non restano per sempre', async () => {
    await eseguiIlLavoroNotturno();
    const cancellazioni = operazioni.filter(
      (o) => o.tabella === 'activity_events' && o.azione === 'delete',
    );
    const suiLogin = cancellazioni.find((o) => trovaFiltro(o, 'eq', 'category')?.argomenti[1] === 'auth');
    expect(
      suiLogin,
      'gli eventi di accesso (login, uscita, registrazione) non venivano cancellati mai: restavano con utente, apparecchio e programma per sempre',
    ).toBeTruthy();
    expect(
      mesiIndietro(trovaFiltro(suiLogin!, 'lt', 'created_at')?.argomenti[1]),
      'le righe di accesso vanno via alla finestra dichiarata di 12 mesi',
    ).toBeCloseTo(12, 1);
  });

  it('le righe di sola navigazione continuano a sparire ai 14 mesi dell analitica', async () => {
    await eseguiIlLavoroNotturno();
    const suiVisitatori = operazioni.find(
      (o) =>
        o.tabella === 'activity_events' &&
        o.azione === 'delete' &&
        trovaFiltro(o, 'eq', 'category')?.argomenti[1] === 'visitor',
    );
    expect(suiVisitatori, 'la potatura della navigazione è sparita').toBeTruthy();
    expect(mesiIndietro(trovaFiltro(suiVisitatori!, 'lt', 'created_at')?.argomenti[1])).toBeCloseTo(14, 1);
  });

  it('il profilo di navigazione si azzera anche sulle righe senza identificativo anonimo', async () => {
    await eseguiIlLavoroNotturno();
    const op = operazioni.find(
      (o) => o.tabella === 'activity_events' && o.azione === 'update' && o.valori?.anon_id === null,
    );
    expect(op, 'nessuno azzera più pagina, referente e citta').toBeTruthy();
    expect(
      op!.filtri.some((f) => f.metodo === 'not' && f.argomenti[0] === 'anon_id'),
      'con questo filtro le righe scritte dal database — quelle senza identificativo anonimo — non venivano ripulite mai',
    ).toBe(false);
  });

  // ------------------------------------------------------------------ R066
  it('il registro dei consensi si pota con la regola scritta in un posto solo', async () => {
    await eseguiIlLavoroNotturno();
    expect(
      chiamateRpc.map((c) => c.nome),
      'la potatura del registro consensi deve passare dalla funzione del database, dove vive il numero di mesi',
    ).toContain('pota_consent_log');
    expect(
      operazioni.filter((o) => o.tabella === 'consent_log'),
      'la regola era scritta due volte con due numeri diversi (12 nel database, 24 qui): deve restarne una sola',
    ).toEqual([]);
  });

  // ------------------------------------------------------------------ R056
  it('i documenti di chi e stato respinto vengono tolti dallo storage', async () => {
    await eseguiIlLavoroNotturno();
    const chiamata = chiamateRpc.find((c) => c.nome === 'documenti_da_cancellare_respinti');
    expect(
      chiamata,
      'carta d’identità e selfie di chi è stato respinto restano nello storage per sempre',
    ).toBeTruthy();
    expect(chiamata?.argomenti).toEqual({ p_giorni: 90 });
    expect(
      rimozioni.filter((r) => r.secchio === 'kyc-docs').flatMap((r) => r.percorsi),
      'la colonna viene azzerata ma il file d’identità resta nel secchio',
    ).toEqual(['respinto-1/carta-fronte.jpg', 'respinto-1/selfie.jpg']);
  });

  // ------------------------------------------------------------------ R058
  it('le foto della consegna in contanti hanno una scadenza', async () => {
    await eseguiIlLavoroNotturno();
    const chiamata = chiamateRpc.find((c) => c.nome === 'foto_consegna_da_cancellare');
    expect(
      chiamata,
      'la foto della porta di casa del cliente non veniva cancellata da nessuno',
    ).toBeTruthy();
    expect(chiamata?.argomenti).toEqual({ p_giorni: 90 });
    expect(
      rimozioni.filter((r) => r.secchio === 'cod-proof').flatMap((r) => r.percorsi),
    ).toEqual(['fattorino-1/ordine-1/delivery-1.jpg']);
  });

  it('quando non c e niente da cancellare non chiede allo storage di togliere il vuoto', async () => {
    rispostaRpc.set('documenti_da_cancellare_respinti', [{ user_id: 'x', percorsi: [] }]);
    rispostaRpc.set('foto_consegna_da_cancellare', []);
    await eseguiIlLavoroNotturno();
    expect(rimozioni).toEqual([]);
  });
});
