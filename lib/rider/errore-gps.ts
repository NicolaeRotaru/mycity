/**
 * 5/11/2026 — L'ERRORE DEL GPS, DETTO IN ITALIANO.
 *
 * Il fattorino leggeva «Errore GPS:» seguito dal testo del browser, in inglese o vuoto, e la
 * condivisione si spegneva anche per un calo di segnale passeggero. I codici sono quelli di
 * GeolocationPositionError: 1 permesso negato, 2 posizione non disponibile, 3 tempo scaduto.
 * Solo il permesso negato spegne la condivisione (chi chiama lo decide col codice).
 */
export function messaggioErroreGps(codice: number): string {
  if (codice === 1) return 'Il telefono non dà il permesso di usare la posizione: attivalo nelle impostazioni e riprova.';
  if (codice === 3) return 'Segnale GPS lento: riprovo da solo, la condivisione resta accesa.';
  return 'Segnale GPS debole: riprovo da solo, la condivisione resta accesa.';
}
