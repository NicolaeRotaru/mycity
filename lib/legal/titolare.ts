/**
 * Chi è il titolare del trattamento, in un posto solo.
 *
 * Perché esiste questo file: l'informativa pubblicata dichiarava
 * «MyCity S.r.l., Via Roma 1, 29121 Piacenza, P.IVA IT00000000000». La partita
 * IVA di soli zeri è un segnaposto: pubblicarla vuol dire dichiarare al mondo
 * un dato falso su chi risponde dei dati delle persone. Peggio ancora, la
 * stessa pagina nominava un responsabile della protezione dei dati (DPO) che
 * non è stato nominato: dichiararlo senza averlo è una falsa attestazione.
 *
 * La regola qui è semplice: si mostra solo ciò che è vero. I campi non ancora
 * disponibili restano vuoti e la pagina non li stampa, invece di inventarli.
 * Quando ci sono i dati reali si riempiono queste variabili d'ambiente e la
 * pagina si completa da sé.
 *
 * `tests/unit/informativa-senza-dati-finti.test.ts` fallisce se un segnaposto
 * torna a comparire.
 */

export type Titolare = {
  denominazione: string;
  indirizzo: string | null;
  partitaIva: string | null;
  emailPrivacy: string;
  /** Nominato davvero? Se no, la pagina non deve citarne uno. */
  emailDpo: string | null;
};

/** Forme di segnaposto che non devono finire su una pagina pubblica. */
const SEGNAPOSTO = [
  /^IT0+$/i,
  /^0+$/,
  /^IT12345678/i,
  /XXXX/i,
  /da\s*definire/i,
  /placeholder/i,
  /tbd/i,
];

export function eSegnaposto(valore: string | null | undefined): boolean {
  if (!valore) return true;
  const v = valore.trim();
  if (v === '') return true;
  return SEGNAPOSTO.some((re) => re.test(v));
}

/** Restituisce il valore solo se è un dato vero, altrimenti null. */
function soloSeVero(valore: string | undefined): string | null {
  return eSegnaposto(valore) ? null : (valore as string).trim();
}

export function titolare(): Titolare {
  return {
    denominazione: process.env.NEXT_PUBLIC_TITOLARE_NOME?.trim() || 'MyCity',
    indirizzo: soloSeVero(process.env.NEXT_PUBLIC_TITOLARE_INDIRIZZO),
    partitaIva: soloSeVero(process.env.NEXT_PUBLIC_TITOLARE_PIVA),
    emailPrivacy: process.env.NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY?.trim() || 'privacy@mycity.it',
    emailDpo: soloSeVero(process.env.NEXT_PUBLIC_TITOLARE_EMAIL_DPO),
  };
}

/**
 * La frase di identificazione del titolare, costruita coi soli dati veri.
 * Esempio senza P.IVA: «Il titolare del trattamento è MyCity.»
 */
export function frameTitolare(t: Titolare = titolare()): string {
  const pezzi: string[] = [];
  if (t.indirizzo) pezzi.push(`con sede in ${t.indirizzo}`);
  if (t.partitaIva) pezzi.push(`P.IVA ${t.partitaIva}`);
  return pezzi.length > 0 ? `${t.denominazione}, ${pezzi.join(', ')}.` : `${t.denominazione}.`;
}
