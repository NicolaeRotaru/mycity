// SU MISURA — cosa faremo per QUESTO negozio con ogni abbonamento (Nicola, 26/11/2026: «dentro ogni abbonamento
// deve esserci la personalizzazione esatta del servizio che offriamo al cliente, sono dati che già recuperi devi solo
// studiare e venderli all'azienda»).
//
// Due mani, una riga per servizio:
//  · l'AD, quando ha finito, scrive la frase su misura di ogni fascia (`scheda.su_misura`, passata dai paletti);
//  · fino ad allora, e per ogni frase che l'AD non scrive, la compone il programma con i dati che la scheda ha già:
//    la misura del sito, i profili trovati, i concorrenti sulla mappa libera, i dati incerti, le critiche.
// Il programma non inventa: ogni frase nomina solo cose lette, e la fascia dà solo quello che dice il listino
// (le tabelle del sito e dei social sono quelle firmate da Nicola, uguali al compito dell'AD).

import type { ServizioAgenzia } from '@/lib/agenzia/preventivo';
import { FASCE, type IdFascia } from './fasce';
import type { Scheda } from './scheda';

export type RigaSuMisura = { testo: string; daChi: 'AD' | 'programma' };

const CANALI = ['Instagram', 'Facebook', 'TikTok'];
/** Il raggio della mappa libera in cui si contano i concorrenti (lib/agenti/osm.ts). */
const RAGGIO_M = 450;

const elenco = (voci: string[]) => (voci.length < 2 ? voci.join('') : `${voci.slice(0, -1).join(', ')} e ${voci.at(-1)}`);

const httpsVero = (u: unknown) => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u);
/** Un nome confrontabile: minuscolo, solo lettere e cifre. */
const chiave = (t: string) => t.toLowerCase().replace(/[^\p{L}\d]+/gu, ' ').trim();
const corto = (t: string, max = 40) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

function sitoWeb(s: Scheda, id: IdFascia): string {
  const m = s.sito.misura?.aperto ? s.sito.misura : null;
  const nome = FASCE[id].nome;
  // Il livello vale solo se qualcuno ha guardato il sito. Con la misura in mano vale la stima del programma,
  // a meno che l'AD abbia dato un giudizio suo (non «medio», che nel compito vuol dire anche «non so»).
  // Collaudo del 27/11: prima «medio» diventava «Secondo l'AD il sito è curato, di più pagine» anche senza averlo visto.
  const giudizioAd = s.sito.daChi === 'AD' && s.sito.livello !== 'medio' && s.sito.livello !== 'nessuno' && s.sito.livello !== 'non visto' ? s.sito.livello : null;
  if (!m && s.sito.livello === 'nessuno') {
    const nasce = { base: 'nasce una pagina col suo nome, collegata alla vetrina MyCity', business: 'nasce un sito di più pagine col suo nome', premium: 'nasce un sito di più pagine, aggiornato da noi ogni mese' }[id];
    return `Non abbiamo trovato un sito di ${s.nome}: con il ${nome} ${nasce}.`;
  }
  const vistoDallAd = !m && giudizioAd && httpsVero(s.sito.fonte);
  if (!m && !vistoDallAd) {
    // Tabella firmata: sito non guardato = medio. Si dice cosa succede nei due casi, senza inventare com'è.
    return {
      base: `Il sito non l’abbiamo aperto: chiedi se c’è e com’è. Se c’è, nel ${nome} si tiene e lo colleghiamo alla vetrina; se manca, nasce una pagina col suo nome.`,
      business: `Il sito non l’abbiamo aperto: chiedi se c’è e com’è. Con il ${nome}, se c’è lo rifacciamo di più pagine; se manca, nasce.`,
      premium: `Il sito non l’abbiamo aperto: chiedi se c’è e com’è. Con il ${nome} lo facciamo di più pagine e lo aggiorniamo noi ogni mese.`,
    }[id];
  }
  const grezzo = m ? (giudizioAd ?? m.stima) : giudizioAd;
  // Un sito che si apre non è «nessuno»: vale come semplice.
  const livello: 'semplice' | 'medio' | 'pregio' = grezzo === 'pregio' || grezzo === 'medio' ? grezzo : 'semplice';
  const difetti: string[] = [];
  let oggi: string;
  if (m) {
    if (m.https === false) difetti.push('non è protetto (https)');
    if (!m.telefonino) difetti.push('non è pensato per il telefono');
    const anno = Number(m.anno);
    const vecchio = anno > 1990 && anno <= Number(s.data.slice(0, 4) || new Date().getFullYear()) - 2 ? `in fondo porta ancora l’anno ${anno}` : null;
    oggi = `Il sito di oggi ha ${m.pagine} ${m.pagine === 1 ? 'pagina' : 'pagine'}${difetti.length || vecchio ? `, ${elenco([...difetti, ...(vecchio ? [vecchio] : [])])}` : ''}.`;
  } else {
    oggi = `Secondo l’AD il sito di oggi è ${{ semplice: 'semplice', medio: 'curato', pregio: 'di pregio' }[livello]}.`;
  }
  const fare: Record<'semplice' | 'medio' | 'pregio', Record<IdFascia, string>> = {
    semplice: {
      base: `Con il ${nome} lo rifacciamo: una pagina col suo nome, collegata alla vetrina MyCity.`,
      business: `Con il ${nome} lo rifacciamo di più pagine.`,
      premium: `Con il ${nome} lo rifacciamo di più pagine e lo aggiorniamo noi ogni mese.`,
    },
    medio: {
      base: `Nel ${nome} si tiene e lo colleghiamo alla vetrina MyCity${difetti.length ? '; i difetti di oggi si sistemano dal Business' : ''}.`,
      business: `Con il ${nome} lo rifacciamo, di più pagine${difetti.length ? ', e i difetti di oggi spariscono' : ''}.`,
      premium: `Con il ${nome} lo rifacciamo e lo aggiorniamo noi ogni mese${difetti.length ? ', e i difetti di oggi spariscono' : ''}.`,
    },
    pregio: {
      base: `È curato: nel ${nome} si tiene e lo colleghiamo alla vetrina MyCity${difetti.length ? '; i difetti di oggi si sistemano col Premium' : ''}.`,
      business: `È curato: nel ${nome} si tiene e lo colleghiamo alla vetrina MyCity${difetti.length ? '; i difetti di oggi si sistemano col Premium' : ''}.`,
      // Tabella firmata: di pregio si rifà solo nel Premium e solo scrivendo cosa miglioriamo; il programma non lo sa.
      premium: `Con il ${nome} lo aggiorniamo noi ogni mese${difetti.length ? ', e sistemiamo i difetti di oggi' : ''}.`,
    },
  };
  return `${oggi} ${fare[livello][id]}`;
}

type Profilo = { canale: string; daMappa: boolean; forte: boolean; post: number | null; video: boolean | null; risponde: boolean };
function profili(s: Scheda): Profilo[] {
  return s.social.filter((p) => CANALI.includes(p.canale) && p.stato === 'trovato').map((p) => {
    const g = p.giudizio ?? '';
    const post = Number(g.match(/circa (\d+) post al mese/)?.[1] ?? NaN);
    const video = /con video/i.test(g) ? true : /senza video/i.test(g) ? false : null;
    return {
      canale: p.canale, daMappa: p.origine === 'mappa',
      forte: p.livello === 'forte' || (Number.isFinite(post) && post > 12 && video === true),
      post: Number.isFinite(post) ? post : null, video,
      risponde: /\brispond/i.test(g) && !/\bnon\s+(?:\S+\s+){0,2}rispond/i.test(g),
    };
  });
}

function social(s: Scheda, id: IdFascia): string {
  const tutti = profili(s);
  const veri = tutti.filter((p) => !p.daMappa);
  const mappa = tutti.filter((p) => p.daMappa);
  const mancano = s.completa ? s.social.filter((p) => CANALI.includes(p.canale) && p.stato === 'non_trovato' && !tutti.some((t) => t.canale === p.canale)).map((p) => p.canale) : [];
  // Collaudo del 27/11: un profilo scritto sulla mappa libera non è un fatto, è da controllare.
  const oggi = [
    veri.length ? `Oggi ha un profilo su ${elenco(veri.map((p) => p.canale))}` : null,
    mappa.length ? `sulla mappa libera c’è un profilo ${elenco(mappa.map((p) => p.canale))}, da controllare` : null,
    mancano.length ? `${elenco(mancano)} non ${mancano.length === 1 ? 'l’abbiamo trovato' : 'li abbiamo trovati'}` : null,
  ].filter(Boolean).join('; ');
  const apri = oggi ? `${oggi.charAt(0).toUpperCase()}${oggi.slice(1)}. ` : '';
  const f = FASCE[id];
  const incerti = [...new Set(s.campi.filter((c) => c.stato === 'frammento' && !/^nome$/i.test(c.voce))
    .map((c) => c.voce.replace(/\s*\(.*?\)\s*/g, '').replace(/^Telefono dell’attività$/i, 'telefono').toLowerCase()))].slice(0, 3);
  const google = incerti.length ? `, controllando per primi i dati incerti: ${elenco(incerti)}` : '';
  // Tabella firmata: le risposte alle recensioni dal Business, solo se oggi non risponde.
  const risponde = veri.some((p) => p.risponde);
  const critica = s.reputazione.negativi.find((n) => n.length <= 90);
  const recensioni = risponde ? '' : `Le risposte alle recensioni le scriviamo noi${critica ? `; oggi fra le critiche c’è «${critica.replace(/\.$/, '')}»` : ''}. `;
  const schedaGoogle: Record<IdFascia, string> = {
    base: `La scheda Google la sistemiamo all’avvio${google}.`,
    business: `${recensioni}Scheda Google sistemata${google}.`,
    premium: `La scheda Google la curiamo ogni mese, con foto nuove${risponde ? '' : ' e risposte alle recensioni'}${google}.`,
  };
  // Tabella firmata dei social: forte → gestione solo nel Premium, dicendo cosa aggiungiamo; attivo → dalla prima
  // fascia che fa più post o video di oggi.
  const forte = veri.find((p) => p.forte);
  if (forte) {
    if (id !== 'premium') return `${apri}Su ${forte.canale} pubblica già molto, con video: la gestione dei social si propone solo col Premium. ${schedaGoogle[id]}`;
    return `${apri}Con il Premium aggiungiamo a quello che fa già le storie e ${f.video} video brevi al mese. ${schedaGoogle.premium}`;
  }
  const attivo = veri.filter((p) => p.post !== null).sort((a, b) => (b.post ?? 0) - (a.post ?? 0))[0];
  const faDiPiu = (x: IdFascia) => !attivo || FASCE[x].post > (attivo.post ?? 0) || (FASCE[x].video > 0 && attivo.video === false);
  if (attivo && !faDiPiu(id)) {
    const prima = (['business', 'premium'] as IdFascia[]).find(faDiPiu) ?? 'premium';
    return `${apri}Su ${attivo.canale} pubblica già circa ${attivo.post} post al mese: il ${f.nome} non ne fa di più, la gestione conviene col ${FASCE[prima].nome}. ${schedaGoogle[id]}`;
  }
  const fare: Record<IdFascia, string> = {
    base: `Con il ${f.nome}: ${f.post} post al mese, preparati e pubblicati da noi.`,
    business: `Con il ${f.nome}: ${f.post} post al mese, ${f.video} sono video brevi.`,
    premium: `Con il ${f.nome}: ${f.post} post al mese, ${f.video} video brevi e le storie.`,
  };
  return `${apri}${fare[id]} ${schedaGoogle[id]}`;
}

function analisi(s: Scheda, id: IdFascia): string | null {
  // Collaudo del 27/11: un doppione del negozio stesso sulla mappa non è un concorrente.
  const io = chiave(s.nome);
  const vicini = [...s.concorrenti]
    .filter((c) => { const k = chiave(c.nome); return k && k !== io && !(k.length >= 6 && (io.includes(k) || k.includes(io))); })
    .sort((a, b) => a.distanza - b.distanza);
  if (!vicini.length) return null;
  const nomi = (k: number) => elenco(vicini.slice(0, k).map((c) => `${corto(c.nome)} (${c.distanza} m)`));
  const quanti = Math.max(s.concorrentiContati - (vicini.length < s.concorrenti.length ? 1 : 0), vicini.length);
  return {
    base: quanti === 1
      ? `All’avvio, una volta: entro ${RAGGIO_M} metri c’è un’attività dello stesso tipo, ${corto(vicini[0].nome)} a ${vicini[0].distanza} metri. Poi il piano dei primi 30 giorni.`
      : `All’avvio, una volta: ${quanti} attività dello stesso tipo entro ${RAGGIO_M} metri, la più vicina è ${corto(vicini[0].nome)} a ${vicini[0].distanza} metri. Poi il piano dei primi 30 giorni.`,
    business: `Ogni mese: i 3 concorrenti principali sui social e sul web. Si parte dai più vicini: ${nomi(3)}.`,
    premium: `Ogni settimana: fino a 5 concorrenti sui social e sul web. Si parte dai più vicini: ${nomi(5)}. E un incontro al mese per leggerlo insieme.`,
  }[id];
}

function fotoVideo(s: Scheda, id: IdFascia): string {
  const profili = s.social.filter((p) => CANALI.includes(p.canale) && p.stato === 'trovato');
  const senzaVideo = profili.length > 0 && profili.some((p) => /senza video/i.test(p.giudizio ?? '')) && !profili.some((p) => /con video/i.test(p.giudizio ?? ''));
  const oggi = senzaVideo ? ': oggi sui suoi profili non abbiamo visto video' : '';
  return {
    base: `Foto di ${s.nome} all’avvio: la copertina e i prodotti principali, per la vetrina, il sito e i primi post. I video arrivano dal Business${oggi}.`,
    business: `Foto di ${s.nome} all’avvio e ogni tre mesi, più un video al mese${oggi}.`,
    premium: `Foto e video di ${s.nome} ogni mese${oggi}.`,
  }[id];
}

const DAL_PROGRAMMA: Record<ServizioAgenzia, (s: Scheda, id: IdFascia) => string | null> = {
  foto_video: fotoVideo,
  sito_web: sitoWeb,
  social,
  analisi,
};

/** La riga su misura di un servizio in una fascia: quella dell'AD se c'è, altrimenti quella del programma. */
export function rigaSuMisura(s: Scheda, id: IdFascia, servizio: ServizioAgenzia): RigaSuMisura | null {
  const dallAd = s.su_misura?.[id]?.servizi[servizio];
  if (dallAd) return { testo: dallAd, daChi: 'AD' };
  const dalProgramma = DAL_PROGRAMMA[servizio](s, id);
  return dalProgramma ? { testo: dalProgramma, daChi: 'programma' } : null;
}

/** Cosa ci guadagna questo negozio con la fascia: solo dall'AD (è un giudizio, il programma non lo inventa). */
export function percheSuMisura(s: Scheda, id: IdFascia): string | null {
  return s.su_misura?.[id]?.perche ?? null;
}
