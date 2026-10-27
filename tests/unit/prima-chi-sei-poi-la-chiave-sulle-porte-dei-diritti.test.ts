/**
 * 27/10/2026 (quarto giro, fase 2) — PRIMA CHI SEI, POI LA CHIAVE.
 *
 * La storia. Per far uscire la strada a mano quando manca la chiave di
 * servizio, le porte dei diritti («Cancella account», «Annulla», «Stato»,
 * «Scarica i miei dati») guardavano la chiave PRIMA del controllo d'accesso.
 * Senza chiave rispondevano 503 a chiunque bussasse: anche a chi non aveva
 * fatto l'accesso, che deve ricevere 401 nel formato ApiErrors. Le prove nel
 * browser sul sito costruito senza chiavi lo hanno visto (09-api-endpoints:
 * tre rosse); quelle unitarie no, perché provavano solo chi aveva un gettone.
 *
 * La regola, provata qui col controllo d'accesso VERO (`withAuth`): chi non ha
 * fatto l'accesso riceve sempre 401, con o senza chiave; chi l'ha fatto e la
 * chiave manca riceve 503 con la strada a mano; con la chiave, la rotta normale.
 * Si finge solo Supabase: di chi è il gettone o il cookie, e il database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const MARIA = { id: "u-1", email: "maria@example.com" };

const stato = {
  senzaChiave: true,
  /** Chi risulta dal cookie di sessione (null = nessuna sessione). */
  dalCookie: null as null | typeof MARIA,
  profilo: { id: "u-1", role: "buyer", is_approved: true, deletion_requested_at: null as string | null },
};

function adminFinto() {
  return {
    from: (_tabella: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.update = (valori: Record<string, unknown>) => {
        Object.assign(stato.profilo, valori);
        return q;
      };
      q.single = async () => ({ data: { ...stato.profilo }, error: null });
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, error: null }));
      return q;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getAdminSupabase: () => {
    if (stato.senzaChiave) throw new Error("Service role Supabase non configurato (SUPABASE_SERVICE_ROLE_KEY).");
    return adminFinto();
  },
  // La sessione col cookie si riconosce con la chiave pubblica, non con quella di servizio.
  getCurrentUser: async () => stato.dalCookie,
  getServerSupabase: async () => ({ client: "coi-cookie" }),
}));
vi.mock("@/lib/supabase/anonimo", () => ({
  creaClientAnonimo: () => ({
    auth: {
      getUser: async (gettone: string) =>
        gettone === "gettone-di-maria"
          ? { data: { user: MARIA }, error: null }
          : { data: { user: null }, error: { message: "invalid JWT" } },
    },
  }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));

import {
  POST as chiediCancellazione,
  DELETE as annullaCancellazione,
  GET as statoCancellazione,
} from "@/app/api/account/delete/route";
import { GET as scaricaDati } from "@/app/api/account/export/route";
import { __resetRateLimitBuckets } from "@/lib/rate-limit";

const CASELLA = "NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY";
/** Next chiama ogni rotta con la richiesta E il contesto: le prove fanno lo stesso. */
const CTX = { params: Promise.resolve({}) } as never;

type Porta = (req: never, ctx: never) => Promise<unknown>;
const PORTE: Array<[string, string, string, Porta]> = [
  ["Cancella account", "POST", "/api/account/delete", chiediCancellazione as unknown as Porta],
  ["Annulla la cancellazione", "DELETE", "/api/account/delete", annullaCancellazione as unknown as Porta],
  ["Stato della cancellazione", "GET", "/api/account/delete", statoCancellazione as unknown as Porta],
  ["Scarica i miei dati", "GET", "/api/account/export", scaricaDati as unknown as Porta],
];

const richiesta = (metodo: string, percorso: string, gettone?: string) =>
  new Request("http://localhost" + percorso, {
    method: metodo,
    headers: gettone ? { authorization: `Bearer ${gettone}` } : {},
  }) as never;

async function leggi(r: unknown): Promise<{ status: number; body: Record<string, unknown>; testo: string }> {
  const res = r as Response;
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body, testo: JSON.stringify(body) };
}

beforeEach(() => {
  stato.senzaChiave = true;
  stato.dalCookie = null;
  stato.profilo.deletion_requested_at = null;
  process.env[CASELLA] = "privacy@pane-quotidiano.example";
  __resetRateLimitBuckets();
});

describe("chi non ha fatto l'accesso riceve 401, con o senza chiave di servizio", () => {
  for (const [nome, metodo, percorso, porta] of PORTE) {
    it(`${nome}: senza chiave, nessun gettone e nessuna sessione → 401 nel formato ApiErrors`, async () => {
      const { status, body, testo } = await leggi(await porta(richiesta(metodo, percorso), CTX));
      expect(status, "senza chiave la porta non chiedeva più chi sei").toBe(401);
      expect(body).toMatchObject({ ok: false, error: { code: expect.any(String), message: expect.any(String) } });
      expect(testo, "la strada a mano è per chi ha fatto l'accesso, non per chiunque bussi").not.toContain(
        "privacy@pane-quotidiano.example",
      );
    });

    it(`${nome}: senza chiave e con un gettone falso → 401`, async () => {
      const { status } = await leggi(await porta(richiesta(metodo, percorso, "gettone-rubato"), CTX));
      expect(status).toBe(401);
    });

    it(`${nome}: con la chiave, nessun gettone e nessuna sessione → 401`, async () => {
      stato.senzaChiave = false;
      const { status } = await leggi(await porta(richiesta(metodo, percorso), CTX));
      expect(status).toBe(401);
    });
  }
});

describe("chi ha fatto l'accesso e la chiave manca riceve 503 con la strada a mano", () => {
  for (const [nome, metodo, percorso, porta] of PORTE) {
    it(`${nome}: col gettone → 503 con la casella privacy`, async () => {
      const { status, testo } = await leggi(await porta(richiesta(metodo, percorso, "gettone-di-maria"), CTX));
      expect(status).toBe(503);
      expect(testo).not.toContain("Auth non configurato");
      expect(testo).toContain("mailto:privacy@pane-quotidiano.example");
    });
  }

  it("col cookie di sessione (senza gettone) → 503 con la casella privacy", async () => {
    stato.dalCookie = MARIA;
    const { status, testo } = await leggi(await chiediCancellazione(richiesta("POST", "/api/account/delete"), CTX));
    expect(status, "la sessione col cookie si riconosce senza la chiave di servizio").toBe(503);
    expect(testo).toContain("mailto:privacy@pane-quotidiano.example");
  });
});

describe("con la chiave, la rotta normale", () => {
  it("Stato della cancellazione: nessuna richiesta in corso", async () => {
    stato.senzaChiave = false;
    const { status, body } = await leggi(await statoCancellazione(richiesta("GET", "/api/account/delete", "gettone-di-maria"), CTX));
    expect(status).toBe(200);
    expect(body).toEqual({ pending: false });
  });

  it("Cancella account: la richiesta si registra e il conto dei 7 giorni parte", async () => {
    stato.senzaChiave = false;
    const { status, body } = await leggi(await chiediCancellazione(richiesta("POST", "/api/account/delete", "gettone-di-maria"), CTX));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof stato.profilo.deletion_requested_at).toBe("string");
  });
});
