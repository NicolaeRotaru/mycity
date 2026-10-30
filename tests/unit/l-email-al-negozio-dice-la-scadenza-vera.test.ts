import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { newOrderSellerTemplate } from "@/lib/email/templates";
import { rigaScadenzaPerIlNegozio } from "@/lib/ordini/scadenza-accettazione";
import { ETICHETTA_ADESSO } from "@/lib/quando-arriva";

/**
 * L EMAIL «NUOVO ORDINE» DICEVA «ACCETTA ENTRO 15 MINUTI», E IL SITO ASPETTAVA TRE ORE O LA FINE
 * DELLA FASCIA. Il negoziante che riceveva alle 21:15 l ordine per domani mattina leggeva che aveva
 * un quarto d ora. Adesso l email dice l ora che calcola scadenzaAccettazione, la stessa che
 * leggono le pagine ordini del negoziante.
 */
const casi = [
  { nome: "alle 21:15 per «Domani · 9:00–12:00»", createdAt: "2026-10-30T20:15:00.000Z", deliverySlot: "Domani · 9:00–12:00", attesa: "entro le 12:00 di domani" },
  { nome: "alle 15:30 per «Stasera · 18:00–20:00»", createdAt: "2026-10-30T14:30:00.000Z", deliverySlot: "Stasera · 18:00–20:00", attesa: "entro le 20:00 di oggi" },
  { nome: "alle 18:05 con la veloce", createdAt: "2026-10-30T17:05:00.000Z", deliverySlot: ETICHETTA_ADESSO, attesa: "entro le 18:15" },
];

describe("l email al negozio dice la scadenza vera", () => {
  for (const c of casi) {
    it(c.nome, () => {
      const t = newOrderSellerTemplate({ orderId: "o1", total: 15, itemsCount: 2, createdAt: c.createdAt, deliverySlot: c.deliverySlot });
      const riga = rigaScadenzaPerIlNegozio({ created_at: c.createdAt, delivery_slot: c.deliverySlot }, new Date(c.createdAt));
      expect(riga).toContain(c.attesa);
      expect(t.html).toContain(riga);
      expect(t.text).toContain(riga);
      expect(t.html).not.toContain("15 minuti");
    });
  }

  it("la veloce dice anche il freno dei 10 minuti", () => {
    const riga = rigaScadenzaPerIlNegozio({ created_at: casi[2].createdAt, delivery_slot: ETICHETTA_ADESSO }, new Date(casi[2].createdAt));
    expect(riga).toContain("10 minuti");
    expect(riga).toContain("fascia");
  });

  it("senza la fascia non promette nessun quarto d ora", () => {
    const t = newOrderSellerTemplate({ orderId: "o1", total: 15, itemsCount: 2 });
    expect(t.html).not.toContain("15 minuti");
  });

  it("le pagine ordini del negoziante leggono la stessa scadenza", () => {
    for (const f of ["app/seller/orders/page.tsx", "app/seller/orders/[id]/page.tsx"]) {
      expect(readFileSync(f, "utf8")).toContain("rigaScadenzaPerIlNegozio(");
    }
  });
});
