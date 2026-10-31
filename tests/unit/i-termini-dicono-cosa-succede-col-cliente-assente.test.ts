import { describe, it, expect } from "vitest";
import { paragrafiConsegne } from "@/lib/legal/promessa-cliente-assente";

/**
 * 31/10/2026 — IL §6 DICE LA PROCEDURA CHE IL FATTORINO HA DAVVERO.
 *
 * Il §6 dei Termini diceva: se non sei in casa, l ordine «resta in stato "in consegna"
 * finché non interviene l assistenza». Da oggi il fattorino segna «cliente assente» e
 * l ordine si annulla (scelta di Nicola, fatto consegna.cliente-assente): rimborso
 * intero, merce al negozio, nessuna trattenuta. Il testo generato deve dire questo.
 */
const testo = () => paragrafiConsegne().join("\n");

describe("§6 Consegne: il cliente assente", () => {
  it("non promette più un ordine fermo «in consegna» fino all assistenza", () => {
    expect(testo()).not.toMatch(/resta in stato «in consegna»/);
    expect(testo()).not.toMatch(/finché non interviene l’assistenza/);
  });

  it("dice la procedura: telefonata, «cliente assente», annullo del Rider, merce al Venditore", () => {
    expect(testo()).toMatch(/il Rider prova a telefonargli/);
    expect(testo()).toMatch(/il Rider segna «cliente assente»/);
    expect(testo()).toMatch(/lo annulla il Rider e la merce torna al Venditore/);
  });

  it("e non trattiene niente: rimborso sullo stesso mezzo, niente addebito coi contanti, credito che torna", () => {
    expect(testo()).not.toMatch(/al netto delle spese di consegna/i);
    expect(testo()).toMatch(/MyCity non trattiene le spese di consegna/);
    expect(testo()).toMatch(/Sugli ordini pagati alla consegna non è stato addebitato nulla/);
    expect(testo()).toMatch(/Il credito MyCity usato sull’ordine torna sul tuo saldo/);
  });
});
