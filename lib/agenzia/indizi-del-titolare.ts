import { controllaCanali } from './canali';

/**
 * GLI INDIZI DEL TITOLARE — 26/11/2026 (Nicola: due campi facoltativi all'iscrizione).
 *
 * Il nome Instagram dell'attività e il link della sua scheda Google Maps. A n8n arrivano come
 * `indizi_del_titolare` (lib/agenzia/nuovo-cliente-n8n.ts): aiutano a trovare il profilo e il place_id giusti.
 * Le stesse regole valgono nel modulo (/sell) e sul server: se il server scarta un indizio, il modulo l'ha già
 * detto al titolare (revisione di mycity#336: prima il link condiviso dal telefono passava il modulo e il server
 * lo scartava in silenzio).
 */
export type IndiziDelTitolare = { instagram?: string; google_maps?: string };

/** I link a un luogo, sui soli domini veri di Google (l'elenco chiuso lo fa `linkGoogleMaps`, dentro `controllaCanali`). */
const LINK_DI_UN_LUOGO = /^https:\/\/(maps\.app\.goo\.gl\/[\w-]+\/?$|goo\.gl\/maps\/[\w-]+\/?$|share\.google\/(?!search\b)[\w-]{6,}\/?$|g\.page\/|g\.co\/kgs\/|(www\.)?google\.[a-z.]+\/maps\/place\/|maps\.google\.[a-z.]+\/(maps)?\?(.*&)?cid=\d+)/i;
/** Pezzi che dicono una persona: il profilo di chi recensisce, una recensione, un percorso, un account, un'email. */
const PEZZI_DI_PERSONE = /\/contrib\/|\/dir\/|\/review|authuser|@[^/]*@|[\w.+-]+@[\w-]+\.|%40/i;

/**
 * Il link della scheda Google ridotto al luogo. Prima si guarda il link intero (un account o un'email dopo «?»
 * lo scartano), poi si toglie la parte dopo «?» (il `g_st=ic` dei link condivisi dal telefono, i parametri di
 * tracciamento), tranne il `cid` che identifica la scheda, e solo allora si controlla che sia un luogo.
 */
function soloIlLuogo(link: string): string | null {
  if (PEZZI_DI_PERSONE.test(link)) return null;
  try {
    const u = new URL(link);
    const cid = u.searchParams.get('cid');
    u.search = cid && /^\d{1,30}$/.test(cid) ? `?cid=${cid}` : '';
    u.hash = '';
    const pulito = u.toString();
    return LINK_DI_UN_LUOGO.test(pulito) ? pulito : null;
  } catch {
    return null;
  }
}

/** Il nome Instagram ripulito, o `null` se non è un nome di profilo valido. */
export function instagramDelTitolare(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  if (!t) return null;
  const esito = controllaCanali({ instagram: t });
  return esito.ok && esito.canali.instagram ? esito.canali.instagram : null;
}

/** Il link della scheda ridotto al luogo, o `null` se non è il link di una scheda Google di un luogo. */
export function schedaGoogleDelTitolare(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  if (!t) return null;
  const esito = controllaCanali({ google_maps: t });
  const pulito = esito.ok ? esito.canali.google_maps : undefined;
  return pulito ? soloIlLuogo(pulito) : null;
}

/** Gli indizi ripuliti; uno storto o vuoto si lascia fuori. `null` se non ne resta nessuno. */
export function indiziDelTitolare(instagram: string | null | undefined, googleMaps: string | null | undefined): IndiziDelTitolare | null {
  const fuori: IndiziDelTitolare = {};
  const ig = instagramDelTitolare(instagram);
  const gm = schedaGoogleDelTitolare(googleMaps);
  if (ig) fuori.instagram = ig;
  if (gm) fuori.google_maps = gm;
  return Object.keys(fuori).length ? fuori : null;
}
