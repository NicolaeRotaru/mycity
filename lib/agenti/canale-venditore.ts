// IL SITO O IL PROFILO CHE IL VENDITORE VEDE SULLA SCHEDA GOOGLE — 28/11/2026.
//
// La caffetteria di prova (Raquel 💗 Cafè, Piazza Duomo 23) è uscita «senza sito» due volte, il 28/11 alle 10:02 e
// alle 10:04. Il sito c'è: sta sulla scheda Google che il venditore ha aperto sul telefono. Ma la macchina dal link
// legge solo nome e indirizzo (regola dei dati Google), i motori di ricerca non lo mostrano, la mappa libera non ha
// il locale. Nicola: «è importantissimo che si trovino subito durante l'analisi il sito web e le pagine social».
//
// Un campo facoltativo accanto al link: il venditore copia quello che vede (il sito, oppure il profilo Instagram,
// Facebook o TikTok). Qui si capisce che cos'è. Il sito poi si apre e si controlla (lib/agenti/sito.ts,
// `sitoIndicato`): se non porta il nome e la città del locale, non si usa.

import { controllaCanali } from '@/lib/agenzia/canali';

export type CanaleDelVenditore = {
  /** L'indirizzo del sito come l'ha scritto il venditore, con https:// davanti se mancava. Da aprire e controllare. */
  sito: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
};

const vuoto = (): CanaleDelVenditore => ({ sito: null, instagram: null, facebook: null, tiktok: null });

/** Link di Google (mappe, scheda, ricerca): non sono il sito del locale. */
const DI_GOOGLE = /(^|\.)(google\.[a-z.]+|goo\.gl|g\.co|g\.page|share\.google)$/i;

const canale = (nome: 'instagram' | 'facebook' | 'tiktok', valore: string): string | null => {
  const esito = controllaCanali({ [nome]: valore });
  return esito.ok && esito.canali[nome] ? esito.canali[nome] : null;
};

/**
 * Quello che il venditore ha scritto nel campo, capito: `null` se il campo è vuoto o non si capisce.
 * «@raquel_cafe23», «instagram.com/raquel_cafe23», o un nome senza punti → Instagram; «facebook.com/…» → Facebook;
 * «tiktok.com/@…» → TikTok; un indirizzo con un dominio → sito. Un link di Google non vale come sito.
 */
export function leggiCanaleDelVenditore(grezzo: unknown): CanaleDelVenditore | null {
  const t = String(grezzo ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!t) return null;
  const fuori = vuoto();
  // Un nome con un punto ma senza un'estensione vera («pane.quotidiano») è un profilo Instagram, non un sito (collaudo).
  const senzaEstensioneVera = /^[A-Za-z0-9_.]{2,30}$/.test(t) && !/\.(it|com|net|org|eu|info|biz|shop|store|online|site|cafe|bar|pizza|restaurant|menu|app|io|me|co|uk|de|fr|es|ch|at|sm|wine|club|live|page|xyz)$/i.test(t);
  if (/instagram\.com\//i.test(t) || /^@[\w.]+$/.test(t) || /^[A-Za-z0-9_]{2,30}$/.test(t) || senzaEstensioneVera) {
    fuori.instagram = canale('instagram', t);
    return fuori.instagram ? fuori : null;
  }
  if (/(^|\/\/|\.)(facebook|fb)\.com\//i.test(t)) {
    fuori.facebook = canale('facebook', t);
    return fuori.facebook ? fuori : null;
  }
  if (/tiktok\.com\/@/i.test(t)) {
    fuori.tiktok = canale('tiktok', t);
    return fuori.tiktok ? fuori : null;
  }
  const conSchema = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  let u: URL;
  try { u = new URL(conSchema); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) || u.username || u.password) return null;
  if (DI_GOOGLE.test(u.hostname)) return null;
  fuori.sito = u.toString();
  return fuori;
}

export { linkDelProfilo, nomeDelProfilo } from './profili';
