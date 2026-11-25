import { ABBONAMENTI, FASCE, FOTO_LOCALE_CONSIGLIATE, PRODOTTI_PER_IL_PREMIUM, type Abbonamento, type DatiAttivita, type ServizioAgenzia } from './preventivo';
import { datoDi, prodottiTipici, senzaPrezzo, sitoUfficialeDi, vociSenzaPrezzo, type SchedaCliente } from './scheda-cliente';
import { LIVELLO_SOCIAL_IN_PAROLE, livelloSocial, votoDi, type AnalisiAziendale, type AnalisiCanali, type RisultatoSito } from './analisi';
import type { TipoAttivita } from './tipi-attivita';

/**
 * L'OFFERTA SU MISURA — dentro il preventivo, 24/11/2026.
 *
 * Nicola: «sulla base dei dati che hai recuperato sul cliente devi trovare esattamente tutte le cose
 * che possiamo offrirgli con i nostri servizi… dentro il preventivo deve esserci un'offerta
 * personalizzata per il cliente, siccome hai già tanti dati su di lui».
 *
 * Il preventivo diceva cosa manca in generale; questa è la lista delle cose precise che faremo per
 * QUEL negozio, ognuna col suo perché vero e con l'abbonamento da cui è compresa. Le fonti sono tutte
 * quelle che il sito ha già:
 *  · la vetrina MyCity: prodotti e loro foto, copertina, video, canali scritti dal titolare;
 *  · la scheda del locale di n8n (flusso 16): indirizzo, orari, prenotazioni, prodotti tipici, punti di
 *    forza, idee, domande per il titolare;
 *  · l'analisi dei canali di n8n: post al mese, recensioni, osservazioni sulla scheda Google;
 *  · l'analisi del sito (Google PageSpeed): velocità, Google, cose da sistemare.
 *
 * REGOLE.
 *  · Solo frasi vere: ogni proposta nasce da un dato letto, e lo cita. Senza il dato, niente proposta.
 *  · Nessun prezzo per proposta: si vende l'abbonamento (Nicola, 24/11). La proposta dice da quale
 *    fascia è compresa, secondo `FASCE` (per esempio il video non è nel Base, le risposte alle
 *    recensioni partono dal Business).
 *  · Il titolare non deve fare niente: le proposte dicono cosa facciamo NOI.
 *  · Dove la pagina non è del negozio (il link col codice) il chiamante passa la scheda coi soli dati
 *    confermati e nessuna analisi: l'offerta si fa con quello che resta.
 * Qui solo regole, senza rete: si prova con i dati in mano.
 */

export type Proposta = {
  /** Una chiave stabile, per React e per le prove. */
  id: string;
  servizio: ServizioAgenzia;
  /** Cosa facciamo, detto al titolare: «Fotografiamo i tuoi 12 prodotti senza foto». */
  cosa: string;
  /** Perché, col dato vero: «Su 30 prodotti in catalogo, 12 non hanno nessuna foto». */
  perche: string;
  /** Da dove viene il dato, in parole: «la tua vetrina», «Google PageSpeed»… */
  fonte: string;
  /** La fascia più leggera che la comprende. */
  daFascia: Abbonamento;
  /**
   * Come cambia la stessa cosa salendo di fascia (Nicola, 24/11 sera: «il servizio deve essere anche in
   * base all'abbonamento»). Le quantità sono solo quelle di `FASCE`; dove una fascia non c'è vale il testo
   * della fascia sotto, o `cosa`.
   */
  perFascia?: Partial<Record<Abbonamento, string>>;
  /**
   * 25/11/2026 — Vera se la proposta non nasce da un dato letto sul locale ma si fa a tutti (l'analisi).
   * Il preventivo corto la lascia fuori (Nicola, 18:30: «lo stretto necessario che gli interessa»).
   */
  generica?: true;
  /**
   * 25/11/2026 — La proposta che sposta l'abbonamento consigliato (Nicola, «ok sito»): il sito rifatto solo
   * da una fascia in su, le opportunità dell'analisi da seguire ogni mese. `perche` continua «Consigliamo X: …».
   */
  consiglia?: { fascia: Abbonamento; perche: string };
};

export type OffertaSuMisura = {
  proposte: Proposta[];
  /** Quante proposte comprende ogni fascia. */
  perFascia: Record<Abbonamento, number>;
  /** La fascia più leggera che le comprende tutte; `null` se non ci sono proposte. */
  tuttoCon: Abbonamento | null;
  /** Le domande da fare al titolare al primo incontro (dalla scheda di n8n). */
  domande: string[];
};

export type DatiPerLOfferta = {
  nome: string;
  tipo: TipoAttivita;
  dati: DatiAttivita;
  scheda?: SchedaCliente | null;
  canali?: AnalisiCanali | null;
  sito?: RisultatoSito | null;
  /** 25/11/2026 — Com'è il sito che ha già, a occhio: lo scrive l'AD nella scheda (Google non misura la bellezza). */
  giudizioSito?: GiudizioSito | null;
  /** 25/11/2026 — L'analisi del business: le opportunità e le prime mosse che un servizio copre diventano proposte. */
  analisiAziendale?: AnalisiAziendale | null;
  /**
   * 25/11/2026 sera — Un sito che conosciamo ma che il titolare non ci ha scritto (misurato da Google, o trovato dal
   * flusso 16 e confermato o con la scheda aperta). Conta come sito, ma non come «canale che ci hai dato».
   */
  sitoTrovato?: boolean;
};

/**
 * IL GIUDIZIO DELL'AD SUL SITO — 25/11/2026.
 *
 * Nicola: «in base alla complessità/bellezza del sito deve già esporre in base all'abbonamento quale valore
 * aggiunto può apportare». PageSpeed misura velocità, Google e facilità d'uso, non la bellezza: quella la
 * guarda l'AD quando scrive la scheda (sua scelta, stesso giorno), in `analisi.giudizio_sito`.
 */
export const ASPETTI_SITO = ['curato', 'datato', 'fai-da-te'] as const;
export const PAGINE_SITO = ['una', 'poche', 'molte'] as const;
/**
 * IL CONTRATTO DEL GIUDIZIO DEL SITO — 25/11/2026 (Nicola, «ok sito»: il sito si offre solo dove vale di più).
 * Lo scrive l'AD nel flusso 16, nella domanda a «Chiedi all'AD», in `scheda.analisi.giudizio_sito`:
 *  · `livello`: «semplice» (una o due pagine, fatto in casa o datato), «medio» (più pagine, curato, senza
 *    funzioni particolari), «pregio» (tante pagine o funzioni, fatto da professionisti). Manca = «medio».
 *  · `funzioni`: quello che il sito sa fare già, solo da `FUNZIONI_SITO`; le altre voci si scartano.
 *  · `migliorie`: per il «pregio», cosa miglioriamo noi rifacendolo nel Premium, in una frase (10-240
 *    caratteri, senza prezzi né telefoni). Senza, un sito di pregio non si rifà mai.
 *  · `aspetto`, `pagine`, `nota`: come prima.
 */
export const LIVELLI_SITO = ['semplice', 'medio', 'pregio'] as const;
export const FUNZIONI_SITO = ['prenotazioni', 'negozio_online', 'piu_lingue', 'blog', 'menu', 'galleria', 'modulo_contatti', 'area_clienti'] as const;
export type LivelloSito = (typeof LIVELLI_SITO)[number];
export type GiudizioSito = {
  aspetto: (typeof ASPETTI_SITO)[number] | null;
  pagine: (typeof PAGINE_SITO)[number] | null;
  nota: string | null;
  livello?: LivelloSito | null;
  funzioni?: (typeof FUNZIONI_SITO)[number][];
  migliorie?: string | null;
};

/** Il giudizio letto dalla scheda, ripulito: valori fuori elenco diventano «non detto», mai un errore. */
export function leggiGiudizioSito(grezzo: unknown): GiudizioSito | null {
  if (!grezzo || typeof grezzo !== 'object') return null;
  const g = grezzo as Record<string, unknown>;
  const aspetto = (ASPETTI_SITO as readonly unknown[]).includes(g.aspetto) ? (g.aspetto as GiudizioSito['aspetto']) : null;
  const pagine = (PAGINE_SITO as readonly unknown[]).includes(g.pagine) ? (g.pagine as GiudizioSito['pagine']) : null;
  const notaGrezza = typeof g.nota === 'string' ? g.nota.replace(/\s+/g, ' ').trim() : '';
  const nota = notaGrezza.length >= 3 && notaGrezza.length <= 200 && senzaPrezzo(notaGrezza) ? notaGrezza : null;
  const livello = (LIVELLI_SITO as readonly unknown[]).includes(g.livello) ? (g.livello as LivelloSito) : null;
  const funzioni = Array.isArray(g.funzioni)
    ? [...new Set(g.funzioni.filter((f): f is (typeof FUNZIONI_SITO)[number] => (FUNZIONI_SITO as readonly unknown[]).includes(f)))]
    : [];
  const miglGrezze = typeof g.migliorie === 'string' ? g.migliorie.replace(/\s+/g, ' ').trim() : '';
  const migliorie = miglGrezze.length >= 10 && miglGrezze.length <= 240 && citabile(miglGrezze) ? miglGrezze : null;
  return aspetto || pagine || nota || livello || funzioni.length || migliorie ? { aspetto, pagine, nota, livello, funzioni, migliorie } : null;
}

/** Il livello del sito: quello dell'AD, o «medio» se non l'ha guardato (mai rifare dal Base un sito non visto). */
export const livelloDelSito = (g: GiudizioSito | null | undefined): LivelloSito => g?.livello ?? 'medio';

/**
 * Da quale fascia rifacciamo il sito che ha già, secondo la tabella di Nicola; `null` = non si rifà.
 * La tabella NON dipende dai voti di Google (25/11/2026 sera, dal collaudo): Google aggiunge solo il perché.
 */
function rifattoDa(g: GiudizioSito | null | undefined): Abbonamento | null {
  const livello = livelloDelSito(g);
  if (livello === 'semplice') return 'base';
  if (livello === 'medio') return 'business';
  return g?.migliorie ? 'premium' : null;
}

/** C'è qualcosa da rifare nel sito di oggi: Google lo trova lento o male, o l'AD lo trova datato o fatto in casa. */
function difettiDelSito(sito: RisultatoSito | null | undefined, g: GiudizioSito | null | undefined) {
  const lento = !!sito && sito.velocita !== null && votoDi(sito.velocita) !== 'bene';
  const googleMale = !!sito && sito.seo !== null && votoDi(sito.seo) !== 'bene';
  const daSistemare = sito ? vociCitabili(sito.daSistemare, 2, 300) : [];
  const aspettoDebole = g?.aspetto === 'datato' || g?.aspetto === 'fai-da-te';
  // Google «segnala» solo se qualcosa per farsi trovare non va, o ci sono cose da sistemare: la velocità ha la sua frase.
  return { lento, googleMale, daSistemare, aspettoDebole, googleSegnala: googleMale || daSistemare.length > 0 };
}

/**
 * Almeno un abbonamento rifà il sito che ha già: allora la bozza del sito va anche a lui (Nicola, «ok sito»).
 * Si chiede solo per chi un sito ce l'ha (vetrina, modulo 12, misura di Google o `campi.sito_ufficiale`).
 * Senza giudizio vale «medio», che il Business rifà: la bozza serve. Solo il pregio senza migliorie non la vuole.
 */
export function sitoDaRifareInQualcheFascia(g: GiudizioSito | null | undefined): boolean {
  return rifattoDa(g) !== null;
}

const FONTE = {
  vetrina: 'la tua vetrina su MyCity',
  scheda: 'le fonti pubbliche del tuo locale',
  sito: 'Google PageSpeed Insights',
  instagram: 'il tuo profilo Instagram',
  facebook: 'la tua pagina Facebook',
  google: 'la tua scheda Google Maps',
  tiktok: 'il tuo profilo TikTok',
} as const;
const FONTE_SOCIAL = { instagram: FONTE.instagram, facebook: FONTE.facebook, tiktok: FONTE.tiktok } as const;

/** I post al mese di ogni fascia, letti dal testo del listino (`FASCE`): se cambia lì, cambia qui. */
// Calcolato quando serve, non quando il file si carica: preventivo.ts e questo file si importano a
// vicenda, e a caricamento `FASCE` può non esserci ancora.
export const postAlMese = (f: Abbonamento): number => Number(/(\d+) post al mese/.exec(FASCE[f].servizi.social)?.[1] ?? 0);
/** I video brevi al mese di ogni fascia, letti allo stesso modo (il Base non ne ha). */
export const videoAlMese = (f: Abbonamento): number => Number(/(\d+) video brevi/.exec(FASCE[f].servizi.social)?.[1] ?? 0);
const NOMI_SOCIAL = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' } as const;

/** Un numero di telefono in un testo libero (n8n può averlo trovato in rete): può essere del titolare. */
const TELEFONO = /\+?\(?\d[\d\s./()-]{7,}\d|[\w.+-]+@[\w-]+\.[\w.]+/;
const ORARIO = /\b\d{1,2}[.:]\d{2}\b/g;
/** Una frase libera si cita solo senza prezzi e senza telefoni. */
const citabile = (t: string) => senzaPrezzo(t) && !TELEFONO.test(t);
const vociCitabili = (v: readonly string[] | undefined, quante: number, max = 140) => vociSenzaPrezzo(v, quante, max).filter((x) => !TELEFONO.test(x));
/** Gli orari hanno cifre per forza («7.30–19.30»): si guardano senza gli orari, poi come una frase. */
const orariCitabili = (t: string) => citabile(t.replace(ORARIO, ' '));

const ORDINE: Record<Abbonamento, number> = { base: 0, business: 1, premium: 2 };

const contaMedia = (media: unknown, tipo: 'image' | 'video') =>
  Array.isArray(media)
    ? media.filter((m) => m && typeof m === 'object' && (m as { type?: unknown }).type === tipo && typeof (m as { url?: unknown }).url === 'string' && ((m as { url: string }).url).trim()).length
    : 0;
const haFoto = (images: unknown) => Array.isArray(images) && images.some((i) => typeof i === 'string' && i.trim().length > 0);
const pieno = (o: unknown, k: string) => {
  const v = o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined;
  return typeof v === 'string' && v.trim().length > 0;
};
const elenco = (v: string[]) => (v.length <= 1 ? v.join('') : `${v.slice(0, -1).join(', ')} e ${v[v.length - 1]}`);
const it = (n: number) => n.toLocaleString('it-IT');
const dominioDi = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const minuscola = (t: string) => `${t.charAt(0).toLowerCase()}${t.slice(1)}`;

/** Il video di presentazione, detto per tipo di attività: quello che un cliente vuole vedere. */
const VIDEO_PER_TIPO: Record<TipoAttivita, string> = {
  negozio: 'un video della bottega e dei prodotti più scelti',
  bar: 'un video del bancone e delle colazioni, dal primo caffè',
  ristorante: 'un video della cucina e dei piatti che escono',
  artigiano: 'un video del laboratorio, con le mani al lavoro',
  servizi: 'un video dello studio e di come lavorate',
  altro: 'un video del locale e di chi ci lavora',
};

export function offertaSuMisura(d: DatiPerLOfferta): OffertaSuMisura {
  const p: Proposta[] = [];
  const aggiungi = (x: Proposta) => p.push(x);
  const { dati, scheda, canali, sito, tipo, giudizioSito } = d;

  /* ─────────── FOTO E VIDEO ─────────── */
  const prodotti = dati.prodotti.length;
  const senzaFoto = dati.prodotti.filter((x) => !haFoto(x.images)).length;
  if (senzaFoto > 0) {
    aggiungi({
      id: 'foto-prodotti',
      servizio: 'foto_video',
      cosa: senzaFoto === 1 ? 'Fotografiamo il prodotto che non ha ancora una foto' : `Fotografiamo i tuoi ${it(senzaFoto)} prodotti senza foto`,
      perFascia: {
        // Il Base dice «copertina e prodotti principali» (FASCE): non tutti, se sono tanti.
        base: senzaFoto <= 1 ? 'Fotografiamo il prodotto senza foto, nella sessione di foto all’avvio' : `Fotografiamo i prodotti principali fra i ${it(senzaFoto)} senza foto, nella sessione di foto all’avvio`,
        business: `${senzaFoto === 1 ? 'Fotografiamo il prodotto senza foto' : `Fotografiamo i tuoi ${it(senzaFoto)} prodotti senza foto`} all’avvio, e ogni tre mesi anche quelli nuovi`,
        premium: `${senzaFoto === 1 ? 'Fotografiamo il prodotto senza foto' : `Fotografiamo i tuoi ${it(senzaFoto)} prodotti senza foto`} all’avvio, e ogni mese quelli nuovi`,
      },
      perche: `Su ${it(prodotti)} ${prodotti === 1 ? 'prodotto' : 'prodotti'} in catalogo, ${it(senzaFoto)} ${senzaFoto === 1 ? 'non ha' : 'non hanno'} nessuna foto: chi li vede non sa cosa compra.`,
      fonte: FONTE.vetrina,
      daFascia: 'base',
    });
  }
  const fotoLocale = contaMedia(dati.storeMedia, 'image');
  if (fotoLocale < FOTO_LOCALE_CONSIGLIATE) {
    aggiungi({
      id: 'foto-copertina',
      servizio: 'foto_video',
      cosa: `Scattiamo le foto della copertina: il locale, l’ingresso${tipo === 'bar' || tipo === 'ristorante' ? ', il bancone' : ''} e chi ci lavora`,
      perche: fotoLocale === 0 ? 'La copertina della tua vetrina non ha nessuna foto del locale.' : `La copertina ha ${fotoLocale} foto del locale: ne servono almeno ${FOTO_LOCALE_CONSIGLIATE} perché scorra.`,
      fonte: FONTE.vetrina,
      daFascia: 'base',
    });
  }
  if (contaMedia(dati.storeMedia, 'video') === 0) {
    aggiungi({
      id: 'video-presentazione',
      servizio: 'foto_video',
      cosa: `Giriamo ${VIDEO_PER_TIPO[tipo]}, per la vetrina e i social`,
      perFascia: {
        business: `Giriamo ${VIDEO_PER_TIPO[tipo]}, e poi un video nuovo ogni mese`,
        premium: `Giriamo ${VIDEO_PER_TIPO[tipo]}, e poi foto e video nuovi ogni mese`,
      },
      perche: 'Nella tua vetrina non c’è nessun video: oggi è il formato che si guarda di più.',
      fonte: FONTE.vetrina,
      // Il Base ha solo le foto all'avvio; il video al mese parte dal Business (FASCE).
      daFascia: 'business',
    });
  }
  if (prodotti >= PRODOTTI_PER_IL_PREMIUM) {
    aggiungi({
      id: 'foto-ogni-mese',
      servizio: 'foto_video',
      cosa: 'Una sessione di foto e video ogni mese, per tenere in ordine tutto il catalogo',
      perche: `Hai ${it(prodotti)} prodotti: con tante schede, una foto nuova ogni tanto non basta.`,
      fonte: FONTE.vetrina,
      daFascia: 'premium',
    });
  }

  /* ─────────── SITO WEB ─────────── */
  // 25/11/2026 sera — Un sito noto conta come sito, anche senza la misura di Google: scritto nella vetrina (o dal
  // modulo 12, che lo scrive lì), misurato da Google, o trovato dal flusso 16 (`campi.sito_ufficiale`). Mai «non hai un sito».
  const haSito = pieno(dati.socials, 'website') || !!sito || !!sitoUfficialeDi(scheda) || d.sitoTrovato === true;
  const indirizzo = datoDi(scheda, 'indirizzo');
  const orariGrezzi = datoDi(scheda, 'orari');
  const orari = orariGrezzi && orariCitabili(orariGrezzi.valore) ? orariGrezzi : null;
  const prenota = datoDi(scheda, 'link_prenotazione');
  const tipici = prodottiTipici(scheda, 5);
  if (!haSito) {
    const conDentro = [indirizzo ? 'l’indirizzo' : null, orari ? 'gli orari' : null, tipici.length ? 'i tuoi prodotti tipici' : null].filter(Boolean) as string[];
    aggiungi({
      id: 'sito-nuovo',
      servizio: 'sito_web',
      cosa: `Il tuo sito col tuo nome, collegato alla vetrina${conDentro.length ? `, con dentro ${elenco(conDentro)}` : ''}`,
      perFascia: {
        base: `Un sito di una pagina col tuo nome, collegato alla vetrina${conDentro.length ? `, con dentro ${elenco(conDentro)}` : ''}`,
        business: `Un sito completo di più pagine col tuo nome, collegato alla vetrina${conDentro.length ? `, con dentro ${elenco(conDentro)}` : ''}`,
        premium: `Un sito completo col tuo nome${conDentro.length ? `, con dentro ${elenco(conDentro)}` : ''}, aggiornato da noi ogni mese`,
      },
      perche: conDentro.length
        ? `Non hai un sito tuo, e i dati per farlo li abbiamo già trovati: li confermi tu prima che vada online.`
        : 'Non hai ancora un sito tutto tuo, con il tuo nome.',
      fonte: conDentro.length ? FONTE.scheda : FONTE.vetrina,
      daFascia: 'base',
    });
    if (tipici.length >= 3 || prodotti >= 10) {
      aggiungi({
        id: 'sito-piu-pagine',
        servizio: 'sito_web',
        cosa: tipici.length >= 3
          ? `Una pagina per quello che offri: ${elenco(tipici.slice(0, 3))} e il resto del menu`
          : `Una pagina per il catalogo, coi tuoi ${it(prodotti)} prodotti presi dalla vetrina`,
        perche: 'Hai abbastanza da raccontare per un sito di più pagine, non solo una.',
        fonte: tipici.length >= 3 ? FONTE.scheda : FONTE.vetrina,
        daFascia: 'business',
      });
    }
  }
  if (prenota && tipo !== 'negozio') {
    aggiungi({
      id: 'sito-prenota',
      servizio: 'sito_web',
      cosa: 'Il pulsante «Prenota» sul sito, collegato al sistema che usi già',
      perche: 'Abbiamo trovato il tuo link per le prenotazioni: lo mettiamo in vista, a un tocco.',
      fonte: FONTE.scheda,
      daFascia: 'base',
    });
  }
  // Il sito che ha già (25/11/2026: Google PageSpeed lo misura, l'AD dice com'è e quanto vale).
  // La tabella di Nicola («ok sito», 25/11): semplice → rifatto dal Base; medio → tenuto e collegato nel Base,
  // rifatto dal Business; pregio → tenuto nel Base e nel Business, rifatto solo nel Premium e solo con le
  // migliorie scritte dall'AD. Senza giudizio vale «medio». La tabella non guarda Google: Google dà solo il perché,
  // e le frasi dicono il vero sia a occhio sia per Google (mai «fatto bene» accanto a un voto basso).
  if (haSito) {
    const { lento, googleMale, daSistemare, aspettoDebole, googleSegnala } = difettiDelSito(sito, giudizioSito);
    const livello = livelloDelSito(giudizioSito);
    const giudicato = !!giudizioSito?.livello;
    // A occhio: l'aspetto se l'AD l'ha detto, se no il livello che ha scritto. Mai le due insieme (si contraddirebbero).
    const aOcchio = giudizioSito?.aspetto === 'datato'
      ? 'A vederlo, il sito sembra datato.'
      : giudizioSito?.aspetto === 'fai-da-te'
        ? 'A vederlo, il sito sembra fatto in casa.'
        : giudizioSito?.aspetto === 'curato'
          ? 'A vederlo, il sito è curato.'
          : giudicato
            ? { semplice: 'A vederlo, il sito è semplice.', medio: 'A vederlo, il sito è ordinato, ma senza funzioni particolari.', pregio: 'A vederlo, il sito è di pregio.' }[livello]
            : null;
    const voti = sito ? [
      sito.velocita !== null ? `${sito.velocita} su 100 per la velocità dal telefono` : null,
      sito.seo !== null ? `${sito.seo} su 100 per farsi trovare su Google` : null,
      sito.accessibilita !== null ? `${sito.accessibilita} su 100 per la facilità d’uso` : null,
    ].filter(Boolean) as string[] : [];
    // Anche la facilità d'uso: il preventivo la mostra nella riga del sito, quindi conta per «fatto bene» (dal collaudo).
    const difficile = !!sito && sito.accessibilita !== null && votoDi(sito.accessibilita) !== 'bene';
    // Per Google, detto com'è: i voti bassi uno per uno; se sono tutti buoni, che sono buoni.
    const perGoogle = [
      lento ? `Oggi Google gli dà ${sito!.velocita} su 100 per la velocità dal telefono${sito!.secondiPerVedere !== null ? `: la parte principale si vede dopo ${sito!.secondiPerVedere.toLocaleString('it-IT')} secondi` : ''}.` : null,
      googleMale ? `Per farsi trovare su Google gli dà ${sito!.seo} su 100.` : null,
      difficile ? `Per la facilità d’uso gli dà ${sito!.accessibilita} su 100.` : null,
      !lento && !googleMale && !difficile && voti.length ? `Per Google va già bene: gli dà ${elenco(voti)}.` : null,
      ...daSistemare,
    ].filter(Boolean) as string[];
    const nota = giudizioSito?.nota ? `${giudizioSito.nota.replace(/[.!?]?$/, '.')}` : null;
    const molte = giudizioSito?.pagine === 'molte';
    const da = rifattoDa(giudizioSito);
    const fonte = (lento || googleMale || daSistemare.length) ? FONTE.sito : giudizioSito ? FONTE.scheda : sito ? FONTE.sito : pieno(dati.socials, 'website') ? FONTE.vetrina : FONTE.scheda;
    // Tenuto e collegato: le stesse frasi di sempre, fascia per fascia.
    const tenuto: Record<Abbonamento, string> = {
      base: 'Colleghiamo il tuo sito alla vetrina MyCity: il pulsante «Ordina» porta i clienti ai tuoi prodotti',
      business: 'Colleghiamo il tuo sito alla vetrina, e ogni mese ci aggiungiamo una pagina nuova e i testi che Google legge',
      premium: 'Colleghiamo il tuo sito alla vetrina e lo curiamo noi ogni mese: foto nuove, le novità del momento e i voti di Google sotto controllo',
    };
    if (da) {
      const veloce = lento ? ', veloce dal telefono' : '';
      // «Senza le cose che Google segnala» solo se Google segnala davvero qualcosa (dal collaudo).
      const pulito = googleSegnala ? ', senza le cose che Google segnala' : '';
      const migliorie = livello === 'pregio' && giudizioSito?.migliorie ? `: ${minuscola(giudizioSito.migliorie.replace(/[.!?]$/, ''))}` : '';
      const rifatto: Record<Abbonamento, string> = {
        base: molte
          ? `Rifacciamo la pagina principale del tuo sito${veloce}, col tuo nome e il pulsante per ordinare dalla vetrina`
          : `Rifacciamo il tuo sito in una pagina col tuo nome${veloce}${pulito}`,
        business: `Rifacciamo il tuo sito completo, di più pagine${veloce}${pulito}`,
        premium: livello === 'pregio'
          ? `Rifacciamo il tuo sito${veloce}${migliorie}`
          : `Rifacciamo il tuo sito completo${veloce}, e lo aggiorniamo noi ogni mese`,
      };
      const perFascia = Object.fromEntries(ABBONAMENTI.map((f) => [f, ORDINE[f] >= ORDINE[da] ? rifatto[f] : tenuto[f]])) as Record<Abbonamento, string>;
      // A occhio prima di Google: per un sito «semplice» il motivo vero del rifacimento è quello (dal collaudo).
      const ragioni = [aOcchio, ...perGoogle, nota].filter(Boolean) as string[];
      aggiungi({
        id: 'sito-rifatto',
        servizio: 'sito_web',
        cosa: rifatto[da],
        perFascia,
        perche: [
          ...(ragioni.length ? ragioni : ['Il tuo sito c’è.']),
          da !== 'base' ? `Col ${FASCE[da].nome} lo rifacciamo per intero; sotto lo teniamo e lo colleghiamo alla vetrina.` : null,
        ].filter(Boolean).join(' '),
        fonte,
        daFascia: 'base',
        consiglia: da === 'base' ? undefined : { fascia: da, perche: `il tuo sito lo rifacciamo dal ${FASCE[da].nome}, che lo fa per intero` },
      });
    } else {
      // Solo il pregio senza migliorie: non si rifà. «Fatto bene» solo se lo è anche per Google e a vederlo.
      const bene = !lento && !googleMale && !difficile && !googleSegnala && !aspettoDebole;
      aggiungi({
        id: 'sito-valorizzato',
        servizio: 'sito_web',
        cosa: 'Teniamo il tuo sito com’è e lo facciamo lavorare per te',
        perFascia: tenuto,
        perche: [
          aOcchio,
          bene && voti.length ? `Il tuo sito è fatto bene: Google gli dà ${elenco(voti)}.` : null,
          bene ? null : perGoogle.join(' ') || null,
          nota,
          'Non lo rifacciamo: lo colleghiamo alla vetrina e lo facciamo crescere.',
        ].filter(Boolean).join(' '),
        fonte,
        daFascia: 'base',
      });
    }
  }

  /* ─────────── SOCIAL E GOOGLE MAPS ─────────── */
  // I social come il sito (Nicola, `agenzia.social-come-il-sito`, 25/11/2026), per ogni canale letto:
  //  · debole → la gestione dal Base;
  //  · attivo → nel Base si tiene e si collega, la gestione dalla prima fascia che fa più post o video di oggi;
  //  · forte → nel Base e nel Business si tiene e si collega, la gestione solo nel Premium e solo con le migliorie dell'AD.
  // Senza l'analisi del canale nessuna frase su quel canale: resta la parte generale del servizio.
  const extra: Record<Abbonamento, string> = { base: ', preparati e pubblicati da noi', business: ' (3 a settimana), con 2 video brevi', premium: ', con 4 video brevi e le storie' };
  // Da quale fascia parte la gestione di ogni profilo: le idee dei post e i video brevi partono dalla prima (dal collaudo:
  // con un canale attivo o forte il Base non deve promettere i post, che lì si tiene e si collega e basta).
  const gestioneDi: Array<Abbonamento | null> = [];
  for (const k of ['instagram', 'facebook', 'tiktok'] as const) {
    const c = canali?.canali[k];
    const livello = livelloSocial(c);
    // Un profilo scritto ma non letto (o privato): nessuna frase sul canale, la gestione resta quella generale (dal Base).
    if (!c || !livello || livello === 'nessuno') {
      if (pieno(dati.socials, k) || c?.stato === 'privato') gestioneDi.push('base');
      continue;
    }
    const nome = NOMI_SOCIAL[k];
    const post = c.giudizio?.post_al_mese ?? c.numeri?.post_ultimi_30_giorni ?? null;
    const video = c.giudizio?.video ?? null;
    const follower = c.numeri?.follower;
    const migl = c.giudizio?.migliorie ?? null;
    const faDiPiu = (f: Abbonamento) => (post !== null && postAlMese(f) > post) || (video === false && videoAlMese(f) > 0);
    const da: Abbonamento | null = livello === 'debole' ? 'base' : livello === 'attivo' ? (ABBONAMENTI.filter((f) => f !== 'base').find(faDiPiu) ?? null) : migl ? 'premium' : null;
    const tenuto = `Teniamo il tuo ${nome} com’è e lo colleghiamo alla vetrina`;
    const gestione = (f: Abbonamento) =>
      livello === 'forte'
        ? `Seguiamo noi il tuo ${nome}: ${minuscola(migl!.replace(/[.!?]$/, ''))}`
        : post !== null && postAlMese(f) > post
          ? `Da ${post} a ${postAlMese(f)} post al mese su ${nome}${extra[f]}`
          : `Curiamo noi il tuo ${nome}: ${postAlMese(f)} post al mese${extra[f]}`;
    const perFascia = Object.fromEntries(ABBONAMENTI.map((f) => [f, da && ORDINE[f] >= ORDINE[da] ? gestione(f) : tenuto])) as Record<Abbonamento, string>;
    gestioneDi.push(da);
    const visto = post !== null
      ? `Negli ultimi 30 giorni su ${nome} sono usciti ${post} post${video === false ? ', senza video' : video === true ? ', anche con video' : ''}${follower !== undefined ? `, con ${it(follower)} persone che ti seguono` : ''}.`
      : `${LIVELLO_SOCIAL_IN_PAROLE[livello]}${follower !== undefined ? ` Ti seguono ${it(follower)} persone.` : ''}`;
    aggiungi({
      // Instagram tiene il nome di sempre: la proposta è la stessa, allargata ai livelli.
      id: k === 'instagram' ? 'social-costanza' : `social-costanza-${k}`,
      servizio: 'social',
      cosa: da ? gestione(da) : tenuto,
      perFascia,
      perche: [
        visto,
        !da ? 'Non lo cambiamo: lo teniamo com’è e lo colleghiamo alla vetrina.' : da !== 'base' ? `Col ${FASCE[da].nome} lo seguiamo noi; sotto lo teniamo e lo colleghiamo alla vetrina.` : null,
      ].filter(Boolean).join(' '),
      fonte: FONTE_SOCIAL[k],
      daFascia: 'base',
      consiglia: da && da !== 'base'
        ? { fascia: da, perche: livello === 'forte' ? `il tuo ${nome} è già forte: lo seguiamo noi solo col ${FASCE[da].nome}, con quello che ci aggiungiamo` : `il tuo ${nome} lo seguiamo noi dal ${FASCE[da].nome}, che fa più di quello che esce oggi` }
        : undefined,
    });
  }
  // Un profilo trovato dall'analisi conta come profilo, anche se nella vetrina non è scritto: mai «nessun profilo».
  const trovati = (['instagram', 'facebook', 'tiktok'] as const).filter((k) => ['fatta', 'privato'].includes(canali?.canali[k]?.stato ?? ''));
  const profili = (['instagram', 'facebook', 'tiktok'] as const).filter((k) => pieno(dati.socials, k) || trovati.includes(k));
  if (profili.length === 0) {
    aggiungi({
      id: 'social-apertura',
      servizio: 'social',
      cosa: 'Apriamo o sistemiamo il tuo profilo Instagram e la pagina Facebook, e li colleghiamo alla vetrina',
      perche: 'Nella tua vetrina non c’è nessun profilo social collegato.',
      fonte: FONTE.vetrina,
      daFascia: 'base',
    });
  } else if (pieno(dati.socials, 'facebook') && canali?.canali.facebook?.stato === 'non_trovato') {
    aggiungi({
      id: 'social-facebook',
      servizio: 'social',
      cosa: 'Sistemiamo la tua pagina Facebook, o la creiamo, e ci pubblichiamo gli stessi post',
      perche: 'La pagina Facebook che ci hai scritto non l’abbiamo trovata.',
      fonte: FONTE.facebook,
      daFascia: 'base',
    });
  }
  // Nessun profilo: la gestione parte dal Base (si aprono). Se no, dalla prima fascia che ne gestisce uno; `null` = nessuna.
  const inizioGestione: Abbonamento | null = !gestioneDi.length
    ? 'base'
    : gestioneDi.reduce<Abbonamento | null>((min, f) => (f === null ? min : min === null || ORDINE[f] < ORDINE[min] ? f : min), null);
  const idee = inizioGestione ? vociCitabili(scheda?.analisi?.idee_contenuti, 3) : [];
  const punti = inizioGestione ? vociCitabili(scheda?.analisi?.punti_di_forza, 3) : [];
  if (idee.length) {
    aggiungi({
      id: 'social-idee',
      servizio: 'social',
      cosa: `I primi post partono da qui: ${elenco(idee.map(minuscola))}`,
      perche: 'Sono le idee che abbiamo trovato guardando il tuo locale: le rivediamo insieme.',
      fonte: FONTE.scheda,
      daFascia: inizioGestione ?? 'base',
    });
  } else if (punti.length) {
    aggiungi({
      id: 'social-punti',
      servizio: 'social',
      cosa: `Nei post raccontiamo quello che ti distingue: ${elenco(punti.map(minuscola))}`,
      perche: 'È quello che di te si legge già in rete: lo facciamo vedere di più.',
      fonte: FONTE.scheda,
      daFascia: inizioGestione ?? 'base',
    });
  }
  if (idee.some((x) => /video|reel|dietro le quinte/i.test(x))) {
    aggiungi({
      id: 'social-video-brevi',
      servizio: 'social',
      cosa: 'Video brevi per Instagram e TikTok, girati nel tuo locale',
      perFascia: { business: '2 video brevi al mese per Instagram e TikTok, girati nel tuo locale', premium: '4 video brevi al mese e le storie, girati nel tuo locale' },
      perche: 'Fra le idee trovate per te ci sono contenuti che rendono solo in video.',
      fonte: FONTE.scheda,
      daFascia: inizioGestione === 'premium' ? 'premium' : 'business',
    });
  }
  // Google Maps, dentro la gestione dei social (Nicola, 24/11).
  const google = canali?.canali.google;
  if (!pieno(dati.socials, 'google_maps') && google?.stato !== 'fatta') {
    aggiungi({
      id: 'google-scheda',
      servizio: 'social',
      cosa: 'Creiamo o recuperiamo la tua scheda su Google Maps, con categoria, orari, foto e il link alla vetrina',
      perFascia: {
        base: 'Creiamo o sistemiamo all’avvio la tua scheda su Google Maps: categoria, orari, foto e il link alla vetrina',
        business: 'Creiamo e sistemiamo la tua scheda su Google Maps, e rispondiamo noi alle recensioni',
        premium: 'Creiamo la tua scheda su Google Maps e la curiamo ogni mese: foto nuove, post e risposte alle recensioni',
      },
      perche: 'Non ci hai ancora dato il link della tua scheda Google: chi cerca «vicino a me» vede prima le schede complete.',
      fonte: FONTE.vetrina,
      daFascia: 'base',
    });
  }
  if (google?.stato === 'fatta') {
    for (const [i, oss] of vociCitabili(google.osservazioni, 2, 240).entries()) {
      aggiungi({ id: `google-sistema-${i}`, servizio: 'social', cosa: 'Sistemiamo la tua scheda Google', perche: oss, fonte: FONTE.google, daFascia: 'base' });
    }
    const recensioni = google.numeri?.recensioni;
    // Dal Business, e solo se oggi il locale non risponde (Nicola, `agenzia.social-come-il-sito`): senza il giudizio non si sa.
    if (recensioni !== undefined && recensioni > 0 && google.giudizio?.risposte_recensioni === false) {
      aggiungi({
        id: 'google-recensioni',
        servizio: 'social',
        cosa: 'Rispondiamo noi alle recensioni su Google, con il tuo tono',
        perFascia: { premium: 'Rispondiamo noi alle recensioni su Google e curiamo la scheda ogni mese, con foto nuove e post' },
        perche: `La tua scheda ha ${it(recensioni)} ${recensioni === 1 ? 'recensione' : 'recensioni'}${google.numeri?.valutazione !== undefined ? ` e ${google.numeri.valutazione.toLocaleString('it-IT', { maximumFractionDigits: 1 })} stelle su 5` : ''}, e oggi nessuno risponde: chi risponde viene scelto di più.`,
        fonte: FONTE.google,
        // Le risposte alle recensioni partono dal Business (FASCE).
        daFascia: 'business',
      });
    }
  }
  if (orari && !orari.confermato) {
    aggiungi({
      id: 'google-orari',
      servizio: 'social',
      cosa: 'Mettiamo gli stessi orari, giusti, su Google, sul sito e nella vetrina',
      perche: `In rete i tuoi orari risultano «${orari.valore.slice(0, 80)}»: li confermi tu e li allineiamo dappertutto.`,
      fonte: FONTE.scheda,
      daFascia: 'base',
    });
  }

  /* ─────────── DALL'ANALISI DEL BUSINESS (25/11/2026, Nicola: «ok sito», lavoro B) ─────────── */
  // Ogni opportunità o prima mossa che l'AD lega a un nostro servizio (`servizio`) e traduce in cosa facciamo
  // (`proposta`) diventa una proposta, con la sua fonte. Al massimo tre. Le altre restano solo analisi.
  const dallAnalisi = (['opportunita', 'prime_mosse'] as const)
    .flatMap((sez) => d.analisiAziendale?.[sez] ?? [])
    .filter((v) => v.servizio && v.proposta)
    .slice(0, 3);
  dallAnalisi.forEach((v, i) => {
    aggiungi({
      id: `analisi-opp-${i}`,
      servizio: v.servizio!,
      cosa: v.proposta!,
      perche: v.testo,
      fonte: dominioDi(v.fonte),
      daFascia: 'base',
      ...(i === 0 ? { consiglia: { fascia: 'business' as const, perche: `l’analisi trova ${dallAnalisi.length === 1 ? 'un’opportunità' : `${dallAnalisi.length} opportunità`} da seguire, e col Business la rifacciamo ogni mese` } } : {}),
    });
  });

  /* ─────────── ANALISI DEL BUSINESS ─────────── */
  const canaliScritti = (['instagram', 'facebook', 'tiktok', 'google_maps', 'website'] as const).filter((k) => pieno(dati.socials, k)).length;
  aggiungi({
    id: 'analisi',
    servizio: 'analisi',
    cosa: 'Un’analisi completa della tua attività, dei social, della scheda Google e del sito',
    // Il ritmo scelto da Nicola il 24/11: avvio, mese, settimana (FASCE).
    perFascia: {
      base: 'Un’analisi completa all’avvio: la tua attività, i social, la scheda Google e il sito, con cosa migliorare',
      business: 'L’analisi completa all’avvio e una nuova ogni mese: cosa è cambiato e cosa fare il mese dopo',
      premium: 'L’analisi ogni settimana, e un incontro al mese per leggerla insieme',
    },
    perche: canaliScritti === 0
      ? 'Oggi non conosciamo nessuno dei tuoi canali: scrivili nella pagina dell’analisi e partiamo da lì.'
      : `Ci hai dato ${canaliScritti} ${canaliScritti === 1 ? 'canale' : 'canali'} da seguire.`,
    fonte: FONTE.vetrina,
    daFascia: 'base',
    // Si propone sempre; nel preventivo la racconta già l'analisi del business, corta.
    generica: true,
  });

  const perFascia = Object.fromEntries(ABBONAMENTI.map((f) => [f, p.filter((x) => ORDINE[x.daFascia] <= ORDINE[f]).length])) as Record<Abbonamento, number>;
  const tuttoCon = p.length ? p.reduce<Abbonamento>((max, x) => (ORDINE[x.daFascia] > ORDINE[max] ? x.daFascia : max), 'base') : null;
  const domande = vociCitabili(scheda?.analisi?.cosa_chiedere_al_titolare, 4, 200);
  return { proposte: p, perFascia, tuttoCon, domande };
}

/** Il testo di una proposta in una fascia, o `null` se quella fascia non la comprende. */
export function cosaInFascia(x: Proposta, f: Abbonamento): string | null {
  if (ORDINE[x.daFascia] > ORDINE[f]) return null;
  for (const g of [...ABBONAMENTI].reverse()) {
    if (ORDINE[g] <= ORDINE[f] && x.perFascia?.[g]) return x.perFascia[g]!;
  }
  return x.cosa;
}

/** La fascia sopra, o `null` dal Premium. */
export const fasciaSopra = (f: Abbonamento): Abbonamento | null => ABBONAMENTI[ORDINE[f] + 1] ?? null;

/**
 * Cosa aggiunge per questo cliente la fascia sopra `f`: le proposte nuove e quelle che cambiano
 * (più post, più spesso, più pagine). Vuoto dal Premium.
 */
export function inPiuSalendo(o: OffertaSuMisura | null | undefined, f: Abbonamento): { fascia: Abbonamento; voci: Array<{ id: string; cosa: string }> } | null {
  const sopra = fasciaSopra(f);
  if (!o || !sopra) return null;
  const voci = o.proposte.flatMap((x) => {
    const ora = cosaInFascia(x, f);
    const dopo = cosaInFascia(x, sopra);
    return dopo && dopo !== ora ? [{ id: x.id, cosa: dopo }] : [];
  });
  return { fascia: sopra, voci };
}

/**
 * La riga dell'avviso a Nicola quando il cliente accetta (24/11/2026): cosa fare per lui nella fascia
 * scelta. Vuota senza offerta. Sta qui e non in preventivo.ts per non far importare i due file a vicenda.
 */
export function testoOffertaPerAvviso(o: OffertaSuMisura | null | undefined, f: Abbonamento): string {
  const voci = (o?.proposte ?? []).map((x) => cosaInFascia(x, f)).filter((x): x is string => x !== null);
  return voci.length ? ` Da fare per lui col ${FASCE[f].nome}: ${voci.slice(0, 8).join('; ')}.` : '';
}

/** Le proposte di un servizio, per la sua pagina. */
export const proposteDi = (o: OffertaSuMisura | null | undefined, servizio: ServizioAgenzia) => (o?.proposte ?? []).filter((x) => x.servizio === servizio);
