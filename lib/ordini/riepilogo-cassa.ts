import { prezziDelCarrello, type IngressiPrezzo } from './prezzi';

/**
 * QUELLO CHE SI LEGGE IN CASSA, dallo stesso conto che poi addebita.
 *
 * 27/8/2026 (R001) — IL BROWSER SI FACEVA IL TOTALE PER CONTO SUO.
 *
 * `app/checkout/page.tsx` calcolava il totale mostrato con una formula scritta
 * lì dentro, in euro:
 *
 *   Math.max(0, subtotale + spedizione + fee − sconto − scontoRitiro)
 *
 * Manca il TETTO sugli sconti che il server applica sempre (`prezziDelCarrello`
 * → `riduciAlTetto`): lo sconto non può superare merce + spedizione meno un
 * centesimo, perché la fee di consegna la piattaforma la incassa comunque.
 * Un buono a importo fisso da 30 € su una spesa da 10 € nel browser azzerava
 * tutto — «0,00 €» — mentre il server ne addebitava 3,01.
 *
 * Chi paga alla consegna scopre la differenza dal fattorino sulla porta, su un
 * ordine che la pagina dava per gratis. Chi paga con carta vede sull'estratto
 * conto una cifra che non è quella letta prima di premere «Paga».
 *
 * Perché una funzione e non tre righe corrette dentro la pagina: la stessa
 * domanda — «quanto pago?» — se la fanno la cassa, le due rotte che creano
 * l'ordine e domani la mail di conferma. La risposta deve nascere una volta
 * sola. Qui dentro non c'è aritmetica nuova: c'è `prezziDelCarrello`, la
 * funzione che decide l'addebito, letta in euro perché è così che si stampa.
 *
 * 🟢 Pura: nessuna rete, nessun orologio. Una prova la ESEGUE
 * (`tests/unit/in-cassa-il-totale-mostrato-e-quello-addebitato.test.ts`).
 */
export type IngressiRiepilogo = IngressiPrezzo & {
  /**
   * Il credito MyCity si applica a questo ordine? Oggi solo sul contrassegno:
   * la carta passa da Stripe, dove il credito non arriva ancora.
   */
  usaCredito: boolean;
  /** Quanto credito ha in cassa la persona, in centesimi. */
  creditoDisponibileCents: number;
};

export type RiepilogoDaMostrare = {
  /** La merce, già ai prezzi di adesso. */
  subtotale: number;
  spedizione: number;
  feeConsegna: number;
  /** Lo sconto del ritiro DAVVERO applicato (già limitato dal tetto). */
  scontoRitiro: number;
  /** Lo sconto del codice DAVVERO applicato (già limitato dal tetto). */
  scontoCodice: number;
  /** Quanto credito entra davvero in questo ordine. */
  creditoUsato: number;
  /** Quello che la persona paga: la cifra grossa sul pulsante. */
  totale: number;
};

export function riepilogoDaMostrare(ing: IngressiRiepilogo): RiepilogoDaMostrare {
  const prezzi = prezziDelCarrello(ing);

  // Le voci si sommano dalle quote per negozio: sono quelle già limitate dal
  // tetto, cioè quelle che finiscono davvero sull'ordine. Se il riepilogo
  // scrivesse lo sconto RICHIESTO, le righe non tornerebbero col totale e chi
  // fa la somma a mano — cioè chiunque, davanti a un pagamento — troverebbe un
  // errore che non c'è.
  const feeConsegnaCents = prezzi.gruppi.reduce((s, g) => s + g.deliveryFeeCents, 0);
  const scontoCodiceCents = prezzi.gruppi.reduce((s, g) => s + g.couponPortionCents, 0);
  const scontoRitiroCents = prezzi.gruppi.reduce((s, g) => s + g.pickupPortionCents, 0);

  const creditoUsatoCents = ing.usaCredito
    ? Math.min(Math.max(0, Math.round(ing.creditoDisponibileCents)), prezzi.grandTotalCents)
    : 0;

  return {
    subtotale: prezzi.grandSubtotalCents / 100,
    spedizione: prezzi.grandShippingCents / 100,
    feeConsegna: feeConsegnaCents / 100,
    scontoRitiro: scontoRitiroCents / 100,
    scontoCodice: scontoCodiceCents / 100,
    creditoUsato: creditoUsatoCents / 100,
    totale: Math.max(0, prezzi.grandTotalCents - creditoUsatoCents) / 100,
  };
}
