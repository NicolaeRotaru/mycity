/**
 * Il segno degli abbonamenti dei servizi nei metadati Stripe (24/11/2026): servizi di MyCity
 * realizzati da SDG Agenzia. Sta in un file suo, senza dipendenze, così lo leggono sia
 * `abbonamenti.ts` sia `servizi.ts` senza che uno debba caricare l'altro.
 */
export const KIND_SERVIZI = 'servizi_subscription';
export const KIND_VETRINA = 'seller_subscription';
