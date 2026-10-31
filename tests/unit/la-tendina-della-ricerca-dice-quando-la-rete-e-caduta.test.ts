/**
 * 31/10/2026 — SE LA RETE CADE MENTRE IL CLIENTE CERCA, LA TENDINA DICEVA «NESSUN RISULTATO».
 *
 * supabase-js non lancia mai quando la rete cade o il server risponde 500: restituisce
 * { data: null, error }. leggiSuggerimentiRicerca leggeva solo `.data`, quindi ogni guasto
 * diventava un elenco vuoto, e la barra di ricerca (che sa mostrare «non riesco a cercare» quando
 * la domanda fallisce) diceva invece al cliente che quel prodotto non c è.
 *
 * Qui la funzione si ESEGUE contro un database finto che risponde come supabase-js.
 */
import { describe, it, expect } from "vitest";
import { leggiSuggerimentiRicerca } from "@/lib/queries/suggerimenti-ricerca";

type Esito = { data: unknown; error: { message: string } | null };
const ROTTA: Esito = { data: null, error: { message: "TypeError: fetch failed" } };
const VUOTA: Esito = { data: [], error: null };

function catena(esito: Esito): unknown {
  const c: unknown = new Proxy(
    {},
    {
      get: (_t, k) =>
        k === "then" ? (ok: (v: Esito) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(esito).then(ok, ko) : () => c,
    },
  );
  return c;
}
const database = (rpc: Esito, tabelle: Esito) => ({ rpc: () => catena(rpc), from: () => catena(tabelle) }) as never;

describe("la tendina della ricerca non scambia un guasto per «nessun risultato»", () => {
  it("rete caduta: la domanda fallisce, non risponde un elenco vuoto", async () => {
    await expect(leggiSuggerimentiRicerca(database(ROTTA, ROTTA), "pane")).rejects.toThrow();
  });

  it("rete viva e niente che si chiama così: elenco vuoto, è la verità", async () => {
    await expect(leggiSuggerimentiRicerca(database(VUOTA, VUOTA), "zzzz")).resolves.toEqual([]);
  });

  it("prodotti trovati e negozi guasti: i prodotti si mostrano lo stesso", async () => {
    const prodotti: Esito = { data: [{ id: "p1", name: "Pane", price: 3, images: [], store_name: "Forno" }], error: null };
    const r = await leggiSuggerimentiRicerca(database(prodotti, ROTTA), "pane");
    expect(r.map((s) => s.kind)).toEqual(["product"]);
  });
});
