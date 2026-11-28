import { z } from 'zod';

import { RITIRO_IN_NEGOZIO_ATTIVO } from './ritiro-in-negozio';
import { giornoPiacenza } from './tempo-piacenza';
import { linkGoogleMaps } from './indirizzi-pubblici';

/**
 * Personalizzazione vetrina negozio — tipi, validazione (zod), cataloghi curati
 * e helper puri. Modulo "single source of truth" sul modello di lib/store-hours.ts.
 *
 * I dati vivono nella colonna JSONB profiles.store_customization (migration 052).
 * La validazione è in app (non nel DB), come per store_hours/store_media.
 *
 * Modalità COLORE: palette CURATA (scelta prodotto) — l'accent è sempre uno degli
 * hex dei preset qui sotto, tutti presi dalle rampe di tailwind.config.ts e tutti
 * sopra 4,5 a 1 sul bianco, perché ci va sopra il testo bianco del pulsante della
 * vetrina. Per passare a "hex libero" basta sostituire accentSchema con un regex hex.
 */

/* ============================================================================
 * Cataloghi curati
 * ========================================================================== */

/**
 * Colori brand-safe per l'accent della vetrina (sfondo con testo bianco).
 *
 * 3/9/2026 — QUATTRO DI QUESTI OTTO COLORI NON ESISTEVANO NEL SITO.
 *
 * Salvia (#2F6F6A), Notte (#3B4A7A), Prugna (#6B3A5B) e Cacao (#5C4033) non
 * comparivano in `tailwind.config.ts`, in `app/globals.css` né nei token del
 * design: erano quattro tinte scritte a mano qui dentro. E non sono decorative:
 * l'accent finisce inline come sfondo del pulsante della vetrina, come striscia
 * della copertina e come colore delle icone dei contatti. Un negozio su
 * «Notte» aveva pulsanti indaco dentro una pagina con la barra terracotta e il
 * piede panna — sembrava un pezzo di un altro sito incollato dentro il nostro.
 *
 * Adesso gli otto colori escono TUTTI dalle rampe del design system. La causa
 * era il modo: l'elenco nasceva a mano, senza nessuno che lo confrontasse con
 * la tavolozza. La prova `tests/unit/la-vetrina-del-negozio-resta-nei-colori-del-sito.test.ts`
 * legge le rampe da `tailwind.config.ts` e pretende che ogni preset sia una di
 * quelle: il prossimo colore inventato diventa rosso.
 */
export const ACCENT_PRESETS = [
  { key: 'terracotta', label: 'Terracotta', hex: '#C0492C' }, // primary-600 (brand)
  { key: 'bordeaux',   label: 'Bordeaux',   hex: '#B82A28' }, // secondary-600
  { key: 'senape',     label: 'Senape',     hex: '#9D621C' }, // accent-700
  { key: 'oliva',      label: 'Oliva',      hex: '#5A7C42' }, // olive-600
  { key: 'bosco',      label: 'Bosco',      hex: '#456236' }, // olive-700
  { key: 'cacao',      label: 'Cacao',      hex: '#69411C' }, // accent-900
  { key: 'vino',       label: 'Vino',       hex: '#5C211A' }, // primary-900
  { key: 'inchiostro', label: 'Inchiostro', hex: '#2C2A28' }, // ink-800
] as const;

/**
 * I colori ritirati e dove finisce chi li aveva scelti.
 *
 * NON è un vezzo, ed è la parte più pericolosa di tutta la riparazione. La
 * validazione qui è tutto-o-niente: un accent che non è più nell'elenco fa
 * fallire l'INTERO `storeCustomization`, che torna vuoto. E chi lo usa non lo
 * legge soltanto — `components/seller/site/ThemePicker.tsx` fa leggi-modifica-
 * scrivi: legge la personalizzazione, ci mette il colore nuovo e RISCRIVE la
 * riga. Quindi togliere i quattro colori senza rimpiazzo vorrebbe dire che il
 * primo negoziante su «Notte» che cambia colore si vede cancellare dal database
 * motto, social, badge, prodotti in vetrina e stile della copertina. Per sempre.
 * Il difetto che stiamo riparando è un colore stonato: la riparazione fatta a
 * metà sarebbe stata la perdita dei dati di un negoziante.
 *
 * La destinazione è il colore della tavolozza più vicino a occhio (distanza
 * CIE76 in Lab), con la tinta rispettata dove esisteva: chi aveva il verde-acqua
 * resta sul verde. Nessuna migrazione: la riga nel database tiene il vecchio
 * esadecimale finché il negoziante non salva, e chi legge vede già il nuovo.
 */
export const ACCENT_RITIRATI: Readonly<Record<string, string>> = {
  '#2F6F6A': '#456236', // Salvia  → Bosco      (ΔE 25,5: il verde più vicino che abbiamo)
  '#3B4A7A': '#2C2A28', // Notte   → Inchiostro (ΔE 35,3: nella tavolozza non c'è nessun blu)
  '#6B3A5B': '#5C211A', // Prugna  → Vino       (ΔE 30,5)
  '#5C4033': '#69411C', // Cacao   → Cacao      (ΔE 16,7: stesso nome, tinta del design)
  // Senape era accent-600 (#C4801F). È nella tavolozza, ma sul pulsante della
  // vetrina ci va sopra il testo bianco e il rapporto era 3,25 a 1: sotto il
  // 4,5 che serve per leggere. Un tono più giù (accent-700) sale a 5,0 e resta
  // la stessa ocra. Il commento in cima al file prometteva già che questi
  // colori garantissero il contrasto sul bianco: adesso è vero.
  '#C4801F': '#9D621C', // Senape  → Senape     (contrasto 3,25 → 5,00)
};

export const DEFAULT_ACCENT = ACCENT_PRESETS[0].hex;
const ACCENT_HEXES: string[] = ACCENT_PRESETS.map((p) => p.hex);

/** Il colore vero da usare: i ritirati diventano il loro sostituto. */
function accentVivo(v: string): string {
  return ACCENT_RITIRATI[v] ?? v;
}

/** Gradienti per la cover quando il negozio non ha foto/video (tutti on-brand). */
export const COVER_PRESETS = [
  { key: 'terracotta', label: 'Cotto',     className: 'bg-gradient-to-br from-primary-500 via-primary-600 to-secondary-600' },
  { key: 'tramonto',   label: 'Tramonto',  className: 'bg-gradient-to-br from-accent-400 via-primary-500 to-secondary-600' },
  { key: 'colli',      label: 'Colli',     className: 'bg-gradient-to-br from-olive-400 via-olive-600 to-ink-700' },
  { key: 'lino',       label: 'Lino',      className: 'bg-gradient-to-br from-cream-200 via-cream-300 to-accent-200' },
  { key: 'zafferano',  label: 'Zafferano', className: 'bg-gradient-to-br from-accent-300 via-accent-500 to-primary-600' },
  { key: 'notte',      label: 'Notte',     className: 'bg-gradient-to-br from-ink-700 via-ink-800 to-ink-900' },
] as const;

export const DEFAULT_COVER = COVER_PRESETS[0].key;
const COVER_KEYS: string[] = COVER_PRESETS.map((p) => p.key);

/** Badge "punti di forza" selezionabili dal venditore (catalogo chiuso). */
const TUTTI_I_BADGE = [
  { key: 'produzione_propria', label: 'Produzione propria' },
  { key: 'consegna_rapida',    label: 'Consegna rapida' },
  { key: 'prodotti_locali',    label: 'Prodotti locali' },
  { key: 'tradizione',         label: 'Tradizione di famiglia' },
  { key: 'bio',                label: 'Biologico' },
  { key: 'artigianale',        label: 'Artigianale' },
  { key: 'ritiro_in_negozio',  label: 'Ritiro in negozio' },
  { key: 'sostenibile',        label: 'Sostenibile' },
] as const;

export type BadgeKey = (typeof TUTTI_I_BADGE)[number]['key'];
/** Tutti i badge che un salvataggio accetta: anche uno spento già scelto non deve rompere il modulo. */
const BADGE_KEYS: string[] = TUTTI_I_BADGE.map((b) => b.key);

/**
 * 31/10/2026 — Un badge che promette un servizio spento non si offre e non si mostra. Il ritiro in
 * negozio è messo da parte (`RITIRO_IN_NEGOZIO_ATTIVO`), ma il negoziante poteva scegliere il
 * bollino «Ritiro in negozio» e la sua pagina lo esponeva, anche come categoria in copertina.
 */
function badgeAttivo(key: string): boolean {
  return key !== 'ritiro_in_negozio' || RITIRO_IN_NEGOZIO_ATTIVO;
}

/** I badge che il venditore può scegliere adesso. */
export const BADGE_CATALOG = TUTTI_I_BADGE.filter((b) => badgeAttivo(b.key));

export const MAX_FEATURED = 8;
export const MAX_BADGES = 6;
export const MAX_TAGLINE = 80;
export const MAX_ANNOUNCEMENT = 160;

/* ============================================================================
 * Schema di validazione (zod)
 * ========================================================================== */

// Modalità curata: accent ∈ hex dei preset. (hex libero => z.string().regex(/^#[0-9a-fA-F]{6}$/))
// I colori ritirati passano dal rimpiazzo PRIMA del controllo: se cadessero qui,
// tutta la personalizzazione del negozio verrebbe buttata via insieme a loro.
const accentSchema = z
  .string()
  .transform(accentVivo)
  .refine((v) => ACCENT_HEXES.includes(v), 'Colore non valido');
const coverSchema = z.string().refine((v) => COVER_KEYS.includes(v), 'Stile cover non valido');

// Handle social: opzionale, accetta stringa vuota. Niente URL completi (li costruiamo noi).
const handleSchema = z
  .string()
  .trim()
  .max(64, 'Troppo lungo')
  .regex(/^@?[A-Za-z0-9._-]+$/, 'Scrivi solo il nome del profilo, per esempio iltuonegozio')
  .optional()
  .or(z.literal(''));

// R10-003 — Un nome di Facebook non ha il trattino basso (lo stesso nome dentro un link è già rifiutato):
// scritto a mano «pane_quotidiano» passava, incollato in un link no.
// R13-009 — Il messaggio del trattino basso viene PRIMA di quello generico: in un link
// «facebook.com/nome_x» il motivo vero del rifiuto è il trattino, non i caratteri del link.
const facebookSchema = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    if (v.length > 64) ctx.addIssue({ code: 'custom', message: 'Troppo lungo' });
    if (v.includes('_')) ctx.addIssue({ code: 'custom', message: 'Il nome di una pagina Facebook non ha il trattino basso: controlla che sia il nome della pagina' });
    if (v && !/^@?[A-Za-z0-9._-]+$/.test(v)) ctx.addIssue({ code: 'custom', message: 'Scrivi solo il nome del profilo, per esempio iltuonegozio' });
  })
  .optional()
  .or(z.literal(''));

const whatsappSchema = z
  .string()
  .trim()
  .regex(/^[0-9+\s]{6,20}$/, 'Scrivi il numero, per esempio 333 1234567')
  .optional()
  .or(z.literal(''));

const websiteSchema = z
  .string()
  .trim()
  .max(200)
  // R13-008 — Solo http o https: «ftp://», «mailto:», «javascript:» e gli schemi storpiati («http//», «https:/», «htp://»)
  // si fermano con un messaggio chiaro. Il dominio nudo è già diventato https:// in normalizzaSocials.
  .superRefine((v, ctx) => {
    // R21-016 — Uno spazio dentro l'indirizzo (nel percorso: «https://negozio.it/a b») non e' un link che funziona:
    // si ferma invece di salvarlo cosi'.
    if (/\s/.test(v)) {
      ctx.addIssue({ code: 'custom', message: "L'indirizzo del sito non puo' avere spazi, per esempio https://www.iltuonegozio.it" });
    } else if (!/^https?:\/\/[^\s/]/i.test(v)) {
      ctx.addIssue({ code: 'custom', message: "L'indirizzo del sito deve cominciare con http:// o https://, per esempio https://www.iltuonegozio.it" });
    } else if (!z.string().url().safeParse(v).success) {
      ctx.addIssue({ code: 'custom', message: "Scrivi l'indirizzo del sito, per esempio www.iltuonegozio.it" });
    }
  })
  .optional()
  .or(z.literal(''));

// 24/11/2026 — Il link della scheda su Google Maps, per l'analisi del business: solo un link di Google,
// https, mai un indirizzo interno (lib/indirizzi-pubblici.ts).
const googleMapsSchema = z
  .string()
  .trim()
  .max(300, 'Troppo lungo')
  .refine((v) => linkGoogleMaps(v) !== null, 'Incolla il link della tua scheda da Google Maps, per esempio https://maps.app.goo.gl/…')
  .optional()
  .or(z.literal(''));

export const storeCustomizationSchema = z.object({
  theme: z
    .object({
      accent: accentSchema.optional(),
      coverStyle: coverSchema.optional(),
    })
    .optional(),
  tagline: z.string().trim().max(MAX_TAGLINE, `Massimo ${MAX_TAGLINE} caratteri`).optional().or(z.literal('')),
  socials: z
    .object({
      instagram: handleSchema,
      facebook: facebookSchema,
      tiktok: handleSchema,
      whatsapp: whatsappSchema,
      website: websiteSchema,
      google_maps: googleMapsSchema,
    })
    .optional(),
  announcement: z
    .object({
      enabled: z.boolean().default(false),
      text: z.string().trim().max(MAX_ANNOUNCEMENT, `Massimo ${MAX_ANNOUNCEMENT} caratteri`).default(''),
      until: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida')
        .optional()
        .or(z.literal('')),
    })
    .optional(),
  featuredProductIds: z.array(z.string().uuid()).max(MAX_FEATURED).optional(),
  badges: z
    .array(z.string().refine((v) => BADGE_KEYS.includes(v), 'Badge non valido'))
    .max(MAX_BADGES)
    .optional(),
});

export type StoreCustomization = z.infer<typeof storeCustomizationSchema>;

/* ============================================================================
 * Helper puri (unit-testabili come lib/store-hours.ts)
 * ========================================================================== */

/** Normalizza un valore qualsiasi (incl. JSONB dal DB) a una StoreCustomization sicura. */
export function normalizeCustomization(raw: unknown): StoreCustomization {
  if (!raw || typeof raw !== 'object') return {};
  const parsed = storeCustomizationSchema.safeParse(raw);
  // R01-010 — Un campo fuori regola non butta più via gli altri: si tiene quello che passa.
  const letti = parsed.success ? parsed.data : salvaQuelloCheVale(raw as Record<string, unknown>);
  const data = conIlSitoGiaSalvato(letti, raw as Record<string, unknown>);
  // Un badge spento già salvato non arriva alla pagina, né all'editor: il prossimo salvataggio lo toglie.
  const { badges } = data;
  return badges ? { ...data, badges: badges.filter(badgeAttivo) } : data;
}

/**
 * Un sito GIÀ salvato che le regole di oggi rifiuterebbero (uno spazio nel percorso, «ftp://», scritto male)
 * si tiene in lettura: altrimenti sparisce dalla vetrina e il primo salvataggio che rilegge la
 * personalizzazione (ThemePicker, StoreDetailsEditor) lo cancella dal database. Si rifiuta solo un valore
 * NUOVO, allo schema di salvataggio. Gli schemi che eseguono codice (javascript:, data:…) no: quelli si scartano.
 * Come link in vetrina si mostra comunque solo http/https (socialLinks).
 */
const SCHEMI_PERICOLOSI = /^(?:javascript|vbscript|data|file|blob):/;
function sitoGiaSalvatoDaTenere(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const w = v.trim();
  if (!w || w.length > 500) return undefined;
  // Il browser ignora spazi e caratteri di controllo dentro lo schema («java\tscript:»).
  if (SCHEMI_PERICOLOSI.test(w.replace(/[\s\u0000-\u001f\u007f-\u009f]/g, '').toLowerCase())) return undefined;
  return w;
}
function conIlSitoGiaSalvato(data: StoreCustomization, raw: Record<string, unknown>): StoreCustomization {
  if (data.socials?.website !== undefined) return data;
  const socials = raw.socials;
  if (!socials || typeof socials !== 'object' || Array.isArray(socials)) return data;
  const website = sitoGiaSalvatoDaTenere((socials as Record<string, unknown>).website);
  return website === undefined ? data : { ...data, socials: { ...data.socials, website } };
}

/**
 * 28/11/2026 (R04-010) — PER CHI MODIFICA E RISCRIVE LA PERSONALIZZAZIONE (StoreDetailsEditor, ThemePicker).
 *
 * normalizeCustomization scarta un Instagram, Facebook, TikTok, WhatsApp o Google Maps GIÀ salvato che le
 * regole di oggi rifiutano («Pane Quotidiano Piacenza», con gli spazi): per la vetrina va bene, il link non
 * si mostra. Ma chi riscrive tutta la personalizzazione partendo da lì lo cancellava dal database al primo
 * «Salva» dei dettagli o al primo cambio di colore, senza dire niente: il campo si apriva già vuoto. Qui si
 * rimette così com'era salvato (come già il sito, sopra): il modulo lo mostra, al «Salva» dice sotto il campo
 * che va corretto e, se non lo si tocca, lo riscrive uguale. Gli schemi che eseguono codice si scartano.
 */
const CHIAVI_SOCIAL = Object.keys(storeCustomizationSchema.shape.socials.unwrap().shape);
export function personalizzazioneDaModificare(raw: unknown): StoreCustomization {
  const data = normalizeCustomization(raw);
  if (!raw || typeof raw !== 'object') return data;
  const socials = (raw as Record<string, unknown>).socials;
  if (!socials || typeof socials !== 'object' || Array.isArray(socials)) return data;
  const letti = (data.socials ?? {}) as Record<string, unknown>;
  const tenuti: Record<string, string> = {};
  for (const k of CHIAVI_SOCIAL) {
    if (letti[k] !== undefined) continue;
    const v = sitoGiaSalvatoDaTenere((socials as Record<string, unknown>)[k]);
    if (v !== undefined) tenuti[k] = v;
  }
  return Object.keys(tenuti).length > 0 ? { ...data, socials: { ...data.socials, ...tenuti } } : data;
}

/**
 * 17/11/2026 (R01-010) — UN CAMPO FUORI REGOLA NON CANCELLA GLI ALTRI.
 *
 * `safeParse` dell'intero oggetto è tutto-o-niente: se domani si toglie una copertina dalla
 * tavolozza o si abbassa MAX_TAGLINE, il negozio che la usava perdeva in vetrina motto, social e
 * annuncio, e al primo cambio di colore (lettura-modifica-scrittura di ThemePicker) o al primo
 * salvataggio dei dettagli (StoreDetailsEditor) li perdeva dal database.
 * Qui ogni campo si controlla per conto suo, e dentro tema, social e annuncio anche ogni voce;
 * negli elenchi si scartano solo gli elementi non validi. Lo schema di salvataggio non cambia:
 * chi scrive resta severo.
 */
function salvaQuelloCheVale(raw: Record<string, unknown>): StoreCustomization {
  const forma = storeCustomizationSchema.shape;
  const out: Record<string, unknown> = {};

  const tieni = (k: string, v: unknown) => { if (v !== undefined) out[k] = v; };
  const parteDiOggetto = (
    schema: { unwrap: () => { shape: Record<string, z.ZodTypeAny> } },
    valore: unknown,
  ): Record<string, unknown> | undefined => {
    if (!valore || typeof valore !== 'object' || Array.isArray(valore)) return undefined;
    const dentro: Record<string, unknown> = {};
    for (const [nome, sotto] of Object.entries(schema.unwrap().shape)) {
      const v = (valore as Record<string, unknown>)[nome];
      if (v === undefined) continue;
      const r = sotto.safeParse(v);
      if (r.success && r.data !== undefined) dentro[nome] = r.data;
    }
    return Object.keys(dentro).length > 0 ? dentro : undefined;
  };

  const tagline = forma.tagline.safeParse(raw.tagline);
  if (tagline.success) tieni('tagline', tagline.data);

  tieni('theme', parteDiOggetto(forma.theme, raw.theme));
  tieni('socials', parteDiOggetto(forma.socials, raw.socials));
  // L'annuncio si tiene acceso solo se è valido tutto intero. Se un suo campo non vale (il testo,
  // la data di scadenza), si tengono i campi buoni ma l'annuncio resta SPENTO: un annuncio senza
  // la sua scadenza non deve restare in vetrina per sempre. Il resto della vetrina non sparisce.
  const annuncioIntero = forma.announcement.safeParse(raw.announcement);
  if (annuncioIntero.success) tieni('announcement', annuncioIntero.data);
  else {
    const annuncio = parteDiOggetto(forma.announcement, raw.announcement);
    if (annuncio) {
      const r = forma.announcement.safeParse({ ...annuncio, enabled: false });
      if (r.success) tieni('announcement', r.data);
    }
  }

  if (Array.isArray(raw.featuredProductIds)) {
    const buoni = raw.featuredProductIds.filter((v) => z.string().uuid().safeParse(v).success);
    tieni('featuredProductIds', buoni.slice(0, MAX_FEATURED));
  }
  if (Array.isArray(raw.badges)) {
    const buoni = raw.badges.filter((v): v is string => typeof v === 'string' && BADGE_KEYS.includes(v));
    tieni('badges', buoni.slice(0, MAX_BADGES));
  }

  // Controllo finale: quello che si restituisce passa comunque lo schema.
  const finale = storeCustomizationSchema.safeParse(out);
  return finale.success ? finale.data : {};
}

/** Hex dell'accent, con fallback al brand se assente/non valido. */
export function accentHex(c?: StoreCustomization | null): string {
  const a = c?.theme?.accent ? accentVivo(c.theme.accent) : undefined;
  return a && ACCENT_HEXES.includes(a) ? a : DEFAULT_ACCENT;
}

/** Classe Tailwind del gradiente cover (fallback al primo preset on-brand). */
export function coverClassName(c?: StoreCustomization | null): string {
  const k = c?.theme?.coverStyle;
  return COVER_PRESETS.find((p) => p.key === k)?.className ?? COVER_PRESETS[0].className;
}

/** Vero se l'annuncio è abilitato, ha testo e non è scaduto. */
export function announcementActive(c?: StoreCustomization | null, now: Date = new Date()): boolean {
  const a = c?.announcement;
  if (!a?.enabled) return false;
  if (!a.text || !a.text.trim()) return false;
  if (a.until) {
    // «Fino al 6/11» vale tutto il 6 a Piacenza, sul server (UTC) come nel browser: si confronta il
    // giorno di Piacenza di adesso con `until`, non una data costruita nel fuso di chi esegue.
    if (/^\d{4}-\d{2}-\d{2}$/.test(a.until) && giornoPiacenza(now) > a.until) return false;
  }
  return true;
}

export type SocialLink = { key: string; label: string; href: string };

/**
 * R10-014 — Il primo pezzo del percorso che non è un nome cambia da un social all'altro: un elenco
 * unico fermava anche un profilo vero di Instagram o TikTok chiamato «live», «help» o «business».
 */
const RISERVATI_FACEBOOK = new RegExp(
  '^(?:profile\\.php|p|reel|reels|share|groups|pages|watch|people|events|photo|photo\\.php|photos|marketplace|hashtag|stories|story\\.php|permalink\\.php|pg|gaming|video|videos|media|sharer|sharer\\.php|login|login\\.php|plugins|dialog|l\\.php|ads|business|help|policies|privacy|settings|notifications|messages|friends|bookmarks|search|public|fundraisers|live|reviews|lite|home|notes|recover|places|saved|memories|jobs|offers|menu|me|pymk|find-friends|onthisday|games|latest|feed|feeds|donate|fundraiser|watchparty|about|legal|terms|careers|composer|creatorstudio|messenger|unsupportedbrowser|checkpoint|crisisresponse|community|developers|profile|story|permalink|topic|topics|directory|security|cookies|support|inbox|oauth|adsmanager|instantgames|logout|recommendations|biz|creators|tr|ajax|requests|invite|invites|groupcampaign|gamingvideo|tournaments|pokes|poke|birthdays|communities|fbreels|apps|flx|groupsbrowse|sharing|welcome|touch|zero|mobile|m|commerce|shops|workplace|oculus|fbwatch|newsroom|accountscenter|reg|campaign|brandedcontent|formedia|facebookmedia|votinginformationcenter|climatescience|pagesmanager|qr|codegen|subscriptions|audiencenetwork|whitehat|transparency|privacycenter|policy|cookie|stars|professionaldashboard|groupsmanager|eventsmanager|businesssuite|metaverified|verified|appcenter|bugbounty)$',
  'i',
);
const RISERVATI_INSTAGRAM = /^(?:p|reel|reels|stories|explore|direct|accounts|tv|share|about|legal|developer|web)$/i;
const RISERVATI_TIKTOK = /^(?:t|tag|discover|video|music|search|share|embed|explore|live|foryou|following)$/i;

/**
 * R10-014 — Su Facebook un elenco di esclusioni non chiude la classe («home.php», «/notes/x»,
 * «/recover/initiate», «/places/x» si salvavano come nome). Il link è di un profilo solo se il nome
 * non è una pagina .php e, quando dopo il nome c'è altro percorso, il pezzo successivo è una
 * sottopagina di un profilo («/pane-quotidiano/posts/1»).
 */
const SOTTOPAGINE_DI_UN_PROFILO_FACEBOOK =
  /^(?:posts|photos|videos|about|reviews|events|mentions|reels|live|menu|shop|services|followers|friends|community|grid|map|timeline|info|photos_by|photos_of|photos_albums|photos_all|photos_stream|videos_by|videos_of|about_details|about_[a-z_]+|friends_[a-z_]+|offers|jobs|likes|following|groups|music|movies|tv|books|notes|photo|video|reviews_given|friends_mutual|sports|events_past|events_upcoming)$/i;
/**
 * 28/11/2026 (R04-011, onda 2) — L'ELENCO NON CHIUDE MAI LA CLASSE: SI GUARDA ANCHE LA CODA.
 * Un percorso di una parola che l'elenco non conosce resta indistinguibile da un nome vero. Ma un link
 * che porta un post, una foto o un video ha la sua coda: «?story_fbid=», «?fbid=», «?v=», «?set=»,
 * «?id=». Il link di un profilo non la porta mai (al più «?mibextid=», «?ref=», «?sk=»).
 */
const CODA_DI_UN_CONTENUTO_FACEBOOK = /(?:^|&)(?:story_fbid|fbid|v|set|id|multi_permalinks|comment_id|post_id|video_id|photo_id)=/i;
function percorsoDiUnProfiloFacebook(nome: string, resto: string, coda = ''): boolean {
  if (/\.php$/i.test(nome)) return false;
  if (CODA_DI_UN_CONTENUTO_FACEBOOK.test(coda)) return false;
  // R07-009 — Il nome di un profilo Facebook è fatto di lettere, cifre e punti, mai del trattino basso:
  // «business_help», «coronavirus_info» e simili sono pagine di Facebook, non un nome.
  if (nome.includes('_')) return false;
  const pezzi = resto.split('/').filter(Boolean);
  return pezzi.length === 0 || SOTTOPAGINE_DI_UN_PROFILO_FACEBOOK.test(pezzi[0]);
}

type RegolaDelSocial = {
  dominio: RegExp;
  riservati: RegExp;
  /** R13-007 — Su TikTok un profilo si scrive sempre con la @: con la @ il nome non è mai un percorso riservato. */
  arobaFaProfilo?: boolean;
  percorsoDiUnProfilo?: (nome: string, resto: string, coda?: string) => boolean;
};

/**
 * 295 — Il negoziante incolla il link del profilo, non il nome: da
 * «https://www.instagram.com/panequotidiano/» si tiene «panequotidiano».
 */
function handleDaLink(v: string | undefined, regola: RegolaDelSocial): string | undefined {
  if (v === undefined) return v;
  const t = v.trim();
  const m = t.match(
    new RegExp(`^(?:https?:\\/\\/)?(?:www\\.|m\\.)?${regola.dominio.source}\\/(@?)([A-Za-z0-9._-]+)(?=$|[\\/?#])([^?#]*)`, 'i'),
  );
  // «profile.php?id=…», «/p/…», «/reel/…», «/share/…» non sono il nome del profilo: si lascia
  // il valore com'è, e il controllo lo ferma invece di salvare un link sbagliato.
  // R10-010 — Il link copiato dall'app porta dietro «?igsh=…» o «?hl=it»: dopo il nome del profilo
  // la coda non conta, si tiene il nome (prima ogni «?» fermava anche un profilo vero).
  const riservato = m && !(regola.arobaFaProfilo && m[1] === '@') && regola.riservati.test(m[2]);
  const coda = t.includes('?') ? t.slice(t.indexOf('?') + 1).split('#')[0] : '';
  if (m && (riservato || (regola.percorsoDiUnProfilo && !regola.percorsoDiUnProfilo(m[2], m[3], coda)))) {
    return t;
  }
  return (m ? m[2] : t).replace(/^@+/, '');
}

/**
 * 580 — Il numero WhatsApp all'italiana: «333 1234567» diventa 393331234567,
 * «0523 123456» 390523123456; 0039 e +39 restano 39. wa.me legge le prime
 * cifre come prefisso: senza il 39 un cellulare italiano diventava francese (+33).
 */
export function numeroWhatsappItaliano(v: string | undefined | null): string {
  let d = String(v ?? '').trim();
  const conPiu = d.startsWith('+');
  d = d.replace(/[^0-9]/g, '');
  if (d.startsWith('00')) return d.slice(2);
  if (conPiu) return d;
  if (d.startsWith('39') && d.length >= 11) return d;
  if (/^3\d{8,9}$/.test(d) || d.startsWith('0')) return `39${d}`;
  return d;
}

/** I campi social come li salva il sito, dopo aver corretto quello che si corregge da solo. */
export function normalizzaSocials(s: StoreCustomization['socials']): StoreCustomization['socials'] {
  if (!s) return s;
  const out = { ...s };
  out.instagram = handleDaLink(s.instagram, { dominio: /instagram\.com/, riservati: RISERVATI_INSTAGRAM });
  out.facebook = handleDaLink(s.facebook, {
    dominio: /(?:facebook|fb)\.com/,
    riservati: RISERVATI_FACEBOOK,
    percorsoDiUnProfilo: percorsoDiUnProfiloFacebook,
  });
  out.tiktok = handleDaLink(s.tiktok, { dominio: /tiktok\.com/, riservati: RISERVATI_TIKTOK, arobaFaProfilo: true });
  if (s.website !== undefined) {
    const w = s.website.trim();
    // Un dominio nudo prende https://; un indirizzo che ha già uno schema (giusto o sbagliato) resta com'è e lo schema lo giudica.
    const conSchema = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(w) || /^[a-z]+\/\//i.test(w);
    // R21-016 — «//negozio.it» non e' un dominio nudo: non prende https:// (diventava «https:////negozio.it»), resta com'e' e lo schema lo rifiuta.
    out.website = w && !conSchema && !w.startsWith('//') && /\./.test(w) ? `https://${w}` : w;
  }
  if (s.google_maps !== undefined) {
    const g = s.google_maps.trim();
    out.google_maps = g ? (linkGoogleMaps(g) ?? g) : '';
  }
  if (s.whatsapp !== undefined) {
    const n = numeroWhatsappItaliano(s.whatsapp);
    out.whatsapp = s.whatsapp.trim() ? (n ? `+${n}` : s.whatsapp.trim()) : '';
  }
  return out;
}

/** Il campo della personalizzazione a cui si riferisce un errore, detto in parole. */
export function campoDellErrore(path: ReadonlyArray<PropertyKey>): string | null {
  const nomi: Record<string, string> = {
    instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', whatsapp: 'WhatsApp', website: 'Sito web',
    google_maps: 'Scheda Google Maps',
  };
  if (path[0] === 'socials' && typeof path[1] === 'string') return nomi[path[1]] ?? path[1];
  return null;
}

function cleanHandle(v?: string): string | null {
  if (!v) return null;
  const h = v.trim().replace(/^@+/, '');
  return /^[A-Za-z0-9._-]+$/.test(h) ? h : null;
}

/** Costruisce i link social assoluti e validati (scarta valori malformati). */
export function socialLinks(c?: StoreCustomization | null): SocialLink[] {
  const s = c?.socials;
  if (!s) return [];
  const out: SocialLink[] = [];

  const ig = cleanHandle(s.instagram);
  if (ig) out.push({ key: 'instagram', label: 'Instagram', href: `https://instagram.com/${ig}` });

  const fb = cleanHandle(s.facebook);
  if (fb) out.push({ key: 'facebook', label: 'Facebook', href: `https://facebook.com/${fb}` });

  const tk = cleanHandle(s.tiktok);
  if (tk) out.push({ key: 'tiktok', label: 'TikTok', href: `https://www.tiktok.com/@${tk}` });

  const wa = numeroWhatsappItaliano(s.whatsapp);
  if (wa.length >= 6) out.push({ key: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/${wa}` });

  const web = (s.website ?? '').trim();
  if (web && /^https?:\/\//i.test(web)) out.push({ key: 'website', label: 'Sito web', href: web });

  return out;
}

export function badgeLabel(key: string): string {
  return TUTTI_I_BADGE.find((b) => b.key === key)?.label ?? key;
}
