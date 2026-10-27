/**
 * LA SPIEGAZIONE PER EMAIL CHE NON PARTE SI RIPROVA LA NOTTE DOPO.
 *
 * 27/10/2026 (terzo giro del pacchetto app/api/account) — il collaudo l'ha
 * trovata così. Chi aspetta la cancellazione riceve il motivo dell'attesa nel
 * pannello del sito e, una volta sola, anche per email. Ma «una volta sola»
 * era legato alla PRIMA scrittura della notifica: se quella notte la posta
 * diceva di no (Resend 503, posta spenta, indirizzo che non si legge), la notte
 * dopo la notifica c'era già, l'avviso risultava «già detto» e l'email non
 * ripartiva mai più. Trenta notti, zero email, e nessuno lo sapeva.
 *
 * Le notti qui passano contro un finto database che si comporta come quello
 * vero: legge quello che ha scritto, e la chiave primaria rifiuta il doppione
 * su TUTTE le tabelle — anche sul registro delle azioni, dove adesso resta
 * scritto «tentativo n. 2» e «l'email è partita».
 */
import { describe, it, expect, vi } from 'vitest';
import {
  recapitaAvvisi,
  type ClienteAvvisi,
  type PostaAvvisi,
  type RegistroAvvisi,
} from '@/lib/privacy/avvisi-a-chi-aspetta';
import { verdettoDelGiro, type TentativoCancellazione } from '@/lib/cron-cancellazioni';

const ADESSO = new Date('2026-10-27T04:00:00.000Z').getTime();
const giorniFa = (g: number) => new Date(ADESSO - g * 86_400_000).toISOString();

const FATTORINO: TentativoCancellazione = {
  userId: 'rider-1',
  ok: false,
  motivo: 'cassa_da_versare',
  errore: 'Cancellazione rinviata: risultano 120,00 € di contanti incassati e non ancora versati.',
  chiestaIl: giorniFa(8),
};

const dovuti = () => verdettoDelGiro([FATTORINO], ADESSO, 'privacy@mycity.example').dovuti;

const registro = (): RegistroAvvisi => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

type Riga = Record<string, unknown>;

/** Un database come quello vero: legge quello che ha scritto, e il doppione sbatte sulla chiave primaria. */
function databaseVero() {
  const tabelle: Record<string, Riga[]> = {};
  const rotte = new Set<string>();
  const righe = (t: string) => (tabelle[t] ??= []);
  const cliente: ClienteAvvisi = {
    from: (t) => ({
      select: () => ({
        eq: async (colonna, valore) =>
          rotte.has(t)
            ? { data: null, error: { message: `permission denied for table ${t}` } }
            : { data: righe(t).filter((r) => r[colonna] === valore), error: null },
      }),
      insert: async (nuove) => {
        if (rotte.has(t)) return { data: null, error: { message: `permission denied for table ${t}` } };
        if (nuove.some((n) => righe(t).some((r) => r.id === n.id))) {
          return { data: null, error: { message: `duplicate key value violates unique constraint "${t}_pkey"` } };
        }
        righe(t).push(...nuove);
        return { data: nuove, error: null };
      },
    }),
  };
  return { cliente, righe, rotte };
}

/** La posta: dice sì o no come le si chiede, notte per notte, e tiene il conto. */
function postaFinta() {
  const stato = { risponde: true };
  const partite: string[] = [];
  const invia = vi.fn(async (l: { to: string; subject: string; html: string }) => {
    if (stato.risponde) partite.push(l.to);
    return { ok: stato.risponde };
  });
  const posta: PostaAvvisi = { indirizzoDi: async () => 'rider@example.com', invia };
  return { posta, stato, partite, tentativi: () => invia.mock.calls.length };
}

describe("la spiegazione per email che non parte si riprova la notte dopo", () => {
  it("IL CASO CHE ROMPEVA — la prima notte la posta dice di no, le trenta dopo sì: la spiegazione arriva, una volta", async () => {
    const db = databaseVero();
    const p = postaFinta();

    p.stato.risponde = false;
    const prima = await recapitaAvvisi(db.cliente, dovuti(), registro(), p.posta);
    expect(prima.recapitati, 'il pannello deve avere la spiegazione già la prima notte').toBe(1);
    expect(prima.emailNonPartite).toBe(1);

    p.stato.risponde = true;
    for (let notte = 2; notte <= 31; notte++) {
      await recapitaAvvisi(db.cliente, dovuti(), registro(), p.posta);
    }

    expect(
      p.partite,
      "trenta notti con la posta buona e la spiegazione non riparte mai: l'avviso risultava «già detto»",
    ).toEqual(['rider@example.com']);
    expect(p.tentativi(), 'una notte di no e una di sì: partita una volta, non si rimanda').toBe(2);
    expect(db.righe('notifications'), 'il pannello resta con un avviso solo').toHaveLength(1);
  });

  it('trenta notti con la posta buona sono una email sola', async () => {
    const db = databaseVero();
    const p = postaFinta();
    for (let notte = 1; notte <= 30; notte++) {
      await recapitaAvvisi(db.cliente, dovuti(), registro(), p.posta);
    }
    expect(p.tentativi(), 'trenta notti sono diventate trenta email').toBe(1);
    expect(p.partite).toHaveLength(1);
  });

  it('due giri partiti insieme la notte del nuovo tentativo: parte una email, non due', async () => {
    const db = databaseVero();
    const p = postaFinta();

    p.stato.risponde = false;
    await recapitaAvvisi(db.cliente, dovuti(), registro(), p.posta);

    p.stato.risponde = true;
    const [a, b] = await Promise.all([
      recapitaAvvisi(db.cliente, dovuti(), registro(), p.posta),
      recapitaAvvisi(db.cliente, dovuti(), registro(), p.posta),
    ]);

    expect(p.partite, 'due giri insieme: la stessa spiegazione due volte, oppure nessuna').toHaveLength(1);
    expect(a.falliti + b.falliti).toBe(0);
    expect(
      a.emailNonPartite + b.emailNonPartite,
      "il giro che trova il tentativo già preso dall'altro non ha perso niente",
    ).toBe(0);
  });

  it("se il registro degli invii non si legge, non si spedisce alla cieca ogni notte: lo si conta", async () => {
    const db = databaseVero();
    const p = postaFinta();
    db.rotte.add('audit_logs');

    const prima = await recapitaAvvisi(db.cliente, dovuti(), registro(), p.posta);
    const seconda = await recapitaAvvisi(db.cliente, dovuti(), registro(), p.posta);

    expect(prima.recapitati, 'il pannello non dipende dal registro delle email').toBe(1);
    expect(
      p.tentativi(),
      'senza un posto dove scrivere «partita» ogni notte sarebbe una email in più',
    ).toBe(0);
    expect([prima.emailNonPartite, seconda.emailNonPartite], "un'email non tentata è un'email non partita").toEqual([1, 1]);
  });
});
