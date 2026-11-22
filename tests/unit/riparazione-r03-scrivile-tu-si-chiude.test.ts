/**
 * R03-006 e R03-007 — «SCRIVILE TU» SI CHIUDE QUANDO LA PERSONA NON ASPETTA PIÙ, ANCHE OLTRE I PRIMI 200.
 *
 * L'allarme «Spiegazione dell'attesa non partita per email» chiede all'amministratore di scrivere
 * lui alla persona. Si chiudeva solo la notte in cui l'email partiva, e solo per gli avvisi di
 * quella notte: chi usciva dall'elenco (richiesta annullata, account cancellato, richiesta rifatta)
 * lasciava il suo allarme aperto per sempre. E la chiusura non deve leggere al massimo 200 avvisi
 * senza ordine né filtro: oltre i 200, quelli aperti restavano fuori.
 *
 * L'allarme qui lo scrive la rotta vera (due notti con la posta giù); il finto database mette
 * `is_read = false` alle righe nuove, come il default della colonna vera.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno, type Riga } from './aiuti/finto-giro-notturno';
import { chiaveAvviso } from '@/lib/cron-cancellazioni';
import { identificativoAvviso } from '@/lib/privacy/avvisi-a-chi-aspetta';

const mondo = vi.hoisted(() => ({ admin: null as unknown, postaSu: false }));

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
const TITOLO = "Spiegazione dell'attesa non partita per email";

type Amministrativo = { rpc: (nome: string) => Promise<unknown>; from: (t: string) => unknown };

function ilMondo(persone: string[], notifiche: Riga[] = [], altriProfili: Riga[] = [], chiestaIl = CHIESTA_IL) {
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [
        { id: 'admin-1', role: 'admin' },
        { id: 'admin-2', role: 'admin' },
        ...persone.map((p) => ({ id: p, role: 'rider', deletion_requested_at: chiestaIl })),
        ...altriProfili,
      ],
      notifications: notifiche,
      audit_logs: [],
      cron_heartbeats: [],
    },
    rpc: { process_expired_deletions: { data: persone.map((p) => ({ user_id: p, deleted_at: chiestaIl })), error: null } },
    indirizzi: Object.fromEntries(persone.map((p) => [p, `${p.slice(-2)}@example.it`])),
    chiaviUniche: true,
  });
  const base = giro.admin as unknown as Amministrativo;
  const admin: Amministrativo = {
    ...(giro.admin as object),
    rpc: base.rpc,
    from(tabella: string) {
      const q = base.from(tabella) as { insert: (r: Riga | Riga[]) => unknown };
      if (tabella === 'notifications') {
        const vera = q.insert.bind(q);
        // Il default della colonna vera: una notifica nuova non è letta.
        q.insert = (r: Riga | Riga[]) => vera((Array.isArray(r) ? r : [r]).map((x) => ({ is_read: false, ...x })));
      }
      return q;
    },
  } as Amministrativo;
  mondo.admin = admin;
  return {
    giro,
    admin,
    /** Da stanotte la lista della notte dice questo. */
    lista: (elenco: Array<{ user_id: string; deleted_at: string }>) => {
      admin.rpc = async () => ({ data: elenco, error: null });
    },
    profilo: (id: string) => giro.righe('profiles').find((p) => p.id === id),
    allarmiDi: (persona: string, amministratore = 'admin-1') =>
      giro.righe('notifications').filter(
        (n) => n.title === TITOLO && n.user_id === amministratore && String(n.body).includes(persona),
      ),
  };
}

const unaNotte = async (n: number) => {
  vi.setSystemTime(ADESSO + n * GIORNO);
  const r = await POST(
    new Request('http://localhost/api/cron/process-deletions?a_mano=1&cancella=1', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
};

/** Due notti con la posta giù: dalla seconda l'email è ferma e c'è «scrivile tu». */
async function dueNottiConLaPostaGiu(m: ReturnType<typeof ilMondo>, persone: string[]) {
  await unaNotte(0);
  await unaNotte(1);
  for (const p of persone) {
    expect(m.allarmiDi(p), 'la rotta non ha scritto «scrivile tu»: la prova non prova niente').toHaveLength(1);
    expect(m.allarmiDi(p)[0].is_read).toBe(false);
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  mondo.postaSu = false;
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R03-006 · «scrivile tu» si chiude se la persona esce dall elenco della notte', () => {
  it('la persona annulla la richiesta: la notte dopo, senza nessuno in lista, l allarme si chiude per tutti', async () => {
    const m = ilMondo([PRIMA]);
    await dueNottiConLaPostaGiu(m, [PRIMA]);
    m.profilo(PRIMA)!.deletion_requested_at = null;
    m.lista([]);
    await unaNotte(2);
    expect(m.allarmiDi(PRIMA, 'admin-1').map((n) => n.is_read), 'resta aperto per sempre').toEqual([true]);
    expect(m.allarmiDi(PRIMA, 'admin-2').map((n) => n.is_read)).toEqual([true]);
  });

  it('una persona viene cancellata, l altra aspetta ancora: si chiude solo l allarme della prima', async () => {
    const m = ilMondo([PRIMA, SECONDA]);
    await dueNottiConLaPostaGiu(m, [PRIMA, SECONDA]);
    // Cancellata: il profilo se ne va con l'account. La seconda resta in lista con la posta giù.
    m.giro.db.profiles = m.giro.righe('profiles').filter((p) => p.id !== PRIMA);
    m.lista([{ user_id: SECONDA, deleted_at: CHIESTA_IL }]);
    await unaNotte(2);
    expect(m.allarmiDi(PRIMA).map((n) => n.is_read), 'la persona cancellata ha ancora «scrivile tu»').toEqual([true]);
    expect(m.allarmiDi(SECONDA).map((n) => n.is_read), 'chi aspetta ancora perde l allarme').toEqual([false]);
  });

  it('la persona rifà la richiesta con un altra data: l allarme della richiesta vecchia si chiude', async () => {
    const m = ilMondo([PRIMA]);
    await dueNottiConLaPostaGiu(m, [PRIMA]);
    const nuova = new Date(ADESSO + 2 * GIORNO - 3 * GIORNO).toISOString();
    m.profilo(PRIMA)!.deletion_requested_at = nuova;
    m.lista([]);
    await unaNotte(2);
    const vecchio = identificativoAvviso(`${identificativoAvviso(chiaveAvviso(PRIMA, CHIESTA_IL, 'rinviata'))}:email-ferma:admin-1`);
    const allarme = m.giro.righe('notifications').find((n) => n.id === vecchio);
    expect(allarme?.is_read, 'l allarme della richiesta di prima resta aperto').toBe(true);
  });

  it('controprova: chi aspetta ancora, anche se stanotte non è in lista, tiene il suo allarme', async () => {
    const m = ilMondo([PRIMA]);
    await dueNottiConLaPostaGiu(m, [PRIMA]);
    // Stanotte la lista non lo porta (per esempio un negozio con un ordine aperto), ma la richiesta c'è.
    m.lista([]);
    await unaNotte(2);
    expect(m.allarmiDi(PRIMA).map((n) => n.is_read)).toEqual([false]);
  });

  it('chi è oltre il mese e aspetta ancora tiene anche «scrivile tu» del termine scaduto, non solo quello del rinvio', async () => {
    // Oltre il mese la stessa persona ha due spiegazioni ferme (rinvio e termine scaduto), due allarmi.
    const oltreIlMese = new Date(ADESSO - 35 * GIORNO).toISOString();
    const m = ilMondo([PRIMA], [], [], oltreIlMese);
    const allarmeDella = (tappa: 'rinviata' | 'termine-scaduto') => {
      const idAllarme = identificativoAvviso(`${identificativoAvviso(chiaveAvviso(PRIMA, oltreIlMese, tappa))}:email-ferma:admin-1`);
      return m.giro.righe('notifications').find((n) => n.id === idAllarme);
    };
    await unaNotte(0);
    await unaNotte(1);
    expect(allarmeDella('termine-scaduto'), 'la rotta non ha scritto «scrivile tu» del termine scaduto: la prova non prova niente').toBeDefined();
    expect(allarmeDella('rinviata')).toBeDefined();
    expect(allarmeDella('termine-scaduto')?.is_read, 'chiuso la notte stessa con l email del termine scaduto ancora ferma').toBe(false);
    // Stanotte la lista non la porta, ma la richiesta c'è ancora: tutti e due restano aperti.
    m.lista([]);
    await unaNotte(2);
    expect(allarmeDella('termine-scaduto')?.is_read, 'chi aspetta oltre il mese perde «scrivile tu» del termine scaduto').toBe(false);
    expect(allarmeDella('rinviata')?.is_read).toBe(false);
  });
});

describe('R03-007 · la chiusura legge tutti gli allarmi aperti, in ordine, oltre i primi 200', () => {
  const id = (n: number, prefisso = '00000000') => `${prefisso}-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const allarme = (idRiga: string, persona: string, campi: Riga = {}): Riga => ({
    id: idRiga, user_id: 'admin-1', category: 'system', title: TITOLO, is_read: false,
    body: `Una spiegazione dell'attesa non è partita per email. Chi aspetta: l'utente ${persona}. La spiegazione ferma è quella del rinvio.`,
    ...campi,
  });

  it('300 avvisi già letti o d altro tipo davanti: l allarme aperto in fondo si chiude lo stesso', async () => {
    const davanti: Riga[] = Array.from({ length: 300 }, (_, i) =>
      i % 2 === 0
        ? allarme(id(i + 1), id(9000 + i, '11111111'), { is_read: true })
        : { id: id(i + 1), user_id: 'admin-1', category: 'system', title: 'Dati vecchi non cancellati', body: 'altro', is_read: false });
    const inFondo = allarme(id(999), id(1, '22222222'));
    const m = ilMondo([], [...davanti, inFondo]);
    await unaNotte(0);
    expect(m.giro.righe('notifications').find((n) => n.id === inFondo.id)?.is_read, 'oltre i primi 200 resta aperto').toBe(true);
  });

  it('più di 200 allarmi aperti di chi aspetta ancora, poi uno di chi è uscito: si chiude anche quello', async () => {
    // 210 persone in attesa, con l'allarme che la rotta avrebbe scritto per loro (stesso identificativo).
    const inAttesa = Array.from({ length: 210 }, (_, i) => id(i + 1, '33333333'));
    const loro = inAttesa.map((p) =>
      allarme(identificativoAvviso(`${identificativoAvviso(chiaveAvviso(p, CHIESTA_IL, 'rinviata'))}:email-ferma:admin-1`), p));
    const uscita = allarme('ffffffff-ffff-4fff-bfff-ffffffffffff', id(1, '44444444'));
    // In ordine di id, come le legge il database con `order('id')` (il finto non ordina da sé).
    const tutte = [...loro, uscita].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
    const m = ilMondo([], tutte, inAttesa.map((p) => ({ id: p, role: 'rider', deletion_requested_at: CHIESTA_IL })));
    await unaNotte(0);
    const dopo = m.giro.righe('notifications');
    expect(dopo.find((n) => n.id === uscita.id)?.is_read, 'il duecentoundicesimo resta aperto per sempre').toBe(true);
    expect(dopo.filter((n) => n.title === TITOLO && n.is_read === false), 'chi aspetta ancora perde l allarme').toHaveLength(210);
  });

  it('la chiusura legge solo «scrivile tu»: «Persone non avvisate» di chi aspetta e non è avvisato resta aperto', async () => {
    const NON_AVVISATE = 'Persone non avvisate del rinvio della cancellazione';
    const m = ilMondo([PRIMA]);
    // Il pannello della persona rifiuta la riga: la spiegazione non arriva e la rotta scrive l'allarme,
    // che nel testo ha «Chi aspetta: l'utente …» come «scrivile tu».
    m.giro.guasti.push({
      tabella: 'notifications', azione: 'insert', messaggio: 'permission denied for table notifications',
      seRiga: (r) => r.user_id === PRIMA,
    });
    const nonAvvisate = () =>
      m.giro.righe('notifications').filter((n) => n.title === NON_AVVISATE && n.user_id === 'admin-1');
    for (let notte = 0; notte < 2; notte++) {
      const { corpo } = await unaNotte(notte);
      expect(corpo.avvisiFalliti, 'il guasto del pannello non c è: la prova non prova niente').toBe(1);
      expect(nonAvvisate(), 'la rotta non ha scritto «Persone non avvisate»').toHaveLength(1);
      expect(String(nonAvvisate()[0].body)).toContain(`Chi aspetta: l'utente ${PRIMA}.`);
      expect(nonAvvisate()[0].is_read, 'la chiusura dello «scrivile tu» ha chiuso «Persone non avvisate»').toBe(false);
    }
  });
});
