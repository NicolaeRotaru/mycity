import { z } from 'zod';
import { normalizzaSocials, storeCustomizationSchema, type StoreCustomization } from '@/lib/store-customization';
import { indirizzoWebPubblico } from '@/lib/indirizzi-pubblici';

/**
 * «I TUOI CANALI» — dove il titolare scrive i canali da analizzare (24/11/2026).
 *
 * Nicola: «ci deve essere un luogo dove l'imprenditore deve inserire l'id dei social e google e
 * quello che serve per analizzare anche il sito». Sono cinque: Instagram, Facebook, TikTok, il link
 * della scheda Google Maps e l'indirizzo del sito. Si salvano dove il sito li teneva già,
 * `store_customization.socials` (instagram, facebook, tiktok, website), più `google_maps`.
 *
 * Il controllo è quello dei social della vetrina (il link del profilo diventa il nome, i nomi
 * riservati come «/p/…» si fermano), con due regole in più per il sito, che il nostro server manda
 * a Google PageSpeed: solo https e solo un indirizzo pubblico (lib/indirizzi-pubblici.ts).
 * Il WhatsApp non è un canale da analizzare: resta com'è, non si tocca da qui.
 */

export const CANALI = ['instagram', 'facebook', 'tiktok', 'google_maps', 'website'] as const;
export type Canale = (typeof CANALI)[number];
export type Canali = Partial<Record<Canale, string>>;

export const NOMI_CANALI: Record<Canale, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  google_maps: 'Scheda Google Maps',
  website: 'Sito web',
};

const testoCorto = z.string().max(400).optional();
export const CanaliInArrivo = z.object(Object.fromEntries(CANALI.map((c) => [c, testoCorto])) as Record<Canale, typeof testoCorto>).strict();

export type EsitoCanali = { ok: true; canali: Canali } | { ok: false; errori: Partial<Record<Canale, string>> };

const MESSAGGIO_SITO = 'Scrivi l’indirizzo pubblico del tuo sito, per esempio www.panequotidiano.it (solo https).';

/**
 * Controlla e ripulisce i canali scritti dal titolare. Un campo vuoto vuol dire «non ce l'ho»: si
 * salva vuoto, e cancella quello di prima.
 */
export function controllaCanali(grezzi: unknown): EsitoCanali {
  const forma = CanaliInArrivo.safeParse(grezzi ?? {});
  if (!forma.success) return { ok: false, errori: { website: 'Richiesta non leggibile.' } };
  const scritti = Object.fromEntries(CANALI.map((c) => [c, (forma.data[c] ?? '').trim()])) as Record<Canale, string>;
  const corretti = normalizzaSocials({ ...scritti }) as Record<Canale, string>;

  const errori: Partial<Record<Canale, string>> = {};
  const regole = storeCustomizationSchema.shape.socials.unwrap().shape;
  for (const c of ['instagram', 'facebook', 'tiktok', 'google_maps'] as const) {
    const esito = regole[c].safeParse(corretti[c]);
    if (!esito.success) errori[c] = esito.error.issues[0]?.message ?? 'Non valido';
  }
  if (corretti.website) {
    const pubblico = indirizzoWebPubblico(corretti.website);
    if (!pubblico) errori.website = MESSAGGIO_SITO;
    else corretti.website = pubblico.replace(/\/$/, '');
  }
  if (Object.keys(errori).length > 0) return { ok: false, errori };
  return { ok: true, canali: Object.fromEntries(CANALI.map((c) => [c, corretti[c].replace(/^@+/, '')])) as Canali };
}

/** I canali già salvati, letti dai social della vetrina. */
export function canaliDaiSocial(socials: StoreCustomization['socials'] | null | undefined): Canali {
  const s = (socials ?? {}) as Record<string, unknown>;
  return Object.fromEntries(CANALI.map((c) => [c, typeof s[c] === 'string' ? (s[c] as string) : ''])) as Canali;
}

/**
 * I canali salvati, ricontrollati uno per uno (collaudo del 24/11): i social della vetrina si scrivono
 * anche dal site builder, che per il sito accetta qualunque URL. Quello che non passa si lascia fuori.
 */
export function canaliValidi(socials: StoreCustomization['socials'] | null | undefined): Canali {
  const salvati = canaliDaiSocial(socials);
  const fuori: Canali = {};
  for (const c of CANALI) {
    const v = (salvati[c] ?? '').trim();
    if (!v) continue;
    const esito = controllaCanali({ [c]: v });
    if (esito.ok && esito.canali[c]) fuori[c] = esito.canali[c];
  }
  return fuori;
}

/** Vero se il titolare ha scritto almeno un canale. */
export const haCanali = (c: Canali) => CANALI.some((k) => (c[k] ?? '').trim().length > 0);

/** Vero se i canali sono cambiati: solo allora si chiede a n8n un'analisi nuova. */
export function canaliCambiati(prima: Canali, dopo: Canali): boolean {
  return CANALI.some((k) => (prima[k] ?? '').trim() !== (dopo[k] ?? '').trim());
}
