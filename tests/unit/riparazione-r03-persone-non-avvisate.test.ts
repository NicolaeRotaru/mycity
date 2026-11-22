/**
 * R03-003 — L'ALLARME «PERSONE NON AVVISATE» È UNO PER AVVISO, E DICE CHI.
 *
 * Quando la notte non riesce a scrivere nel pannello di chi aspetta la cancellazione il motivo
 * dell'attesa, gli amministratori ricevono un allarme. Prima era una riga nuova ogni notte, a ogni
 * amministratore, col solo numero delle persone: con lo stesso guasto per una settimana, sette
 * allarmi uguali, e nessuno sapeva a chi scrivere. Gli allarmi delle email ferme questa classe
 * l'avevano già chiusa: uno per avviso, con l'identificativo ricavato dall'avviso, e il nome di chi
 * aspetta. Qui si prova lo stesso per il pannello, facendo girare la rotta vera su un finto database.
 *
 * E come per le email ferme l'allarme si chiude da solo (la spiegazione arriva nel pannello, o la
 * persona non aspetta più), e la notte è rossa solo quando l'allarme nasce o non si riesce a scrivere:
 * le notti dopo l'amministratore lo sa già. Il finto database mette `is_read = false` alle righe
 * nuove, come il default della colonna vera.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno, type Guasto } from './aiuti/finto-giro-notturno';

const mondo = vi.hoisted(() => ({ admin: null as unknown, postaSu: true }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: mondo.postaSu })) }));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: vi.fn(async () => ({
    ok: false, motivo: 'cassa_da_versare', errore: 'contanti da versare', fileRimossi: 0, erroriFile: [],
  })),
}));

import { POST } from '@/app/api/cron/process-deletions/route';

const ADESSO = new Date('2026-11-21T04:00:00+01:00').getTime();
const GIORNO = 86_400_000;
const CHIESTA_IL = new Date(ADESSO - 8 * GIORNO).toISOString();
const PRIMA = '00000000-0000-4000-8000-000000000001';
const SECONDA = '00000000-0000-4000-8000-000000000002';
const TITOLO = 'Persone non avvisate del rinvio della cancellazione';
const SCRIVILE_TU = "Spiegazione dell'attesa non partita per email";

type Amministrativo = { from: (t: string) => unknown };

/**
 * Il pannello delle persone in `rifiutate` rifiuta la riga: la spiegazione non si scrive. L'elenco si
 * può cambiare fra una notte e l'altra (la riga torna a passare), come la lista della notte (`lista`).
 */
function laNotte(persone: string[], rifiutate: string[]) {
  const guasti: Guasto[] = [{
    tabella: 'notifications',
    azione: 'insert',
    messaggio: 'permission denied for table notifications',
    seRiga: (r) => rifiutate.includes(String(r.user_id)),
  }];
  const rpc = { process_expired_deletions: { data: persone.map((p) => ({ user_id: p, deleted_at: CHIESTA_IL })) as unknown, error: null } };
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [
        { id: 'admin-1', role: 'admin' },
        { id: 'admin-2', role: 'admin' },
        ...persone.map((p) => ({ id: p, role: 'rider', deletion_requested_at: CHIESTA_IL })),
      ],
      notifications: [],
      audit_logs: [],
      cron_heartbeats: [],
    },
    rpc,
    indirizzi: Object.fromEntries(persone.map((p) => [p, `${p.slice(-2)}@example.it`])),
    guasti,
    chiaviUniche: true,
  });
  const base = giro.admin as unknown as Amministrativo;
  // Il default della colonna vera: una notifica nuova non è letta.
  mondo.admin = {
    ...(giro.admin as object),
    from(tabella: string) {
      const q = base.from(tabella) as { insert: (r: Record<string, unknown> | Record<string, unknown>[]) => unknown };
      if (tabella === 'notifications') {
        const vera = q.insert.bind(q);
        q.insert = (r) => vera((Array.isArray(r) ? r : [r]).map((x) => ({ is_read: false, ...x })));
      }
      return q;
    },
  };
  return Object.assign(giro, {
    /** Da stanotte la lista della notte porta solo queste persone. */
    lista: (chi: string[]) => {
      rpc.process_expired_deletions.data = chi.map((p) => ({ user_id: p, deleted_at: CHIESTA_IL }));
    },
    profilo: (id: string) => giro.righe('profiles').find((p) => p.id === id),
    /** Gli allarmi «Persone non avvisate» di questa persona come stanno adesso, per amministratore. */
    apertiDi: (persona: string, amministratore = 'admin-1') =>
      giro.righe('notifications')
        .filter((n) => n.title === TITOLO && n.user_id === amministratore && String(n.body).includes(persona))
        .map((n) => n.is_read),
  });
}

const unGiro = async () => {
  const r = await POST(
    new Request('http://localhost/api/cron/process-deletions?a_mano=1&cancella=1', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
};

const allarmiDi = (giro: ReturnType<typeof laNotte>, amministratore: string) =>
  giro.notifiche().filter((n) => n.title === TITOLO && n.user_id === amministratore);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R03-003 · l allarme «persone non avvisate» è uno per avviso e dice chi', () => {
  it('lo stesso guasto per tre notti: un allarme solo per amministratore, non uno a notte', async () => {
    const giro = laNotte([PRIMA], [PRIMA]);
    for (let n = 0; n < 3; n++) {
      vi.setSystemTime(ADESSO + n * GIORNO);
      const { corpo } = await unGiro();
      expect(corpo.avvisiFalliti, 'il guasto del pannello non c è: la prova non prova niente').toBe(1);
    }
    expect(allarmiDi(giro, 'admin-1'), 'l allarme si riscrive ogni notte').toHaveLength(1);
    expect(allarmiDi(giro, 'admin-2'), 'ogni amministratore ha il suo, una volta').toHaveLength(1);
  });

  it('l allarme dice chi aspetta e quale spiegazione non è arrivata', async () => {
    const giro = laNotte([PRIMA], [PRIMA]);
    await unGiro();
    const [allarme] = allarmiDi(giro, 'admin-1');
    expect(String(allarme?.body), 'l amministratore non sa a chi scrivere').toContain(PRIMA);
    expect(String(allarme?.body)).toMatch(/rinvio/);
  });

  it('due persone non avvisate: due allarmi, ognuno col suo nome', async () => {
    const giro = laNotte([PRIMA, SECONDA], [PRIMA, SECONDA]);
    await unGiro();
    const allarmi = allarmiDi(giro, 'admin-1');
    expect(allarmi, 'un allarme solo per due persone: chi è chi?').toHaveLength(2);
    expect(allarmi.some((n) => String(n.body).includes(PRIMA))).toBe(true);
    expect(allarmi.some((n) => String(n.body).includes(SECONDA))).toBe(true);
  });

  it('controprova: chi riceve la spiegazione non fa suonare l allarme', async () => {
    const giro = laNotte([PRIMA, SECONDA], [SECONDA]);
    const { status } = await unGiro();
    const allarmi = allarmiDi(giro, 'admin-1');
    expect(allarmi).toHaveLength(1);
    expect(String(allarmi[0].body)).toContain(SECONDA);
    expect(String(allarmi[0].body)).not.toContain(PRIMA);
    expect(status, 'la notte in cui nasce l allarme della persona non avvisata è rossa').toBe(500);
  });
});

const notte = async (n: number) => {
  vi.setSystemTime(ADESSO + n * GIORNO);
  return unGiro();
};

describe('R03-003 · come le email ferme: l allarme si chiude da solo', () => {
  it('la spiegazione arriva la notte dopo: l allarme si chiude per tutti gli amministratori', async () => {
    const rifiutate = [PRIMA];
    const giro = laNotte([PRIMA], rifiutate);
    await notte(0);
    expect(giro.apertiDi(PRIMA, 'admin-1'), 'la rotta non ha scritto l allarme: la prova non prova niente').toEqual([false]);
    rifiutate.length = 0;
    const { corpo } = await notte(1);
    expect(corpo.avvisiRecapitati, 'la spiegazione non è arrivata: la prova non prova niente').toBe(1);
    expect(giro.apertiDi(PRIMA, 'admin-1'), 'avvisata, e l allarme resta aperto per sempre').toEqual([true]);
    expect(giro.apertiDi(PRIMA, 'admin-2')).toEqual([true]);
  });

  it('la persona annulla la richiesta: l allarme si chiude anche la notte senza nessuno in lista', async () => {
    const giro = laNotte([PRIMA], [PRIMA]);
    await notte(0);
    expect(giro.apertiDi(PRIMA)).toEqual([false]);
    giro.profilo(PRIMA)!.deletion_requested_at = null;
    giro.lista([]);
    await notte(1);
    expect(giro.apertiDi(PRIMA, 'admin-1'), 'non aspetta più, e l allarme resta aperto').toEqual([true]);
    expect(giro.apertiDi(PRIMA, 'admin-2')).toEqual([true]);
  });

  it('controprova: chi aspetta ancora e non è avvisato lo tiene, anche la notte in cui non è in lista', async () => {
    const giro = laNotte([PRIMA], [PRIMA]);
    await notte(0);
    giro.lista([]);
    await notte(1);
    expect(giro.apertiDi(PRIMA), 'chiuso mentre la persona aspetta ancora senza spiegazione').toEqual([false]);
    giro.lista([PRIMA]);
    await notte(2);
    expect(giro.apertiDi(PRIMA)).toEqual([false]);
    expect(giro.apertiDi(PRIMA, 'admin-2')).toEqual([false]);
  });

  it('chiude il suo allarme e non «scrivile tu»: spiegazione arrivata nel pannello, email ancora ferma', async () => {
    mondo.postaSu = false;
    try {
      const rifiutate = [PRIMA];
      const giro = laNotte([PRIMA], rifiutate);
      await notte(0);
      expect(giro.apertiDi(PRIMA)).toEqual([false]);
      rifiutate.length = 0;
      await notte(1);
      await notte(2);
      const scriviletu = giro.righe('notifications').filter((n) => n.title === SCRIVILE_TU && n.user_id === 'admin-1');
      expect(scriviletu, 'la rotta non ha scritto «scrivile tu»: la prova non prova niente').toHaveLength(1);
      expect(scriviletu[0].is_read, 'chiuso «scrivile tu» con l email ancora ferma').toBe(false);
      expect(giro.apertiDi(PRIMA), 'la spiegazione è nel pannello e «Persone non avvisate» resta aperto').toEqual([true]);
    } finally {
      mondo.postaSu = true;
    }
  });
});

describe('R03-003 · come le email ferme: la notte è rossa solo quando il guasto è nuovo', () => {
  it('lo stesso guasto per tre notti: rossa la prima, verde le altre, il conto resta nella risposta', async () => {
    laNotte([PRIMA], [PRIMA]);
    const notti = [];
    for (let n = 0; n < 3; n++) notti.push(await notte(n));
    expect(notti.map((x) => x.corpo.avvisiFalliti), 'il guasto del pannello non c è: la prova non prova niente').toEqual([1, 1, 1]);
    expect(notti.map((x) => x.corpo.allarmiNonAvvisateNuovi)).toEqual([1, 0, 0]);
    expect(notti.map((x) => x.status), 'rossa ogni notte anche se l amministratore lo sa già').toEqual([500, 200, 200]);
  });

  it('una persona nuova non avvisata la notte dopo: allarme nuovo, notte di nuovo rossa', async () => {
    const giro = laNotte([PRIMA, SECONDA], [PRIMA, SECONDA]);
    giro.lista([PRIMA]);
    expect((await notte(0)).status).toBe(500);
    // La seconda entra in lista stanotte, e anche il suo pannello rifiuta la spiegazione.
    giro.lista([PRIMA, SECONDA]);
    const seconda = await notte(1);
    expect(seconda.corpo.allarmiNonAvvisateNuovi).toBe(1);
    expect(seconda.status, 'il guasto nuovo non fa rossa la notte').toBe(500);
  });

  it('l allarme che non si riesce a scrivere tiene rossa la notte, ogni notte', async () => {
    // Anche il pannello degli amministratori rifiuta la riga: nessuno lo sa.
    laNotte([PRIMA], [PRIMA, 'admin-1', 'admin-2']);
    const stati = [];
    for (let n = 0; n < 3; n++) stati.push((await notte(n)).status);
    expect(stati, 'nessuno lo sa e la notte torna verde').toEqual([500, 500, 500]);
  });
});
