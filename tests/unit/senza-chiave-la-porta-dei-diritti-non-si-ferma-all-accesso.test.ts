/**
 * 27/10/2026 — SENZA CHIAVE, LA PORTA DEI DIRITTI NON SI FERMA ALL'ACCESSO.
 *
 * La storia. La squadra aveva insegnato a «Cancella account» e «Scarica i miei
 * dati» a dire la strada a mano quando manca la chiave di servizio. La prova
 * era verde, ma fingeva il controllo d'accesso. Quello vero (`withAuth`) legge
 * il profilo con la stessa chiave: senza, risponde 503 «Auth non configurato»
 * PRIMA che la rotta parli. In produzione la frase nuova non usciva mai.
 *
 * Qui il controllo d'accesso è quello VERO: si finge solo il database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const stato = { senzaChiave: true };

vi.mock("@/lib/supabase/server", () => ({
  getAdminSupabase: () => {
    if (stato.senzaChiave) throw new Error("Service role Supabase non configurato (SUPABASE_SERVICE_ROLE_KEY).");
    return { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }) };
  },
  getServerSupabase: async () => { throw new Error("nessun cookie"); },
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/supabase/anonimo", () => ({
  creaClientAnonimo: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-1", email: "maria@example.com" } }, error: null }) },
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

const conGettone = (metodo: string, percorso: string) =>
  new Request("http://localhost" + percorso, { method: metodo, headers: { authorization: "Bearer gettone" } });

async function risposta(r: unknown): Promise<{ status: number; testo: string }> {
  const res = r as Response;
  return { status: res.status, testo: JSON.stringify(await res.json()) };
}

beforeEach(() => {
  stato.senzaChiave = true;
  delete process.env[CASELLA];
  __resetRateLimitBuckets();
});

describe("senza chiave di servizio, col controllo d'accesso vero", () => {
  const porte: Array<[string, () => Promise<unknown>]> = [
    ["Cancella account", () => chiediCancellazione(conGettone("POST", "/api/account/delete") as never)],
    ["Annulla la cancellazione", () => annullaCancellazione(conGettone("DELETE", "/api/account/delete") as never)],
    ["Stato della cancellazione", () => statoCancellazione(conGettone("GET", "/api/account/delete") as never)],
    ["Scarica i miei dati", () => scaricaDati(conGettone("GET", "/api/account/export") as never)],
  ];

  for (const [nome, bussa] of porte) {
    it(`${nome} dice la strada a mano, non «Auth non configurato»`, async () => {
      process.env[CASELLA] = "info@mycity-marketplace.com";
      const { status, testo } = await risposta(await bussa());
      expect(status).toBe(503);
      expect(testo, "il controllo d'accesso rispondeva prima della rotta").not.toContain("Auth non configurato");
      expect(testo).toContain("Puoi fare la richiesta lo stesso");
      expect(testo).toContain("info@mycity-marketplace.com");
    });
  }

  it("senza casella vera manda al modulo, senza indirizzi inventati", async () => {
    const { testo } = await risposta(await chiediCancellazione(conGettone("POST", "/api/account/delete") as never));
    expect(testo).toContain("modulo dei contatti");
    expect(testo).not.toMatch(/[a-z0-9.]+@[a-z0-9.-]+\.[a-z]+/i);
  });
});

describe("con la chiave, la strada a mano non apre la porta a chi non ha accesso", () => {
  it("chi non ha né gettone né sessione resta fuori: 401", async () => {
    stato.senzaChiave = false;
    const res = await chiediCancellazione(new Request("http://localhost/api/account/delete", { method: "POST" }) as never);
    expect(res.status).toBe(401);
  });
});
