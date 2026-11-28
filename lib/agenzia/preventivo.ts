/**
 * IL PREVENTIVO DI QUELLO CHE MANCA — già pronto quando il cliente apre la dashboard.
 *
 * 22/11/2026 — La dashboard di ogni attività iscritta mostra quello che le manca e
 * il preventivo di MyCity per farlo. I servizi sono di MyCity e li realizza SDG Agenzia,
 * il partner di MyCity per foto, video, social e web (Nicola, 24/11: «sono servizi che
 * offre mycity, ma tramite SDG»; fino al 23/11 il partner era nominato solo su foto e video). Nicola: «deve già essere creato prima, in formato
 * preventivo/demo» — quindi il cliente non lo chiede: lo trova pronto, calcolato
 * dai suoi dati.
 *
 * I servizi sono tre: foto e video, sito web professionale, gestione dei social (il flusso
 * n8n) con dentro la scheda Google su Maps. Il logo è stato tolto il 23/11; la scheda Google è
 * entrata nella gestione social il 24/11 (Nicola: «gestione di social dentro è compreso anche
 * Google Maps»).
 *
 * Dal 24/11/2026 non si vendono più uno per uno: Nicola, «l'abbonamento comprende tutti i
 * servizi ma in modi diversi» — tre fasce, Base 300 €, Business 600 €, Premium 900 € al mese,
 * solo canone e niente percentuale sul venduto. Ogni fascia comprende tutti e tre i
 * servizi più la vetrina; cambia quanto (`FASCE`).
 *
 * Tutto quello che si decide sta qui, in funzioni senza rete:
 *  · `cosaManca()` guarda i dati dell'attività e dice quali servizi servono e
 *    perché, con il numero vero (es. «12 prodotti sono senza foto»);
 *  · `costruisciPreventivo()` mette tutto in forma di preventivo: numero, data,
 *    cosa manca, i canoni delle tre fasce e quella che consigliamo;
 *  · `leggiImpostazioniAgenzia()` legge da `site_settings.agenzia` chi firma il
 *    preventivo e i canoni che Nicola vuole cambiare, senza rifare il sito.
 *
 * Lo stesso calcolo gira sul server quando il cliente accetta: il server non si
 * fida della fascia mandata dal browser: la rilegge dal listino.
 */

import type { TipoAttivita } from './tipi-attivita';
import { formatPriceFromCents } from '@/lib/format';
import type { OffertaSuMisura } from './offerta-su-misura';

/**
 * Nell'ordine del menu «Servizi» (Nicola, 24/11/2026: «foto e video, sito e social, gestione di social»).
 * Il quarto, l'analisi del business, è arrivato la sera del 24/11 (Nicola: «manca un'ultima cosa dentro
 * i servizi, l'analisi del business, la fa n8n»): sta dopo i social, prima di «Abbonamento».
 */
export const SERVIZI_AGENZIA = ['foto_video', 'sito_web', 'social', 'analisi'] as const;
export type ServizioAgenzia = (typeof SERVIZI_AGENZIA)[number];

/**
 * L'indirizzo della pagina di ogni servizio (Nicola, 23/11: «ogni servizio ha la sua voce dentro il
 * menu»): /seller/servizi/<slug> dal 24/11/2026 (lib/agenzia/indirizzi-servizi.ts).
 */
export const SLUG_SERVIZIO: Record<ServizioAgenzia, string> = {
  foto_video: 'foto-video',
  sito_web: 'sito-web',
  social: 'social',
  analisi: 'analisi',
};

/** Il servizio di un indirizzo, o `null` se l'indirizzo non è di nessun servizio. */
export function servizioDaSlug(slug: string): ServizioAgenzia | null {
  return SERVIZI_AGENZIA.find((id) => SLUG_SERVIZIO[id] === slug) ?? null;
}

/**
 * Sotto questo numero di foto del locale la copertina della vetrina si
 * considera da rifare. Una scelta ragionata (22/11): la copertina è un
 * carosello, e con una o due foto non scorre.
 */
export const FOTO_LOCALE_CONSIGLIATE = 3;

/** Le tre fasce dell'abbonamento, dalla più leggera alla più completa (Nicola, 24/11/2026). */
export const ABBONAMENTI = ['base', 'business', 'premium'] as const;
export type Abbonamento = (typeof ABBONAMENTI)[number];

type VoceListino = {
  titolo: string;
  /** Cosa comprende il servizio, detto in generale: quanto, lo dice la fascia. */
  descrizione: string;
  /** Chi fa il lavoro quando non è MyCity: il cliente lo legge sulla voce, Nicola nell'avviso. */
  partner?: string;
};

export const LISTINO: Record<ServizioAgenzia, VoceListino> = {
  foto_video: {
    titolo: 'Foto e video',
    descrizione: 'Scatti e riprese nel tuo locale, con ritocco e montaggio: le foto della copertina, dei prodotti e i video per vetrina e social.',
  },
  sito_web: {
    titolo: 'Sito web professionale',
    descrizione: 'Un sito tutto tuo, con il tuo nome, che porta i clienti alla tua vetrina MyCity.',
  },
  // 24/11/2026 — La scheda Google è dentro la gestione social (Nicola: «gestione di social dentro è
  // compreso anche Google Maps»): un servizio solo, con i testi dei due di prima messi insieme.
  social: {
    titolo: 'Gestione dei social e di Google Maps',
    descrizione: 'I post sui tuoi social li prepariamo e li pubblichiamo noi, in automatico, con le foto della tua vetrina. E curiamo la tua scheda su Google Maps: categoria giusta, orari, foto e il collegamento alla tua vetrina MyCity. Chi cerca vicino a te ti trova.',
  },
  // 24/11/2026 — Nicola: «dentro il servizio di analisi, oltre all'analisi che già n8n fa, ci deve
  // essere anche l'analisi dei social, google, sito». Solo fonti gratuite (sua scelta, stesso giorno).
  analisi: {
    titolo: 'Analisi del business',
    descrizione: 'Ti diciamo cosa funziona e cosa migliorare: la tua attività, i tuoi social, la scheda Google e il sito, letti da noi e spiegati in parole semplici.',
  },
};

type Fascia = {
  nome: string;
  /** Il canone di Nicola (24/11/2026), in centesimi al mese. */
  prezzoMese: number;
  /** Per chi è, in una frase. */
  perChi: string;
  /** Come ogni servizio è compreso in questa fascia: tutti ci sono, cambia quanto. */
  servizi: Record<ServizioAgenzia, string>;
  /** La vetrina e l'assistenza, che non sono voci del «cosa manca» ma fanno parte del canone. */
  vetrina: string;
  assistenza: string;
};

/**
 * I TRE ABBONAMENTI — 24/11/2026.
 *
 * Nicola: «adesso l'abbonamento comprende tutti i servizi ma in modi diversi, perché ci sono 3
 * abbonamenti: base 300€/mese, business 500€/mese e premium 999€/mese», e alla domanda sul 10%:
 * «solo canone, niente 10%». I prezzi sono suoi. Come si divide ogni servizio fra le fasce è una
 * proposta dell'AD dello stesso giorno, da confermare con Nicola: si cambia qui, in un posto solo.
 * Prima di questa data ogni servizio aveva il suo prezzo (sito 500 €, social 300 € al mese, foto e
 * video da 50 a 300 € al mese): non si vendono più uno per uno.
 *
 * 26/11/2026 — L'analisi diventa il rapporto dell'imprenditore (Nicola, ~14:45, prezzi invariati) e si personalizza
 * per abbonamento (14:54); i concorrenti sui social e sul web si nominano (14:35). Cambia il testo di
 * `servizi.analisi`: Base all'avvio, senza ricerche né concorrenti sui social; Business ogni mese, coi 3 concorrenti
 * principali; Premium ogni settimana, fino a 5 concorrenti e un incontro al mese. Le parti incluse ed escluse di
 * ogni fascia stanno in `ANALISI_PER_FASCIA`
 * (lib/agenzia/rapporto.ts). I prodotti di SDG ripetono questo testo: li riscrive la migrazione 863.
 */
export const FASCE: Record<Abbonamento, Fascia> = {
  base: {
    nome: 'Base',
    prezzoMese: 30_000,
    perChi: 'Per essere online e vendere da subito, con un aiuto costante ma leggero.',
    servizi: {
      foto_video: 'Una sessione di foto all’avvio: copertina e prodotti principali.',
      sito_web: 'Un sito di una pagina col tuo nome, collegato alla vetrina.',
      social: '8 post al mese, preparati e pubblicati da noi. Scheda Google Maps creata o sistemata all’avvio.',
      analisi: 'Il rapporto completo all’avvio: reputazione, concorrenti vicini, zona, sito, i tuoi social, calendario della città, bandi e il piano dei primi 30 giorni.',
    },
    vetrina: 'Vetrina su MyCity con ordini, consegna e ritiro in negozio.',
    assistenza: 'Su WhatsApp, risposta entro 24 ore lavorative.',
  },
  business: {
    nome: 'Business',
    prezzoMese: 60_000,
    perChi: 'Per crescere ogni settimana: più contenuti, più clienti che ti trovano.',
    servizi: {
      foto_video: 'Foto all’avvio e una nuova sessione ogni tre mesi, più un video al mese.',
      sito_web: 'Un sito completo di più pagine, col tuo nome.',
      social: '12 post al mese, 3 a settimana, con 2 video brevi. Scheda Google Maps sistemata, più le risposte alle recensioni scritte da noi.',
      analisi: 'Il rapporto all’avvio e ogni mese: le ricerche su Google, i tuoi 3 concorrenti principali sui social e sul web, cosa è cambiato.',
    },
    vetrina: 'Vetrina su MyCity con ordini, consegna e ritiro in negozio, in evidenza nella tua categoria una settimana al mese.',
    assistenza: 'Su WhatsApp, risposta entro 4 ore lavorative.',
  },
  premium: {
    nome: 'Premium',
    prezzoMese: 90_000,
    perChi: 'Il servizio completo: foto e video ogni mese, un referente tutto tuo.',
    servizi: {
      foto_video: 'Una sessione di foto e video ogni mese.',
      sito_web: 'Un sito completo, aggiornato da noi ogni mese.',
      social: '20 post al mese, 4 video brevi e le storie. Scheda Google Maps curata ogni mese: foto nuove, post e risposte alle recensioni.',
      analisi: 'Il rapporto aggiornato ogni settimana, con fino a 5 concorrenti sui social e sul web e le idee che ne nascono, e un incontro al mese per leggerlo insieme.',
    },
    vetrina: 'Vetrina su MyCity con ordini, consegna e ritiro in negozio, in home page due settimane al mese.',
    assistenza: 'Un referente tutto tuo e una visita nel locale ogni mese.',
  },
};

/**
 * Chi firma il preventivo: MyCity. Il partner che realizza i servizi è SDG Agenzia
 * (`REALIZZATI_DA`), nominato una volta per tutti i servizi (Nicola, 24/11/2026). Vale finché `site_settings.agenzia.nome` non dice
 * un altro nome: da lì si cambia senza rifare il sito.
 */
export const NOME_AGENZIA_DI_RISERVA = 'MyCity';

/**
 * Chi realizza i servizi (Nicola, 24/11/2026): «sono servizi che offre mycity, ma tramite SDG».
 * MyCity li vende e li incassa; li fa SDG Agenzia, la sua agenzia di web, marketing, foto e video.
 */
export const REALIZZATI_DA = 'SDG Agenzia';

/** La riga che lo dice al negozio, uguale nel preventivo e in ogni servizio. Il menu non la porta. */
export const FRASE_PARTNER = `I servizi li realizza ${REALIZZATI_DA}, il partner di MyCity per foto, video, social e web.`;

/** Un canone oltre questo (in centesimi: 10.000 € al mese) è un errore di battitura, non un listino. */
const PREZZO_MASSIMO_CENTESIMI = 1_000_000;
/**
 * Sotto questo (in centesimi: 10 € al mese) è quasi certamente un canone scritto in euro invece
 * che in centesimi: «"base": 300» farebbe leggere al cliente «3,00 € al mese» (collaudo del 24/11).
 */
const PREZZO_MINIMO_CENTESIMI = 1_000;

export type ImpostazioniAgenzia = {
  nome: string;
  /** Il canone di ogni fascia in centesimi al mese; `null` = su richiesta. */
  prezzi: Record<Abbonamento, number | null>;
};

/**
 * Lo 0 non è un prezzo (collaudo del 23/11): con lo 0 il cliente leggeva «0,00 €».
 * Uno 0 scritto per sbaglio nelle impostazioni diventa «su richiesta».
 */
const centesimiValidi = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= PREZZO_MINIMO_CENTESIMI && v <= PREZZO_MASSIMO_CENTESIMI;

/**
 * Un canone scritto in `site_settings.agenzia.abbonamenti.<fascia>`:
 *  · assente → vale il prezzo di Nicola;
 *  · `null` → su richiesta;
 *  · un numero di centesimi → quel canone.
 * Qualunque altra cosa (zero, negativo, sotto i 10 €, testo, decimali) diventa «su richiesta»: meglio
 * nessun prezzo che un prezzo sbagliato davanti a un cliente. La vecchia chiave `prezzi`
 * (un prezzo per servizio, fino al 23/11) si ignora.
 */
function leggiCanone(v: unknown, diListino: number): number | null {
  if (v === undefined) return diListino;
  return centesimiValidi(v) ? v : null;
}

export function leggiImpostazioniAgenzia(grezzo: unknown): ImpostazioniAgenzia {
  const g = (grezzo && typeof grezzo === 'object' ? grezzo : {}) as { nome?: unknown; abbonamenti?: unknown };
  const nome = typeof g.nome === 'string' && g.nome.trim().length >= 2 ? g.nome.trim().slice(0, 80) : NOME_AGENZIA_DI_RISERVA;
  const scritti = (g.abbonamenti && typeof g.abbonamenti === 'object' ? g.abbonamenti : {}) as Record<string, unknown>;
  const prezzi = Object.fromEntries(
    ABBONAMENTI.map((id) => [id, leggiCanone(scritti[id], FASCE[id].prezzoMese)]),
  ) as Record<Abbonamento, number | null>;
  return { nome, prezzi };
}

/** Tutti i canoni «su richiesta»: quando le impostazioni non si leggono per un guasto. */
export function impostazioniSenzaPrezzi(): ImpostazioniAgenzia {
  return {
    nome: NOME_AGENZIA_DI_RISERVA,
    prezzi: Object.fromEntries(ABBONAMENTI.map((id) => [id, null])) as Record<Abbonamento, number | null>,
  };
}

export type DatiAttivita = {
  storeLogo: string | null | undefined;
  storeMedia: unknown;
  /** I prodotti ancora in catalogo (non venduti, non esauriti per sempre), con le loro foto. */
  prodotti: { images: unknown }[];
  /** `store_customization.socials`: instagram, facebook, tiktok, whatsapp, website e, dal 24/11/2026, google_maps. */
  socials?: unknown;
  /**
   * 25/11/2026 — Il sito che ha già, misurato da Google PageSpeed: una frase per voce, già scritta
   * (velocità, Google, facilità d'uso). Se c'è, il preventivo parla del suo sito invece di «non ce l'hai».
   */
  sitoOggi?: string[];
  /** 25/11/2026 sera — Un sito noto che il titolare non ci ha scritto: conta come sito, mai «non ce l'hai». */
  sitoTrovato?: boolean;
  /** 25/11/2026 sera — I profili social trovati in rete dall'analisi (nomi: «Instagram»…), anche se non sono nella vetrina. */
  profiliTrovati?: string[];
};

export type VoceMancante = {
  id: ServizioAgenzia;
  /** Perché serve: una frase per ogni cosa che manca, col numero vero letto dai dati. */
  perche: string[];
};

const contaMedia = (media: unknown, tipo: 'image' | 'video') =>
  Array.isArray(media)
    ? media.filter((m) => {
        if (!m || typeof m !== 'object') return false;
        const { type, url } = m as { type?: unknown; url?: unknown };
        return type === tipo && typeof url === 'string' && url.trim().length > 0;
      }).length
    : 0;

const haFoto = (images: unknown) =>
  Array.isArray(images) && images.some((i) => typeof i === 'string' && i.trim().length > 0);

const campoPieno = (oggetto: unknown, chiave: string) => {
  const v = oggetto && typeof oggetto === 'object' ? (oggetto as Record<string, unknown>)[chiave] : undefined;
  return typeof v === 'string' && v.trim().length > 0;
};

const elenco = (parole: string[]) =>
  parole.length <= 1 ? parole.join('') : `${parole.slice(0, -1).join(', ')} e ${parole[parole.length - 1]}`;

const PROFILI_SOCIAL = [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['tiktok', 'TikTok']] as const;

/** I canali che l'analisi legge (24/11/2026): i social, la scheda Google su Maps e il sito. */
const CANALI_DA_ANALIZZARE = [...PROFILI_SOCIAL, ['google_maps', 'la scheda Google'], ['website', 'il sito']] as const;

/** Quello che manca all'attività, nell'ordine del listino. */
export function cosaManca(d: DatiAttivita): VoceMancante[] {
  const voci: VoceMancante[] = [];

  const fotoVideo: string[] = [];
  const fotoLocale = contaMedia(d.storeMedia, 'image');
  if (fotoLocale < FOTO_LOCALE_CONSIGLIATE) {
    fotoVideo.push(
      fotoLocale === 0
        ? 'La copertina della vetrina non ha nessuna foto del locale.'
        : `La copertina ha ${fotoLocale} foto del locale: ne consigliamo almeno ${FOTO_LOCALE_CONSIGLIATE}.`,
    );
  }
  const senzaFoto = d.prodotti.filter((p) => !haFoto(p.images)).length;
  if (senzaFoto > 0) {
    fotoVideo.push(`${senzaFoto} ${senzaFoto === 1 ? 'prodotto è' : 'prodotti sono'} senza foto, su ${d.prodotti.length} in catalogo.`);
  }
  if (contaMedia(d.storeMedia, 'video') === 0) {
    fotoVideo.push('Nella vetrina non c’è nessun video.');
  }
  if (fotoVideo.length > 0) voci.push({ id: 'foto_video', perche: fotoVideo });

  if (!campoPieno(d.socials, 'website') && !d.sitoTrovato) {
    voci.push({ id: 'sito_web', perche: ['La tua attività non ha ancora un sito web suo.'] });
  } else if (d.sitoOggi?.length) {
    // 25/11/2026 — Il sito c'è e Google l'ha misurato: si dice com'è, e l'offerta dice cosa ci aggiungiamo.
    voci.push({ id: 'sito_web', perche: d.sitoOggi });
  }

  // La gestione dei social, con dentro la scheda Google (24/11/2026), si propone sempre: dai dati
  // non si vede chi pubblica già con costanza, e MyCity non sa se hai una scheda Google né se è curata.
  const profili = PROFILI_SOCIAL.filter(([chiave]) => campoPieno(d.socials, chiave)).map(([, nome]) => nome);
  const trovati = (d.profiliTrovati ?? []).filter((n) => !(profili as string[]).includes(n));
  voci.push({
    id: 'social',
    perche: [
      profili.length === 0 && trovati.length
        ? `In rete abbiamo trovato ${elenco(trovati)}: lo colleghiamo alla vetrina, e i post possono partire senza che tu li scriva.`
        : profili.length === 0
        ? 'Nessun profilo social è collegato alla vetrina.'
        : `Hai già ${elenco(profili)}: i post possono partire in automatico, senza che tu li scriva.`,
      'Quando qualcuno cerca «vicino a me», Google mostra prima le schede complete di orari e foto: controlliamo la tua.',
    ],
  });

  // L'analisi del business (24/11/2026) si propone sempre, come i social: serve anche a chi ha già
  // tutto, e dai dati si vede solo quali canali il titolare ci ha scritto.
  const canali = CANALI_DA_ANALIZZARE.filter(([chiave]) => campoPieno(d.socials, chiave)).map(([, nome]) => nome);
  voci.push({
    id: 'analisi',
    perche: [
      canali.length === 0
        ? 'Non ci hai ancora scritto i tuoi canali: social, scheda Google e sito. Scrivili e li leggiamo noi.'
        : `Ci hai scritto ${elenco(canali)}: li leggiamo e ti diciamo cosa funziona e cosa migliorare.`,
      'L’analisi ti dice, in parole semplici, chi sono i tuoi clienti e cosa fare il mese prossimo.',
    ],
  });

  return voci;
}

export type RigaPreventivo = VoceMancante & {
  titolo: string;
  descrizione: string;
  partner?: string;
};

/** Sopra questo numero di prodotti in catalogo consigliamo il Premium: tante schede, tante foto. */
export const PRODOTTI_PER_IL_PREMIUM = 150;

export type Preventivo = {
  numero: string;
  /** AAAA-MM-GG, giorno di Piacenza. */
  data: string;
  agenzia: string;
  attivita: string;
  tipoAttivita: TipoAttivita;
  /** Cosa manca alla vetrina, col perché: tutto è compreso in ogni abbonamento. */
  righe: RigaPreventivo[];
  /** Quello che è già a posto: nel preventivo si vede anche questo. */
  giaAPosto: ServizioAgenzia[];
  /** Il canone di ogni fascia in centesimi al mese; `null` = su richiesta. */
  prezzi: Record<Abbonamento, number | null>;
  /** La fascia che consigliamo guardando la vetrina, e perché. */
  consigliato: Abbonamento;
  perche_consigliato: string;
  /** La fascia scelta dal cliente quando accetta; `null` mentre guarda. */
  scelto: Abbonamento | null;
  /** L'abbonamento dei servizi già pagato (24/11/2026), se c'è: la pagina lo mostra invece della cassa. */
  attivo: AbbonamentoAttivo | null;
  /** Il primo mese a metà vale una volta per negozio: falso se ha già avuto un abbonamento dei servizi. */
  primoMeseScontato: boolean;
  /**
   * L'offerta su misura (24/11/2026): le cose precise che facciamo per questo negozio, dai suoi dati
   * (lib/agenzia/offerta-su-misura.ts). La aggiunge chi legge il preventivo dal database.
   */
  offerta?: OffertaSuMisura;
  /**
   * 28/11/2026 — Il giorno in cui l'attività si è iscritta a MyCity («AAAA-MM-GG»): non cambia mai.
   * La usa la firma dell'armonia nascosta (lib/armonia) per la bozza del sito. La aggiunge chi legge dal database.
   */
  nascitaAttivita?: string | null;
  /**
   * 25/11/2026 — L'analisi del business dell'attività, come l'AD analizza MyCity come azienda (Nicola): la
   * parte specifica del servizio «Analisi del business» (lib/agenzia/analisi.ts, `analisiAziendale`).
   */
  analisiAziendale?: import('./analisi').AnalisiAziendale | null;
  /** 25/11/2026 sera — Fatta, fatta senza fonti (l'AD non ha trovato niente in rete), o da fare. */
  analisiAziendaleStato?: import('./analisi').StatoAnalisiBusiness;
  /**
   * 25/11/2026 sera — L'analisi dei canali (social e scheda Google), anche nel link (Nicola: i social nel link pubblico).
   * È una lettura di pagine pubbliche, con la fonte di ognuna: per la pagina «Analisi» della demo.
   */
  canali?: import('./analisi').AnalisiCanali | null;
};

/**
 * LA FASCIA CONSIGLIATA, DOPO L'OFFERTA SU MISURA — 25/11/2026 (Nicola, «ok sito»).
 * `fasciaConsigliata` guarda solo prodotti e voci mancanti; qui il consiglio sale fin dove serve per le
 * proposte che lo chiedono (`consiglia`): il sito rifatto solo dal Business o dal Premium, le opportunità
 * dell'analisi da seguire ogni mese. Non scende mai.
 */
export function consigliataDallOfferta(
  prima: { id: Abbonamento; perche: string },
  offerta: { proposte: Array<{ consiglia?: { fascia: Abbonamento; perche: string } }> } | null | undefined,
): { id: Abbonamento; perche: string } {
  const ordine = (f: Abbonamento) => ABBONAMENTI.indexOf(f);
  let meglio = prima;
  for (const x of offerta?.proposte ?? []) {
    if (x.consiglia && ordine(x.consiglia.fascia) > ordine(meglio.id)) {
      const perche = x.consiglia.perche;
      meglio = { id: x.consiglia.fascia, perche: `${perche.charAt(0).toUpperCase()}${perche.slice(1)}.` };
    }
  }
  return meglio;
}

/**
 * `incluso`: l'abbonamento c'è per regola e non si paga (28/11/2026, oggi solo SDG Agenzia:
 * lib/agenzia/abbonamento-di-sdg.ts). Le pagine non parlano di rinnovo, disdetta o pagamento.
 */
export type AbbonamentoAttivo = { fascia: Abbonamento; stato: 'active' | 'past_due'; rinnovoIl: string | null; incluso?: true };

/** La fascia consigliata dai dati: il catalogo grande va sul Premium, una vetrina da rifare sul Business. */
export function fasciaConsigliata(d: DatiAttivita, righe: VoceMancante[]): { id: Abbonamento; perche: string } {
  if (d.prodotti.length >= PRODOTTI_PER_IL_PREMIUM) {
    return { id: 'premium', perche: `Hai ${d.prodotti.length} prodotti in catalogo: con foto e video ogni mese li teniamo tutti in ordine.` };
  }
  const daRifare = righe.filter((r) => r.id === 'foto_video' || r.id === 'sito_web').map((r) => LISTINO[r.id].titolo.toLowerCase());
  if (daRifare.length > 0) {
    return { id: 'business', perche: `Alla tua vetrina mancano ${daRifare.join(' e ')}: il Business li fa e li tiene aggiornati.` };
  }
  return { id: 'base', perche: 'La tua vetrina è già in ordine: il Base basta per tenerla viva.' };
}

/** Il giorno di oggi a Piacenza, AAAA-MM-GG (un preventivo fatto alle 00:30 è di oggi, non di ieri). */
export function giornoDiPiacenza(adesso: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(adesso);
}

/**
 * Il numero del preventivo: giorno + le prime sei cifre dell'attività. È lo
 * stesso per tutta la giornata, così il numero che il cliente dice al telefono
 * è quello che Nicola trova nell'avviso.
 */
export function numeroPreventivo(idAttivita: string, giorno: string): string {
  const sigla = idAttivita.replace(/[^0-9a-z]/gi, '').slice(0, 6).toUpperCase() || 'MYCITY';
  return `P-${giorno.replace(/-/g, '')}-${sigla}`;
}

/**
 * LE CONDIZIONI DELL'ABBONAMENTO — Nicola, 24/11/2026: «disdici quando vuoi», «preavviso di 30
 * giorni», «primo mese a metà prezzo». Messe insieme: nessuna durata minima, la disdetta si dà
 * quando si vuole e vale dopo 30 giorni, e il primo mese costa la metà.
 */
export const CONDIZIONI = {
  preavvisoGiorni: 30,
  /** Il primo mese costa la metà: Base 150 €, Business 300 €, Premium 450 €. */
  primoMeseFrazione: 0.5,
} as const;

/** Il canone del primo mese, in centesimi; `null` se il canone è su richiesta. */
export function canonePrimoMese(centesimi: number | null): number | null {
  return centesimi ? Math.round(centesimi * CONDIZIONI.primoMeseFrazione) : null;
}

export const FRASE_CONDIZIONI =
  `Nessun vincolo di durata: disdici quando vuoi, con ${CONDIZIONI.preavvisoGiorni} giorni di preavviso. Il primo mese costa la metà.`;

/**
 * IL PAREGGIO IN SCONTRINI — 24/11/2026. Un titolare non ragiona in canoni ma in scontrini:
 * «500 € al mese» spaventa, «l'incasso di 6 colazioni in più al giorno» si capisce. È l'incasso,
 * non il guadagno netto: il margine di ogni locale non lo conosciamo, e non lo inventiamo.
 *
 * Lo scontrino di partenza è una stima dell'AD per tipo di attività (24/11), non un dato: sulla
 * pagina il titolare lo cambia col suo, e i conti si rifanno.
 */
export const SCONTRINO_DI_PARTENZA: Record<TipoAttivita, { centesimi: number; cosa: string; una: string }> = {
  negozio: { centesimi: 1_500, cosa: 'scontrini', una: 'scontrino' },
  bar: { centesimi: 300, cosa: 'colazioni', una: 'colazione' },
  ristorante: { centesimi: 2_500, cosa: 'coperti', una: 'coperto' },
  artigiano: { centesimi: 2_000, cosa: 'scontrini', una: 'scontrino' },
  servizi: { centesimi: 3_000, cosa: 'clienti', una: 'cliente' },
  altro: { centesimi: 1_500, cosa: 'scontrini', una: 'scontrino' },
};

/**
 * La frase del pareggio sotto un piano: «Circa 17 € al giorno: l'incasso di 6 colazioni in più al
 * giorno». Sotto i 10 € al giorno si scrivono i centesimi (con 33 centesimi «circa 0 €» era falso),
 * e con 1 si usa il singolare (collaudo, 24/11).
 */
export function frasePareggio(p: Pareggio, tipo: TipoAttivita): { alGiorno: string; quanti: string } {
  const unita = SCONTRINO_DI_PARTENZA[tipo];
  const alGiorno = p.alGiornoCentesimi >= 1_000 ? `${Math.round(p.alGiornoCentesimi / 100)} €` : formatPriceFromCents(p.alGiornoCentesimi);
  return { alGiorno, quanti: `${p.quanti} ${p.quanti === 1 ? unita.una : unita.cosa}` };
}

/** I giorni su cui si divide il canone: un mese di calendario. */
export const GIORNI_DEL_MESE = 30;

export type Pareggio = { alGiornoCentesimi: number; quanti: number };

/** Quanto fa il canone al giorno, e quanti scontrini in più al giorno lo incassano (arrotondato in su). */
export function pareggio(canoneCentesimi: number | null, scontrinoCentesimi: number): Pareggio | null {
  if (!canoneCentesimi || !Number.isFinite(scontrinoCentesimi) || scontrinoCentesimi < 1) return null;
  const alGiorno = canoneCentesimi / GIORNI_DEL_MESE;
  return { alGiornoCentesimi: Math.round(alGiorno), quanti: Math.ceil(alGiorno / scontrinoCentesimi) };
}

/** Le parole del motore di ricerca per tipo: quello che scrive chi cerca «… vicino a me». */
const CERCA_VICINO: Record<TipoAttivita, string> = {
  negozio: 'negozio vicino a me',
  bar: 'bar vicino a me',
  ristorante: 'ristorante vicino a me',
  artigiano: 'laboratorio artigiano vicino a me',
  servizi: 'vicino a me',
  altro: 'vicino a me',
};

/**
 * COSA CI GUADAGNI — il blocco in cima al preventivo (24/11/2026). Solo frasi vere: i fatti della
 * sua vetrina letti dai dati, e cosa cambia con l'abbonamento. Niente numeri di piattaforma
 * («chi ha le foto vende X volte di più») finché non ci sono: al 24/11 il sito ha 2 ordini in
 * tutto, e un numero inventato davanti a un cliente è una bugia (Nicola: «solo frasi vere»).
 */
export function cosaCiGuadagni(righe: readonly VoceMancante[], tipo: TipoAttivita): { oggi: string[]; conNoi: string } {
  const oggi: string[] = [];
  const foto = righe.find((r) => r.id === 'foto_video');
  if (foto) oggi.push(`Chi apre la tua vetrina su MyCity oggi trova questo: ${foto.perche[0].charAt(0).toLowerCase()}${foto.perche[0].slice(1)}`);
  // Solo il fatto letto dai dati: manca l'indirizzo di un sito suo. Non «non trova una pagina tua»:
  // la vetrina MyCity è già nella mappa del sito per Google, e spesso ci sono i social (collaudo, 24/11).
  if (righe.some((r) => r.id === 'sito_web')) oggi.push('Non hai ancora un sito tutto tuo, con il tuo nome.');
  if (righe.some((r) => r.id === 'social')) {
    oggi.push(`Chi cerca «${CERCA_VICINO[tipo]}» vede prima le schede Google complete di orari e foto: se la tua non lo è, vede gli altri.`);
  }
  return {
    oggi: oggi.slice(0, 3),
    // Vera per tutte e tre le fasce: «ogni mese» vale solo per il Premium (collaudo, 24/11).
    conNoi: 'Con l’abbonamento foto, post, sito e scheda Google li facciamo noi: quanto spesso, lo dice il piano che scegli. Tu resti al bancone; ai clienti che arrivano pensa MyCity.',
  };
}

/** Il resoconto che il cliente riceve ogni mese (24/11/2026): il valore si vede anche dopo la firma. */
export const RESOCONTO_MENSILE =
  'Ogni mese ti mandiamo il resoconto: quante persone hanno visto la tua vetrina, quanti ordini e quanto hai incassato su MyCity, e quante persone hanno visto e chiamato dalla tua scheda Google.';

export function costruisciPreventivo(opzioni: {
  idAttivita: string;
  nomeAttivita: string;
  tipoAttivita: TipoAttivita;
  dati: DatiAttivita;
  impostazioni: ImpostazioniAgenzia;
  adesso: Date;
  /** La fascia scelta dal cliente, quando accetta. Assente = sta ancora guardando. */
  scelto?: Abbonamento;
  /** L'abbonamento dei servizi già attivo, letto dal server. */
  attivo?: AbbonamentoAttivo | null;
  /** Falso se il negozio ha già avuto un abbonamento dei servizi. Assente = vero. */
  primoMeseScontato?: boolean;
}): Preventivo {
  const { idAttivita, nomeAttivita, tipoAttivita, dati, impostazioni, adesso, scelto, attivo, primoMeseScontato } = opzioni;
  const mancanti = cosaManca(dati);
  const righe: RigaPreventivo[] = mancanti.map((v) => ({
    ...v,
    titolo: LISTINO[v.id].titolo,
    descrizione: LISTINO[v.id].descrizione,
    ...(LISTINO[v.id].partner ? { partner: LISTINO[v.id].partner } : {}),
  }));
  const consigliato = fasciaConsigliata(dati, mancanti);
  const giorno = giornoDiPiacenza(adesso);
  return {
    numero: numeroPreventivo(idAttivita, giorno),
    data: giorno,
    agenzia: impostazioni.nome,
    attivita: nomeAttivita.trim() || 'La tua attività',
    tipoAttivita,
    righe,
    giaAPosto: SERVIZI_AGENZIA.filter((id) => !mancanti.some((v) => v.id === id)),
    prezzi: impostazioni.prezzi,
    consigliato: consigliato.id,
    perche_consigliato: consigliato.perche,
    scelto: scelto ?? null,
    attivo: attivo ?? null,
    primoMeseScontato: primoMeseScontato ?? true,
  };
}

/** «300,00 € al mese», oppure «su richiesta». */
export function scriviCanone(centesimi: number | null): string {
  return centesimi ? `${formatPriceFromCents(centesimi)} al mese` : 'su richiesta';
}

/**
 * Il testo dell'avviso che arriva a Nicola quando il cliente accetta: chi, quale preventivo,
 * quale abbonamento e a quanto, cosa manca alla vetrina, e il telefono per richiamare.
 */
export function testoAvvisoPreventivo(p: Preventivo, telefono: string | null): string {
  const fascia = p.scelto ?? p.consigliato;
  const manca = p.righe.length > 0
    // Il partner tra parentesi: Nicola sa subito chi chiamare per foto e video.
    ? ` Alla vetrina mancano: ${p.righe.map((r) => (r.partner ? `${r.titolo} (${r.partner})` : r.titolo)).join(', ')}.`
    : '';
  const contatto = telefono ? ` Telefono: ${telefono}.` : '';
  const primo = canonePrimoMese(p.prezzi[fascia]);
  const primoMese = primo ? `, il primo mese ${formatPriceFromCents(primo)}` : '';
  return `${p.attivita} sceglie l'abbonamento ${FASCE[fascia].nome} (${scriviCanone(p.prezzi[fascia])}${primoMese}), preventivo ${p.numero}.${manca}${contatto}`;
}
