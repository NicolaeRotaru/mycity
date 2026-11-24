/**
 * R02-001 — LA CHIUSURA DI «SCRIVILE TU» HA UN TETTO DI TEMPO SUO, E NON DIPENDE DA QUELLO DELLE EMAIL.
 *
 * La chiusura degli allarmi «scrivile tu» di chi non aspetta più gira dopo le email (quindi dopo il
 * loro tetto di 240 secondi) e non aveva un tetto: con centinaia di allarmi aperti, una scrittura per
 * allarme, la notte andava oltre i 300 secondi della piattaforma, che ferma la funzione senza
 * risposta. Qui l'orologio è finto: ogni scrittura di un allarme costa un secondo.
 *  ① notte senza nessuno in lista, 400 allarmi da chiudere: la risposta arriva prima dei 300 secondi,
 *    una parte si chiude, il resto resta aperto e la notte dopo si chiude;
 *  ② notte in cui le email finiscono oltre il loro tetto (la posta lenta): la chiusura gira lo stesso
 *    (non dipende dal tetto delle email) e si ferma al suo, prima dei 300 secondi.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno, type Riga } from './aiuti/finto-giro-notturno';

const mondo = vi.hoisted(() => ({ admin: null as unknown, postaLenta: 0 }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
const posta = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => {
    // La posta lenta: l'email risponde dopo `postaLenta` millisecondi dell'orologio finto.
    vi.setSystemTime(Date.now() + mondo.postaLenta);
    return { ok: true };
  }),
}));
vi.mock('@/lib/email/client', () => posta);
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: vi.fn(async () => ({
    ok: false, motivo: 'cassa_da_versare', errore: 'contanti da versare', fileRimossi: 0, erroriFile: [],
  })),
}));

import { POST } from '@/app/api/cron/process-deletions/route';

const ADESSO = new Date('2026-11-24T04:00:00+01:00').getTime();
const GIORNO = 86_400_000;
const CHIESTA_IL = new Date(ADESSO - 8 * GIORNO).toISOString();
const PERSONA = '00000000-0000-4000-8000-000000000001';
const TITOLO = "Spiegazione dell'attesa non partita per email";
const PIATTAFORMA_MS = 300_000;

const id = (n: number, prefisso = '00000000') => `${prefisso}-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Un «scrivile tu» aperto di una persona che non aspetta più (il suo profilo non c'è): va chiuso. */
const allarmeDiChiEUscito = (n: number): Riga => ({
  id: id(n, 'aaaaaaaa'), user_id: 'admin-1', category: 'system', title: TITOLO, is_read: false,
  body: `Una spiegazione dell'attesa non è partita per email. Chi aspetta: l'utente ${id(n, 'bbbbbbbb')}. La spiegazione ferma è quella del rinvio.`,
});

type Amministrativo = { rpc: unknown; from: (t: string) => unknown };

function ilMondo(persone: string[], aperti: number) {
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [
        { id: 'admin-1', role: 'admin' },
        ...persone.map((p) => ({ id: p, role: 'rider', deletion_requested_at: CHIESTA_IL })),
      ],
      notifications: Array.from({ length: aperti }, (_, i) => allarmeDiChiEUscito(i + 1)),
      audit_logs: [],
      cron_heartbeats: [],
    },
    rpc: { process_expired_deletions: { data: persone.map((p) => ({ user_id: p, deleted_at: CHIESTA_IL })), error: null } },
    indirizzi: Object.fromEntries(persone.map((p) => [p, `${p.slice(-2)}@example.it`])),
    chiaviUniche: true,
  });
  const base = giro.admin as unknown as Amministrativo;
  mondo.admin = {
    ...(giro.admin as object),
    rpc: base.rpc,
    from(tabella: string) {
      const q = base.from(tabella) as { update: (v: Riga) => unknown };
      if (tabella === 'notifications') {
        const vera = q.update.bind(q);
        // Ogni scrittura di un allarme costa un secondo dell'orologio finto.
        q.update = (v: Riga) => {
          vi.setSystemTime(Date.now() + 1000);
          return vera(v);
        };
      }
      return q;
    },
  };
  return {
    aperti: () => giro.righe('notifications').filter((n) => n.title === TITOLO && n.is_read === false).length,
    chiusi: () => giro.righe('notifications').filter((n) => n.title === TITOLO && n.is_read === true).length,
  };
}

/** Una notte: quanto è durata sull'orologio finto, dall'inizio alla risposta. */
const unaNotte = async (n: number) => {
  const inizio = ADESSO + n * GIORNO;
  vi.setSystemTime(inizio);
  const r = await POST(
    new Request('http://localhost/api/cron/process-deletions?a_mano=1&cancella=1', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );
  await r.json();
  return Date.now() - inizio;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  mondo.postaLenta = 0;
  posta.sendEmail.mockClear();
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R02-001 · la chiusura di «scrivile tu» ha un tetto di tempo suo', () => {
  it('① 400 allarmi da chiudere in una notte senza nessuno in lista: la risposta arriva prima dei 300 secondi', async () => {
    const m = ilMondo([], 400);
    const durata = await unaNotte(0);
    expect(m.chiusi(), 'la chiusura non ha chiuso niente: la prova non prova niente').toBeGreaterThan(0);
    expect(durata, 'la chiusura ha portato la notte oltre i 300 secondi della piattaforma').toBeLessThan(PIATTAFORMA_MS);
    expect(m.aperti(), 'con 400 secondi di scritture qualcuno doveva restare per la notte dopo').toBeGreaterThan(0);
    // La notte dopo chiude i rimasti: il tetto rimanda, non perde.
    await unaNotte(1);
    expect(m.aperti()).toBe(0);
  });

  it('② le email finiscono oltre il loro tetto: la chiusura gira lo stesso e si ferma al suo tetto', async () => {
    const m = ilMondo([PERSONA], 400);
    mondo.postaLenta = 250_000;
    const durata = await unaNotte(0);
    expect(posta.sendEmail, 'l email della persona in attesa non è partita: la prova non prova niente').toHaveBeenCalled();
    expect(m.chiusi(), 'dopo il tetto delle email la chiusura non ha chiuso niente').toBeGreaterThan(0);
    expect(durata, 'la chiusura ha portato la notte oltre i 300 secondi della piattaforma').toBeLessThan(PIATTAFORMA_MS);
  });
});
