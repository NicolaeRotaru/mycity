// 31/10/2026 — Questo interruttore sta in un modulo che non importa niente.
// lib/store-hours.ts lo legge, e lib/constants.ts importa lib/promessa-consegna.ts, che importa
// lib/store-hours.ts: leggerlo da qui chiudeva un giro di import, e la costruzione si fermava con
// «Cannot access before initialization» sulla rotta /api/admin/branding. Le costanti lo esportano
// ancora, cosi' chi lo importa da lib/constants.ts non cambia.

/**
 * Il ritiro in negozio si puo' scegliere in cassa?
 *
 * No, per adesso: coi negozi non se n'e' ancora parlato (lo sconto per il ritiro,
 * `PICKUP_DISCOUNT_PERCENT` in lib/constants.ts, e' a zero per lo stesso motivo).
 *
 * 5/11/2026 — Come si chiude un ritiro: la via del venditore ESISTE. La funzione
 * `confirm_pickup_by_seller` (migrazione 124, rifatta nella 179) porta l'ordine
 * da «pronto» a «consegnato» col codice del ritiro e fa pagare il negozio; la
 * usa app/seller/orders/[id]/page.tsx. Prima qui c'era scritto che il solo modo
 * di chiudere un ordine era il bottone del fattorino: non e' piu' vero.
 *
 * Si riaccende cambiando questa riga in `true`, dopo aver controllato che le
 * migrazioni 124 e 179 siano applicate in produzione.
 */
export const RITIRO_IN_NEGOZIO_ATTIVO = false;
