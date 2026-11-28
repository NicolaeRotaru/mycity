// 31/10/2026 — Questo interruttore sta in un modulo che non importa niente.
// lib/store-hours.ts lo legge, e lib/constants.ts importa lib/promessa-consegna.ts, che importa
// lib/store-hours.ts: leggerlo da qui chiudeva un giro di import, e la costruzione si fermava con
// «Cannot access before initialization» sulla rotta /api/admin/branding. Le costanti lo esportano
// ancora, cosi' chi lo importa da lib/constants.ts non cambia.

/**
 * Il ritiro in negozio si puo' scegliere in cassa?
 *
 * Si', dal lancio (R12-009, decisione di Nicola: acceso e gratis per il cliente). Col ritiro la
 * consegna vale zero (lib/ordini/prezzi.ts), si paga con la carta o in contanti al banco, e MyCity
 * prende comunque la sua commissione. Lo sconto per il ritiro (`PICKUP_DISCOUNT_PERCENT` in
 * lib/constants.ts) resta a zero: coi negozi non se n'e' parlato, e la cassa dice «Senza consegna»,
 * non «Sconto 0%».
 *
 * Come si chiude un ritiro: il negozio scrive il codice che il cliente gli mostra
 * (`confirm_pickup_by_seller`, migrazione 124 rifatta nella 179, da app/seller/orders/[id]/page.tsx).
 * L'ordine passa a «consegnato»; se era in contanti diventa CASH_IN_STORE: il negozio ha gia' tutto
 * in cassa e la commissione MyCity si toglie dal bonifico del lunedi' (segna_bonifico_manuale,
 * migrazione 916; il resto va in fattura).
 *
 * Fuori dal codice: le migrazioni 124, 179 e 916 devono essere applicate in produzione, se no il
 * ritiro non si chiude o la commissione non si segna (risultano applicate al controllo in sola
 * lettura del 28/11/2026).
 */
export const RITIRO_IN_NEGOZIO_ATTIVO = true;
