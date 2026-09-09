/**
 * IL GUASTO CHE ARRIVAVA TRAVESTITO DA REGOLA.
 *
 * Prima di cancellare l'account di un fattorino si guarda `cod_reconciliations`,
 * il registro della cassa contanti: se ha ancora dei soldi da versare la
 * cancellazione si ferma apposta, per non distruggere insieme a lui il registro
 * di un debito. E' una regola nostra, e il giro notturno la conosce: non sveglia
 * nessuno, non rende rossa la notte, riprova domani.
 *
 * Ma quel controllo poteva anche NON RIUSCIRE — permesso revocato, vista
 * cambiata, rete caduta — e in quel caso rispondeva con lo stesso identico
 * `bloccante: true`. A valle il motivo veniva ricostruito da chi l'informazione
 * l'aveva persa: `cassa_da_versare`, sempre. Il giro notturno lo contava fra i
 * rinvii legittimi, rispondeva 200 con `failed: 0`, non svegliava nessuno.
 *
 * Conseguenza vera: bastava un permesso negato su `cod_reconciliations` —
 * e in questo stesso lotto ci sono tre migrazioni che revocano permessi —
 * perche' NESSUNA richiesta di cancellazione venisse piu' onorata, mentre
 * l'allarme costruito apposta diceva che andava tutto bene. Le richieste di
 * cancellazione sono richieste fatte per legge, con un mese di tempo per
 * rispondere.
 *
 * QUI SI PROVANO LE DUE FACCE, E LA SECONDA E' QUELLA CHE SI ROMPE PER
 * SBAGLIO RIPARANDO LA PRIMA:
 *  ① la cassa che non si legge e' un GUASTO: notte rossa, amministratore
 *    svegliato, `failed: 1`;
 *  ② la cassa che si legge e ha davvero dei contanti resta un RINVIO: notte
 *    verde, nessuno svegliato. Se suonasse anche questa, un fattorino con la
 *    cassa aperta renderebbe rossa ogni notte per settimane.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';
import { fintoMondo } from './aiuti/finta-cancellazione-account';

const mondo: { attuale: ReturnType<typeof fintoGiroNotturno> } = { attuale: fintoGiroNotturno() };

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.attuale.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

// La cancellazione NON si finge: la catena che si e' rotta va dalla lettura
// della cassa fino al conto della notte, e fingerne un pezzo vorrebbe dire
// saltare esattamente il punto malato.
import { POST } from '@/app/api/cron/process-deletions/route';
import { cancellaAccount, contantiAncoraDaVersare } from '@/lib/account/cancellazione';

const FATTORINO = '00000000-0000-0000-0000-00000000f1f0';
const giorniFa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString();

const SABATO_NON_VERSATO = {
  for_date: '2026-08-29',
  collected_cents: 12_000,
  status: 'OPEN',
  remitted_at: null,
  rider_id: FATTORINO,
};

/** Fa passare la notte con una richiesta scaduta e questo stato della cassa. */
async function laNotte(scenario: { erroreCassa?: string; cassa?: Array<Record<string, unknown>> }) {
  mondo.attuale = fintoGiroNotturno({
    tabelle: {
      profiles: [{ id: 'admin-1', role: 'admin' }],
      notifications: [],
      cron_heartbeats: [],
      cod_reconciliations: scenario.cassa ?? [],
    },
    errori: scenario.erroreCassa ? { cod_reconciliations: scenario.erroreCassa } : {},
    rpc: {
      process_expired_deletions: {
        data: [{ user_id: FATTORINO, deleted_at: giorniFa(8) }],
        error: null,
      },
    },
  });
  const res = await POST(
    new Request('http://localhost/api/cron/process-deletions', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );
  return { http: res.status, corpo: await res.json(), mondo: mondo.attuale };
}

describe('la cassa contanti, quando non si riesce a guardarla', () => {
  it('lo dice: «non verificabile», che non e la stessa cosa di «ha dei contanti»', async () => {
    const { admin } = fintoMondo({ erroreCassa: 'permission denied for table cod_reconciliations' });
    const cassa = await contantiAncoraDaVersare(admin as never, FATTORINO);
    expect(cassa.bloccante, 'su una cassa «non lo so» vale quanto «si»: ci si ferma comunque').toBe(true);
    expect(
      cassa.esito,
      'un booleano solo per due domande diverse: a valle il motivo si torna a indovinare',
    ).toBe('non_verificabile');
  });

  it('e la cancellazione NON esce con il motivo di un rinvio deciso da noi', async () => {
    const { admin } = fintoMondo({ erroreCassa: 'permission denied for table cod_reconciliations' });
    const esito = await cancellaAccount(admin as never, FATTORINO);
    expect(esito.ok).toBe(false);
    expect(
      esito.motivo,
      'un guasto del database esce con il motivo di una regola nostra: il giro notturno lo conta fra i rinvii e tace',
    ).toBeUndefined();
    expect(esito.errore).toContain('cassa contanti');
  });

  it('mentre i contanti veri restano un rinvio, col loro motivo', async () => {
    const { admin } = fintoMondo({ cassa: [SABATO_NON_VERSATO] });
    const cassa = await contantiAncoraDaVersare(admin as never, FATTORINO);
    expect(cassa.esito).toBe('da_versare');
    const esito = await cancellaAccount(admin as never, FATTORINO);
    expect(esito.motivo).toBe('cassa_da_versare');
  });

  it('e la cassa in pari non ferma niente', async () => {
    const { admin } = fintoMondo({ cassa: [] });
    const cassa = await contantiAncoraDaVersare(admin as never, FATTORINO);
    expect(cassa.esito).toBe('libera');
    expect(cassa.bloccante).toBe(false);
  });
});

describe('la notte, quando il registro della cassa risponde «permesso negato»', () => {
  const salvato = process.env.CRON_SECRET;
  beforeEach(() => { process.env.CRON_SECRET = 'segreto-dei-lavori'; });
  afterEach(() => { process.env.CRON_SECRET = salvato; });

  it('IL CASO CHE ROMPEVA — la notte finisce rossa e conta un guasto, non un rinvio', async () => {
    const { http, corpo } = await laNotte({
      erroreCassa: 'permission denied for table cod_reconciliations',
    });
    expect(
      http,
      'il database ha rifiutato e la notte risponde «riuscita»: nessuna cancellazione viene piu onorata e l allarme dice che va tutto bene',
    ).toBe(500);
    expect(corpo.failed, 'il guasto viene contato fra i rinvii decisi da noi').toBe(1);
    expect(corpo.rinviate, 'un guasto del database non e una regola nostra').toBe(0);
    expect(
      corpo.retentionFallite,
      'il guasto viene attribuito alle potature, che qui non c entrano niente',
    ).toBe(0);
  });

  it('e sveglia un amministratore, perche nessuno se ne accorgerebbe da solo', async () => {
    const { mondo } = await laNotte({ erroreCassa: 'permission denied for table cod_reconciliations' });
    const avvisi = mondo.notifiche();
    expect(avvisi.length, 'il guasto resta dentro una risposta HTTP che nessuno legge').toBe(1);
    expect(String(avvisi[0].body)).toContain('cancellazione account');
    expect(avvisi[0].category).toBe('system');
  });

  it('IL FALSO ALLARME — se la cassa si legge ed e davvero aperta, non suona niente', async () => {
    const { http, corpo, mondo } = await laNotte({ cassa: [SABATO_NON_VERSATO] });
    expect(
      http,
      'un fattorino con la cassa aperta rende rossa ogni notte per settimane: alla terza nessuno guarda piu',
    ).toBe(200);
    expect(corpo.rinviate).toBe(1);
    expect(corpo.failed).toBe(0);
    expect(mondo.notifiche().length, 'sveglia qualcuno per una regola che sta funzionando').toBe(0);
  });
});
