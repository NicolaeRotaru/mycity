// DOPO LA RISPOSTA DELL'AD: IL PROGRAMMA APRE QUELLO CHE L'AD HA SOLO VISTO — 28/11/2026.
//
// L'AD vede solo gli estratti della ricerca e non apre le pagine. Il programma sì (lib/agenti/rete.ts, con le cinture
// contro gli indirizzi interni). Qui:
//  1. apre le pagine dei risultati che l'AD ha visto («pagine_viste»: elenchi, guide, giornali; mai Meta, Google o i
//     portali) e ne prende i collegamenti verso un sito o un profilo che portano il nome del locale;
//  2. apre il sito che l'AD ha messo in «sito.url» e quelli trovati nelle pagine, e tiene il primo che porta il nome e
//     la città del locale; se nessuno va, prova gli indirizzi fatti dai nomi dei profili (raquel_cafe23 → raquelcafe23.it);
//  3. i profili trovati nelle pagine entrano solo se il loro nome porta una parola che distingue il locale.
// Prima del 28/11 il sito dell'AD si apriva solo per mostrarlo (/api/agente/stato) e non arrivava mai al negozio
// iscritto: «Aggiungi attività» ricostruiva la scheda senza aprirlo. Adesso le due porte usano questa funzione.
// La lettura sta qui e non nel flusso 14 di n8n, che per regola non chiama la rete.

import { fontiDi, type Scheda, type Social } from './scheda';
import { maiLetta, indirizzoMaiLetto } from './mai-lette';
import { indovinaSitoDaiProfili, portaIlNome, sitoIndicato, NON_E_UN_SITO, type MisuraSito } from './sito';
import { leggiPagina } from './rete';
import { nomeDelProfilo } from './profili';

type Canale = 'Instagram' | 'Facebook' | 'TikTok';
const dominioDi = (u: string) => { try { return new URL(u).hostname.replace(/^(www\.|m\.)/, '').toLowerCase(); } catch { return ''; } };
const canaleDi = (u: string): Canale | null => {
  const h = dominioDi(u);
  return h === 'instagram.com' ? 'Instagram' : h === 'facebook.com' ? 'Facebook' : h === 'tiktok.com' ? 'TikTok' : null;
};
/** Percorsi di Meta e TikTok che non sono un profilo: condividi, post, reel, ricerche. */
const NON_UN_PROFILO = /^\/(sharer|share|intent|plugins|dialog|tr|p|reel|reels|explore|hashtag|stories|watch|groups|events|search|login|privacy|policies|help|legal)(\/|$)/i;

/**
 * I collegamenti di una pagina che parlano del locale: siti con il nome del locale nel dominio, e profili social.
 * Funzione pura: le prove la usano con pagine finte.
 */
export function collegamentiDellaPagina(html: string, indirizzo: string, nome: string): { siti: string[]; profili: string[] } {
  const siti = new Set<string>();
  const profili = new Set<string>();
  const casa = dominioDi(indirizzo);
  for (const m of html.slice(0, 1_500_000).matchAll(/href=["']([^"'#\s]+)["']/gi)) {
    let u: URL;
    try { u = new URL(m[1].replace(/&amp;/g, '&'), indirizzo); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) continue;
    const h = dominioDi(u.toString());
    if (!h || h === casa) continue;
    const canale = canaleDi(u.toString());
    if (canale) {
      const percorso = u.pathname.replace(/\/+$/, '');
      if (!percorso || NON_UN_PROFILO.test(percorso) || (canale === 'TikTok' && !/^\/@[\w.]+$/.test(percorso))) continue;
      const profilo = canale === 'TikTok' ? percorso.slice(1) : percorso.split('/')[1];
      if (!profilo || !/^[\w.@-]{2,60}$/.test(profilo)) continue;
      profili.add(canale === 'Instagram' ? `https://www.instagram.com/${profilo}/` : canale === 'TikTok' ? `https://www.tiktok.com/${profilo}` : `https://www.facebook.com/${profilo}`);
      continue;
    }
    if (maiLetta(h) || NON_E_UN_SITO.test(h) || !portaIlNome(h, nome)) continue;
    siti.add(`https://${u.hostname}/`);
  }
  return { siti: [...siti].slice(0, 4), profili: [...profili].slice(0, 6) };
}

/** La riga «Misura del sito» della scheda, uguale a quella che scriveva /api/agente/stato. */
function rigaMisura(m: MisuraSito) {
  return `${m.pagine} ${m.pagine === 1 ? 'pagina' : 'pagine'} collegate dalla home · ${m.https === false ? 'non protetto (solo http)' : 'protetto (https)'} · ${m.telefonino ? 'pensato per il telefono' : 'non pensato per il telefono'}${m.piattaforma ? ` · fatto con ${m.piattaforma}` : ''}${m.funzioni.length ? ` · ${m.funzioni.join(', ')}` : ''}`;
}

/** I nomi dei profili Instagram e TikTok già nella scheda, per fare gli indirizzi da provare. */
export function nomiDeiProfili(s: Scheda): string[] {
  return s.social.filter((p) => p.stato === 'trovato' && (p.canale === 'Instagram' || p.canale === 'TikTok'))
    .map((p) => nomeDelProfilo(p.fonte)).filter((x): x is string => !!x);
}

const mettiProfilo = (s: Scheda, voce: Social) => {
  const i = s.social.findIndex((p) => p.canale === voce.canale);
  if (i >= 0) { s.social[i] = voce; return; }
  const g = s.social.findIndex((p) => p.canale === 'Scheda Google Maps');
  s.social.splice(g < 0 ? s.social.length : g, 0, voce);
};

/**
 * Apre e controlla le pagine, il sito e i profili che l'AD ha indicato. Modifica la scheda e la restituisce.
 * `apri`, `daiProfili` e `leggi` si possono sostituire nelle prove (niente rete).
 */
export async function confermaQuelloCheHaTrovatoLAd(
  s: Scheda,
  ad: { sitoUrl?: string | null; pagine?: string[] | null },
  { apri = sitoIndicato, daiProfili = indovinaSitoDaiProfili, leggi = leggiPagina }: { apri?: typeof sitoIndicato; daiProfili?: typeof indovinaSitoDaiProfili; leggi?: typeof leggiPagina } = {},
): Promise<Scheda> {
  // 1. Le pagine viste dall'AD: al massimo 3, insieme, e mai Meta, Google o i portali. Solo se manca qualcosa: il sito
  //    non è ancora confermato, o il profilo Instagram non c'è.
  const manca = !s.sito.misura?.aperto || !s.social.some((p) => p.canale === 'Instagram' && p.stato === 'trovato');
  const daLeggere = manca ? (ad.pagine ?? []).filter((u) => /^https:\/\//i.test(u) && !indirizzoMaiLetto(u)).slice(0, 3) : [];
  const lette = await Promise.all(daLeggere.map((u) => leggi(u, { attesaMs: 3000, maxByte: 1_500_000 })));
  const trovati = { siti: [] as string[], profili: [] as string[] };
  lette.forEach((p) => {
    if (!p.ok || !p.html) return;
    const c = collegamentiDellaPagina(p.html, p.url, s.nome);
    trovati.siti.push(...c.siti);
    trovati.profili.push(...c.profili);
  });

  // 3. I profili trovati nelle pagine: solo se portano il nome del locale, e solo dove la scheda non ne ha uno.
  for (const fonte of [...new Set(trovati.profili)]) {
    const canale = canaleDi(fonte);
    if (!canale) continue;
    if (!portaIlNome(new URL(fonte).pathname, s.nome)) continue;
    if (s.social.some((p) => p.canale === canale && p.stato === 'trovato')) continue;
    mettiProfilo(s, { canale, stato: 'trovato', livello: 'da vedere', giudizio: 'Trovato in una pagina che parla del locale: controlla che sia il suo.', fonte, origine: 'pagine' });
  }

  // 2. Il sito.
  if (!s.sito.misura?.aperto) {
    const candidati = [...new Set([ad.sitoUrl, ...trovati.siti]
      .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u) && !NON_E_UN_SITO.test(dominioDi(u))))].slice(0, 4);
    // Controllo stretto, con l'indirizzo del locale: un sito visto dall'AD o in una pagina può essere di un omonimo.
    const prove = await Promise.all(candidati.map((u) => apri(u, s.nome, s.citta, { indirizzo: s.indirizzo, attesaMs: 3500 })));
    let m = prove.find((x): x is MisuraSito => !!x?.aperto) ?? null;
    let come = m ? (ad.sitoUrl && dominioDi(m.url) === dominioDi(ad.sitoUrl) ? 'l’AD l’ha visto nella ricerca' : 'è collegato da una pagina che parla del locale') : '';
    if (!m) {
      m = await daiProfili(s.nome, s.citta, nomiDeiProfili(s), 3000, s.indirizzo);
      if (m?.aperto) come = 'ha lo stesso nome del profilo social';
    }
    if (m?.aperto) {
      s.sito.misura = m;
      s.sito.fonte = m.url;
      s.campi.push({ voce: 'Misura del sito', valore: rigaMisura(m), stato: 'confermato', fonte: m.url });
      s.avvisi.push(`Il programma ha aperto il sito ${dominioDi(m.url)}: porta il nome e la città del locale (${come}).`);
      // I profili che il sito stesso collega valgono come trovati, più di quelli visti solo dall'AD o in una pagina.
      const dalSito: [Canale, string | undefined][] = [['Instagram', m.social.instagram], ['Facebook', m.social.facebook], ['TikTok', m.social.tiktok]];
      for (const [canale, fonte] of dalSito) {
        if (!fonte) continue;
        const ora = s.social.find((p) => p.canale === canale);
        if (ora && ora.stato === 'trovato' && ora.origine !== 'ad' && ora.origine !== 'pagine') continue;
        mettiProfilo(s, { canale, stato: 'trovato', livello: ora?.livello ?? 'da vedere', giudizio: 'Il sito dell’attività porta a questo profilo.', fonte, origine: 'sito' });
      }
    }
  }
  s.fonti = fontiDi(s);
  return s;
}

/**
 * Il profilo Instagram da passare al flusso 16 come indizio, o `null`. Passa solo un profilo sicuro: collegato dal sito
 * del locale, copiato dal venditore dalla scheda Google, o scritto sulla mappa libera. Uno visto solo dall'AD o trovato
 * in una pagina resta nella scheda, da controllare, ma non va al 16: un omonimo sbaglierebbe tutta l'analisi
 * all'accettazione (collaudo del 28/11).
 */
export function instagramPerIlFlusso(s: Scheda): string | null {
  const p = s.social.find((x) => x.canale === 'Instagram' && x.stato === 'trovato' && x.fonte && (x.origine === 'sito' || x.origine === 'venditore' || x.origine === 'mappa'));
  return nomeDelProfilo(p?.fonte);
}
