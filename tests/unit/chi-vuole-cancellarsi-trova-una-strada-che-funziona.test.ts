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
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
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
} = { mondo: fintoGiroNotturno(), senzaChiave: false, esiti: {}, rifiutaAvvisiA: null, registroInviiRotto: false };

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
      if (tabella === "audit_logs" && stato.registroInviiRotto) {
        const rifiuto = { data: null, error: { message: "permission denied for table audit_logs" } };
        q.select = () => ({ eq: async () => rifiuto });
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

describe("chi aspetta la cancellazione lo sa dal giro notturno vero", () => {
  it("dopo la notte il fattorino ha nel suo pannello il motivo del rinvio", async () => {
    ilFattorinoConLaCassaAperta();
    const res = await passaLaNotte();
    expect(
      suoi(),
      "il giro ha calcolato la spiegazione dovuta (art. 12.4) e non l ha scritta a nessuno",
    ).toHaveLength(1);
    expect(String(suoi()[0].body)).toContain("120,00 €");
    expect(String(suoi()[0].body)).toContain("Garante");
    // Senza casella vera la frase non diventa «scrivi a il modulo dei contatti».
    expect(String(suoi()[0].body)).not.toContain("scrivi a il modulo");
    // La stessa spiegazione gli arriva per email: il pannello è di un sito da
    // cui sta cercando di andarsene, e non è detto che ci rientri.
    const lettere = lettereA(UTENTE.email);
    expect(lettere, "il motivo restava solo dentro il sito").toHaveLength(1);
    expect(String(lettere[0].html)).toContain("120,00");
    // Un rinvio deciso da noi non è un guasto: la notte resta verde.
    expect(res.status).toBe(200);
  });

  it("trenta notti non sono trenta messaggi: la seconda notte non riscrive", async () => {
    ilFattorinoConLaCassaAperta();
    // 27/10/2026 (terzo giro) — Qui la posta era spenta, e la prova chiedeva
    // UNA email dopo due notti: blindava proprio il difetto, la spiegazione
    // non partita la prima notte che non ripartiva mai. Una email sola si
    // chiede quando la prima È PARTITA; quella che non parte si riprova (vedi
    // «la spiegazione per email che non parte si riprova», qui sotto).
    inviaEmail.mockImplementation(async () => ({ ok: true }));
    await passaLaNotte();
    await passaLaNotte();
    expect(suoi()).toHaveLength(1);
    expect(lettereA(UTENTE.email), "trenta notti non sono trenta email").toHaveLength(1);
  });

  it("la pagina del suo account restituisce lo stesso motivo", async () => {
    ilFattorinoConLaCassaAperta();
    await passaLaNotte();
    const body = (await (await statoCancellazione(conGettone("GET", "/api/account/delete") as never, CTX)).json()) as Record<string, unknown>;
    expect(body.pending).toBe(true);
    expect(
      String(body.motivo ?? ""),
      "il conto alla rovescia fermo a zero era l unica cosa che vedeva",
    ).toContain("120,00 €");
    expect(body.rinviata, "la pagina deve sapere che il conto alla rovescia non vale più").toBe(true);
  });

  it("chi non ha nessun rinvio non riceve un motivo inventato", async () => {
    ilFattorinoConLaCassaAperta();
    const body = (await (await statoCancellazione(conGettone("GET", "/api/account/delete") as never, CTX)).json()) as Record<string, unknown>;
    expect(body.pending).toBe(true);
    expect(body.motivo ?? null).toBeNull();
    expect(body.rinviata, "nessun rinvio: il conto alla rovescia resta quello vero").toBe(false);
  });
});

describe("senza la chiave di servizio nessuna porta è murata", () => {
  beforeEach(() => { stato.senzaChiave = true; });

  it("Cancella account dice dove scrivere, con la casella vera", async () => {
    process.env[CASELLA] = "info@mycity-marketplace.com";
    const res = await chiediCancellazione(conGettone("POST", "/api/account/delete") as never, CTX);
    expect(res.status).toBe(503);
    const testo = await corpo(res);
    expect(testo, "«Servizio non configurato» è vero per noi e un muro per lei").toContain("info@mycity-marketplace.com");
    expect(testo).not.toContain("Servizio non configurato");
    // Nell'errore serve il collegamento, non solo l'indirizzo da ricopiare.
    expect(recapitoDallaRisposta(JSON.parse(testo))?.href ?? "").toMatch(/^mailto:info@mycity-marketplace\.com\?subject=/);
  });

  it("Scarica i miei dati dice dove scrivere, con la casella vera", async () => {
    process.env[CASELLA] = "info@mycity-marketplace.com";
    const res = await scaricaDati(conGettone("GET", "/api/account/export") as never, CTX);
    expect(res.status).toBe(503);
    const testo = await corpo(res);
    expect(testo).toContain("info@mycity-marketplace.com");
    expect(recapitoDallaRisposta(JSON.parse(testo))?.href ?? "").toMatch(/^mailto:info@mycity-marketplace\.com/);
  });

  // 27/10/2026 (secondo giro) — Qui la prova pretendeva «si manda al modulo».
  // Ma senza chiave il modulo non salva niente, e senza posta del supporto non
  // inoltra: rispondeva «riprova tra qualche ora». Cancella account mandava al
  // modulo, il modulo non arrivava a nessuno — la persona girava in tondo.
  it("senza casella e senza posta del supporto non si manda la persona in tondo", async () => {
    const res = await chiediCancellazione(conGettone("POST", "/api/account/delete") as never, CTX);
    const testo = await corpo(res);
    expect(res.status).toBe(503);
    expect(testo, "il modulo, senza chiave e senza posta, non arriva a nessuno").not.toContain("/contact");
    expect(testo).not.toContain("modulo dei contatti");
    expect(testo, "nessun indirizzo inventato").not.toMatch(/[a-z0-9.]+@[a-z0-9.-]+\.[a-z]+/i);
    expect(testo, "lo dice in chiaro: la richiesta non è partita").toContain("non è partita");
    // E il modulo, nella stessa situazione, non promette un «riprova» che non cambia niente.
    const modulo = await scriviAiContatti(messaggio("7.0.0.9"));
    expect(modulo.status).toBe(503);
    const suo = await corpo(modulo);
    expect(suo).not.toContain("Riprova");
    expect(suo, "nessun indirizzo inventato").not.toMatch(/[a-z0-9.]+@[a-z0-9.-]+\.[a-z]+/i);
  });

  it("con la casella del supporto ma senza la posta, non si manda al modulo", async () => {
    // Il caso più probabile in produzione: SUPPORT_EMAIL c'è, Resend no. Il
    // modulo prova a inoltrare, la posta lo salta, e risponde 503.
    process.env.SUPPORT_EMAIL = "supporto@example.com";
    const testo = await corpo(await chiediCancellazione(conGettone("POST", "/api/account/delete") as never, CTX));
    expect(testo, "senza posta il modulo non inoltra: mandarci la persona è il giro in tondo").not.toContain("/contact");
    expect(testo).toContain("non è partita");
    const modulo = await scriviAiContatti(messaggio("7.0.0.12"));
    expect(modulo.status).toBe(503);
  });

  it("se Cancella account manda al modulo, il modulo arriva davvero a una persona", async () => {
    process.env.SUPPORT_EMAIL = "supporto@example.com";
    process.env.RESEND_API_KEY = "re_di_prova";
    process.env.RESEND_FROM = "MyCity <no-reply@example.com>";
    const testo = await corpo(await chiediCancellazione(conGettone("POST", "/api/account/delete") as never, CTX));
    expect(testo).toContain("/contact");
    expect(testo).not.toMatch(/[a-z0-9.]+@[a-z0-9.-]+\.[a-z]+/i);
    inviaEmail.mockResolvedValueOnce({ ok: true, id: "e-1" } as { ok: boolean });
    const modulo = await scriviAiContatti(messaggio("7.0.0.10"));
    expect(modulo.status, "il modulo a cui l abbiamo mandata deve arrivare a qualcuno").toBe(200);
  });

  it("se il modulo non funziona e la casella c'è, l'errore porta il collegamento alla casella", async () => {
    process.env[CASELLA] = "info@mycity-marketplace.com";
    const res = await scriviAiContatti(messaggio("7.0.0.11"));
    expect(res.status).toBe(503);
    const testo = await corpo(res);
    expect(testo).toContain("Scrivici a info@mycity-marketplace.com");
    expect(recapitoDallaRisposta(JSON.parse(testo))?.href ?? "").toMatch(/^mailto:info@mycity-marketplace\.com/);
  });

  const messaggio = (ip: string) =>
    new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ name: "Maria Rossi", email: "maria@example.com", subject: "Privacy", message: "Vorrei cancellare il mio account, grazie." }),
    });

  it("il modulo dei contatti risponde 503 con una frase leggibile invece di lanciare", async () => {
    const res = await scriviAiContatti(messaggio("7.0.0.1"));
    expect(res.status).toBe(503);
    expect(await corpo(res)).toContain("non è arrivato");
  });

  it("se la posta del supporto c è, il messaggio arriva a una persona anche senza database", async () => {
    process.env.SUPPORT_EMAIL = "supporto@example.com";
    inviaEmail.mockResolvedValueOnce({ ok: true });
    const res = await scriviAiContatti(messaggio("7.0.0.2"));
    expect(res.status).toBe(200);
    expect(inviaEmail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(inviaEmail.mock.calls[0][0])).toContain("maria@example.com");
  });
});

/**
 * 27/10/2026 — Il collaudo ha trovato tre modi di sbagliare che nessuna prova
 * vedeva: il modulo che dice «ok» con la mail ferma, la notte verde con un
 * avviso dovuto per legge non partito, l'avviso di termine scaduto perso per
 * strada. Ognuna di queste prove diventa rossa su uno di quei tre sbagli.
 */
describe("un messaggio dovuto che non parte non passa per partito", () => {
  const messaggio = (ip: string) =>
    new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ name: "Maria Rossi", email: "maria@example.com", subject: "Privacy", message: "Vorrei cancellare il mio account, grazie." }),
    });

  it("il modulo non dice ok se la mail al supporto non è partita", async () => {
    stato.senzaChiave = true;
    process.env.SUPPORT_EMAIL = "supporto@example.com";
    inviaEmail.mockResolvedValueOnce({ ok: false, skipped: true, reason: "non configurata" } as { ok: boolean });
    const res = await scriviAiContatti(messaggio("7.0.0.3"));
    expect(inviaEmail).toHaveBeenCalledTimes(1);
    expect(res.status, "Maria legge «inviato» e il suo messaggio non arriva a nessuno").toBe(503);
    expect(await corpo(res)).toContain("non è arrivato");
  });

  it("il modulo non dice ok se la mail al supporto lancia", async () => {
    stato.senzaChiave = true;
    process.env.SUPPORT_EMAIL = "supporto@example.com";
    inviaEmail.mockRejectedValueOnce(new Error("rete giù"));
    const res = await scriviAiContatti(messaggio("7.0.0.4"));
    expect(res.status).toBe(503);
  });

  it("se il motivo dell'attesa non si scrive, la notte è rossa e un amministratore lo sa", async () => {
    ilFattorinoConLaCassaAperta();
    stato.rifiutaAvvisiA = "rider-1";
    const res = await passaLaNotte();
    const body = (await (res as Response).json()) as Record<string, unknown>;
    expect(body.avvisiFalliti).toBe(1);
    expect(res.status, "un avviso dovuto per legge non partito è un guasto, non una notte verde").toBe(500);
    const allarmi = stato.mondo.righe("notifications").filter((n) => n.user_id === "admin-1");
    expect(allarmi.map((n) => n.title)).toContain("Persone non avvisate del rinvio della cancellazione");
  });

  it("oltre il mese il fattorino riceve anche l'avviso del termine scaduto", async () => {
    ilFattorinoConLaCassaAperta(giorniFa(40));
    await passaLaNotte();
    const titoli = suoi().map((n) => n.title);
    expect(titoli).toContain("La tua richiesta di cancellazione è in attesa");
    expect(titoli, "il termine di legge è passato e lui non lo sa").toContain("La tua cancellazione è in ritardo");
  });

  it("oltre il mese, anche con un guasto nostro, la persona sa del ritardo", async () => {
    ilFattorinoConLaCassaAperta(giorniFa(40), { ok: false, errore: "timeout", fileRimossi: 0, erroriFile: [] });
    await passaLaNotte();
    expect(suoi().map((n) => n.title)).toEqual(["La tua cancellazione è in ritardo"]);
  });
});

describe("la spiegazione per email che non parte si riprova, e se non parte ancora qualcuno lo sa", () => {
  it("IL CASO CHE ROMPEVA — Resend dice di no la prima notte: la notte dopo la spiegazione parte", async () => {
    ilFattorinoConLaCassaAperta();
    inviaEmail.mockImplementation(async () => ({ ok: false, error: "Resend 503" }) as { ok: boolean });
    const prima = await passaLaNotte();
    expect(prima.status, "un intoppo di una notte non è ancora un guasto: la notte dopo si riprova").toBe(200);
    expect(stato.mondo.notifiche(), "si sveglia qualcuno per un intoppo che si sistema da solo").toHaveLength(0);

    inviaEmail.mockImplementation(async () => ({ ok: true }));
    const seconda = await passaLaNotte();
    expect(
      lettereA(UTENTE.email),
      "la spiegazione non partita la prima notte non riparte mai: l'avviso risulta «già detto»",
    ).toHaveLength(2);
    expect(seconda.status).toBe(200);

    await passaLaNotte();
    await passaLaNotte();
    expect(lettereA(UTENTE.email), "partita una volta, non si rimanda").toHaveLength(2);
    expect(suoi(), "il pannello resta con un avviso solo").toHaveLength(1);
  });

  it("IL CASO CHE ROMPEVA — se la posta dice di no anche la notte dopo, la notte è rossa e un amministratore lo sa", async () => {
    ilFattorinoConLaCassaAperta();
    const prima = await passaLaNotte();
    expect(prima.status).toBe(200);
    const seconda = await passaLaNotte();
    const body = (await (seconda as Response).json()) as Record<string, unknown>;

    expect(lettereA(UTENTE.email), "la seconda notte la spiegazione si riprova").toHaveLength(2);
    expect(body.avvisiEmailBloccate, "quante spiegazioni restano ferme la risposta non lo dice").toBe(1);
    expect(seconda.status, "la spiegazione non parte da due notti e la notte resta verde").toBe(500);
    const allarmi = stato.mondo.notifiche();
    expect(allarmi, "nessun amministratore sa che la persona non ha ricevuto niente per email").toHaveLength(1);
    expect(String(allarmi[0].title)).toContain("email");
    expect(String(allarmi[0].body)).toContain("scrivile tu");
  });

  it("se il registro degli invii non si legge, non si spedisce alla cieca e un amministratore lo sa subito", async () => {
    ilFattorinoConLaCassaAperta();
    stato.registroInviiRotto = true;
    inviaEmail.mockImplementation(async () => ({ ok: true }));
    const res = await passaLaNotte();
    const body = (await (res as Response).json()) as Record<string, unknown>;

    expect(suoi(), "il pannello non dipende dal registro delle email").toHaveLength(1);
    expect(lettereA(UTENTE.email), "senza registro ogni notte partirebbe una email in più").toHaveLength(0);
    expect(body.avvisiEmailBloccate).toBe(1);
    expect(res.status).toBe(500);
    expect(stato.mondo.notifiche()).toHaveLength(1);
  });
});

describe("nessuna pagina costruisce la casella privacy di ripiego", () => {
  it("niente mailto scritto a mano sulla casella di ripiego, in nessuna pagina", () => {
    const radice = path.join(process.cwd(), "app");
    const colpevoli: string[] = [];
    const visita = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) visita(p);
        else if (p.endsWith(".tsx") && /mailto:\$\{[^}]*emailPrivacy\}/.test(readFileSync(p, "utf8"))) {
          colpevoli.push(path.relative(process.cwd(), p));
        }
      }
    };
    visita(radice);
    expect(colpevoli, "queste pagine mostrano un indirizzo che forse nessuno legge: usino recapitoPrivacy()").toEqual([]);
  });
});

describe("il collegamento accanto all'errore si fida solo di due forme", () => {
  it("passa una casella (mailto:) o il modulo; tutto il resto no", () => {
    const r = (href: unknown) => recapitoDallaRisposta({ error: { details: { recapito: { href, testo: "x" } } } });
    expect(r("mailto:info@mycity-marketplace.com?subject=Richiesta")?.href).toBe("mailto:info@mycity-marketplace.com?subject=Richiesta");
    expect(r("/contact")?.href).toBe("/contact");
    expect(r("javascript:alert(1)")).toBeNull();
    expect(r("https://altro.example/contact")).toBeNull();
    expect(r(42)).toBeNull();
    expect(recapitoDallaRisposta(null)).toBeNull();
    expect(recapitoDallaRisposta({ error: { details: { recapito: null } } })).toBeNull();
  });
});

/**
 * 27/10/2026 (quarto giro) — LE PROVE CHE MANCAVANO.
 *
 * Il collaudo del terzo giro ha trovato mutazioni che restavano verdi e
 * situazioni che nessuna prova guardava. Ogni prova qui sotto diventa rossa su
 * una di quelle; il messaggio dell'asserzione dice quale.
 */
const richiestaAlModulo = (ip: string) =>
  new Request("http://localhost/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ name: "Maria Rossi", email: "maria@example.com", subject: "Privacy", message: "Vorrei cancellare il mio account, grazie." }),
  });

const letto = async (r: unknown) => (await (r as Response).json()) as Record<string, unknown>;

describe("con la posta a metà, Cancella account non riapre il giro in tondo", () => {
  beforeEach(() => { stato.senzaChiave = true; });

  it("con la chiave di Resend ma senza il mittente (RESEND_FROM) non manda al modulo", async () => {
    process.env.SUPPORT_EMAIL = "supporto@example.com";
    process.env.RESEND_API_KEY = "re_di_prova";
    const testo = await corpo(await chiediCancellazione(conGettone("POST", "/api/account/delete") as never, CTX));
    expect(testo, "senza mittente la posta non parte: il modulo non inoltra a nessuno").not.toContain("/contact");
    expect(testo).toContain("non è partita");
  });

  it("con Resend acceso ma senza la casella del supporto (SUPPORT_EMAIL) non manda al modulo", async () => {
    process.env.RESEND_API_KEY = "re_di_prova";
    process.env.RESEND_FROM = "MyCity <no-reply@example.com>";
    const testo = await corpo(await chiediCancellazione(conGettone("POST", "/api/account/delete") as never, CTX));
    expect(testo, "senza casella del supporto il modulo non sa a chi inoltrare").not.toContain("/contact");
    expect(testo).toContain("non è partita");
    const modulo = await scriviAiContatti(richiestaAlModulo("7.0.0.20"));
    expect(modulo.status, "e infatti il modulo, così, non arriva a nessuno").toBe(503);
  });
});

describe("senza casella e senza posta nessuna delle quattro porte manda in tondo", () => {
  beforeEach(() => { stato.senzaChiave = true; });

  const porte: Array<[string, () => Promise<unknown>]> = [
    ["Cancella account", () => chiediCancellazione(conGettone("POST", "/api/account/delete") as never, CTX)],
    ["Annulla la cancellazione", () => annullaCancellazione(conGettone("DELETE", "/api/account/delete") as never, CTX)],
    ["Stato della cancellazione", () => statoCancellazione(conGettone("GET", "/api/account/delete") as never, CTX)],
    ["Scarica i miei dati", () => scaricaDati(conGettone("GET", "/api/account/export") as never, CTX)],
  ];

  for (const [nome, bussa] of porte) {
    it(`${nome}: dice che la richiesta non è partita, non manda al modulo che non arriva`, async () => {
      const res = (await bussa()) as Response;
      const testo = await corpo(res);
      expect(res.status).toBe(503);
      expect(testo, "il controllo d'accesso ha risposto prima della rotta").not.toContain("Auth non configurato");
      expect(testo, "senza chiave e senza posta il modulo non arriva a nessuno").not.toContain("/contact");
      expect(testo).toContain("non è partita");
    });
  }
});

describe("oltre il mese la rotta dell'account dice il ritardo, non un conto alla rovescia", () => {
  it("con un guasto nostro: rinviata e il motivo del termine scaduto", async () => {
    ilFattorinoConLaCassaAperta(giorniFa(40), { ok: false, errore: "timeout", fileRimossi: 0, erroriFile: [] });
    await passaLaNotte();
    const body = await letto(await statoCancellazione(conGettone("GET", "/api/account/delete") as never, CTX));
    expect(body.pending).toBe(true);
    expect(body.rinviata, "oltre il mese la cancellazione è ferma: «tra 0 giorni» non vale").toBe(true);
    expect(String(body.motivo ?? ""), "il termine di legge è passato e la rotta non lo dice").toContain("quel mese è passato");
  });

  it("con la cassa aperta: il ritardo vince sul rinvio, e la rotta dice il ritardo", async () => {
    ilFattorinoConLaCassaAperta(giorniFa(40));
    await passaLaNotte();
    const body = await letto(await statoCancellazione(conGettone("GET", "/api/account/delete") as never, CTX));
    expect(body.rinviata).toBe(true);
    expect(String(body.motivo ?? "")).toContain("quel mese è passato");
  });
});

describe("la spiegazione per email si ritenta ogni notte, senza tetto e senza doppioni", () => {
  it("la risposta della notte dice quante spiegazioni non sono uscite per email", async () => {
    ilFattorinoConLaCassaAperta();
    const body = await letto(await passaLaNotte());
    expect(body.avvisiEmailNonPartite, "posta spenta: la spiegazione è nel pannello e non è uscita").toBe(1);
    expect(body.avvisiEmailBloccate, "una notte sola è un intoppo, non ancora un guasto").toBe(0);
  });

  it("tre notti di posta giù e poi su: la spiegazione parte la quarta notte", async () => {
    ilFattorinoConLaCassaAperta();
    inviaEmail.mockImplementation(async () => ({ ok: false, error: "Resend 503" }) as { ok: boolean });
    await passaLaNotte();
    await passaLaNotte();
    await passaLaNotte();
    expect(lettereA(UTENTE.email), "una prova a notte, tutte e tre").toHaveLength(3);

    inviaEmail.mockImplementation(async () => ({ ok: true }));
    const quarta = await passaLaNotte();
    const body = await letto(quarta);
    expect(lettereA(UTENTE.email), "la posta è tornata e la spiegazione non è ripartita: un tetto ai tentativi").toHaveLength(4);
    expect(body.avvisiEmailBloccate).toBe(0);
    expect(quarta.status).toBe(200);

    await passaLaNotte();
    expect(lettereA(UTENTE.email), "partita una volta, non si rimanda").toHaveLength(4);
  });

  it("IL CASO CHE ROMPEVA — un secondo giro parte mentre il primo sta ancora spedendo: una email, nessun falso allarme", async () => {
    ilFattorinoConLaCassaAperta();
    let rilascia: (v: { ok: boolean }) => void = () => {};
    let fermo = false;
    inviaEmail.mockImplementation(async (x: unknown) => {
      if ((x as { to?: string }).to === UTENTE.email && !fermo) {
        fermo = true;
        return new Promise<{ ok: boolean }>((r) => { rilascia = r; });
      }
      // Se il secondo giro provasse a spedire, la posta gli direbbe di no.
      return { ok: false, error: "Resend 503" } as { ok: boolean };
    });

    vi.setSystemTime(Date.now() + GIORNO);
    const primo = unGiro();
    for (let i = 0; i < 500 && !fermo; i++) await new Promise((r) => setTimeout(r, 0));
    expect(fermo, "il primo giro non è arrivato a spedire").toBe(true);

    // Venti minuti dopo, la stessa notte: l'altro lavoro periodico.
    vi.setSystemTime(Date.now() + 20 * 60_000);
    const secondo = await unGiro();
    const suo = await letto(secondo);
    expect(lettereA(UTENTE.email), "il secondo giro rispedisce la spiegazione che il primo sta spedendo").toHaveLength(1);
    expect(suo.avvisiEmailBloccate, "un tentativo in volo non è una email ferma").toBe(0);
    expect(secondo.status, "falso allarme la prima notte").toBe(200);
    expect(stato.mondo.notifiche(), "nessun amministratore da svegliare").toHaveLength(0);

    rilascia({ ok: true });
    expect((await primo).status).toBe(200);
    await passaLaNotte();
    expect(lettereA(UTENTE.email), "partita una volta: la notte dopo non si rimanda").toHaveLength(1);
  });

  // 27/10/2026 (quinto giro) — LA FINESTRA SI MISURA DALL'ULTIMO TENTATIVO.
  // La prova di sopra guarda una notte sola, e la prima notte il primo
  // tentativo e l'ultimo sono lo stesso: misurare dal primo restava verde. Dalla
  // seconda notte no — il primo è di ieri, e il secondo giro rispediva.
  it("IL CASO CHE ROMPEVA — due giri sfalsati ogni notte con la posta giù: una lettera per notte, anche dalla seconda in poi", async () => {
    ilFattorinoConLaCassaAperta();
    inviaEmail.mockImplementation(async () => ({ ok: false, error: "Resend 503" }) as { ok: boolean });
    const lettereDopoLaNotte: number[] = [];
    const secondiGiri: number[] = [];
    for (let n = 1; n <= 3; n++) {
      await passaLaNotte(); // il lavoro periodico di Vercel
      vi.setSystemTime(Date.now() + 20 * 60_000); // venti minuti dopo, il cron esterno
      secondiGiri.push((await unGiro()).status);
      lettereDopoLaNotte.push(lettereA(UTENTE.email).length);
    }
    expect(lettereDopoLaNotte, "il secondo giro rispedisce: la finestra è misurata dal primo tentativo, non dall'ultimo").toEqual([1, 2, 3]);
    expect(secondiGiri, "il secondo giro della notte non è una email ferma in più").toEqual([200, 200, 200]);
    expect(stato.mondo.notifiche(), "una spiegazione ferma, un allarme").toHaveLength(1);
  });

  // 27/10/2026 (quinto giro) — NIENTE TETTO, PER TUTTO IL MESE.
  // Tre notti giù non dicono niente di un tetto a cinque. Chi aspetta resta in
  // attesa fino al termine di legge (30 giorni dalla richiesta): la spiegazione
  // si ritenta ogni notte fino a lì, non per un numero di volte.
  it("venti notti di posta giù, a un passo dal termine di legge: la ventunesima la spiegazione parte ancora", async () => {
    ilFattorinoConLaCassaAperta(); // chiesta 8 giorni fa: la notte 21 è il giorno 29, dentro il mese
    inviaEmail.mockImplementation(async () => ({ ok: false, error: "Resend 503" }) as { ok: boolean });
    for (let n = 1; n <= 20; n++) await passaLaNotte();
    expect(lettereA(UTENTE.email), "una prova a notte, tutte e venti: un tetto ai tentativi").toHaveLength(20);

    inviaEmail.mockImplementation(async () => ({ ok: true }));
    const ventunesima = await passaLaNotte();
    const body = await letto(ventunesima);
    expect(body.scadute, "la prova deve restare dentro il mese").toBe(0);
    expect(lettereA(UTENTE.email), "la posta è tornata e la spiegazione non è ripartita: un tetto ai tentativi").toHaveLength(21);
    expect(body.avvisiEmailBloccate).toBe(0);
    expect(ventunesima.status).toBe(200);
  });
});

describe("con la posta spenta l'allarme suona una volta per stato, non ogni notte", () => {
  it("cinque notti di posta spenta: un allarme solo, e le notti dopo il battito si scrive", async () => {
    ilFattorinoConLaCassaAperta();
    const battiti = () =>
      stato.mondo.diario.filter((v) => {
        const voce = v as { op: string; tabella?: string };
        return (voce.op === "upsert" || voce.op === "insert") && voce.tabella === "cron_heartbeats";
      }).length;
    const stati: number[] = [];
    let ultimo: Record<string, unknown> = {};
    let battitoDellUltima = false;
    for (let n = 1; n <= 5; n++) {
      const prima = battiti();
      const res = await passaLaNotte();
      stati.push(res.status);
      ultimo = await letto(res);
      battitoDellUltima = battiti() > prima;
    }
    expect(stati, "rossa la notte in cui la spiegazione si ferma, non tutte le notti dopo").toEqual([200, 500, 200, 200, 200]);
    expect(stato.mondo.notifiche(), "un allarme nuovo, uguale al precedente, ogni notte").toHaveLength(1);
    expect(battitoDellUltima, "il lavoro è vivo: il sorvegliante non deve crederlo morto").toBe(true);
    expect(ultimo.avvisiEmailBloccate, "lo stato resta detto nella risposta").toBe(1);
    expect(lettereA(UTENTE.email), "si riprova comunque ogni notte").toHaveLength(5);
  });

  // 27/10/2026 (quinto giro) — UN ALLARME PER OGNI SPIEGAZIONE FERMA, A OGNI
  // AMMINISTRATORE. La prova di sopra ha un fattorino e un amministratore: un
  // allarme ricavato solo dall'amministratore (o solo dall'avviso) restava
  // verde. Con due persone ferme in notti diverse, la seconda spiegazione
  // ferma trovava l'allarme della prima e restava muta, con la notte verde.
  it("IL CASO CHE ROMPEVA — due fattorini fermi in notti diverse, due amministratori: ogni spiegazione ferma ha il suo allarme, per ognuno", async () => {
    ilFattorinoConLaCassaAperta();
    stato.esiti[SECONDO.id] = CASSA_APERTA;
    const inCoda = [{ user_id: UTENTE.id, deleted_at: CHIESTA }];
    stato.mondo = fintoGiroNotturno({
      rpc: { process_expired_deletions: { data: inCoda, error: null } },
      tabelle: {
        notifications: [],
        profiles: [
          { id: UTENTE.id, role: "rider", deletion_requested_at: CHIESTA },
          { id: SECONDO.id, role: "rider", deletion_requested_at: CHIESTA },
          { id: "admin-1", role: "admin" },
          { id: "admin-2", role: "admin" },
        ],
      },
    });
    const stati: number[] = [];
    let quinta: Record<string, unknown> = {};
    for (let n = 1; n <= 5; n++) {
      // Dalla quarta notte aspetta la cancellazione anche il secondo fattorino.
      if (n === 4) inCoda.push({ user_id: SECONDO.id, deleted_at: CHIESTA });
      const res = await passaLaNotte();
      stati.push(res.status);
      quinta = await letto(res);
    }
    expect(lettereA(SECONDO.email), "anche la sua spiegazione si ritenta ogni notte").toHaveLength(2);
    expect(stati, "la seconda spiegazione ferma resta muta: la notte 5 è verde").toEqual([200, 500, 200, 200, 500]);
    expect(quinta.avvisiEmailBloccate).toBe(2);
    expect(quinta.allarmiEmailNuovi, "ferma da stanotte è la seconda, non la prima").toBe(1);
    const allarmi = stato.mondo.notifiche().filter((n) => n.title === "Spiegazione dell'attesa non partita per email");
    const di = (amministratore: string) => allarmi.filter((n) => n.user_id === amministratore).length;
    expect([di("admin-1"), di("admin-2")], "ogni amministratore sa di tutte e due").toEqual([2, 2]);
    expect(new Set(allarmi.map((n) => n.id)).size, "quattro allarmi, quattro identificativi").toBe(4);
  });
});

describe("il modulo dei contatti e l'allarme non si fanno ingannare", () => {
  it("il modulo non dice ok quando Resend risponde con un errore vero ({ ok:false, error })", async () => {
    stato.senzaChiave = true;
    process.env.SUPPORT_EMAIL = "supporto@example.com";
    process.env.RESEND_API_KEY = "re_di_prova";
    process.env.RESEND_FROM = "MyCity <no-reply@example.com>";
    inviaEmail.mockResolvedValueOnce({ ok: false, error: "Resend 422: dominio non verificato" } as { ok: boolean });
    const res = await scriviAiContatti(richiestaAlModulo("7.0.0.21"));
    expect(inviaEmail).toHaveBeenCalledTimes(1);
    expect(res.status, "Maria legge «inviato» e Resend l'ha rifiutato").toBe(503);
  });

  it("due persone, a una il motivo non si scrive: la notte è rossa anche se all'altra è arrivato", async () => {
    ilFattorinoConLaCassaAperta();
    stato.esiti["rider-2"] = CASSA_APERTA;
    stato.mondo = fintoGiroNotturno({
      rpc: {
        process_expired_deletions: {
          data: [{ user_id: "rider-1", deleted_at: CHIESTA }, { user_id: "rider-2", deleted_at: CHIESTA }],
          error: null,
        },
      },
      tabelle: {
        notifications: [],
        profiles: [
          { id: "rider-1", role: "rider", deletion_requested_at: CHIESTA },
          { id: "rider-2", role: "rider", deletion_requested_at: CHIESTA },
          { id: "admin-1", role: "admin" },
        ],
      },
    });
    stato.rifiutaAvvisiA = "rider-1";
    const res = await passaLaNotte();
    const body = await letto(res);
    expect([body.avvisiRecapitati, body.avvisiFalliti]).toEqual([1, 1]);
    expect(res.status, "uno recapitato non compensa uno non partito").toBe(500);
    expect(stato.mondo.notifiche().map((n) => n.title)).toContain("Persone non avvisate del rinvio della cancellazione");
  });
});

describe("un allarme che non si riesce a scrivere non fa tornare verde la notte", () => {
  it("la spiegazione è ferma e il database rifiuta l'allarme: la notte resta rossa finché qualcuno lo sa", async () => {
    ilFattorinoConLaCassaAperta();
    stato.rifiutaAvvisiA = "admin-1";
    const stati: number[] = [];
    for (let n = 1; n <= 3; n++) stati.push((await passaLaNotte()).status);
    expect(stati, "un allarme per stato vale solo se lo stato è stato detto a qualcuno").toEqual([200, 500, 500]);
    expect(stato.mondo.notifiche()).toHaveLength(0);
  });
});
