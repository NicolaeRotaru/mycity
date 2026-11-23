/**
 * IL PREVENTIVO DI QUELLO CHE MANCA — già pronto quando il cliente apre la dashboard.
 *
 * 22/11/2026 — La dashboard di ogni attività iscritta mostra quello che le manca e
 * il preventivo di MyCity per farlo. Foto e video li fa scattiDG, l'azienda partner a
 * cui MyCity si affida per riprese, scatti, montaggio e ritocco (Nicola, 23/11);
 * social e sito web sono servizi di MyCity. Nicola: «deve già essere creato prima, in formato
 * preventivo/demo» — quindi il cliente non lo chiede: lo trova pronto, calcolato
 * dai suoi dati.
 *
 * I servizi e i prezzi sono di Nicola, 22/11/2026:
 *  · sito web professionale — 500 €;
 *  · gestione automatica dei social (il flusso n8n, «già pronto, basta
 *    collegarlo») — 300 € al mese;
 *  · foto e video, con riprese, scatti, montaggio e ritocco — da 50 a 300 € al
 *    mese, secondo quanto serve;
 *  · logo e grafica — TOLTO dal preventivo il 23/11/2026 (Nicola: «togli sezione di
 *    logo e grafica»).
 * (La vetrina sul marketplace, 50 € al mese, non è una voce del preventivo: il
 * preventivo la mostra con la frase unica dei prezzi dei negozi, che segue
 * l'interruttore dell'abbonamento.)
 *
 * Tutto quello che si decide sta qui, in funzioni senza rete:
 *  · `cosaManca()` guarda i dati dell'attività e dice quali servizi servono e
 *    perché, con il numero vero (es. «12 prodotti sono senza foto»);
 *  · `costruisciPreventivo()` mette le voci in forma di preventivo: numero,
 *    data, prezzi, totali una tantum e al mese;
 *  · `leggiImpostazioniAgenzia()` legge da `site_settings.agenzia` chi firma il
 *    preventivo e i prezzi che Nicola vuole cambiare, senza rifare il sito.
 *
 * Lo stesso calcolo gira sul server quando il cliente accetta: il server non si
 * fida delle voci mandate dal browser.
 */

import type { TipoAttivita } from './tipi-attivita';
import { formatPriceFromCents } from '@/lib/format';

export const SERVIZI_AGENZIA = ['foto_video', 'social', 'sito_web'] as const;
export type ServizioAgenzia = (typeof SERVIZI_AGENZIA)[number];

/**
 * L'indirizzo della pagina di ogni servizio, dentro «Preventivo» (Nicola, 23/11: «ogni servizio
 * ha la sua voce dentro il menu»): /seller/preventivo/<slug>.
 */
export const SLUG_SERVIZIO: Record<ServizioAgenzia, string> = {
  foto_video: 'foto-video',
  social: 'social',
  sito_web: 'sito-web',
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

/** Un servizio si paga una volta, oppure ogni mese. */
export type Cadenza = 'una_tantum' | 'mese';

/** Un prezzo in centesimi: fisso quando `da` e `a` coincidono, altrimenti una fascia. */
export type Prezzo = { da: number; a: number };

type VoceListino = {
  titolo: string;
  /** Cosa comprende, detto senza promettere numeri che nessuno ha fissato. */
  descrizione: string;
  cadenza: Cadenza;
  /** Chi fa il lavoro quando non è MyCity: il cliente lo legge sulla voce, Nicola nell'avviso. */
  partner?: string;
  /** Il prezzo detto da Nicola il 22/11/2026; `null` = su richiesta. */
  prezzo: Prezzo | null;
};

const fisso = (centesimi: number): Prezzo => ({ da: centesimi, a: centesimi });

export const LISTINO: Record<ServizioAgenzia, VoceListino> = {
  foto_video: {
    titolo: 'Foto e video',
    descrizione: 'Scatti e riprese nel tuo locale, con ritocco e montaggio: le foto della copertina, dei prodotti e i video per vetrina e social.',
    cadenza: 'mese',
    prezzo: { da: 5_000, a: 30_000 },
    // Nicola, 23/11: «scattiDG è l'azienda partner a cui MyCity si affida per foto/video making/editing».
    partner: 'scattiDG',
  },
  social: {
    titolo: 'Gestione automatica dei social',
    descrizione: 'I post sui tuoi social li prepariamo e li pubblichiamo noi, in automatico, con le foto della tua vetrina.',
    cadenza: 'mese',
    prezzo: fisso(30_000),
  },
  sito_web: {
    titolo: 'Sito web professionale',
    descrizione: 'Un sito tutto tuo, con il tuo nome, che porta i clienti alla tua vetrina MyCity.',
    cadenza: 'una_tantum',
    prezzo: fisso(50_000),
  },
};

/**
 * Chi firma il preventivo: MyCity. scattiDG è il partner che fa foto e video, e compare
 * sulla sua voce (Nicola, 23/11/2026). Vale finché `site_settings.agenzia.nome` non dice
 * un altro nome: da lì si cambia senza rifare il sito.
 */
export const NOME_AGENZIA_DI_RISERVA = 'MyCity';

/** Un prezzo oltre questo (in centesimi: 10.000 €) è un errore di battitura, non un listino. */
const PREZZO_MASSIMO_CENTESIMI = 1_000_000;

export type ImpostazioniAgenzia = {
  nome: string;
  /** `null` = su richiesta. */
  prezzi: Record<ServizioAgenzia, Prezzo | null>;
};

/**
 * Lo 0 non è un prezzo (collaudo del 23/11): con lo 0 il cliente leggeva «Sito web
 * professionale: 0,00 €». Nessuna voce del listino è gratis; uno 0 scritto per sbaglio
 * nelle impostazioni diventa «su richiesta».
 */
const centesimiValidi = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= PREZZO_MASSIMO_CENTESIMI;

/**
 * Un prezzo scritto in `site_settings.agenzia.prezzi.<servizio>`:
 *  · assente → vale il listino di Nicola;
 *  · `null` → su richiesta;
 *  · un numero di centesimi → prezzo fisso;
 *  · `{ "da": …, "a": … }` → fascia.
 * Qualunque altra cosa (zero, negativo, testo, `da` più alto di `a`) diventa «su
 * richiesta»: meglio nessun prezzo che un prezzo sbagliato davanti a un cliente.
 */
function leggiPrezzo(v: unknown, diListino: Prezzo | null): Prezzo | null {
  if (v === undefined) return diListino;
  if (centesimiValidi(v)) return fisso(v);
  if (v && typeof v === 'object') {
    const { da, a } = v as { da?: unknown; a?: unknown };
    if (centesimiValidi(da) && centesimiValidi(a) && da <= a) return { da, a };
  }
  return null;
}

export function leggiImpostazioniAgenzia(grezzo: unknown): ImpostazioniAgenzia {
  const g = (grezzo && typeof grezzo === 'object' ? grezzo : {}) as { nome?: unknown; prezzi?: unknown };
  const nome = typeof g.nome === 'string' && g.nome.trim().length >= 2 ? g.nome.trim().slice(0, 80) : NOME_AGENZIA_DI_RISERVA;
  const scritti = (g.prezzi && typeof g.prezzi === 'object' ? g.prezzi : {}) as Record<string, unknown>;
  const prezzi = Object.fromEntries(
    SERVIZI_AGENZIA.map((id) => [id, leggiPrezzo(scritti[id], LISTINO[id].prezzo)]),
  ) as Record<ServizioAgenzia, Prezzo | null>;
  return { nome, prezzi };
}

/** Tutti i prezzi «su richiesta»: quando le impostazioni non si leggono per un guasto. */
export function impostazioniSenzaPrezzi(): ImpostazioniAgenzia {
  return {
    nome: NOME_AGENZIA_DI_RISERVA,
    prezzi: Object.fromEntries(SERVIZI_AGENZIA.map((id) => [id, null])) as Record<ServizioAgenzia, Prezzo | null>,
  };
}

export type DatiAttivita = {
  storeLogo: string | null | undefined;
  storeMedia: unknown;
  /** I prodotti ancora in catalogo (non venduti, non esauriti per sempre), con le loro foto. */
  prodotti: { images: unknown }[];
  /** `store_customization.socials`: instagram, facebook, tiktok, whatsapp, website. */
  socials?: unknown;
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

  // La gestione dei social si propone sempre: dai dati non si vede chi pubblica già con
  // costanza, e il cliente può togliere la voce prima di accettare.
  const profili = PROFILI_SOCIAL.filter(([chiave]) => campoPieno(d.socials, chiave)).map(([, nome]) => nome);
  voci.push({
    id: 'social',
    perche: [
      profili.length === 0
        ? 'Nessun profilo social è collegato alla vetrina.'
        : `Hai già ${elenco(profili)}: i post possono partire in automatico, senza che tu li scriva.`,
    ],
  });

  if (!campoPieno(d.socials, 'website')) {
    voci.push({ id: 'sito_web', perche: ['La tua attività non ha ancora un sito web suo.'] });
  }

  return voci;
}

export type RigaPreventivo = VoceMancante & {
  titolo: string;
  descrizione: string;
  cadenza: Cadenza;
  partner?: string;
  /** `null` = su richiesta. */
  prezzo: Prezzo | null;
};

/** Il totale di una cadenza: la somma dei prezzi noti, e i titoli delle voci su richiesta. */
export type Totale = { da: number; a: number; suRichiesta: string[] };

export type Preventivo = {
  numero: string;
  /** AAAA-MM-GG, giorno di Piacenza. */
  data: string;
  agenzia: string;
  attivita: string;
  tipoAttivita: TipoAttivita;
  righe: RigaPreventivo[];
  /** Quello che è già a posto: nel preventivo si vede anche questo. */
  giaAPosto: ServizioAgenzia[];
  /** `null` se nessuna voce si paga una volta sola. */
  totaleUnaTantum: Totale | null;
  /** `null` se nessuna voce si paga al mese. */
  totaleMensile: Totale | null;
};

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

/** Somma le righe di una cadenza. */
export function sommaRighe(righe: RigaPreventivo[]): Totale | null {
  if (righe.length === 0) return null;
  return righe.reduce<Totale>(
    (t, r) =>
      r.prezzo
        ? { ...t, da: t.da + r.prezzo.da, a: t.a + r.prezzo.a }
        : { ...t, suRichiesta: [...t.suRichiesta, r.titolo] },
    { da: 0, a: 0, suRichiesta: [] },
  );
}

export function costruisciPreventivo(opzioni: {
  idAttivita: string;
  nomeAttivita: string;
  tipoAttivita: TipoAttivita;
  dati: DatiAttivita;
  impostazioni: ImpostazioniAgenzia;
  adesso: Date;
  /**
   * Le voci che il cliente ha tenuto, quando accetta. Una voce scelta che non manca
   * davvero non entra: decide `cosaManca`, non il browser. Assente = tutte.
   */
  scelte?: readonly ServizioAgenzia[];
}): Preventivo {
  const { idAttivita, nomeAttivita, tipoAttivita, dati, impostazioni, adesso, scelte } = opzioni;
  const tutteLeMancanti = cosaManca(dati);
  const mancanti = scelte ? tutteLeMancanti.filter((v) => scelte.includes(v.id)) : tutteLeMancanti;
  const righe: RigaPreventivo[] = mancanti.map((v) => ({
    ...v,
    titolo: LISTINO[v.id].titolo,
    descrizione: LISTINO[v.id].descrizione,
    cadenza: LISTINO[v.id].cadenza,
    ...(LISTINO[v.id].partner ? { partner: LISTINO[v.id].partner } : {}),
    prezzo: impostazioni.prezzi[v.id],
  }));
  const giorno = giornoDiPiacenza(adesso);
  return {
    numero: numeroPreventivo(idAttivita, giorno),
    data: giorno,
    agenzia: impostazioni.nome,
    attivita: nomeAttivita.trim() || 'La tua attività',
    tipoAttivita,
    righe,
    giaAPosto: SERVIZI_AGENZIA.filter((id) => !tutteLeMancanti.some((v) => v.id === id)),
    totaleUnaTantum: sommaRighe(righe.filter((r) => r.cadenza === 'una_tantum')),
    totaleMensile: sommaRighe(righe.filter((r) => r.cadenza === 'mese')),
  };
}

const DOPO_IL_PREZZO: Record<Cadenza, string> = { una_tantum: '', mese: ' al mese' };

/** «500,00 €», «300,00 € al mese», «da 50,00 a 300,00 € al mese», «su richiesta». */
export function scriviPrezzo(prezzo: Prezzo | null, cadenza: Cadenza): string {
  if (!prezzo) return 'su richiesta';
  if (prezzo.da === prezzo.a) return `${formatPriceFromCents(prezzo.da)}${DOPO_IL_PREZZO[cadenza]}`;
  return `da ${formatPriceFromCents(prezzo.da)} a ${formatPriceFromCents(prezzo.a)}${DOPO_IL_PREZZO[cadenza]}`;
}

/** Un totale: la parte coi prezzi, più «+ Sito web professionale su richiesta» per le voci senza prezzo. */
export function scriviTotale(t: Totale, cadenza: Cadenza): string {
  const conPrezzo = t.da > 0 || t.a > 0 ? scriviPrezzo({ da: t.da, a: t.a }, cadenza) : '';
  const senza = t.suRichiesta.length > 0 ? `${t.suRichiesta.join(', ')} su richiesta` : '';
  if (conPrezzo && senza) return `${conPrezzo} + ${senza}`;
  return conPrezzo || senza || 'su richiesta';
}

/**
 * Il testo dell'avviso che arriva a Nicola quando il cliente accetta: chi, quale preventivo,
 * quali voci e quanto (una volta / al mese), e il telefono per richiamare.
 */
export function testoAvvisoPreventivo(p: Preventivo, telefono: string | null): string {
  // Il partner tra parentesi: Nicola sa subito chi chiamare per foto e video.
  const voci = p.righe.map((r) => (r.partner ? `${r.titolo} (${r.partner})` : r.titolo)).join(', ');
  const totali = [
    p.totaleUnaTantum ? `una volta ${scriviTotale(p.totaleUnaTantum, 'una_tantum')}` : '',
    p.totaleMensile ? `ogni mese ${scriviTotale(p.totaleMensile, 'mese')}` : '',
  ].filter(Boolean).join('; ');
  const contatto = telefono ? ` Telefono: ${telefono}.` : '';
  return `${p.attivita} vuole il preventivo ${p.numero}: ${voci}.${totali ? ` Totale: ${totali}.` : ''}${contatto}`;
}
