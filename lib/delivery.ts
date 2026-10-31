/**
 * I minuti della consegna veloce: il numero deciso una volta sola.
 *
 * 31/10/2026 (ondata 3) — Qui c'erano anche `DEFAULT_CUTOFF_HOUR` (le 18), `deliveryWindow`,
 * `deliveryEstimate`, `splitDuration` e `STANDARD_ETA_LABEL` («2-3 giorni»): il conto alla rovescia
 * fino alle 18 uguale per ogni negozio. Dava cinque ore e mezza a un forno che chiude alle 13 e
 * prometteva «domani» il sabato sera a un negozio chiuso la domenica. La scheda prodotto non lo usa
 * più dal 29/10 (`rigaConsegnaDellaScheda` in lib/promessa-consegna.ts, con le regole della cassa),
 * ma restava esportato: un orario limite fisso che resta in giro torna in una scheda. Tolto, non
 * azzerato. Prova: tests/unit/la-scheda-non-conta-fino-alle-18.test.ts
 */

/** Consegna Express (prodotto a inventario e pronto): stima rider locale. */
export const EXPRESS_ETA_MIN = 30;
export const EXPRESS_ETA_MAX = 60;
export const EXPRESS_ETA_LABEL = `${EXPRESS_ETA_MIN}-${EXPRESS_ETA_MAX} min`;
