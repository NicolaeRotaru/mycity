// 31/10/2026 — Questo interruttore sta in un modulo che non importa niente.
// lib/store-hours.ts lo legge, e lib/constants.ts importa lib/promessa-consegna.ts, che importa
// lib/store-hours.ts: leggerlo da qui chiudeva un giro di import, e la costruzione si fermava con
// «Cannot access before initialization» sulla rotta /api/admin/branding. Le costanti lo esportano
// ancora, cosi' chi lo importa da lib/constants.ts non cambia.

/**
 * Il ritiro in negozio si puo' scegliere in cassa?
 *
 * No, per adesso. Stesso motivo dello sconto qui sopra: coi negozi non se n'e'
 * ancora parlato. Tenerlo acceso senza sconto non basterebbe, perche' un ordine
 * ritirato in negozio oggi non arriva mai a «consegnato»: il solo modo di
 * chiudere un ordine e' il bottone del fattorino, e su un ritiro il fattorino
 * non c'e'. Il negoziante consegnerebbe a mano e resterebbe senza incasso.
 *
 * Si riaccende cambiando questa riga in `true` — ma prima va data al venditore
 * una via per confermare il ritiro.
 */
export const RITIRO_IN_NEGOZIO_ATTIVO = false;
