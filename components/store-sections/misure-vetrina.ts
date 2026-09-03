/**
 * LE MISURE DELLA VETRINA, SCRITTE UNA VOLTA SOLA.
 *
 * 3/9/2026 — APRENDO UN NEGOZIO SI VEDEVANO TRE PAGINE DIVERSE IN FILA.
 *
 * Chi toccava il nome di un negozio vedeva, nell'ordine: uno scheletro con una
 * banda alta 192 punti e otto quadrati; poi la pagina che si accorciava a poche
 * righe con un cerchietto che gira in mezzo; e solo alla fine il negozio vero,
 * con la copertina alta 240 punti. Tre impaginazioni in sequenza sono peggio di
 * una lenta: chi guarda pensa che il sito sia rotto e torna indietro.
 *
 * La causa non era la lentezza: erano tre elenchi di classi scritti a mano in
 * tre file diversi, che nessuno teneva allineati. Qui le misure sono una sola, e
 * lo scheletro dell'attesa e la pagina vera le chiedono a questo file: se domani
 * la copertina cambia altezza, lo scheletro la segue senza che nessuno se ne
 * ricordi.
 *
 * Questo file NON dichiara `'use client'`: lo legge il guscio del server
 * (`app/store/[id]/loading.tsx`) tanto quanto la copertina nel browser.
 */

/** L'altezza della copertina del negozio: la stessa nell'attesa e nella pagina vera. */
export const ALTEZZA_COPERTINA = 'h-60';

/** Il contenitore della pagina negozio: stessa larghezza e stessi margini nell'attesa e dopo. */
export const CONTENITORE_PAGINA_NEGOZIO = 'container mx-auto px-4 py-6 max-w-5xl space-y-4';
