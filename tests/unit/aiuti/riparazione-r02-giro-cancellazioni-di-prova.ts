/**
 * R02-004 — L'IMPIANTO COMUNE DELLE PROVE SULLA CANCELLAZIONE DELL'ACCOUNT.
 *
 * Prima stava tutto in un file di 1035 righe che mescolava le rotte, la notte e una scansione del
 * sorgente. Ora le prove stanno in tre file e questo è quello che hanno in comune: le persone, lo
 * stato del mondo finto (il finto unico del giro notturno, con i suoi guasti), la posta, i giri.
 *
 * I `vi.mock` restano in ogni file di prova: vitest li sposta in cima al file che li chiama, e questo
 * modulo (che importa la rotta della notte) va importato dopo di loro.
 */
import { vi } from "vitest";
import { fintoGiroNotturno, type Guasto } from "./finto-giro-notturno";
import { POST as notte } from "@/app/api/cron/process-deletions/route";
import { __resetRateLimitBuckets } from "@/lib/rate-limit";

export type Esito = { ok: boolean; motivo?: string; errore?: string; fileRimossi: number; erroriFile: string[] };

export const UTENTE = { id: "rider-1", email: "rider@example.com" };
/**
 * 27/10/2026 (quinto giro) — Un secondo fattorino con la SUA casella. Senza,
 * la sua spiegazione non partiva perché mancava l'indirizzo, non perché la
 * posta era giù: le prove con due persone provavano un'altra cosa.
 */
export const SECONDO = { id: "rider-2", email: "rider2@example.com" };
export const PERSONE = [UTENTE, SECONDO];

/** Le caselle delle persone: il finto le dà ad `auth.admin.getUserById`, l'indirizzo della spiegazione. */
export const INDIRIZZI = Object.fromEntries(PERSONE.map((p) => [p.id, p.email]));

export const stato: {
  mondo: ReturnType<typeof fintoGiroNotturno>;
  senzaChiave: boolean;
  esiti: Record<string, Esito>;
} = { mondo: fintoGiroNotturno({ indirizzi: INDIRIZZI }), senzaChiave: false, esiti: {} };

/**
 * R02-004 — I guasti che la notte deve reggere li dà il finto unico (`finto.guasti`, letto a ogni
 * richiesta): prima qui c'era un `adminDiProva` che riscriveva a mano insert, eq, select e single.
 */
export const GUASTO = {
  /** Il database rifiuta gli avvisi scritti a questa persona (e solo a lei). */
  avvisiA: (chi: string): Guasto => ({
    tabella: "notifications", azione: "insert", messaggio: "permission denied", seRiga: (r) => r.user_id === chi,
  }),
  /**
   * Il registro delle azioni non si legge e non si scrive — solo lì dove la notte segna i tentativi
   * d'invio. Le potature della stessa tabella restano buone: altrimenti la notte diventerebbe rossa
   * per loro, non per l'email.
   */
  registroInvii: (["select", "insert"] as const).map((azione): Guasto => ({
    tabella: "audit_logs", azione, messaggio: "permission denied for table audit_logs",
  })),
  /**
   * 27/10/2026 (sesto giro) — Il registro delle azioni si legge, ma ogni riga nuova la rifiuta con un
   * errore che NON è un doppione: il messaggio vero di PostgREST per un CHECK (23514).
   */
  registroRifiutaLeRighe: {
    tabella: "audit_logs", azione: "insert", codice: "23514",
    messaggio: 'new row for relation "audit_logs" violates check constraint "audit_logs_action_check"',
  } as Guasto,
  /**
   * 27/10/2026 (quarto giro, fase 2) — Una lettura sola che non riesce: quella della riga con questo
   * identificativo in `notifications`. Le altre letture della stessa tabella (il pannello) vanno.
   */
  letturaDi: (id: string): Guasto => ({
    tabella: "notifications", azione: "select", messaggio: "canceling statement due to statement timeout", seFiltro: ["id", id],
  }),
};

/** La posta spenta, com'è oggi in produzione: risponde di no, senza lanciare. */
export const POSTA_SPENTA = async (_x: unknown) => ({ ok: false, skipped: true, reason: "non configurata" }) as { ok: boolean };
export const inviaEmail = vi.fn(POSTA_SPENTA);

export const CASELLA = "NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY";
/**
 * 27/10/2026 (quarto giro) — IL CONTESTO CHE NEXT PASSA SEMPRE.
 * Next chiama ogni rotta con due argomenti: la richiesta e il contesto
 * ({ params }). Le prove chiamavano con uno solo, e il ramo
 * `ctx ? rotta(req, ctx)` — quello di produzione — non lo eseguiva nessuno:
 * una guardia saltata proprio lì restava verde.
 */
export const CTX = { params: Promise.resolve({}) } as never;
export const GIORNO = 86_400_000;
export const giorniFa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString();
export const CHIESTA = giorniFa(8);
export const MOTIVO =
  "Cancellazione rinviata: risultano 120,00 € di contanti incassati alle consegne e non ancora " +
  "versati (1 giornata di cassa). Appena il versamento è registrato la cancellazione riparte da sola.";

export const CASSA_APERTA: Esito = { ok: false, motivo: "cassa_da_versare", errore: MOTIVO, fileRimossi: 0, erroriFile: [] };

export function ilFattorinoConLaCassaAperta(chiesta = CHIESTA, esito: Esito = CASSA_APERTA) {
  stato.senzaChiave = false;
  stato.esiti = { "rider-1": esito };
  stato.mondo = fintoGiroNotturno({
    indirizzi: INDIRIZZI,
    rpc: { process_expired_deletions: { data: [{ user_id: "rider-1", deleted_at: chiesta }], error: null } },
    tabelle: {
      notifications: [],
      profiles: [
        { id: "rider-1", role: "rider", deletion_requested_at: chiesta },
        { id: "admin-1", role: "admin" },
      ],
    },
  });
}

export const SEGRETO_DELLA_NOTTE = "segreto-della-notte-di-prova";
/** Un giro del lavoro notturno, all'ora che segna l'orologio. */
export const unGiro = () =>
  notte(new Request("http://localhost/api/cron/process-deletions", {
    method: "POST",
    headers: { authorization: `Bearer ${SEGRETO_DELLA_NOTTE}` },
  }) as never);

/**
 * Una notte nuova: l'orologio va avanti di un giorno, poi gira il lavoro.
 * 27/10/2026 (quarto giro) — La spiegazione per email si ritenta una volta per
 * notte, non a ogni giro: due giri della stessa notte non sono due notti.
 */
export const passaLaNotte = () => {
  vi.setSystemTime(Date.now() + GIORNO);
  return unGiro();
};

/** Chi bussa col gettone: il controllo d'accesso vero lo riconosce come il fattorino. */
export const conGettone = (metodo: string, percorso: string) =>
  new Request("http://localhost" + percorso, { method: metodo, headers: { authorization: "Bearer gettone-del-fattorino" } });

/** Le lettere spedite a una persona (non quelle al supporto). */
export const lettereA = (indirizzo: string) =>
  inviaEmail.mock.calls
    .map((c) => c[0] as { to?: string; subject?: string; html?: string })
    .filter((l) => l.to === indirizzo);

export const suoi = () => stato.mondo.righe("notifications").filter((n) => n.user_id === "rider-1");

export async function corpo(r: Response | unknown): Promise<string> {
  return JSON.stringify(await (r as Response).json());
}

export const richiestaAlModulo = (ip: string) =>
  new Request("http://localhost/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ name: "Maria Rossi", email: "maria@example.com", subject: "Privacy", message: "Vorrei cancellare il mio account, grazie." }),
  });

export const letto = async (r: unknown) => (await (r as Response).json()) as Record<string, unknown>;

export const GIU = async (_x: unknown) => ({ ok: false, error: "Resend 503" }) as { ok: boolean };
export const SU = async (_x: unknown) => ({ ok: true });

/** Quello che ogni prova rimette a posto prima di partire (era il `beforeEach` del file lungo). */
export function preparaLaProva() {
  // L'orologio lo muoviamo noi, e solo lui: i timer restano veri.
  const adesso = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(adesso);
  delete process.env[CASELLA];
  delete process.env.SUPPORT_EMAIL;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
  process.env.CRON_SECRET = SEGRETO_DELLA_NOTTE;
  inviaEmail.mockClear();
  // Ogni prova riparte con la posta spenta: una posta «buona» lasciata da una
  // prova non deve far passare quella dopo.
  inviaEmail.mockImplementation(POSTA_SPENTA);
  __resetRateLimitBuckets();
}
