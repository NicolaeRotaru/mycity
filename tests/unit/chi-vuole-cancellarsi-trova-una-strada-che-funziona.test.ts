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
import { describe, it, expect, vi, beforeEach } from "vitest";
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
        getUserById: async (id: string) => ({ data: { user: id === UTENTE.id ? UTENTE : null }, error: null }),
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
import { GET as statoCancellazione, POST as chiediCancellazione } from "@/app/api/account/delete/route";
import { GET as scaricaDati } from "@/app/api/account/export/route";
import { POST as scriviAiContatti } from "@/app/api/contact/route";
import { __resetRateLimitBuckets } from "@/lib/rate-limit";
import { recapitoDallaRisposta } from "@/lib/legal/titolare";

const CASELLA = "NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY";
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
const passaLaNotte = () =>
  notte(new Request("http://localhost/api/cron/process-deletions", {
    method: "POST",
    headers: { authorization: `Bearer ${SEGRETO_DELLA_NOTTE}` },
  }) as never);

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
    const body = (await (await statoCancellazione(conGettone("GET", "/api/account/delete") as never)).json()) as Record<string, unknown>;
    expect(body.pending).toBe(true);
    expect(
      String(body.motivo ?? ""),
      "il conto alla rovescia fermo a zero era l unica cosa che vedeva",
    ).toContain("120,00 €");
    expect(body.rinviata, "la pagina deve sapere che il conto alla rovescia non vale più").toBe(true);
  });

  it("chi non ha nessun rinvio non riceve un motivo inventato", async () => {
    ilFattorinoConLaCassaAperta();
    const body = (await (await statoCancellazione(conGettone("GET", "/api/account/delete") as never)).json()) as Record<string, unknown>;
    expect(body.pending).toBe(true);
    expect(body.motivo ?? null).toBeNull();
    expect(body.rinviata, "nessun rinvio: il conto alla rovescia resta quello vero").toBe(false);
  });
});

describe("senza la chiave di servizio nessuna porta è murata", () => {
  beforeEach(() => { stato.senzaChiave = true; });

  it("Cancella account dice dove scrivere, con la casella vera", async () => {
    process.env[CASELLA] = "info@mycity-marketplace.com";
    const res = await chiediCancellazione(conGettone("POST", "/api/account/delete") as never);
    expect(res.status).toBe(503);
    const testo = await corpo(res);
    expect(testo, "«Servizio non configurato» è vero per noi e un muro per lei").toContain("info@mycity-marketplace.com");
    expect(testo).not.toContain("Servizio non configurato");
    // Nell'errore serve il collegamento, non solo l'indirizzo da ricopiare.
    expect(recapitoDallaRisposta(JSON.parse(testo))?.href ?? "").toMatch(/^mailto:info@mycity-marketplace\.com\?subject=/);
  });

  it("Scarica i miei dati dice dove scrivere, con la casella vera", async () => {
    process.env[CASELLA] = "info@mycity-marketplace.com";
    const res = await scaricaDati(conGettone("GET", "/api/account/export") as never);
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
    const res = await chiediCancellazione(conGettone("POST", "/api/account/delete") as never);
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
    const testo = await corpo(await chiediCancellazione(conGettone("POST", "/api/account/delete") as never));
    expect(testo, "senza posta il modulo non inoltra: mandarci la persona è il giro in tondo").not.toContain("/contact");
    expect(testo).toContain("non è partita");
    const modulo = await scriviAiContatti(messaggio("7.0.0.12"));
    expect(modulo.status).toBe(503);
  });

  it("se Cancella account manda al modulo, il modulo arriva davvero a una persona", async () => {
    process.env.SUPPORT_EMAIL = "supporto@example.com";
    process.env.RESEND_API_KEY = "re_di_prova";
    process.env.RESEND_FROM = "MyCity <no-reply@example.com>";
    const testo = await corpo(await chiediCancellazione(conGettone("POST", "/api/account/delete") as never));
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
