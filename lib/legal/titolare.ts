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
  /** Numero REA camerale. Esiste solo con una societa' iscritta. */
  rea: string | null;
  /** Posta elettronica certificata. */
  pec: string | null;
  /** Capitale sociale, gia' scritto per intero (es. «10.000 € i.v.»). */
  capitale: string | null;
  emailPrivacy: string;
  /**
   * La casella della privacy e' quella VERA, o e' il ripiego scritto nel codice?
   *
   * 27/8/2026 (R053) — `emailPrivacy` e' l'unico campo che non passa dal filtro
   * `soloSeVero`: se la variabile manca ripiega su `privacy@mycity.it`, che sta
   * su un dominio che non e' quello di produzione. Da fuori le due cose sono
   * identiche, e quell'indirizzo e' la porta dell'art. 15 e dell'art. 17 — dove
   * si scrive per avere una copia dei propri dati o per farseli cancellare.
   *
   * Il ripiego resta perche' tre pagine lo stampano e un `null` sarebbe peggio;
   * ma chi deve indirizzare una richiesta di diritti guarda QUESTO, e se e'
   * falso manda al modulo dei contatti (vedi `recapitoPrivacy`).
   */
  emailPrivacyConfigurata?: boolean;
  /**
   * Chi risponde delle domande sulla privacy, col suo nome.
   *
   * NON e' un DPO: quello e' una nomina formale che un'attivita' di questa
   * dimensione non e' tenuta a fare, e dichiararlo senza averlo fatto e' una
   * falsa attestazione (art. 37 GDPR). Qui c'e' semplicemente la persona a cui
   * si scrive. Nicola, 20/8/2026: «per il responsabile di privacy sono io:
   * Nicolae Rotaru».
   */
  referentePrivacy: string | null;
  /** Nominato davvero un DPO formale? Se no, la pagina non deve citarne uno. */
  emailDpo: string | null;
  /**
   * 22/8/2026 — LE CASELLE SCRITTE A MANO NELLE PAGINE LEGALI.
   *
   * Nei Termini e nelle impostazioni c'erano quattro indirizzi scritti dentro
   * il testo — resi@, reclami@, legal@, security@ — tutti su un dominio che non
   * e' quello di produzione. Chi esercita il recesso, chi apre un reclamo, chi
   * segnala una falla scriveva a una casella che non riceve niente, e non
   * riceveva mai risposta: un obbligo dichiarato e non erogato.
   *
   * Adesso vivono qui, come tutti gli altri dati del titolare, e valgono la
   * stessa regola: se la variabile d'ambiente non c'e', la riga non si stampa.
   * Meglio una riga in meno che un indirizzo che non risponde.
   */
  emailResi: string | null;
  emailReclami: string | null;
  emailLegale: string | null;
  emailSicurezza: string | null;
  /** Il punto di contatto unico per autorita' e utenti (obblighi DSA). */
  emailSegnalazioni: string | null;
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
    rea: soloSeVero(process.env.NEXT_PUBLIC_TITOLARE_REA),
    pec: soloSeVero(process.env.NEXT_PUBLIC_TITOLARE_PEC),
    capitale: soloSeVero(process.env.NEXT_PUBLIC_TITOLARE_CAPITALE),
    emailPrivacy: soloSeVero(process.env.NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY) ?? 'privacy@mycity.it',
    emailPrivacyConfigurata: soloSeVero(process.env.NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY) !== null,
    referentePrivacy: process.env.NEXT_PUBLIC_TITOLARE_REFERENTE_PRIVACY?.trim() || 'Nicolae Rotaru',
    emailDpo: soloSeVero(process.env.NEXT_PUBLIC_TITOLARE_EMAIL_DPO),
    emailResi: soloSeVero(process.env.NEXT_PUBLIC_TITOLARE_EMAIL_RESI),
    emailReclami: soloSeVero(process.env.NEXT_PUBLIC_TITOLARE_EMAIL_RECLAMI),
    emailLegale: soloSeVero(process.env.NEXT_PUBLIC_TITOLARE_EMAIL_LEGALE),
    emailSicurezza: soloSeVero(process.env.NEXT_PUBLIC_TITOLARE_EMAIL_SICUREZZA),
    emailSegnalazioni: soloSeVero(process.env.NEXT_PUBLIC_TITOLARE_EMAIL_SEGNALAZIONI),
  };
}

/**
 * La riga di identificazione in fondo alle pagine, coi soli dati veri.
 *
 * Cosa c'era prima, su OGNI pagina del sito: «Sede legale: Via Roma 1, 29121
 * Piacenza (PC), Italia · P.IVA / C.F. IT00000000000 · REA PC-000000» e
 * «Capitale sociale 10.000 € i.v. · PEC: mycity@pec.it». Nessuno di quei dati
 * esisteva. Una partita IVA di soli zeri in fondo al contratto che il cliente
 * accetta non e' un segnaposto da riempire dopo: e' gia' pubblicata.
 *
 * Nicola, 20/8/2026: «non c'e' ancora una partita IVA attiva, la attivo quando
 * raggiungeremo i 5000€». Finche' non c'e', qui non si stampa niente.
 */
export function rigaIdentita(t: Titolare = titolare()): string {
  const pezzi: string[] = [];
  if (t.indirizzo) pezzi.push(`Sede: ${t.indirizzo}`);
  if (t.partitaIva) pezzi.push(`P.IVA / C.F. ${t.partitaIva}`);
  if (t.rea) pezzi.push(`REA ${t.rea}`);
  if (t.capitale) pezzi.push(`Capitale sociale ${t.capitale}`);
  if (t.pec) pezzi.push(`PEC: ${t.pec}`);
  return pezzi.join(' · ');
}

/**
 * Dove si scrive per esercitare i diritti sui propri dati.
 *
 * 27/8/2026 (R053) — L'INFORMATIVA MANDAVA A UNA CASELLA CHE NON RICEVE.
 *
 * Le tre volte in cui l'informativa dice «scrivi qui» — il contatto del
 * titolare, l'esercizio dei diritti, la richiesta delle versioni precedenti —
 * portavano tutte a `privacy@mycity.it`, che nasce come ripiego dentro il
 * codice quando la variabile d'ambiente e' vuota. Una richiesta di accesso o di
 * cancellazione che finisce li' non arriva a nessuno, e dopo un mese di
 * silenzio la persona ha diritto di reclamare al Garante: la conseguenza non e'
 * un link rotto, e' una mancata risposta.
 *
 * Finche' la casella vera non c'e', si manda al modulo dei contatti: scrive nel
 * database, arriva a qualcuno, e non promette un indirizzo che non esiste.
 */
export function recapitoPrivacy(t: Titolare = titolare()): {
  href: string;
  testo: string;
  eUnaCasella: boolean;
} {
  if (t.emailPrivacyConfigurata) {
    return { href: `mailto:${t.emailPrivacy}`, testo: t.emailPrivacy, eUnaCasella: true };
  }
  return { href: '/contact', testo: 'il modulo dei contatti', eUnaCasella: false };
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
