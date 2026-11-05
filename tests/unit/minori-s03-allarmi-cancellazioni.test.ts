/**
 * 27/10/2026 — CHI VUOLE CANCELLARSI TROVA UNA STRADA CHE FUNZIONA.
 *
 * Nicola, 27/10: «risolvi il problema che il cliente ha quando deve cancellare
 * l account». La storia vera era questa. Una cliente va in Impostazioni →
 * Privacy e preme «Cancella account»: in produzione manca la chiave di servizio
 * e la risposta è «Servizio non configurato». Torna all informativa e usa il
 * modulo dei contatti: il modulo lancia, errore 500. Prova la casella privacy
 * mostrata nelle impostazioni: è un ripiego scritto nel codice, nessuno la
 * legge. Tre porte, tutte murate.
 *
 * E chi la cancellazione l aveva chiesta davvero — un fattorino con 120 € di
 * contanti non ancora versati — vedeva un conto alla rovescia fermo a zero:
 * il giro notturno calcolava ogni notte la spiegazione che gli dovevamo, e la
 * buttava via. Nessuno chiamava `recapitaAvvisi`.
 *
 * QUI SI ESEGUONO LE ROTTE VERE, non le librerie: la libreria degli avvisi
 * aveva già la sua prova verde, ed era proprio quella prova a far sembrare
 * fatto un lavoro che in produzione non girava.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fintoGiroNotturno } from "./aiuti/finto-giro-notturno";

type Esito = { ok: boolean; motivo?: string; errore?: string; fileRimossi: number; erroriFile: string[] };

const stato: {
  mondo: ReturnType<typeof fintoGiroNotturno>;
  senzaChiave: boolean;
  esiti: Record<string, Esito>;
  /** Il database rifiuta gli avvisi scritti a questa persona (e solo a lei). */
  rifiutaAvvisiA: string | null;
  /**
   * Il registro delle azioni non si legge e non si scrive — solo lì dove la
   * notte segna i tentativi d'invio. Le potature della stessa tabella restano
   * buone: altrimenti la notte diventerebbe rossa per loro, non per l'email.
   */
  registroInviiRotto: boolean;
  /**
   * 27/10/2026 (sesto giro) — Il registro delle azioni si legge, ma ogni riga
   * nuova la rifiuta con un errore che NON è un doppione (qui un CHECK). È il
   * pezzo che `registroInviiRotto` non raggiunge: lì si ferma già la lettura.
   */
  registroInviiRifiutaLeRighe: boolean;
  /**
   * 27/10/2026 (quarto giro, fase 2) — Una lettura sola che non riesce: quella
   * della riga con questo identificativo in `notifications`. Le altre letture
   * della stessa tabella (il pannello della persona) vanno.
   */
  rifiutaLetturaDi: string | null;
} = {
  mondo: fintoGiroNotturno(), senzaChiave: false, esiti: {}, rifiutaAvvisiA: null,
  registroInviiRotto: false, registroInviiRifiutaLeRighe: false, rifiutaLetturaDi: null,
};

const UTENTE = { id: "rider-1", email: "rider@example.com" };
/**
 * 27/10/2026 (quinto giro) — Un secondo fattorino con la SUA casella. Senza,
 * la sua spiegazione non partiva perché mancava l'indirizzo, non perché la
 * posta era giù: le prove con due persone provavano un'altra cosa.
 */
const SECONDO = { id: "rider-2", email: "rider2@example.com" };
const PERSONE = [UTENTE, SECONDO];

/**
 * Il finto database del giro notturno, con in più il `.single()` che usa la
 * pagina dell account: legge la prima riga che passa i filtri.
 */
function adminDiProva() {
  const base = stato.mondo.admin as unknown as {
    from(t: string): Record<string, unknown> & PromiseLike<{ data: unknown[] | null; error: unknown }>;
  };
  return {
    ...(stato.mondo.admin as object),
    // L'indirizzo a cui la notte spedisce la spiegazione per email.
    auth: {
      admin: {
        ...((stato.mondo.admin as { auth?: { admin?: object } }).auth?.admin ?? {}),
        getUserById: async (id: string) => ({ data: { user: PERSONE.find((p) => p.id === id) ?? null }, error: null }),
      },
    },
    from(tabella: string) {
      const q = base.from(tabella);
      if (tabella === "notifications" && stato.rifiutaAvvisiA) {
        const vera = (q.insert as (r: unknown) => unknown).bind(q);
        q.insert = (righe: Record<string, unknown> | Record<string, unknown>[]) => {
          const lista = Array.isArray(righe) ? righe : [righe];
          if (!lista.some((r) => r.user_id === stato.rifiutaAvvisiA)) return vera(righe);
          return { then: (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, error: { message: "permission denied" } })) };
        };
      }
      if (tabella === "notifications" && stato.rifiutaLetturaDi) {
        const bersaglio = stato.rifiutaLetturaDi;
        const veraEq = (q.eq as (c: string, v: unknown) => unknown).bind(q);
        q.eq = (c: string, v: unknown) => {
          if (c !== "id" || v !== bersaglio) return veraEq(c, v);
          const rotta: Record<string, unknown> = {
            then: (ok: (x: unknown) => unknown) =>
              Promise.resolve(ok({ data: null, error: { message: "canceling statement due to statement timeout" } })),
          };
          rotta.eq = () => rotta;
          return rotta;
        };
      }
      if (tabella === "audit_logs" && stato.registroInviiRotto) {
        const rifiuto = { data: null, error: { message: "permission denied for table audit_logs" } };
        // La lettura filtra per tabella E per avviso: due `eq` di fila.
        const lettura: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve(ok(rifiuto)) };
        lettura.eq = () => lettura;
        q.select = () => lettura;
        q.insert = () => ({ then: (ok: (v: unknown) => unknown) => Promise.resolve(ok(rifiuto)) });
      }
      if (tabella === "audit_logs" && stato.registroInviiRifiutaLeRighe) {
        // Il messaggio vero di PostgREST per un CHECK (23514): niente «duplicate key».
        const rifiuto = {
          data: null,
          error: { message: 'new row for relation "audit_logs" violates check constraint "audit_logs_action_check"', code: "23514" },
        };
        q.insert = () => ({ then: (ok: (v: unknown) => unknown) => Promise.resolve(ok(rifiuto)) });
      }
      q.single = async () => {
        const r = await q;
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: r.error };
      };
      return q;
    },
  };
}

/** La posta spenta, com'è oggi in produzione: risponde di no, senza lanciare. */
const POSTA_SPENTA = async (_x: unknown) => ({ ok: false, skipped: true, reason: "non configurata" }) as { ok: boolean };
const inviaEmail = vi.fn(POSTA_SPENTA);

vi.mock("@/lib/supabase/server", () => ({
  getAdminSupabase: () => {
    if (stato.senzaChiave) throw new Error("SUPABASE_SERVICE_ROLE_KEY non configurata");
    return adminDiProva();
  },
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock("@/lib/account/cancellazione", () => ({
  cancellaAccount: async (_a: unknown, userId: string): Promise<Esito> =>
    stato.esiti[userId] ?? { ok: true, fileRimossi: 0, erroriFile: [] },
}));
// 27/10/2026 (secondo giro) — IL CONTROLLO D'ACCESSO È QUELLO VERO.
// Qui c'era un withAuth finto che chiamava la rotta e basta: saltava
// authenticate(), cioè proprio il punto in cui, senza chiave di servizio, la
// risposta era «Auth non configurato». La prova era verde su un ramo che in
// produzione non si eseguiva mai. Adesso si finge solo il servizio di accesso
// di Supabase (di chi è il gettone); withAuth, withAuthRateLimit e
// withCronAuth sono quelli di lib/api/middleware.ts.
vi.mock("@/lib/supabase/anonimo", () => ({
  creaClientAnonimo: () => ({
    auth: { getUser: async () => ({ data: { user: UTENTE }, error: null }) },
  }),
}));
vi.mock("@/lib/captcha", () => ({ verifyTurnstileToken: async () => ({ ok: true }) }));
vi.mock("@/lib/email/client", () => ({ sendEmail: (x: unknown) => inviaEmail(x) }));

import { POST as notte } from "@/app/api/cron/process-deletions/route";
import {
  GET as statoCancellazione,
  POST as chiediCancellazione,
  DELETE as annullaCancellazione,
} from "@/app/api/account/delete/route";
import { GET as scaricaDati } from "@/app/api/account/export/route";
import { POST as scriviAiContatti } from "@/app/api/contact/route";
import { __resetRateLimitBuckets } from "@/lib/rate-limit";
import { recapitoDallaRisposta } from "@/lib/legal/titolare";

const CASELLA = "NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY";
/**
 * 27/10/2026 (quarto giro) — IL CONTESTO CHE NEXT PASSA SEMPRE.
 * Next chiama ogni rotta con due argomenti: la richiesta e il contesto
 * ({ params }). Le prove chiamavano con uno solo, e il ramo
 * `ctx ? rotta(req, ctx)` — quello di produzione — non lo eseguiva nessuno:
 * una guardia saltata proprio lì restava verde.
 */
const CTX = { params: Promise.resolve({}) } as never;
const GIORNO = 86_400_000;
const giorniFa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString();
const CHIESTA = giorniFa(8);
const MOTIVO =
  "Cancellazione rinviata: risultano 120,00 € di contanti incassati alle consegne e non ancora " +
  "versati (1 giornata di cassa). Appena il versamento è registrato la cancellazione riparte da sola.";

const CASSA_APERTA: Esito = { ok: false, motivo: "cassa_da_versare", errore: MOTIVO, fileRimossi: 0, erroriFile: [] };

function ilFattorinoConLaCassaAperta(chiesta = CHIESTA, esito: Esito = CASSA_APERTA) {
  stato.senzaChiave = false;
  stato.rifiutaAvvisiA = null;
  stato.registroInviiRotto = false;
  stato.registroInviiRifiutaLeRighe = false;
  stato.rifiutaLetturaDi = null;
  stato.esiti = { "rider-1": esito };
  stato.mondo = fintoGiroNotturno({
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

const SEGRETO_DELLA_NOTTE = "segreto-della-notte-di-prova";
/** Un giro del lavoro notturno, all'ora che segna l'orologio. */
const unGiro = () =>
  notte(new Request("http://localhost/api/cron/process-deletions", {
    method: "POST",
    headers: { authorization: `Bearer ${SEGRETO_DELLA_NOTTE}` },
  }) as never);

/**
 * Una notte nuova: l'orologio va avanti di un giorno, poi gira il lavoro.
 * 27/10/2026 (quarto giro) — La spiegazione per email si ritenta una volta per
 * notte, non a ogni giro: due giri della stessa notte non sono due notti.
 */
const passaLaNotte = () => {
  vi.setSystemTime(Date.now() + GIORNO);
  return unGiro();
};

/** Chi bussa col gettone: il controllo d'accesso vero lo riconosce come il fattorino. */
const conGettone = (metodo: string, percorso: string) =>
  new Request("http://localhost" + percorso, { method: metodo, headers: { authorization: "Bearer gettone-del-fattorino" } });

/** Le lettere spedite a una persona (non quelle al supporto). */
const lettereA = (indirizzo: string) =>
  inviaEmail.mock.calls
    .map((c) => c[0] as { to?: string; subject?: string; html?: string })
    .filter((l) => l.to === indirizzo);

const suoi = () => stato.mondo.righe("notifications").filter((n) => n.user_id === "rider-1");

async function corpo(r: Response | unknown): Promise<string> {
  return JSON.stringify(await (r as Response).json());
}

beforeEach(() => {
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
});

afterEach(() => {
  vi.useRealTimers();
});


/*
 * S03 — scheda 1997. Copia dell'impianto di chi-vuole-cancellarsi-trova-una-strada-che-funziona.test.ts
 * (le prime righe, il mondo finto e i mock), con DUE amministratori: la chiusura dell'allarme a
 * email partita era provata con uno solo, e il mutante `.slice(0, 1)` sul ciclo restava verde.
 */
const GIU = async (_x: unknown) => ({ ok: false, error: "Resend 503" }) as { ok: boolean };
const SU = async (_x: unknown) => ({ ok: true });

describe("l'allarme della spiegazione ferma si chiude per tutti gli amministratori", () => {
  it("due amministratori: la notte in cui l'email parte, si chiude per tutti e due", async () => {
    ilFattorinoConLaCassaAperta();
    stato.mondo.righe("profiles").push({ id: "admin-2", role: "admin" });
    inviaEmail.mockImplementation(GIU);
    await passaLaNotte();
    await passaLaNotte();
    const allarmi = () => stato.mondo.notifiche().filter((n) => n.title === "Spiegazione dell'attesa non partita per email");
    expect(allarmi().map((n) => n.user_id).sort()).toEqual(["admin-1", "admin-2"]);
    expect(allarmi().every((n) => !n.is_read)).toBe(true);
    inviaEmail.mockImplementation(SU);
    await passaLaNotte();
    expect(allarmi().map((n) => [n.user_id, n.is_read]).sort(), "l'allarme del secondo amministratore resta aperto").toEqual([
      ["admin-1", true],
      ["admin-2", true],
    ]);
  });
});
