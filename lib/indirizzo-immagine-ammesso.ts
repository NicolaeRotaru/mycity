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

  // Un percorso di casa nostra (`/placeholder.svg`): la politica di sicurezza lo permette con
  // 'self' e il caricatore lo lascia passare intero.
  if (v.startsWith('/')) return { stato: 'ammesso', host: '', messaggio: null };

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
