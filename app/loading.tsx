/**
 * Il confine di caricamento della RADICE: quello che si vede in ogni pagina che
 * non ha uno scheletro suo.
 *
 * 6/9/2026 — QUI C'ERA UNA GRIGLIA DI PRODOTTI FINTI, ANCHE SU «CHI SIAMO».
 *
 * Era uno scheletro a quattro schede prodotto, centrato in un riquadro alto il
 * 70% dello schermo, con sotto una riga che prometteva i prodotti dei negozi
 * vicini. Lo riceveva la home — che poi diventa hero e categorie, un'altra forma
 * del tutto — lo riceveva «Chi siamo», che diventa testo, e lo riceveva ogni
 * altra pagina senza scheletro proprio. All'arrivo del contenuto vero la
 * pagina saltava tutta insieme, e la frase prometteva prodotti dove non ce
 * n'erano.
 *
 * Uno scheletro generico non puo' assomigliare a tutte le pagine: se ci prova,
 * sbaglia con tutte tranne una. Quindi qui non assomiglia a niente — una barra
 * sottile in alto, alta quattro pixel, che dice «sto arrivando» e non sposta
 * niente quando se ne va. Le pagine che meritano uno scheletro con la loro
 * geometria ne hanno gia' uno proprio (ordine, prodotto, negozio); le altre lo
 * avranno quando qualcuno lo scrivera' per loro, non prima.
 */
export default function RootLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="px-4 sm:px-6 pt-3">
      <span className="sr-only">Stiamo caricando…</span>
      <div className="h-1 w-full overflow-hidden rounded-full bg-cream-200" aria-hidden>
        <div className="h-full w-1/3 animate-pulse rounded-full bg-primary-700" />
      </div>
    </div>
  );
}
