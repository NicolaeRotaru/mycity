/**
 * 1503 (revisore) — Tailwind scansiona solo app/ e components/ (tailwind.config.ts),
 * non lib/. Le proporzioni della fascia-banner stanno in lib/banner-vetrina.ts, quindi
 * senza questa copia testuale le classi a gradino non venivano generate e la fascia
 * restava 16:9 su ogni schermo. Questa riga serve solo a farle vedere a Tailwind;
 * tests/unit/minori-s06-fascia-banner.test.ts controlla che resti uguale a quella di lib.
 *
 * (Meglio sarebbe aggiungere './lib/**' ai `content` di tailwind.config.ts: è un file
 * di un'altra sessione, lo segnalo nel referto.)
 */
export const CLASSI_FASCIA_BANNER_PER_TAILWIND = 'aspect-[16/9] sm:aspect-[2/1] md:aspect-[3/1] lg:aspect-[4/1]';
