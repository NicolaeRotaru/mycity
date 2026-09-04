/**
 * LA FORMA DELLA FASCIA-BANNER, IN UN POSTO SOLO.
 *
 * IL DIFETTO CHE CHIUDE (misurato il 3/9/2026, col file davanti). Il pannello
 * diceva a chi carica «Consigliato 16:9» e il riquadro sul sito aveva
 * un'ALTEZZA FISSA — 224 punti sul telefono, 288 sul computer — dentro una
 * larghezza che segue la finestra. Un'altezza fissa dentro una larghezza libera
 * non è una forma: è una forma diversa per ogni schermo. Su un telefono da 360
 * il riquadro veniva 328×224, cioè quasi un quadrato e mezzo; su un monitor
 * largo veniva 1488×288, cioè cinque volte più largo che alto.
 *
 * Chi caricava il 16:9 che gli era stato chiesto (1600×900) sul computer se ne
 * vedeva ritagliare quasi il sessanta per cento dell'altezza — spariva quello
 * che stava in alto e in basso — e sul telefono se ne vedeva ritagliare i lati.
 * Nessuna immagine poteva andare bene, perché la forma da riempire non era una
 * sola. E chi carica non aveva modo di accorgersene prima di pubblicare.
 *
 * LA CURA non è ritoccare l'altezza: è che la fascia dichiari una PROPORZIONE,
 * così su ogni schermo la forma è una delle tre scritte qui, non una qualunque;
 * e che il consiglio dato a chi carica nasca dallo stesso file, così non può
 * più dire una cosa diversa da quella che il sito fa.
 *
 * Le tre proporzioni non sono un capriccio: sul telefono la fascia deve restare
 * abbastanza alta da contenere titolo, sottotitolo e pulsante, che le stanno
 * dentro sovrapposti; su un monitor largo la stessa proporzione darebbe una
 * fascia alta settecento punti, cioè uno schermo intero prima del primo
 * prodotto.
 */

/**
 * Le proporzioni della fascia, per fascia di schermo.
 *
 *   telefono   16:9  →  a 360 punti di larghezza la fascia è alta 184
 *   tablet      3:1  →  a 768 punti è alta 240
 *   computer    4:1  →  a 1280 punti è alta 308  (prima erano 288 fissi)
 */
export const PROPORZIONI_FASCIA_BANNER = 'aspect-[16/9] sm:aspect-[3/1] lg:aspect-[4/1]';

/** Il riquadro completo della fascia: proporzione, bordo, angoli, ritaglio. */
export const CLASSI_FASCIA_BANNER =
  `relative w-full ${PROPORZIONI_FASCIA_BANNER} overflow-hidden rounded-2xl border border-cream-300 shadow-warm`;

/**
 * L'imbottitura del testo sovrapposto.
 *
 * Sul telefono la fascia è alta 184 punti e il testo — titolo, sottotitolo e
 * pulsante — ne chiede circa 137 con l'imbottitura corta. Con quella lunga
 * (24 punti per lato) il titolo finirebbe tagliato in cima sugli schermi da 320.
 */
export const CLASSI_TESTO_FASCIA_BANNER = 'absolute inset-0 flex flex-col items-start justify-end gap-2 p-4 sm:p-6';

/**
 * La forma da caricare, in proporzione e in pixel.
 *
 * NON È UNA PREFERENZA: È UN CONTO. La stessa immagine viene ritagliata in tre
 * riquadri diversi (16:9, 3:1, 4:1), e con `object-cover` quello che resta è
 * sempre `il più stretto diviso il più largo` fra la forma dell'immagine e
 * quella del riquadro. Consigliare il 16:9 — come faceva il pannello — voleva
 * dire buttare via il 56% dell'immagine sul riquadro più largo. Consigliare il
 * 4:1 farebbe lo stesso danno dall'altra parte, sul telefono.
 *
 * Il minor danno possibile sta esattamente in mezzo, in senso moltiplicativo:
 * la radice di 16/9 per 4 fa 2,67, cioè 8:3. Con quella forma il ritaglio
 * peggiore è il 33% invece del 56%, e cade nello stesso modo su tutti e tre gli
 * schermi invece di rovinare solo il più grande.
 *
 * Il 33% che resta non si può togliere: è il prezzo di una sola immagine che
 * deve stare in una fascia che va da un telefono a un monitor. Per questo il
 * consiglio qui sotto dice anche di tenere il soggetto al centro — è l'unica
 * parte del quadro che sopravvive a tutti e tre i ritagli.
 */
export const FORMA_CONSIGLIATA_BANNER = '8:3';
export const MISURA_CONSIGLIATA_BANNER = '1600×600';

/**
 * Il consiglio che legge chi carica l'immagine dal pannello.
 *
 * Nasce da qui, non è scritto a mano nel modulo: era esattamente così che il
 * pannello è arrivato a chiedere una forma che il sito non usava.
 *
 * Dice anche la cosa che serve davvero sapere, e che prima non diceva nessuno:
 * la stessa immagine viene ritagliata in tre modi diversi, quindi il soggetto
 * deve stare al centro.
 */
export const CONSIGLIO_IMMAGINE_BANNER =
  `Consigliato ${FORMA_CONSIGLIATA_BANNER} orizzontale (per esempio ${MISURA_CONSIGLIATA_BANNER}). ` +
  'Tieni il soggetto al centro: sul telefono la fascia si stringe e taglia ai lati. ' +
  'Carica un file o incolla un URL https.';
