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

function sitoWeb(s: Scheda, id: IdFascia): string {
  const m = s.sito.misura?.aperto ? s.sito.misura : null;
  // Tabella firmata: sito non guardato = medio. Con la misura in mano, «nessuno» non può essere (lo toglie unisci).
  const livello = s.sito.livello === 'non visto' ? 'medio' : s.sito.livello === 'nessuno' && m ? 'semplice' : s.sito.livello;
  if (!m && s.sito.livello === 'nessuno') {
    const nasce = { base: 'nasce una pagina col suo nome, collegata alla vetrina MyCity', business: 'nasce un sito di più pagine col suo nome', premium: 'nasce un sito di più pagine, aggiornato da noi ogni mese' }[id];
    return `Non abbiamo trovato un sito di ${s.nome}: con il ${FASCE[id].nome} ${nasce}.`;
  }
  let oggi: string;
  const difetti: string[] = [];
  if (m) {
    if (m.https === false) difetti.push('non è protetto (https)');
    if (!m.telefonino) difetti.push('non è pensato per il telefono');
    const anno = Number(m.anno);
    const vecchio = anno > 1990 && anno <= Number(s.data.slice(0, 4) || new Date().getFullYear()) - 2 ? `in fondo porta ancora l’anno ${anno}` : null;
    oggi = `Il sito di oggi ha ${m.pagine} ${m.pagine === 1 ? 'pagina' : 'pagine'}${difetti.length || vecchio ? `, ${elenco([...difetti, ...(vecchio ? [vecchio] : [])])}` : ''}.`;
  } else if (s.sito.livello === 'non visto') {
    oggi = 'Il sito non l’abbiamo visto: chiedi se c’è.';
  } else {
    oggi = `Secondo l’AD il sito di oggi è ${{ semplice: 'semplice', medio: 'curato, di più pagine', pregio: 'di pregio', nessuno: 'assente' }[livello as 'semplice']}.`;
  }
  const nome = FASCE[id].nome;
  const fare: Record<string, Record<IdFascia, string>> = {
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
      base: `È già curato: nel ${nome} si tiene e lo colleghiamo alla vetrina MyCity.`,
      business: `È già curato: nel ${nome} si tiene e lo colleghiamo alla vetrina MyCity.`,
      premium: `Con il ${nome} lo aggiorniamo noi ogni mese, e si rifà solo dove c’è da migliorare.`,
    },
  };
  return `${oggi} ${(fare[livello] ?? fare.medio)[id]}`;
}

function social(s: Scheda, id: IdFascia): string {
  const trovati = s.social.filter((p) => CANALI.includes(p.canale) && p.stato === 'trovato').map((p) => p.canale);
  const mancano = s.completa ? s.social.filter((p) => CANALI.includes(p.canale) && p.stato === 'non_trovato' && !trovati.includes(p.canale)).map((p) => p.canale) : [];
  const oggi = [
    trovati.length ? `Oggi ha un profilo su ${elenco(trovati)}` : null,
    mancano.length ? `${trovati.length ? '' : 'Oggi '}${elenco(mancano)} non ${mancano.length === 1 ? 'l’abbiamo trovato' : 'li abbiamo trovati'}` : null,
  ].filter(Boolean).join('; ');
  const f = FASCE[id];
  const daZero = !trovati.length && mancano.length ? ', partendo da zero' : '';
  // I dati incerti (orari, indirizzo…) sono i primi da mettere in ordine sulla scheda Google.
  const incerti = [...new Set(s.campi.filter((c) => c.stato === 'frammento' && !/^nome$/i.test(c.voce))
    .map((c) => c.voce.replace(/\s*\(.*?\)\s*/g, '').replace(/^Telefono dell’attività$/i, 'telefono').toLowerCase()))].slice(0, 3);
  const google = incerti.length ? `, controllando per primi i dati incerti: ${elenco(incerti)}` : '';
  const critica = s.reputazione.negativi.find((n) => n.length <= 90);
  const recensioni = critica ? `; oggi fra le critiche c’è «${critica.replace(/\.$/, '')}»` : '';
  const fare: Record<IdFascia, string> = {
    base: `Con il ${f.nome}: ${f.post} post al mese, preparati e pubblicati da noi${daZero}. La scheda Google la sistemiamo all’avvio${google}.`,
    business: `Con il ${f.nome}: ${f.post} post al mese, ${f.video} sono video brevi${daZero}. Le risposte alle recensioni le scriviamo noi${recensioni}. Scheda Google sistemata${google}.`,
    premium: `Con il ${f.nome}: ${f.post} post al mese, ${f.video} video brevi e le storie${daZero}. La scheda Google la curiamo ogni mese, con foto nuove e risposte alle recensioni${recensioni}.`,
  };
  return `${oggi ? `${oggi}. ` : ''}${fare[id]}`;
}

function analisi(s: Scheda, id: IdFascia): string | null {
  const vicini = [...s.concorrenti].sort((a, b) => a.distanza - b.distanza);
  if (!vicini.length) return null;
  const nomi = (k: number) => elenco(vicini.slice(0, k).map((c) => `${c.nome} (${c.distanza} m)`));
  const quanti = Math.max(s.concorrentiContati, vicini.length);
  return {
    base: quanti === 1
      ? `All’avvio, una volta: entro ${RAGGIO_M} metri c’è un’attività dello stesso tipo, ${vicini[0].nome} a ${vicini[0].distanza} metri. Poi il piano dei primi 30 giorni.`
      : `All’avvio, una volta: ${quanti} attività dello stesso tipo entro ${RAGGIO_M} metri, la più vicina è ${vicini[0].nome} a ${vicini[0].distanza} metri. Poi il piano dei primi 30 giorni.`,
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
