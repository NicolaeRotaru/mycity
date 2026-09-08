/**
 * DA QUALI INDIRIZZI IL SITO RIESCE DAVVERO A MOSTRARE UN'IMMAGINE.
 *
 * ── Il difetto che questo file chiude (8/9/2026) ─────────────────────────────────────────────
 * Il campo immagine dell'amministrazione (`components/ImageUrlField.tsx`) invita a incollare un
 * indirizzo qualsiasi: «oppure incolla un URL https://…». Ma il sito le immagini le sa mostrare
 * solo da quattro domini. Un indirizzo fuori elenco veniva accettato in silenzio, salvato, e la
 * copertina restava un buco bianco sulla home e sulla pagina eventi. Nessuno diceva perché.
 *
 * ── Perché non bastava riparare il campo ─────────────────────────────────────────────────────
 * L'elenco dei domini vive in due file di configurazione che l'interfaccia non ha mai letto:
 *   · `next.config.js` → `images.remotePatterns` (l'ottimizzatore di Next risponde 400 fuori elenco)
 *   · `middleware.ts`  → la direttiva `img-src` della politica di sicurezza (il browser blocca)
 * Finché la lista non ha UNA casa che il campo possa interrogare, la malattia torna: basta che
 * qualcuno aggiunga o tolga un dominio in `next.config.js` e il campo ricomincia a mentire.
 *
 * Questa è la casa. Il campo chiede qui, e `tests/unit/l-indirizzo-che-il-sito-non-sa-mostrare-lo-dice-subito.test.ts`
 * lega questa lista a `next.config.js`: il giorno che le due divergono, la prova diventa rossa.
 *
 * ⚠️ Chi tocca questa lista tocchi ANCHE `next.config.js` e `img-src` nel middleware. Un dominio
 * ammesso qui ma non là è di nuovo un buco bianco; ammesso là ma non qui è un avviso bugiardo.
 */

/**
 * I domini da cui il sito sa mostrare un'immagine. Copiati da `images.remotePatterns` di
 * `next.config.js`, che è il vincolo più stretto dei due (la politica di sicurezza ne permette
 * qualcuno in più — le mappe, Stripe, le statistiche — ma quelli non servono a una copertina).
 *
 * Un `*.` iniziale vale per un livello solo, come in Next: `*.supabase.co` prende
 * `abc.supabase.co` ma non `supabase.co` né `a.b.supabase.co`.
 */
export const HOST_IMMAGINI_AMMESSI = [
  '*.supabase.co',
  'placehold.co',
  'api.iconify.design',
  'images.pexels.com',
] as const;

/** Dice se un nome di dominio è fra quelli ammessi, rispettando il `*.` iniziale. */
export function hostImmagineAmmesso(host: string): boolean {
  const pulito = String(host).trim().toLowerCase().replace(/\.$/, '');
  if (!pulito) return false;
  return HOST_IMMAGINI_AMMESSI.some((schema) => {
    if (!schema.startsWith('*.')) return pulito === schema;
    const coda = schema.slice(1); // '.supabase.co'
    if (!pulito.endsWith(coda)) return false;
    const testa = pulito.slice(0, -coda.length);
    // Un livello solo: 'abc' sì, 'a.b' no, '' no (cioè `supabase.co` nudo non passa).
    return testa.length > 0 && !testa.includes('.');
  });
}

export type EsitoIndirizzoImmagine = {
  /**
   * `vuoto`      → non c'è ancora niente da giudicare.
   * `incompleto` → si sta ancora scrivendo: si tace, non si urla addosso a chi digita.
   * `ammesso`    → il sito questa immagine la sa mostrare.
   * `non_ammesso`→ il sito NON la sa mostrare, e il perché va detto adesso.
   */
  stato: 'vuoto' | 'incompleto' | 'ammesso' | 'non_ammesso';
  /** Il dominio riconosciuto, `''` se l'immagine sta in casa nostra (percorso che comincia con `/`). */
  host: string;
  /** Cosa leggerà l'amministratore. `null` quando non c'è niente da dire. */
  messaggio: string | null;
};

const NIENTE_DA_DIRE = (stato: 'vuoto' | 'incompleto'): EsitoIndirizzoImmagine => ({
  stato,
  host: '',
  messaggio: null,
});

/** L'elenco dei domini scritto come lo direbbe una persona, per il messaggio d'errore. */
export function dominiInParole(): string {
  return HOST_IMMAGINI_AMMESSI.map((h) => h.replace(/^\*\./, '')).join(', ');
}

/* ── LA FORMA DELL'INDIRIZZO, PRIMA ANCORA DEL DOMINIO (8/9/2026) ─────────────────────────────
 *
 * Il controllo sul dominio qui sopra serve a poco se l'indirizzo riesce a NON farsi leggere come
 * un indirizzo. Un percorso di casa nostra e un indirizzo che porta il visitatore su un altro
 * sito possono cominciare tutti e due per una barra, e il secondo si traveste da primo.
 *
 * La regola che lo impedisce è UNA SOLA, ed è già scritta per esteso nel vincolo
 * `categories_image_url_format` di
 * `migrations/159_la_foto_della_categoria_si_cambia_senza_ripubblicare_il_sito.sql`, insieme al
 * conto dei travestimenti provati sul database vero. Qui sotto c'è la stessa regola dal lato del
 * sito; `lib/immagine-categoria.ts` la IMPORTA da qui invece di riscriverla, così le regole
 * restano due (database e sito) e non tre.
 *
 * ⚠️ IL DATABASE GUARDA LA FORMA, NON IL DOMINIO — e i due controlli non sono intercambiabili.
 * `https://images.pexels.com@evil.com/x.jpg` non ha nessun carattere strano e passa il vincolo
 * del database senza un fiato, ma per il browser il dominio è `evil.com`: tutto quello che sta
 * dopo la chiocciola è il dominio, tutto quello che sta prima è un nome utente. Quel caso lo
 * deve fermare QUESTO file, con l'elenco dei domini — ed è per questo che il paletto del
 * database non basta e questo non si può togliere.
 */

/**
 * I caratteri che il browser TOGLIE dall'indirizzo prima ancora di leggerlo: tabulazione, a capo,
 * ritorno carrello e gli altri caratteri di controllo.
 *
 * È il travestimento che ha fregato la versione di prima. Per noi `/<TAB>//evil.com/x.jpg`
 * comincia con una barra sola, quindi sembra una foto di casa nostra; il browser toglie la
 * tabulazione, si ritrova `//evil.com/x.jpg` e va su evil.com. Provato l'8/9/2026 con il lettore
 * di indirizzi vero (`new URL`): tabulazione, a capo e ritorno carrello rispondono tutti e tre
 * `host: evil.com`.
 *
 * È lo stesso `[[:cntrl:]]` della migrazione 159, con dentro anche i controlli C1
 * (`\u0080`-`\u009F`): un indirizzo d'immagine vero non ne contiene nessuno, quindi rifiutarli
 * tutti non toglie niente a nessuno e spegne l'intera classe invece dei tre casi già noti.
 */
const CARATTERI_CHE_IL_BROWSER_TOGLIE = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Dice se un indirizzo contiene qualcosa che lo farà leggere al browser in modo diverso da come
 * lo leggiamo noi. Sono due cose, e tutte e due portano allo stesso posto:
 *
 *  · un carattere di controllo (sopra);
 *  · una barra rovescia `\`, che il browser tratta come una barra normale. `/\evil.com/x.jpg`
 *    per lui è `//evil.com/x.jpg`, cioè evil.com; e in
 *    `https://images.pexels.com\@evil.com/x.jpg` la barra rovescia sposta il confine del dominio.
 *
 * La barra rovescia è rifiutata OVUNQUE, non solo all'inizio: nel database il vincolo la vieta
 * subito dopo la barra iniziale e dentro il dominio, qui si va un passo più in là perché un
 * indirizzo d'immagine legittimo non ne contiene mai una (nei percorsi si scrive `%5C`), e fra
 * accettare e rifiutare si sceglie di rifiutare — un permesso sbagliato qui non è un riquadro
 * vuoto: è un cliente che finisce su un sito che non è il nostro.
 */
export function indirizzoTravestito(indirizzo: string): boolean {
  return CARATTERI_CHE_IL_BROWSER_TOGLIE.test(indirizzo) || indirizzo.includes('\\');
}

/**
 * Dice se l'indirizzo è davvero un percorso di casa nostra, di quelli che la politica di
 * sicurezza lascia passare con `'self'` (`/placeholder.svg`, `/immagini/categorie/libri.jpg`).
 *
 * Non basta che cominci per barra: serve che il SECONDO carattere non sia un'altra barra — due
 * barre in testa vogliono dire «stesso schema della pagina, dominio diverso», ed è la forma con
 * cui un indirizzo esterno si traveste da interno — e che dentro non ci sia niente che il
 * browser toglierebbe. Una barra da sola (`/`) non è una foto: è la home, e come immagine
 * sarebbe comunque un riquadro rotto, quindi la stessa regola del database (`^/[^/\\]`) chiede
 * almeno due caratteri.
 */
export function percorsoDelSito(indirizzo: string): boolean {
  if (indirizzoTravestito(indirizzo)) return false;
  return indirizzo.length >= 2 && indirizzo.startsWith('/') && indirizzo[1] !== '/';
}

/** Cosa legge l'amministratore quando l'indirizzo che ha incollato è travestito. */
export const MESSAGGIO_INDIRIZZO_TRAVESTITO =
  'Questo indirizzo non è ammesso: sembra una foto di questo sito ma il browser la andrebbe a prendere su un altro sito. Carica il file dal dispositivo, oppure incolla un indirizzo che comincia con https://.';

/**
 * Giudica l'indirizzo di un'immagine incollato a mano.
 *
 * Il criterio del silenzio è voluto: chi scrive `https://exa` non ha ancora finito, e un campo che
 * protesta a ogni lettera si impara a ignorare. Si tace finché il dominio non ha almeno un punto —
 * cioè finché non è un dominio vero — e da lì in poi si dice la verità.
 */
export function controllaIndirizzoImmagine(valore: string | null | undefined): EsitoIndirizzoImmagine {
  const v = String(valore ?? '').trim();
  if (!v) return NIENTE_DA_DIRE('vuoto');

  // Prima di ogni altra cosa: se l'indirizzo contiene qualcosa che il browser leggerebbe in modo
  // diverso da noi (un carattere di controllo, una barra rovescia), qualunque giudizio dato dopo
  // sarebbe dato sulla stringa sbagliata. Non si tace e non si prova a capire: si dice di no.
  if (indirizzoTravestito(v)) {
    return { stato: 'non_ammesso', host: '', messaggio: MESSAGGIO_INDIRIZZO_TRAVESTITO };
  }

  // Un percorso di casa nostra (`/placeholder.svg`): la politica di sicurezza lo permette con
  // 'self' e il caricatore lo lascia passare intero.
  //
  // ⚠️ Qui prima bastava «comincia per barra», e quel «prima» è il difetto: `//evil.com/x.jpg`
  // comincia per barra e NON è di casa nostra. Due barre in testa vogliono dire «lo schema lo
  // prendo dalla pagina, il dominio è questo»: il browser ci mette davanti `https:` e va su
  // evil.com. La riga di prima lo dichiarava `ammesso`, cioè il campo dell'amministrazione
  // disegnava l'anteprima e non protestava — verificato l'8/9/2026 eseguendo questa funzione.
  if (v.startsWith('/')) {
    if (percorsoDelSito(v)) return { stato: 'ammesso', host: '', messaggio: null };
    return { stato: 'non_ammesso', host: '', messaggio: MESSAGGIO_INDIRIZZO_TRAVESTITO };
  }

  let url: URL;
  try {
    url = new URL(v);
  } catch {
    // Non è ancora un indirizzo (manca lo `https://`, o è mezza parola): si sta scrivendo.
    return NIENTE_DA_DIRE('incompleto');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      stato: 'non_ammesso',
      host: '',
      messaggio: 'Serve un indirizzo che comincia con https://, oppure carica il file dal dispositivo.',
    };
  }

  const host = url.hostname.toLowerCase();
  // Dominio ancora a metà (`https://exa`): non è un errore, è una persona che digita.
  if (!host.includes('.')) return NIENTE_DA_DIRE('incompleto');

  // La chiocciola dentro l'indirizzo sposta il dominio, e in tutte e due i versi è un guaio.
  // `https://images.pexels.com@evil.com/x.jpg` porta su evil.com (e lo ferma già l'elenco dei
  // domini, perché il dominio che leggiamo qui è quello vero); ma
  // `https://evil.com@images.pexels.com/x.jpg` porta davvero su images.pexels.com, passerebbe
  // l'elenco, e a chi lo legge nel pannello sembra un indirizzo di evil.com. Un indirizzo
  // d'immagine non ha mai bisogno di un nome utente: se c'è, si rifiuta e si dice qual è il
  // dominio vero. Questo il vincolo del database non lo vede: là è forma, qui è significato.
  if (url.username !== '' || url.password !== '') {
    return {
      stato: 'non_ammesso',
      host,
      messaggio: `Questo indirizzo non è ammesso: la parte prima della chiocciola (@) non è il sito da cui arriva la foto — il sito vero è ${host}. Togli la chiocciola, oppure carica il file dal dispositivo.`,
    };
  }

  if (url.protocol === 'http:') {
    return {
      stato: 'non_ammesso',
      host,
      messaggio:
        'Questo indirizzo non è ammesso: le immagini devono arrivare da https://, non da http://. Carica il file dal dispositivo.',
    };
  }

  if (!hostImmagineAmmesso(host)) {
    return {
      stato: 'non_ammesso',
      host,
      messaggio: `Questo indirizzo non è ammesso: il sito non riesce a mostrare le immagini di ${host} e resterebbe un riquadro vuoto. Carica il file dal dispositivo, oppure usa un indirizzo di ${dominiInParole()}.`,
    };
  }

  return { stato: 'ammesso', host, messaggio: null };
}

/** Scorciatoia per chi deve solo decidere se disegnare l'anteprima. */
export function immagineMostrabile(valore: string | null | undefined): boolean {
  return controllaIndirizzoImmagine(valore).stato === 'ammesso';
}

/**
 * Quando il dominio e' giusto ma dall'indirizzo non arriva niente lo stesso: file cancellato dallo
 * Storage, percorso sbagliato di una lettera, immagine tolta da chi la ospitava. Il controllo sul
 * dominio non puo' saperlo — lo sa solo il browser, provando — ma il buco bianco che ne esce e'
 * identico, e identico dev'essere il modo in cui il sito lo dice.
 */
export const MESSAGGIO_IMMAGINE_NON_ARRIVATA =
  'Da questo indirizzo non arriva nessuna immagine: controlla che sia giusto, oppure carica il file dal dispositivo.';
