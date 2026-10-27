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
} = { mondo: fintoGiroNotturno(), senzaChiave: false, esiti: {}, rifiutaAvvisiA: null };

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
      q.single = async () => {
        const r = await q;
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: r.error };
      };
      return q;
    },
  };
}

const inviaEmail = vi.fn(async (_x: unknown) => ({ ok: false, skipped: true, reason: "non configurata" }) as { ok: boolean });

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
vi.mock("@/lib/api/middleware", () => ({
  withAuth: (h: (c: { user: typeof UTENTE }) => unknown) => () => h({ user: UTENTE }),
  withAuthRateLimit: (_o: unknown, h: (c: { user: typeof UTENTE }) => unknown) => () => h({ user: UTENTE }),
  withCronAuth: (h: (r: unknown) => unknown) => (r: unknown) => h(r),
}));
vi.mock("@/lib/captcha", () => ({ verifyTurnstileToken: async () => ({ ok: true }) }));
vi.mock("@/lib/email/client", () => ({ sendEmail: (x: unknown) => inviaEmail(x) }));

import { POST as notte } from "@/app/api/cron/process-deletions/route";
import { GET as statoCancellazione, POST as chiediCancellazione } from "@/app/api/account/delete/route";
import { GET as scaricaDati } from "@/app/api/account/export/route";
import { POST as scriviAiContatti } from "@/app/api/contact/route";
import { __resetRateLimitBuckets } from "@/lib/rate-limit";

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

const passaLaNotte = () =>
  notte(new Request("http://localhost/api/cron/process-deletions", { method: "POST" }) as never);

const suoi = () => stato.mondo.righe("notifications").filter((n) => n.user_id === "rider-1");

async function corpo(r: Response | unknown): Promise<string> {
  return JSON.stringify(await (r as Response).json());
}

beforeEach(() => {
  delete process.env[CASELLA];
  delete process.env.SUPPORT_EMAIL;
  inviaEmail.mockClear();
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
    // Un rinvio deciso da noi non è un guasto: la notte resta verde.
    expect(res.status).toBe(200);
  });

  it("trenta notti non sono trenta messaggi: la seconda notte non riscrive", async () => {
    ilFattorinoConLaCassaAperta();
    await passaLaNotte();
    await passaLaNotte();
    expect(suoi()).toHaveLength(1);
  });

  it("la pagina del suo account restituisce lo stesso motivo", async () => {
    ilFattorinoConLaCassaAperta();
    await passaLaNotte();
    const body = (await (await statoCancellazione(new Request("http://localhost/api/account/delete") as never)).json()) as Record<string, unknown>;
    expect(body.pending).toBe(true);
    expect(
      String(body.motivo ?? ""),
      "il conto alla rovescia fermo a zero era l unica cosa che vedeva",
    ).toContain("120,00 €");
  });

  it("chi non ha nessun rinvio non riceve un motivo inventato", async () => {
    ilFattorinoConLaCassaAperta();
    const body = (await (await statoCancellazione(new Request("http://localhost/api/account/delete") as never)).json()) as Record<string, unknown>;
    expect(body.pending).toBe(true);
    expect(body.motivo ?? null).toBeNull();
  });
});

describe("senza la chiave di servizio nessuna porta è murata", () => {
  beforeEach(() => { stato.senzaChiave = true; });

  it("Cancella account dice dove scrivere, con la casella vera", async () => {
    process.env[CASELLA] = "info@mycity-marketplace.com";
    const res = await chiediCancellazione(new Request("http://localhost/api/account/delete", { method: "POST" }) as never);
    expect(res.status).toBe(503);
    const testo = await corpo(res);
    expect(testo, "«Servizio non configurato» è vero per noi e un muro per lei").toContain("info@mycity-marketplace.com");
    expect(testo).not.toContain("Servizio non configurato");
  });

  it("Scarica i miei dati dice dove scrivere, con la casella vera", async () => {
    process.env[CASELLA] = "info@mycity-marketplace.com";
    const res = await scaricaDati(new Request("http://localhost/api/account/export") as never);
    expect(res.status).toBe(503);
    expect(await corpo(res)).toContain("info@mycity-marketplace.com");
  });

  it("senza casella vera non si mostra un indirizzo inventato: si manda al modulo", async () => {
    const res = await chiediCancellazione(new Request("http://localhost/api/account/delete", { method: "POST" }) as never);
    const testo = await corpo(res);
    expect(testo).toContain("modulo dei contatti");
    expect(testo).not.toMatch(/[a-z0-9.]+@[a-z0-9.-]+\.[a-z]+/i);
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
