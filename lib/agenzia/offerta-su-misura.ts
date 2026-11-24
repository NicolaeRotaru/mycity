import { ABBONAMENTI, FOTO_LOCALE_CONSIGLIATE, PRODOTTI_PER_IL_PREMIUM, type Abbonamento, type DatiAttivita, type ServizioAgenzia } from './preventivo';
import { datoDi, prodottiTipici, senzaValuta, vociSenzaPrezzo, type SchedaCliente } from './scheda-cliente';
import { votoDi, type AnalisiCanali, type RisultatoSito } from './analisi';
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
};

const FONTE = {
  vetrina: 'la tua vetrina su MyCity',
  scheda: 'le fonti pubbliche del tuo locale',
  sito: 'Google PageSpeed Insights',
  instagram: 'il tuo profilo Instagram',
  facebook: 'la tua pagina Facebook',
  google: 'la tua scheda Google Maps',
} as const;

/** I post al mese di ogni fascia, letti dal listino (8, 12, 20): non si riscrivono qui. */
export const POST_AL_MESE: Record<Abbonamento, number> = { base: 8, business: 12, premium: 20 };

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
  const { dati, scheda, canali, sito, tipo } = d;

  /* ─────────── FOTO E VIDEO ─────────── */
  const prodotti = dati.prodotti.length;
  const senzaFoto = dati.prodotti.filter((x) => !haFoto(x.images)).length;
  if (senzaFoto > 0) {
    aggiungi({
      id: 'foto-prodotti',
      servizio: 'foto_video',
      cosa: senzaFoto === 1 ? 'Fotografiamo il prodotto che non ha ancora una foto' : `Fotografiamo i tuoi ${it(senzaFoto)} prodotti senza foto`,
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
  const haSito = pieno(dati.socials, 'website');
  const indirizzo = datoDi(scheda, 'indirizzo');
  const orariGrezzi = datoDi(scheda, 'orari');
  const orari = orariGrezzi && senzaValuta(orariGrezzi.valore) ? orariGrezzi : null;
  const prenota = datoDi(scheda, 'link_prenotazione');
  const tipici = prodottiTipici(scheda, 5);
  if (!haSito) {
    const conDentro = [indirizzo ? 'l’indirizzo' : null, orari ? 'gli orari' : null, tipici.length ? 'i tuoi prodotti tipici' : null].filter(Boolean) as string[];
    aggiungi({
      id: 'sito-nuovo',
      servizio: 'sito_web',
      cosa: `Il tuo sito col tuo nome, collegato alla vetrina${conDentro.length ? `, con dentro ${elenco(conDentro)}` : ''}`,
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
  if (sito) {
    if (sito.velocita !== null && votoDi(sito.velocita) !== 'bene') {
      aggiungi({
        id: 'sito-veloce',
        servizio: 'sito_web',
        cosa: 'Rendiamo il tuo sito veloce dal telefono',
        perche: `Oggi Google gli dà ${sito.velocita} su 100 per la velocità dal telefono${sito.secondiPerVedere !== null ? `: la parte principale si vede dopo ${sito.secondiPerVedere.toLocaleString('it-IT')} secondi` : ''}.`,
        fonte: FONTE.sito,
        daFascia: 'base',
      });
    }
    if (sito.daSistemare.length > 0) {
      aggiungi({
        id: 'sito-google',
        servizio: 'sito_web',
        cosa: `Sistemiamo ${sito.daSistemare.length === 1 ? 'la cosa che Google segnala' : `le ${sito.daSistemare.length} cose che Google segnala`} sul tuo sito`,
        perche: sito.daSistemare.slice(0, 2).join(' '),
        fonte: FONTE.sito,
        daFascia: 'base',
      });
    }
  }

  /* ─────────── SOCIAL E GOOGLE MAPS ─────────── */
  const ig = canali?.canali.instagram;
  const postIg = ig?.stato === 'fatta' ? ig.numeri?.post_ultimi_30_giorni : undefined;
  if (postIg !== undefined) {
    const daFascia = ABBONAMENTI.find((f) => POST_AL_MESE[f] > postIg) ?? 'premium';
    aggiungi({
      id: 'social-costanza',
      servizio: 'social',
      cosa: postIg < POST_AL_MESE.base
        ? `Da ${postIg} a ${POST_AL_MESE.base} post al mese su Instagram, preparati e pubblicati da noi`
        : `Più contenuti su Instagram: ${POST_AL_MESE[daFascia]} post al mese, preparati e pubblicati da noi`,
      perche: `Negli ultimi 30 giorni su Instagram sono usciti ${postIg} post${ig?.numeri?.follower !== undefined ? `, con ${it(ig.numeri.follower)} persone che ti seguono` : ''}.`,
      fonte: FONTE.instagram,
      daFascia: postIg < POST_AL_MESE.base ? 'base' : daFascia,
    });
  }
  const profili = (['instagram', 'facebook', 'tiktok'] as const).filter((k) => pieno(dati.socials, k));
  if (profili.length === 0) {
    aggiungi({
      id: 'social-apertura',
      servizio: 'social',
      cosa: 'Apriamo o sistemiamo il tuo profilo Instagram e la pagina Facebook, e li colleghiamo alla vetrina',
      perche: 'Nella tua vetrina non c’è nessun profilo social collegato.',
      fonte: FONTE.vetrina,
      daFascia: 'base',
    });
  } else if (canali?.canali.facebook?.stato === 'non_trovato') {
    aggiungi({
      id: 'social-facebook',
      servizio: 'social',
      cosa: 'Sistemiamo la tua pagina Facebook, o la creiamo, e ci pubblichiamo gli stessi post',
      perche: 'La pagina Facebook che ci hai scritto non l’abbiamo trovata.',
      fonte: FONTE.facebook,
      daFascia: 'base',
    });
  }
  const idee = vociSenzaPrezzo(scheda?.analisi?.idee_contenuti, 3);
  const punti = vociSenzaPrezzo(scheda?.analisi?.punti_di_forza, 3);
  if (idee.length) {
    aggiungi({
      id: 'social-idee',
      servizio: 'social',
      cosa: `I primi post partono da qui: ${elenco(idee.map(minuscola))}`,
      perche: 'Sono le idee che abbiamo trovato guardando il tuo locale: le rivediamo insieme.',
      fonte: FONTE.scheda,
      daFascia: 'base',
    });
  } else if (punti.length) {
    aggiungi({
      id: 'social-punti',
      servizio: 'social',
      cosa: `Nei post raccontiamo quello che ti distingue: ${elenco(punti.map(minuscola))}`,
      perche: 'È quello che di te si legge già in rete: lo facciamo vedere di più.',
      fonte: FONTE.scheda,
      daFascia: 'base',
    });
  }
  if (idee.some((x) => /video|reel|dietro le quinte|laboratorio/i.test(x))) {
    aggiungi({
      id: 'social-video-brevi',
      servizio: 'social',
      cosa: 'Video brevi per Instagram e TikTok, girati nel tuo locale',
      perche: 'Fra le idee trovate per te ci sono contenuti che rendono solo in video.',
      fonte: FONTE.scheda,
      daFascia: 'business',
    });
  }
  // Google Maps, dentro la gestione dei social (Nicola, 24/11).
  const google = canali?.canali.google;
  if (!pieno(dati.socials, 'google_maps') && google?.stato !== 'fatta') {
    aggiungi({
      id: 'google-scheda',
      servizio: 'social',
      cosa: 'Creiamo o recuperiamo la tua scheda su Google Maps, con categoria, orari, foto e il link alla vetrina',
      perche: 'Non ci hai ancora dato il link della tua scheda Google: chi cerca «vicino a me» vede prima le schede complete.',
      fonte: FONTE.vetrina,
      daFascia: 'base',
    });
  }
  if (google?.stato === 'fatta') {
    for (const [i, oss] of vociSenzaPrezzo(google.osservazioni, 2).entries()) {
      aggiungi({ id: `google-sistema-${i}`, servizio: 'social', cosa: 'Sistemiamo la tua scheda Google', perche: oss, fonte: FONTE.google, daFascia: 'base' });
    }
    const recensioni = google.numeri?.recensioni;
    if (recensioni !== undefined && recensioni > 0) {
      aggiungi({
        id: 'google-recensioni',
        servizio: 'social',
        cosa: 'Rispondiamo noi alle recensioni su Google, con il tuo tono',
        perche: `La tua scheda ha ${it(recensioni)} ${recensioni === 1 ? 'recensione' : 'recensioni'}${google.numeri?.valutazione !== undefined ? ` e ${google.numeri.valutazione.toLocaleString('it-IT', { maximumFractionDigits: 1 })} stelle su 5` : ''}: chi risponde viene scelto di più.`,
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

  /* ─────────── ANALISI DEL BUSINESS ─────────── */
  const canaliScritti = (['instagram', 'facebook', 'tiktok', 'google_maps', 'website'] as const).filter((k) => pieno(dati.socials, k)).length;
  aggiungi(
    canaliScritti === 0
      ? {
          id: 'analisi-avvio',
          servizio: 'analisi',
          cosa: 'Un’analisi completa all’avvio: la tua attività, i social, la scheda Google e il sito',
          perche: 'Scrivi i tuoi canali e partiamo da lì: oggi non ne conosciamo nessuno.',
          fonte: FONTE.vetrina,
          daFascia: 'base',
        }
      : {
          id: 'analisi-ogni-mese',
          servizio: 'analisi',
          cosa: 'Ogni mese misuriamo cosa è cambiato sui tuoi canali, e ti diciamo cosa fare il mese dopo',
          perche: `Ci hai dato ${canaliScritti} ${canaliScritti === 1 ? 'canale' : 'canali'}: si possono seguire nel tempo, non solo all’avvio.`,
          fonte: FONTE.vetrina,
          daFascia: 'business',
        },
  );
  if (prodotti >= PRODOTTI_PER_IL_PREMIUM) {
    aggiungi({
      id: 'analisi-incontro',
      servizio: 'analisi',
      cosa: 'Un incontro al mese per leggere l’analisi insieme, con un referente tutto tuo',
      perche: `Con ${it(prodotti)} prodotti ci sono tante cose da decidere: meglio guardarle insieme.`,
      fonte: FONTE.vetrina,
      daFascia: 'premium',
    });
  }

  const perFascia = Object.fromEntries(ABBONAMENTI.map((f) => [f, p.filter((x) => ORDINE[x.daFascia] <= ORDINE[f]).length])) as Record<Abbonamento, number>;
  const tuttoCon = p.length ? p.reduce<Abbonamento>((max, x) => (ORDINE[x.daFascia] > ORDINE[max] ? x.daFascia : max), 'base') : null;
  const domande = vociSenzaPrezzo(scheda?.analisi?.cosa_chiedere_al_titolare, 4, 200);
  return { proposte: p, perFascia, tuttoCon, domande };
}

/** Le proposte di un servizio, per la sua pagina. */
export const proposteDi = (o: OffertaSuMisura | null | undefined, servizio: ServizioAgenzia) => (o?.proposte ?? []).filter((x) => x.servizio === servizio);
