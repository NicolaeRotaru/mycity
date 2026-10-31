/**
 * @vitest-environment jsdom
 */
/**
 * 31/10/2026 — LA PAGINA PROMOZIONI ANDAVA IN ERRORE QUANDO NON C ERA NESSUNA PROMOZIONE.
 *
 * La pagina /promozioni e la griglia dei prodotti salvavano i dati nella stessa memoria del browser
 * (la chiave [promotions,active]) con due forme diverse: la pagina un elenco di righe, la
 * griglia un insieme di id su cui chiama .has(). Con zero promozioni la pagina disegna proprio la
 * griglia «solo promo»: la griglia trovava l elenco della pagina, .has non esiste, pagina rotta.
 *
 * Qui la memoria si riempie come la riempie la pagina (elenco vuoto) e poi si MONTA la griglia vera,
 * con un prodotto senza sconto. Deve mostrare il suo stato vuoto, non un errore.
 */
import { describe, it, expect, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queries/keys";

vi.mock("@/lib/supabase/client", () => ({ supabase: { rpc: async () => ({ data: [], error: null }) } }));
vi.mock("@/lib/queries/griglia-prodotti", () => ({
  leggiProdottiDellaGriglia: async () => [
    { id: "p1", name: "Focaccia", price: 3, compare_at_price: null, images: [], seller_id: "s1", stock: 5, profiles: { store_name: "Pane Quotidiano", store_hours: null } },
  ],
}));
vi.mock("@/components/ProductCard", () => ({ default: () => null }));
vi.mock("@/lib/analytics/events", () => ({ trackSearchPerformed: () => undefined }));
vi.mock("next/link", async () => {
  const { createElement: ce } = await import("react");
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce("a", { href: String(href), ...r }, children as never) };
});

import ProductGrid from "@/components/ProductGrid";

describe("la griglia «solo promo» con zero promozioni attive", () => {
  it("dopo la pagina Promozioni mostra lo stato vuoto, non va in errore", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as Record<string, unknown>).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Quello che lascia la pagina /promozioni quando non trova promozioni: un elenco vuoto.
    client.setQueryData(queryKeys.promotions.active, []);

    const errori: unknown[] = [];
    // React e jsdom stampano l errore per esteso: qui conta SE la griglia si rompe, non il testo.
    const zitto = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sentinella = (e: ErrorEvent) => { errori.push(e.error ?? e.message); e.preventDefault(); };
    window.addEventListener("error", sentinella);
    const radice = document.createElement("div");
    document.body.appendChild(radice);
    const root = createRoot(radice);
    try {
      await act(async () => {
        root.render(
          createElement(QueryClientProvider, { client },
            createElement(ProductGrid, { onlyPromo: true, maxColumns: 4, emptyTitle: "Nessuna promozione attiva al momento" })),
        );
      });
      for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    } catch (e) {
      errori.push(e);
    } finally {
      window.removeEventListener("error", sentinella);
      zitto.mockRestore();
    }
    expect(errori.length, "la griglia «solo promo» è andata in errore invece di mostrare lo stato vuoto").toBe(0);
    expect(radice.textContent).toContain("Nessuna promozione attiva al momento");
    act(() => root.unmount());
  });
});
