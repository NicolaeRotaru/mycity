/**
 * LA NOTTE CHE FALLISCE SPEGNEVA IL BATTITO — E IL SORVEGLIANTE MANDAVA A
 * CERCARE NEL POSTO SBAGLIATO.
 *
 * Ogni lavoro periodico, passando, scrive una riga in `cron_heartbeats`. Il
 * sorvegliante la confronta con una soglia (per questo lavoro: 1560 minuti, cioe'
 * 26 ore) e, se la trova vecchia, avvisa con queste parole esatte: «Cron
 * "process-deletions" fermo da X min (soglia 1560): scheduler o deploy down?».
 * E' il dead-man's switch: l'unico sensore capace di accorgersi che un lavoro
 * NON PARTE PIU'.
 *
 * Il battito pero' veniva scritto solo `if (risposta.status < 400)`. Cioe' il
 * lavoro doveva anche essere andato BENE. Due condizioni rendono il 500
 * permanente, non un episodio:
 *  (a) un fattorino se ne va senza versare i contanti: dal 31esimo giorno il
 *      termine di legge e' passato e la notte finisce 500 SEMPRE;
 *  (b) qualunque guasto stabile — un permesso revocato non si aggiusta da solo.
 *
 * Passate 26 ore dal primo 500, il battito e' vecchio e parte l'avviso. Chi
 * viene svegliato guarda lo scheduler e il rilascio — che sono sani — mentre il
 * lavoro parte puntuale ogni notte. E il danno peggiore e' il secondo: da quel
 * momento il battito resta vecchio PER SEMPRE, quindi il giorno in cui il lavoro
 * si ferma DAVVERO — e con lui la potatura degli indirizzi di rete, delle foto
 * di consegna e delle email dei destinatari dei buoni regalo, che vivono nella
 * stessa rotta — il segnale e' identico a quello di ieri. Il freno anti-silenzio
 * e' disarmato.
 *
 * La cura e' separare i due messaggi che viaggiavano sullo stesso filo:
 *   «questo giro non e' avvenuto»    -> il battito che manca;
 *   «questo giro ha trovato guai»    -> il 500, l'avviso agli amministratori,
 *                                       la riga di errore nei log.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';
import { lavoriFermi, type CronHeartbeat } from '@/lib/cron-health';

type Esito = { ok: boolean; motivo?: 'cassa_da_versare'; errore?: string; fileRimossi: number; erroriFile: string[] };

const mondo: { attuale: ReturnType<typeof fintoGiroNotturno>; esiti: Record<string, Esito> } = {
  attuale: fintoGiroNotturno(),
  esiti: {},
};

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.attuale.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: async (_admin: unknown, userId: string): Promise<Esito> =>
    mondo.esiti[userId] ?? { ok: true, fileRimossi: 0, erroriFile: [] },
}));

import { POST } from '@/app/api/cron/process-deletions/route';

const SOGLIA = { 'process-deletions': 1560 };
const giorniFa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString();
const GUASTO: Esito = {
  ok: false,
  errore: "L'account non e stato cancellato: database is not available",
  fileRimossi: 0,
  erroriFile: [],
};

/**
 * Il battito piu' recente per ogni lavoro.
 *
 * Il finto database accoda le righe invece di sovrascriverle (quello vero fa
 * `upsert` sulla chiave `name`): prendere la piu' recente rifa' la stessa cosa.
 */
function battitiVeri(righe: Array<Record<string, unknown>>): CronHeartbeat[] {
  const ultimo = new Map<string, string>();
  for (const r of righe) {
    const nome = String(r.name);
    const quando = String(r.last_run_at);
    if (!ultimo.has(nome) || quando > (ultimo.get(nome) as string)) ultimo.set(nome, quando);
  }
  return [...ultimo].map(([name, last_run_at]) => ({ name, last_run_at }));
}

/**
 * Prepara il mondo come la produzione: la riga del battito ESISTE gia' ed e'
 * vecchia di tre giorni (la migrazione 095 la semina alla nascita). Senza una
 * riga di partenza, «il lavoro non ha mai battuto» e' un caso diverso, e il
 * sorvegliante lo tratta in un altro modo.
 */
function preparaLaNotte(richieste: Array<{ userId: string; chiestaIl: string; esito: Esito }>) {
  mondo.esiti = Object.fromEntries(richieste.map((r) => [r.userId, r.esito]));
  mondo.attuale = fintoGiroNotturno({
    tabelle: {
      profiles: [{ id: 'admin-1', role: 'admin' }],
      notifications: [],
      cron_heartbeats: [{ name: 'process-deletions', last_run_at: giorniFa(3) }],
    },
    rpc: {
      process_expired_deletions: {
        data: richieste.map((r) => ({ user_id: r.userId, deleted_at: r.chiestaIl })),
        error: null,
      },
    },
  });
}

async function unGiro() {
  const res = await POST(
    new Request('http://localhost/api/cron/process-deletions', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );
  return { http: res.status, corpo: await res.json() };
}

describe('il battito del giro notturno', () => {
  const salvato = process.env.CRON_SECRET;
  beforeEach(() => { process.env.CRON_SECRET = 'segreto-dei-lavori'; });
  afterEach(() => { process.env.CRON_SECRET = salvato; });

  it('IL CASO CHE ROMPEVA — una cancellazione fallita non spegne il battito', async () => {
    preparaLaNotte([{ userId: 'u1', chiestaIl: giorniFa(8), esito: GUASTO }]);
    const { http } = await unGiro();

    expect(http, 'il problema trovato deve restare visibile: la notte e rossa').toBe(500);
    expect(
      mondo.attuale.battitoScritto(),
      'il giro e passato e il battito manca: il sorvegliante dira «scheduler o deploy down?» mentre il lavoro gira benissimo',
    ).toBe(true);
    expect(
      mondo.attuale.notifiche().length,
      'senza avviso agli amministratori il 500 non lo legge nessuno: il problema sparirebbe davvero',
    ).toBe(1);
  });

  it('DUE NOTTI DI FILA — un guasto che dura non fa annunciare un lavoro fermo', async () => {
    // Il caso vero: un fattorino se n'e' andato senza versare i contanti e la
    // richiesta ha passato il termine di legge. Da li' in poi la notte finisce
    // 500 tutte le notti, per sempre. Il sorvegliante non deve confondere
    // «trova sempre lo stesso problema» con «non parte piu'».
    preparaLaNotte([{ userId: 'u1', chiestaIl: giorniFa(45), esito: GUASTO }]);
    const primo = await unGiro();
    const secondo = await unGiro();
    expect([primo.http, secondo.http], 'il problema sparisce dalla risposta').toEqual([500, 500]);

    const battiti = battitiVeri(mondo.attuale.righe('cron_heartbeats'));
    const fermi = lavoriFermi(battiti, Date.now() + 60 * 60_000, SOGLIA);
    expect(
      fermi,
      'il sorvegliante annuncia «process-deletions fermo: scheduler o deploy down?» mentre il lavoro e passato due volte su due',
    ).toEqual([]);
  });

  it('anche quando a fallire e una pulizia dei dati vecchi', async () => {
    // Stessa storia dall'altro lato della rotta: un permesso negato su una
    // potatura non si aggiusta da solo, quindi il 500 sarebbe permanente.
    mondo.esiti = {};
    mondo.attuale = fintoGiroNotturno({
      tabelle: {
        profiles: [{ id: 'admin-1', role: 'admin' }],
        notifications: [],
        cron_heartbeats: [{ name: 'process-deletions', last_run_at: giorniFa(3) }],
      },
      errori: { activity_events: 'permission denied for table activity_events' },
    });
    const { http, corpo } = await unGiro();

    expect(http).toBe(500);
    expect(corpo.retentionFallite).toBeGreaterThan(0);
    expect(mondo.attuale.battitoScritto()).toBe(true);
    const fermi = lavoriFermi(battitiVeri(mondo.attuale.righe('cron_heartbeats')), Date.now() + 60 * 60_000, SOGLIA);
    expect(fermi, 'una potatura rifiutata basta a far dichiarare fermo un lavoro che gira').toEqual([]);
  });

  it('ma il freno anti-silenzio funziona ancora: se il lavoro NON passa, lo dice', async () => {
    // La controprova. Un battito scritto sempre non serve a niente se poi non
    // sa piu' distinguere il lavoro che non parte: qui il giro non viene
    // eseguito affatto e il sorvegliante lo deve vedere.
    const battiti: CronHeartbeat[] = [{ name: 'process-deletions', last_run_at: giorniFa(3) }];
    const fermi = lavoriFermi(battiti, Date.now(), SOGLIA);
    expect(fermi.map((f) => f.name), 'il lavoro non gira da tre giorni e nessuno se ne accorge').toEqual([
      'process-deletions',
    ]);
  });

  it('e la notte andata bene continua a scriverlo, come prima', async () => {
    preparaLaNotte([{ userId: 'u1', chiestaIl: giorniFa(8), esito: { ok: true, fileRimossi: 0, erroriFile: [] } }]);
    const { http } = await unGiro();
    expect(http).toBe(200);
    expect(mondo.attuale.battitoScritto()).toBe(true);
    expect(mondo.attuale.notifiche().length).toBe(0);
  });
});
