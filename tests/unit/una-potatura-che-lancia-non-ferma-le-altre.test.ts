/**
 * IL GIRO NOTTURNO DELLE PULIZIE POTEVA SALTARNE DODICI SU QUINDICI E
 * RISPONDERE LO STESSO «TUTTO A POSTO».
 *
 * Le potature dei dati oltre la finestra dichiarata stavano in fila dentro la
 * rotta, dentro UN solo `try` con UN solo `catch` in fondo. Bastava che una
 * LANCIASSE — un client che rifiuta la promessa, la rete che cade a meta' giro,
 * un metodo che non c'e' — perche' il `catch` ingoiasse tutto e le potature
 * successive non partissero nemmeno. Il conto delle fallite restava a zero, la
 * risposta era 200 e nessuno veniva svegliato.
 *
 * Chi ci rimette: gli indirizzi di rete nei log, le foto della consegna — cioe'
 * quasi sempre la porta di casa di un cliente — e il nome e l'email di chi ha
 * ricevuto un buono regalo, che con noi non ha nessun rapporto. Tenuti oltre il
 * tempo che promettiamo nella pagina pubblica della privacy, in silenzio.
 *
 * I modi di fallire erano due — l'errore restituito dentro l'oggetto (PostgREST
 * non lancia) e l'eccezione vera — e ne veniva contato uno solo. Adesso sono
 * uno: ogni potatura gira nel suo `try` e chi non riesce si conta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  eseguiPotature,
  potatureDiRitenzione,
  type ClientePotature,
} from '@/lib/privacy/potature-ritenzione';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

const registroMuto = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * Un finto database minimo: qui non interessa quali righe vengono toccate — di
 * quello rispondono le prove sui filtri — ma COSA SUCCEDE AL GIRO quando una
 * potatura va male, nei due modi in cui puo' andare male.
 */
function fintoClient(opzioni: { lancia?: string[]; rifiuta?: string[] } = {}) {
  const toccate: string[] = [];
  const lancia = new Set(opzioni.lancia ?? []);
  const rifiuta = new Set(opzioni.rifiuta ?? []);

  const catena = (tabella: string) => {
    const q: Record<string, unknown> = {
      then: (risolvi: (v: { error: { message: string } | null }) => unknown) =>
        Promise.resolve(risolvi(
          rifiuta.has(tabella) ? { error: { message: 'permission denied' } } : { error: null },
        )),
    };
    for (const filtro of ['eq', 'lt', 'is', 'not', 'or']) q[filtro] = () => q;
    return q;
  };

  const admin = {
    from(tabella: string) {
      toccate.push(tabella);
      if (lancia.has(tabella)) throw new Error('la rete e caduta a meta giro');
      return { update: () => catena(tabella), delete: () => catena(tabella) };
    },
    async rpc(nome: string) {
      toccate.push(`rpc:${nome}`);
      if (lancia.has(nome)) throw new Error('la rete e caduta a meta giro');
      if (rifiuta.has(nome)) return { data: null, error: { message: 'permission denied' } };
      return { data: [], error: null };
    },
    storage: {
      from: () => ({ remove: async () => ({ error: null }) }),
    },
  } as unknown as ClientePotature;

  return { admin, toccate };
}

describe('le potature dei dati oltre la finestra dichiarata', () => {
  beforeEach(() => { registroMuto.error.mockClear(); });

  it('IL CASO CHE ROMPEVA — una potatura che LANCIA non si porta dietro le altre', async () => {
    // `activity_events` e' la prima tabella del giro: se la sua caduta fermasse
    // tutto, dopo di lei non partirebbe piu' niente.
    const { admin, toccate } = fintoClient({ lancia: ['activity_events'] });
    const rapporto = await eseguiPotature(admin, registroMuto, Date.now());

    expect(
      rapporto.esiti.length,
      'il giro si e fermato alla prima caduta: le potature dopo non sono nemmeno partite',
    ).toBe(potatureDiRitenzione(Date.now()).length);
    expect(
      toccate,
      'i buoni regalo sono in fondo alla fila: se non li tocca nessuno, nome ed email di chi non e nostro cliente restano li',
    ).toContain('gift_cards');
    expect(rapporto.fallite, 'la caduta e passata per una pulizia riuscita').toBeGreaterThan(0);
  });

  it('e i due modi di fallire si contano tutti e due', async () => {
    // PostgREST non lancia: restituisce `{error}`. Prima ne veniva guardato uno
    // solo, e l'altro spariva.
    const { admin } = fintoClient({ lancia: ['contact_messages'], rifiuta: ['audit_logs'] });
    const rapporto = await eseguiPotature(admin, registroMuto, Date.now());

    const falliteQui = rapporto.esiti.filter((e) => !e.ok).map((e) => e.cosa);
    expect(falliteQui).toContain('contact_messages');
    expect(falliteQui).toContain('audit_logs.ip');
    expect(falliteQui).toContain('audit_logs.metadata');
    expect(rapporto.fallite).toBe(falliteQui.length);
    expect(registroMuto.error, 'una pulizia rifiutata non lascia nemmeno una riga nei log').toHaveBeenCalled();
  });

  it('la notte in cui non cade niente conta zero fallite', async () => {
    const { admin } = fintoClient();
    const rapporto = await eseguiPotature(admin, registroMuto, Date.now());
    expect(rapporto.fallite).toBe(0);
    expect(rapporto.fatte).toBe(rapporto.esiti.length);
  });

  it('le finestre dichiarate restano quelle: 12 mesi sugli accessi, 14 sull analitica', () => {
    // La prova che l'estrazione non ha cambiato le date per strada: si guarda
    // il valore che finisce nel filtro, non il nome del passo.
    const adesso = Date.parse('2026-09-08T04:00:00Z');
    const visti: string[] = [];
    const admin = {
      from: () => {
        const q: Record<string, unknown> = { then: (r: (v: { error: null }) => unknown) => Promise.resolve(r({ error: null })) };
        for (const f of ['eq', 'is', 'not', 'or']) q[f] = () => q;
        q.lt = (_c: string, v: string) => { visti.push(v); return q; };
        return { update: () => q, delete: () => q };
      },
      rpc: async () => ({ data: [], error: null }),
      storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    } as unknown as ClientePotature;

    return eseguiPotature(admin, registroMuto, adesso).then(() => {
      const mesi = (m: number) => new Date(adesso - m * 30 * 86_400_000).toISOString();
      expect(visti, 'la finestra dei log di accesso non e piu quella dichiarata (12 mesi)').toContain(mesi(12));
      expect(visti, 'la finestra dell analitica non e piu quella dichiarata (14 mesi)').toContain(mesi(14));
      expect(visti, 'i messaggi dal modulo contatti restano oltre i due anni').toContain(mesi(24));
    });
  });
});

/**
 * La stessa cosa dal buco della serratura della rotta: e' li' che il difetto si
 * vedeva, ed e' li' che deve smettere di vedersi.
 */
const mondo: { attuale: ReturnType<typeof fintoGiroNotturno>; lanciaSu: Set<string> } = {
  attuale: fintoGiroNotturno(),
  lanciaSu: new Set(),
};

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    const vero = mondo.attuale.admin;
    return {
      ...vero,
      from: (tabella: string) => {
        if (mondo.lanciaSu.has(tabella)) throw new Error('la rete e caduta a meta giro');
        return vero.from(tabella);
      },
    };
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: async () => ({ ok: true, fileRimossi: 0, erroriFile: [] }),
}));

describe('la notte, quando una potatura cade a meta giro', () => {
  const salvato = process.env.CRON_SECRET;
  beforeEach(() => { process.env.CRON_SECRET = 'segreto-dei-lavori'; });
  afterEach(() => { process.env.CRON_SECRET = salvato; mondo.lanciaSu = new Set(); });

  it('IL CASO CHE ROMPEVA — le potature dopo partono lo stesso, e la notte lo dice', async () => {
    const { POST } = await import('@/app/api/cron/process-deletions/route');
    mondo.lanciaSu = new Set(['activity_events']);
    mondo.attuale = fintoGiroNotturno({
      tabelle: {
        profiles: [{ id: 'admin-1', role: 'admin' }],
        notifications: [],
        cron_heartbeats: [],
        // Un buono regalo scaduto da due anni, con dentro nome ed email di una
        // persona che con noi non ha nessun rapporto. E' l'ULTIMA potatura del
        // giro: se la prima si porta dietro le altre, questa riga non viene
        // nemmeno guardata.
        gift_cards: [{
          id: 'gc-1',
          expires_at: new Date(Date.now() - 24 * 30 * 86_400_000).toISOString(),
          balance_cents: 500,
          recipient_name: 'Anna Bianchi',
          recipient_email: 'anna.bianchi@example.it',
          message: 'Buon compleanno!',
        }],
      },
    });

    const res = await POST(
      new Request('http://localhost/api/cron/process-deletions', {
        method: 'POST',
        headers: { authorization: 'Bearer segreto-dei-lavori' },
      }) as never,
    );
    const corpo = await res.json();

    expect(res.status, 'dodici potature saltate e la notte risponde «riuscita»').toBe(500);
    expect(corpo.retentionFallite, 'le potature cadute non si contano').toBeGreaterThan(0);
    expect(
      mondo.attuale.righe('gift_cards')[0].recipient_email,
      'l email di chi ha ricevuto il buono regalo e ancora li: la potatura in fondo alla fila non e mai partita',
    ).toBeNull();
    expect(
      mondo.attuale.notifiche().length,
      'nessuno viene svegliato: i dati oltre la finestra restano dove sono e il numero muore dentro una risposta HTTP',
    ).toBe(1);
  });
});
