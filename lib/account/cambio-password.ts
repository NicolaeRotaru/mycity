/**
 * SI PUÒ CAMBIARE QUESTA PASSWORD? — le condizioni, prima di toccare l'account.
 *
 * PERCHÉ ESISTE. La schermata «Cambia password» chiedeva la password attuale e
 * non la controllava mai: `currentPassword` compariva due volte in tutto il file,
 * la dichiarazione dello stato e il binding del campo. Il pulsante era
 * `disabled={!newPassword || !confirmPassword}`, quindi il campo si poteva
 * lasciare VUOTO e la password cambiava lo stesso.
 *
 * Non è un difetto di testo, anche se la radiografia l'aveva messo fra quelli:
 * è un controllo di sicurezza promesso all'utente e mai eseguito. Chi si trovasse
 * fra le mani una sessione aperta — un telefono lasciato sbloccato, un computer
 * condiviso — poteva cambiare la password senza conoscere quella vecchia, cioè
 * prendersi l'account e chiuderne fuori il proprietario.
 *
 * Le condizioni stanno qui e non dentro il componente perché una prova le possa
 * ESEGUIRE. La verifica vera della password attuale è una chiamata di rete e resta
 * nella pagina; queste sono le condizioni che si possono decidere prima.
 */

export type CampiPassword = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export const LUNGHEZZA_MINIMA = 8;

/**
 * Il motivo per cui il cambio NON può partire, o `null` se può.
 *
 * L'ordine dei controlli è quello in cui li incontra chi compila: prima ti dico
 * che manca la password attuale, poi che la nuova è corta, poi che le due non
 * coincidono. Dire per ultimo il campo che hai lasciato vuoto per primo fa
 * ricominciare da capo.
 */
export function perchePasswordNonCambiabile(campi: CampiPassword): string | null {
  if (!campi.currentPassword) return 'Inserisci la password attuale';
  if (campi.newPassword.length < LUNGHEZZA_MINIMA) {
    return `La password deve essere di almeno ${LUNGHEZZA_MINIMA} caratteri`;
  }
  if (campi.newPassword !== campi.confirmPassword) return 'Le password non coincidono';
  return null;
}

/** `true` quando il pulsante «Aggiorna password» deve essere premibile. */
export function puoiProvareACambiare(campi: CampiPassword): boolean {
  return Boolean(campi.currentPassword && campi.newPassword && campi.confirmPassword);
}
