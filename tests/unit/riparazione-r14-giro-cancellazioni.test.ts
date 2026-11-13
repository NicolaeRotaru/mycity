/**
 * R14 · il giro notturno delle cancellazioni account
 * (`app/api/cron/process-deletions`), con la pipeline vera di cancellazione
 * (`lib/account/cancellazione.ts`) sopra il finto database del giro
 * (tests/unit/aiuti/finto-giro-notturno.ts, usato com'è).
 *
 * R14-015 — Il lavoro entra da due porte (il calendario di Vercel e il cron
 * esterno): due giri partiti insieme prendono lo stesso account scaduto. Uno lo
 * cancella, l'altro riceve dal servizio di accesso «utente non trovato» e lo
 * contava come cancellazione fallita: l'account era sparito, ma la notte finiva
 * rossa e agli amministratori arrivava «Cancellazioni account non eseguite».
 *
 * R14-012 — Quando la spiegazione dovuta a chi aspetta non si scrive nel suo
 * pannello, la notte scriveva agli amministratori «Persone non avvisate del
 * rinvio della cancellazione»: un allarme nuovo a ogni notte, uguale al
 * precedente, e senza dire chi. La stessa classe era già chiusa per le email.
 *
 * R14-013 — Le spiegazioni a chi aspetta partivano persona per persona,
 * pannello ed email, senza un tetto di tempo. Con la posta appesa (fino a due
 * volte dieci secondi a email) e una quindicina di persone, il giro arrivava ai
 * 300 secondi del lavoro e veniva fermato: gli ultimi non avevano nemmeno la
 * spiegazione nel pannello. Orologio finto: ogni email «appesa» lo manda avanti.
 *
 * R14-014 — L'allarme «scrivile tu» (spiegazione non partita per email) si
 * chiudeva solo la notte in cui l'email partiva. Se la persona annullava la
 * richiesta o veniva cancellata, restava aperto per sempre col suo id.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

const mondo = vi.hoisted(() => ({ admin: null as unknown }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
const posta = vi.hoisted(() => ({ invia: (async () => ({ ok: true })) as (x: unknown) => Promise<{ ok: boolean }> }));
vi.mock('@/lib/email/client', () => ({ sendEmail: (x: unknown) => posta.invia(x) }));

import { POST } from '@/app/api/cron/process-deletions/route';

const MARIA = '00000000-0000-4000-8000-0000000000a1';
const giorniFa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString();

/** «Utente non trovato», come lo dice il servizio di accesso di Supabase. */
const UTENTE_NON_TROVATO = { message: 'User not found', status: 404, code: 'user_not_found' };

/**
 * Il finto database del giro, con il servizio di accesso vero nel modo che
 * conta qui: l'account si chiude una volta, e chiuso porta via il profilo
 * (ON DELETE CASCADE). Chi arriva dopo trova «utente non trovato».
 */
function laNotteDiMaria() {
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [
        { id: 'admin-1', role: 'admin' },
        { id: MARIA, role: 'buyer', deletion_requested_at: giorniFa(8) },
      ],
      notifications: [],
      cron_heartbeats: [],
      cod_reconciliations: [],
    },
    rpc: {
      process_expired_deletions: { data: [{ user_id: MARIA, deleted_at: giorniFa(8) }], error: null },
    },
  });
  let chiuso = false;
  let chiusure = 0;
  mondo.admin = {
    ...giro.admin,
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: chiuso ? null : { email: 'maria@example.it' } }, error: null }),
        deleteUser: async (id: string) => {
          const giaChiuso = chiuso;
          chiuso = true;
          await new Promise((r) => setTimeout(r, 2));
          if (giaChiuso) return { error: UTENTE_NON_TROVATO };
          chiusure++;
          giro.db.profiles = (giro.db.profiles ?? []).filter((p) => p.id !== id);
          return { error: null };
        },
      },
    },
  };
  return { giro, chiusure: () => chiusure };
}

function unGiro() {
  return POST(
    new Request('http://localhost/api/cron/process-deletions', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );
}

const segretoSalvato = process.env.CRON_SECRET;
beforeEach(() => {
  vi.clearAllMocks();
  posta.invia = async () => ({ ok: true });
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  process.env.CRON_SECRET = segretoSalvato;
});

describe('R14-015 — due giri della cancellazione partiti insieme', () => {
  it("l'account sparisce una volta e nessuno riceve un falso allarme di cancellazione fallita", async () => {
    const { giro, chiusure } = laNotteDiMaria();

    const [a, b] = await Promise.all([unGiro(), unGiro()]);
    const corpi = [await a.json(), await b.json()];

    expect(chiusure()).toBe(1);
    expect(giro.righe('profiles').some((p) => p.id === MARIA)).toBe(false);
    const sveglie = giro.notifiche().filter((n) => n.title === 'Cancellazioni account non eseguite');
    expect(sveglie, 'falso allarme: la cancellazione e riuscita').toHaveLength(0);
    expect(corpi.map((c) => c.failed), 'il secondo giro conta come fallita una cancellazione riuscita').toEqual([0, 0]);
    expect([a.status, b.status], 'la notte finisce rossa per niente').toEqual([200, 200]);
  });

  it('una cancellazione che fallisce davvero sveglia ancora qualcuno', async () => {
    const { giro } = laNotteDiMaria();
    mondo.admin = {
      ...(mondo.admin as object),
      auth: {
        admin: {
          getUserById: async () => ({ data: { user: { email: 'maria@example.it' } }, error: null }),
          deleteUser: async () => ({ error: { message: 'Database error deleting user', status: 500 } }),
        },
      },
    };

    const res = await unGiro();

    expect(res.status).toBe(500);
    expect((await res.json()).failed).toBe(1);
    expect(giro.notifiche().filter((n) => n.title === 'Cancellazioni account non eseguite')).toHaveLength(1);
  });
});

// ── un fattorino con la cassa aperta: la cancellazione si rinvia e gli si deve dire perché ──
const LUCA = '00000000-0000-4000-8000-0000000000b2';
const GIORNO = 86_400_000;

/**
 * La notte di Luca: ha chiesto la cancellazione, ma ha 120 € di contanti da
 * versare. La pipeline vera lo rinvia e la notte gli deve la spiegazione nel
 * pannello. `rifiutaIlPannelloDi`: il database rifiuta le notifiche scritte a
 * quella persona (e solo a lei).
 */
function laNotteDiLuca(o: { rifiutaIlPannelloDi?: string } = {}) {
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [
        { id: 'admin-1', role: 'admin' },
        { id: LUCA, role: 'rider', deletion_requested_at: giorniFa(8) },
      ],
      notifications: [],
      cron_heartbeats: [],
      audit_logs: [],
      cod_reconciliations: [
        { rider_id: LUCA, for_date: '2026-11-01', collected_cents: 12_000, status: 'OPEN', remitted_at: null },
      ],
    },
    rpc: {
      process_expired_deletions: { data: [{ user_id: LUCA, deleted_at: giorniFa(8) }], error: null },
    },
  });
  const base = giro.admin as unknown as { from(t: string): Record<string, unknown> };
  mondo.admin = {
    ...giro.admin,
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: 'luca@example.it' } }, error: null }),
        deleteUser: async () => ({ error: null }),
      },
    },
    from(tabella: string) {
      const q = base.from(tabella);
      if (tabella === 'notifications' && o.rifiutaIlPannelloDi) {
        const bersaglio = o.rifiutaIlPannelloDi;
        const vera = (q.insert as (r: unknown) => unknown).bind(q);
        q.insert = (righe: Record<string, unknown> | Record<string, unknown>[]) => {
          const lista = Array.isArray(righe) ? righe : [righe];
          if (!lista.some((r) => r.user_id === bersaglio)) return vera(righe);
          return { then: (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, error: { message: 'permission denied' } })) };
        };
      }
      return q;
    },
  };
  return giro;
}

describe('R14-012 — l allarme «persone non avvisate» è uno per stato e dice chi', () => {
  beforeEach(() => {
    const adesso = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(adesso);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('tre notti col pannello di Luca che rifiuta: un allarme per amministratore, col suo identificativo', async () => {
    const giro = laNotteDiLuca({ rifiutaIlPannelloDi: LUCA });

    for (let notte = 0; notte < 3; notte++) {
      const res = await unGiro();
      expect((await res.json()).avvisiFalliti, 'premessa: la spiegazione a Luca non si scrive').toBe(1);
      vi.setSystemTime(Date.now() + GIORNO);
    }

    const allarmi = giro.notifiche().filter((n) => n.title === 'Persone non avvisate del rinvio della cancellazione');
    expect(allarmi, 'un allarme nuovo a ogni notte, uguale al precedente').toHaveLength(1);
    expect(String(allarmi[0].body), 'l allarme non dice chi aspetta').toContain(LUCA);
  });
});

// ── quindici fattorini con la cassa aperta e la posta appesa ─────────────────
/** I 300 secondi che Vercel dà al lavoro (vercel.json, maxDuration). */
const DURATA_MASSIMA_MS = 300_000;

function laNotteDiQuindici() {
  const fattorini = Array.from({ length: 15 }, (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`);
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [
        { id: 'admin-1', role: 'admin' },
        ...fattorini.map((id) => ({ id, role: 'rider', deletion_requested_at: giorniFa(8) })),
      ],
      notifications: [],
      cron_heartbeats: [],
      audit_logs: [],
      cod_reconciliations: fattorini.map((id) => (
        { rider_id: id, for_date: '2026-11-01', collected_cents: 5_000, status: 'OPEN', remitted_at: null }
      )),
    },
    rpc: {
      process_expired_deletions: { data: fattorini.map((id) => ({ user_id: id, deleted_at: giorniFa(8) })), error: null },
    },
  });
  // Quando è stata scritta ogni spiegazione nel pannello, sull'orologio della notte.
  const scritteAl = new Map<string, number>();
  const base = giro.admin as unknown as { from(t: string): Record<string, unknown> };
  mondo.admin = {
    ...giro.admin,
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { email: `${id}@example.it` } }, error: null }),
        deleteUser: async () => ({ error: null }),
      },
    },
    from(tabella: string) {
      const q = base.from(tabella);
      if (tabella === 'notifications') {
        const vera = (q.insert as (r: unknown) => unknown).bind(q);
        q.insert = (righe: Record<string, unknown> | Record<string, unknown>[]) => {
          for (const r of Array.isArray(righe) ? righe : [righe]) {
            if (fattorini.includes(String(r.user_id))) scritteAl.set(String(r.user_id), Date.now());
          }
          return vera(righe);
        };
      }
      return q;
    },
  };
  return { giro, fattorini, scritteAl };
}

describe('R14-013 — gli avvisi e le email della notte hanno un tetto di tempo', () => {
  beforeEach(() => {
    const adesso = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(adesso);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('posta appesa e quindici persone: tutte hanno il pannello prima dello stop, e il giro finisce in tempo', async () => {
    const { fattorini, scritteAl } = laNotteDiQuindici();
    const inizio = Date.now();
    let spedite = 0;
    // Ogni email aspetta la posta 25 secondi e poi non parte.
    posta.invia = async () => {
      spedite++;
      vi.setSystemTime(Date.now() + 25_000);
      return { ok: false };
    };

    const res = await unGiro();
    const corpo = await res.json();
    const durata = Date.now() - inizio;

    const tardive = fattorini.filter((id) => !((scritteAl.get(id) ?? Infinity) - inizio < DURATA_MASSIMA_MS));
    expect(tardive, 'il pannello di questi arriva dopo i 300 secondi: il giro li avrebbe già fermati').toEqual([]);
    expect(durata, 'il giro va oltre i 300 secondi del lavoro').toBeLessThan(DURATA_MASSIMA_MS);
    expect(spedite).toBeGreaterThan(0);
    expect(corpo.avvisiEmailFuoriTempo + spedite).toBe(15);
  });

  it('la notte dopo riparte da dove si era fermata: le email non tentate partono', async () => {
    const { fattorini } = laNotteDiQuindici();
    const destinatari: string[] = [];
    posta.invia = async (x: unknown) => {
      destinatari.push(String((x as { to?: string }).to));
      vi.setSystemTime(Date.now() + 25_000);
      return { ok: true };
    };

    await unGiro();
    const primaNotte = destinatari.length;
    vi.setSystemTime(Date.now() + GIORNO);
    await unGiro();

    expect(primaNotte).toBeLessThan(15);
    expect(new Set(destinatari).size, 'qualcuno resta senza email anche la seconda notte').toBe(15);
    expect(destinatari.length, 'una email spedita due volte').toBe(15);
    expect(fattorini.every((id) => destinatari.includes(`${id}@example.it`))).toBe(true);
  });
});

// ── l'allarme «scrivile tu» e chi non aspetta più ─────────────────────────────
/**
 * Luca, con la cassa aperta e la posta giù: dalla seconda notte la sua
 * spiegazione per email è ferma e agli amministratori arriva «scrivile tu».
 * Qui la lista delle richieste scadute la fa il database vero: solo chi ha
 * ancora la richiesta aperta. E l'account chiuso porta via il profilo.
 */
function lucaConLaPostaGiu() {
  const giro = laNotteDiLuca();
  const profili = () => giro.db.profiles ?? [];
  const base = mondo.admin as Record<string, unknown> & { auth: { admin: Record<string, unknown> } };
  mondo.admin = {
    ...base,
    rpc: async (nome: string) => {
      if (nome !== 'process_expired_deletions') return { data: [], error: null };
      const scadute = profili().filter((p) => p.deletion_requested_at);
      return { data: scadute.map((p) => ({ user_id: p.id, deleted_at: p.deletion_requested_at })), error: null };
    },
    auth: {
      admin: {
        ...base.auth.admin,
        deleteUser: async (id: string) => {
          giro.db.profiles = profili().filter((p) => p.id !== id);
          return { error: null };
        },
      },
    },
  };
  posta.invia = async () => ({ ok: false });
  const allarmi = () => giro.righe('notifications').filter((n) => n.title === "Spiegazione dell'attesa non partita per email");
  return { giro, allarmi };
}

describe("R14-014 — l'allarme «scrivile tu» si chiude anche quando non c'è più nessuno a cui scrivere", () => {
  beforeEach(() => {
    const adesso = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(adesso);
  });
  afterEach(() => { vi.useRealTimers(); });

  const notte = async () => { vi.setSystemTime(Date.now() + GIORNO); await unGiro(); };

  it('Luca annulla la richiesta: la notte dopo il suo allarme è chiuso', async () => {
    const { giro, allarmi } = lucaConLaPostaGiu();
    await notte();
    await notte();
    expect(allarmi().length, 'premessa: dalla seconda notte la spiegazione è ferma e l allarme c è').toBe(1);
    expect(allarmi()[0].is_read).not.toBe(true);

    const luca = giro.righe('profiles').find((p) => p.id === LUCA)!;
    luca.deletion_requested_at = null;
    await notte();

    expect(allarmi().map((n) => n.is_read), 'l allarme di chi ha annullato resta aperto per sempre').toEqual([true]);
  });

  it('Luca versa i contanti e viene cancellato: il suo allarme si chiude', async () => {
    const { giro, allarmi } = lucaConLaPostaGiu();
    await notte();
    await notte();
    expect(allarmi().length).toBe(1);

    giro.righe('cod_reconciliations').forEach((r) => { r.remitted_at = new Date().toISOString(); });
    await notte();

    expect(giro.righe('profiles').some((p) => p.id === LUCA), 'premessa: Luca è stato cancellato').toBe(false);
    expect(allarmi().map((n) => n.is_read), 'l allarme resta aperto con l id di una persona cancellata').toEqual([true]);
  });

  it('finché Luca aspetta, il suo allarme resta aperto', async () => {
    const { allarmi } = lucaConLaPostaGiu();
    await notte();
    await notte();
    await notte();
    expect(allarmi().length).toBe(1);
    expect(allarmi()[0].is_read).not.toBe(true);
  });
});
