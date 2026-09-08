/**
 * GLI INDIRIZZI EMAIL CHE IL SITO DÀ AI CLIENTI — UNO SOLO, E DERIVATO.
 *
 * 8/9/2026 — IL SITO MANDAVA LA GENTE A SCRIVERE SU UN DOMINIO CHE NON È IL SUO.
 *
 * Cosa c'era: quattordici indirizzi su `@mycity.it` scritti a mano dentro le
 * pagine (info@ nel piè di pagina, in Contatti e in Aiuto; venditori@ nel centro
 * venditori; lavora@ in cinque annunci di lavoro; privacy@ come ripiego del
 * titolare del trattamento) e tre su `@mycity-marketplace.com`, che è il dominio
 * dove il sito vive davvero — con le prime due nella STESSA pagina Contatti, a
 * ottanta righe di distanza.
 *
 * Non sono due modi di scrivere la stessa cosa: sono due caselle di posta
 * diverse, su due fornitori diversi. Il 8/9/2026, da qui:
 *
 *   mycity.it              → mx.zoho.com, mx2.zoho.com, mx3.zoho.com
 *   mycity-marketplace.com → mail.mycity-marketplace.com
 *
 * Chi scrive a `lavora@mycity.it` per candidarsi, o a `privacy@mycity.it` per
 * farsi cancellare i dati (art. 15 e 17 GDPR), finisce in una casella che non è
 * quella del sito — e nessuno di noi lo vede. Il codice stesso lo diceva:
 * `lib/legal/titolare.ts` chiama `privacy@mycity.it` «ripiego», e la FAQ dei
 * fattorini era già stata riscritta il 3/9 proprio perché quell'indirizzo «è su
 * un dominio diverso da quello dove vive il sito».
 *
 * ── PERCHÉ UN FILE E NON DICIOTTO CORREZIONI DI TESTO ────────────────────────
 *
 * Perché correggere i diciotto punti lascia in piedi il modo in cui si sono
 * rotti: ogni pagina teneva la sua copia dell'indirizzo, scritta col dominio del
 * momento, e la pagina scritta domani ne terrà una diciannovesima. Qui
 * l'indirizzo NASCE dal dominio del sito: cambiarlo in un posto solo li sposta
 * tutti, e non esiste più un testo da ricordarsi di aggiornare.
 *
 * ── PERCHÉ mycity-marketplace.com E NON mycity.it ───────────────────────────
 *
 * Non è una preferenza: è l'unico dominio che il codice sa essere nostro.
 * È quello con cui il sito si presenta (`DOMINIO_PUBBLICO` in `lib/env.ts`),
 * quello da cui parte la posta quando `RESEND_FROM` non è impostata, quello che
 * `lib/email/unsubscribe.ts` pretende sotto il link di disiscrizione, quello
 * stampato sull'etichetta di spedizione e quello che la pagina accessibilità
 * dichiara come «il sito». Di `mycity.it` non sappiamo nemmeno se la casella è
 * nostra — la posta sta su Zoho e da qui non si può guardare dentro.
 *
 * Se è nostra e Nicola la vuole usare, non serve toccare il codice: si imposta
 * `NEXT_PUBLIC_CONTATTI_DOMINIO=mycity.it` e i diciotto indirizzi si spostano
 * insieme, comprese le sette caselle dei mailto. È il verso giusto in cui
 * lasciare la decisione: una variabile, non una caccia nelle pagine.
 *
 * 🟢 Puro: nessuna rete, nessun orologio, nessun import. Sta in `lib/` e senza
 * dipendenze apposta — lo leggono anche le pagine che girano nel browser
 * (`Footer`, `contact`, `faq`), e una prova lo ESEGUE con i domini nei due versi.
 */

/**
 * Il dominio con cui MyCity si presenta al mondo. Scritto qui, una volta sola:
 * `lib/env.ts` deriva da questo `DOMINIO_PUBBLICO`, così l'indirizzo del sito e
 * l'indirizzo a cui si scrive non possono più separarsi.
 */
export const DOMINIO_MYCITY = 'mycity-marketplace.com';

/** Le caselle che il sito pubblica. Elenco chiuso: una nuova si aggiunge qui. */
export const CHIAVI_CONTATTO = ['info', 'privacy', 'venditori', 'lavoro', 'accessibilita'] as const;

export type ChiaveContatto = (typeof CHIAVI_CONTATTO)[number];

/** La parte prima della chiocciola, per ogni chiave. */
const CASELLA: Record<ChiaveContatto, string> = {
  info: 'info',
  privacy: 'privacy',
  venditori: 'venditori',
  lavoro: 'lavora',
  accessibilita: 'accessibilita',
};

/**
 * I domini che NON possono ricevere posta, per quanto qualcuno li configuri.
 *
 * Serve perché il dominio del sito, in certi ambienti, è `localhost:3000` o un
 * indirizzo di anteprima `qualcosa.vercel.app`: derivare gli indirizzi da lì
 * pubblicherebbe `info@localhost` su una pagina vera. Un ripiego che nasce da
 * un ambiente sbagliato è lo stesso difetto di prima, con un altro nome.
 */
const NON_RICEVONO_POSTA: readonly string[] = [
  'localhost',
  'example.com',
  'example.org',
  'example.net',
];
const SUFFISSI_CHE_NON_RICEVONO: readonly string[] = [
  '.vercel.app',
  '.local',
  '.localhost',
  '.test',
  '.invalid',
  '.example',
];

/**
 * Riduce a un dominio pulito quello che gli si passa — `https://`, `mailto:`,
 * un indirizzo intero, una porta, una barra finale — oppure `null` se quello
 * che resta non è un dominio a cui si può scrivere.
 */
export function ripulisciDominio(valore: string | undefined | null): string | null {
  if (typeof valore !== 'string') return null;
  const nudo = valore
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^[^@\s]*@/, '') // "info@dominio" → "dominio"
    .replace(/[/?#].*$/, '') // percorso, query, ancora
    .replace(/:\d+$/, '') // porta
    .replace(/\.+$/, ''); // punto finale del DNS assoluto
  if (nudo.length === 0) return null;
  // Un nome di dominio vero: etichette alfanumeriche separate da punti, almeno
  // due, e un suffisso di sole lettere.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(nudo)) {
    return null;
  }
  if (NON_RICEVONO_POSTA.includes(nudo)) return null;
  if (SUFFISSI_CHE_NON_RICEVONO.some((s) => nudo.endsWith(s))) return null;
  return nudo;
}

/**
 * Il dominio su cui vivono gli indirizzi che il sito pubblica.
 *
 * `NEXT_PUBLIC_CONTATTI_DOMINIO` è la maniglia di Nicola: se la casella di
 * `mycity.it` è sua, la sposta lì senza aprire il codice. Se quella variabile è
 * scritta male — o punta a un ambiente che non riceve posta — si torna al
 * dominio del sito invece di pubblicare un indirizzo che non esiste.
 */
export function dominioDeiContatti(
  dichiarato: string | undefined = process.env.NEXT_PUBLIC_CONTATTI_DOMINIO,
): string {
  return ripulisciDominio(dichiarato) ?? DOMINIO_MYCITY;
}

/** L'indirizzo di una casella: `info@mycity-marketplace.com`. */
export function indirizzoContatto(
  chiave: ChiaveContatto,
  dominio: string = dominioDeiContatti(),
): string {
  return `${CASELLA[chiave]}@${dominio}`;
}

/** Tutte le caselle in un colpo solo, per chi ne stampa più d'una. */
export function contattiPubblici(
  dominio: string = dominioDeiContatti(),
): Record<ChiaveContatto, string> {
  const fuori = {} as Record<ChiaveContatto, string>;
  for (const chiave of CHIAVI_CONTATTO) fuori[chiave] = indirizzoContatto(chiave, dominio);
  return fuori;
}

/**
 * Il collegamento `mailto:`, con l'oggetto già scritto e codificato.
 *
 * L'oggetto passa da `encodeURIComponent` perché prima era codificato a mano
 * («Candidatura%20Account%20negozi»): una candidatura nuova con un accento nel
 * titolo avrebbe prodotto un collegamento rotto, e non se ne sarebbe accorto
 * nessuno finché qualcuno non ci cliccava sopra.
 */
export function mailtoContatto(
  chiave: ChiaveContatto,
  oggetto?: string,
  dominio: string = dominioDeiContatti(),
): string {
  const base = `mailto:${indirizzoContatto(chiave, dominio)}`;
  return oggetto ? `${base}?subject=${encodeURIComponent(oggetto)}` : base;
}

/**
 * Il dominio da cui parte davvero la posta, estratto dal mittente di Resend
 * (`RESEND_FROM`), che può avere la forma «MyCity <no-reply@dominio>».
 */
export function dominioDelMittente(mittente: string | undefined | null): string | null {
  if (typeof mittente !== 'string') return null;
  const dentroParentesi = mittente.match(/<([^>]+)>/);
  return ripulisciDominio(dentroParentesi ? dentroParentesi[1] : mittente);
}

/**
 * IL SENSORE — il mittente delle email sta sullo stesso dominio degli indirizzi
 * che il sito pubblica?
 *
 * Perché è un allarme e non un commento: qui sopra si può mettere ordine nel
 * codice, ma il dominio da cui la posta parte davvero lo decide una variabile
 * su Vercel, che il codice non controlla. Se qualcuno imposta `RESEND_FROM` su
 * un dominio diverso da quello che le pagine pubblicano, la conferma d'ordine
 * arriva da un mittente che il cliente non ha mai visto — e i filtri antispam
 * puniscono esattamente questo: un dominio che non c'entra con il sito e a cui
 * il destinatario non può rispondere. Non si vede in nessun log: la email parte,
 * risulta consegnata, e finisce in posta indesiderata.
 *
 * Restituisce `null` quando va tutto bene, o quando il mittente non è impostato
 * affatto — quel caso lo dicono già `lib/email/client.ts` (si ferma prima di
 * spedire) e `/api/health` (semaforo degradato), e ripeterlo qui sarebbe un
 * secondo allarme per lo stesso guasto.
 */
export function mittenteFuoriDominio(
  mittente: string | undefined | null,
  dominio: string = dominioDeiContatti(),
): { mittente: string; atteso: string; riga: string } | null {
  const host = dominioDelMittente(mittente);
  if (host === null) return null;
  if (host === dominio) return null;
  return {
    mittente: host,
    atteso: dominio,
    riga:
      `Le email partono da un indirizzo su ${host}, ma il sito pubblica i suoi contatti su ${dominio}. ` +
      `Chi le riceve vede un mittente che non c'entra con MyCity, e i filtri antispam lo trattano come tale. ` +
      `Si sistema impostando RESEND_FROM su ${dominio} (oppure NEXT_PUBLIC_CONTATTI_DOMINIO su ${host}, se è quello il dominio giusto).`,
  };
}
