import type { ImageLoaderProps } from 'next/image';
import caricatoreFotoRemote from '@/lib/image-loader';
import { pixelDellaTaglia, riquadroDichiarato, sizedImage } from '@/lib/image-url';

/**
 * DOVE VIVE LA FOTO DI UN NEGOZIO, E QUANTO È GRANDE DAVVERO QUEL RIQUADRO.
 *
 * 8/9/2026 — LA VETRINA SCARICAVA SEI COPERTINE DA PAGINA INTERA PER SEI
 * RIQUADRI ALTI 112 PUNTI, E LE MARCAVA URGENTI.
 *
 * `StoreMediaCarousel` serve due posti diversi: la copertina a tutta pagina del
 * negozio e la miniatura dentro la scheda della vetrina. La misura però era
 * scritta dentro il componente, uguale per tutti e due: chiedeva la versione da
 * 1200 pixel e dichiarava al browser `sizes="…1024px"`, mentre nella scheda il
 * riquadro è alto 112 punti e largo circa 300. In più `priority` era acceso
 * sulla prima foto di ogni carosello: con sei negozi in vetrina sono sei
 * immagini grandi precaricate nell'intestazione, pur stando sotto la piega —
 * cioè sei download urgenti che rubano banda a quello che si vede davvero.
 *
 * LA MALATTIA, non il sintomo: le due misure — quella CHIESTA al CDN e quella
 * DICHIARATA al browser — vivevano in due punti diversi, scritte a mano. Basta
 * che una delle due sbagli posto e la cura salta. Qui il posto si dichiara una
 * volta sola (`RIQUADRO_DELLA_FOTO`) e la larghezza chiesta si RICAVA da quella
 * dichiarazione: non possono più divergere, perché sono lo stesso numero.
 *
 * ⚠️ Il riquadro non lo indovina nessuno: sta scritto nella griglia della
 * pagina, ed è per questo che i posti sono tre e non due (vedi sotto).
 */

/**
 * I tre posti in cui il sito mostra la foto di un negozio. Non è un vezzo: la
 * larghezza del riquadro la decide la griglia della PAGINA, non il componente.
 *  - `copertina`        → la banda a tutta pagina di `/store/[id]` (h-60).
 *  - `scheda-in-vetrina`→ la scheda della home: due colonne da telefono.
 *  - `scheda-in-elenco` → la stessa scheda in `/stores`: UNA colonna da
 *    telefono, cioè un riquadro largo il doppio. Dichiararlo 50vw come in
 *    vetrina servirebbe una foto della metà dei punti che occupa: sgranata.
 */
export type PostoDellaFoto = 'copertina' | 'scheda-in-vetrina' | 'scheda-in-elenco';

/**
 * Il riquadro di ogni posto, nella lingua che il browser legge (`sizes`).
 *
 * I numeri sono misurati sulle griglie vere, non scelti a occhio:
 *  - vetrina (`grid-cols-2 … lg:grid-cols-4` dentro `container px-4 sm:px-6`):
 *    su un telefono da 390 punti la scheda ne occupa ~171, cioè il 44% —
 *    dichiarati 50vw, un filo abbondante perché una foto un po' più grande si
 *    vede bene e una più piccola no. Da computer la colonna sta fra 296 e 360:
 *    dichiarati 320.
 *  - elenco (`grid-cols-1 … xl:grid-cols-4` dentro `max-w-7xl`): da telefono la
 *    scheda è larga quanto lo schermo (100vw), a schermo medio metà, poi 296.
 *  - copertina: banda piena fino a 768, poi il contenitore da 1024.
 */
export const RIQUADRO_DELLA_FOTO: Record<PostoDellaFoto, string> = {
  copertina: '(max-width: 768px) 100vw, 1024px',
  'scheda-in-vetrina': '(max-width: 640px) 50vw, 320px',
  'scheda-in-elenco': '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 320px',
};

/**
 * Se il posto non si riconosce si sceglie il riquadro PIÙ LARGO fra le schede.
 * Una foto più grande del necessario costa banda; una più piccola si vede
 * sgranata e non si può rimediare. Fra i due errori si sceglie quello che non
 * si vede.
 */
const POSTO_DI_RIPIEGO: PostoDellaFoto = 'scheda-in-elenco';

/**
 * Quanti pixel veri sta un punto dello schermo. Sui telefoni sono due (o tre):
 * chiederne 320 per un riquadro da 320 punti darebbe una foto sfocata su
 * qualunque telefono recente. È lo stesso ragionamento — e lo stesso numero —
 * di `logoNegozio` in `lib/image-url.ts`.
 */
const PIXEL_PER_PUNTO = 2;

/** La larghezza del riquadro in punti, letta dalla dichiarazione. `null` se il posto la esprime solo in percentuale di schermo. */
export function larghezzaDelRiquadro(posto: PostoDellaFoto): number | null {
  return riquadroDichiarato(RIQUADRO_DELLA_FOTO[posto] ?? RIQUADRO_DELLA_FOTO[POSTO_DI_RIPIEGO]).px;
}

export type FotoDaMostrare = {
  /** L'indirizzo da dare a `<Image src>`. */
  src: string;
  /** Il riquadro dichiarato al browser: `<Image sizes>`. */
  sizes: string;
  /** `<Image priority>`: acceso solo se chi usa il componente lo chiede, e solo sulla prima foto. */
  priority: boolean;
};

/**
 * Tutto quello che serve a `<Image>` per UNA foto di negozio, deciso in un
 * posto solo.
 *
 * @param url     l'indirizzo della foto come sta nel database.
 * @param posto   dove verrà mostrata: è la sola cosa che chi usa deve sapere.
 * @param opzioni `indice` = la posizione nel carosello (la seconda foto non è
 *                mai urgente: nessuno l'ha ancora fatta scorrere).
 *                `priority` = la RICHIESTA di chi usa il componente. Spento di
 *                fabbrica: «urgente» deve essere una scelta di chi conosce la
 *                pagina, non un caso.
 */
export function fotoDelNegozio(
  url: string | null | undefined,
  posto: PostoDellaFoto,
  opzioni: { indice?: number; priority?: boolean } = {},
): FotoDaMostrare {
  const sizes = RIQUADRO_DELLA_FOTO[posto] ?? RIQUADRO_DELLA_FOTO[POSTO_DI_RIPIEGO];
  const riquadro = riquadroDichiarato(sizes).px ?? pixelDellaTaglia('card');
  return {
    // Il ritaglio quadrato resta spento: nessuno di questi riquadri è quadrato
    // (la copertina è una banda, la scheda è alta 112 punti su ~300 di larghezza)
    // e un ritaglio quadrato mangia i lati della foto.
    src: sizedImage(url, riquadro * PIXEL_PER_PUNTO, { quadrato: false }),
    sizes,
    priority: opzioni.priority === true && (opzioni.indice ?? 0) === 0,
  };
}

/**
 * Il caricatore per i riquadri LARGHI (copertine e schede negozio).
 *
 * `lib/image-loader.ts` decide il ritaglio dalla larghezza chiesta, non da chi
 * chiama: sotto i 600 pixel ricade nelle fasce `card`/`thumb`, che ritagliano
 * quadrato, e su Pexels ritaglia sempre. Finché la foto veniva chiesta da 1024
 * punti il caso non si presentava; adesso che la scheda ne chiede 320, il
 * browser sceglie la variante da 384 — e senza questo strato la copertina del
 * negozio arriverebbe ritagliata a quadrato e ingrandita, cioè si vedrebbe MENO
 * negozio di prima. Qui il ritaglio si toglie dove il riquadro non è quadrato.
 *
 * ⚠️ Questo NON ripara il caricatore generale: quel difetto (il ritaglio deciso
 * dalla larghezza invece che da chi chiama) è segnalato a parte, perché tocca
 * una ventina di punti e va guardato a video prima di cambiarlo.
 */
export function caricatoreDelRiquadroLargo(parametri: ImageLoaderProps): string {
  const indirizzo = caricatoreFotoRemote(parametri);
  try {
    const url = new URL(indirizzo);
    if (!url.searchParams.has('height') && !url.searchParams.has('h')) return indirizzo;
    url.searchParams.delete('height'); // Supabase
    url.searchParams.delete('h'); // Pexels
    if (url.searchParams.get('fit') === 'crop') url.searchParams.delete('fit');
    return url.toString();
  } catch {
    // Percorsi locali (`/placeholder.svg`): non sono un indirizzo, non c'è niente da togliere.
    return indirizzo;
  }
}

/** La larghezza che un indirizzo già riscritto chiede al CDN (`width=` su Supabase, `w=` su Pexels). */
export function larghezzaChiesta(indirizzo: string): number | null {
  try {
    const url = new URL(indirizzo);
    const valore = url.searchParams.get('width') ?? url.searchParams.get('w');
    return valore === null ? null : Number(valore);
  } catch {
    return null;
  }
}

/**
 * L'invariante, ESEGUIBILE: per ogni posto dichiarato la foto che esce copre il
 * riquadro e non lo sfonda, e non arriva ritagliata a quadrato. Vale anche per
 * il quarto posto che qualcuno aggiungerà domani — è per questo che è un giro
 * sulla tabella e non tre righe scritte a mano.
 *
 * Non è una tautologia: la larghezza non è il numero che ho scritto io, è
 * quella che finisce nell'indirizzo dopo che `sizedImage` l'ha arrotondata e
 * riportata dentro `LARGHEZZA_MASSIMA`. Un riquadro dichiarato troppo grande
 * verrebbe tagliato da quel tetto, e la foto uscirebbe più piccola del posto in
 * cui va: è il difetto del 24/8, che qui non può rientrare di nascosto.
 *
 * @returns l'elenco dei posti sbagliati, vuoto se è tutto a posto.
 */
export function riquadriIncoerenti(): string[] {
  const FOTO_DI_PROVA = 'https://x.supabase.co/storage/v1/object/public/media/copertina.jpg';
  const guasti: string[] = [];
  for (const posto of Object.keys(RIQUADRO_DELLA_FOTO) as PostoDellaFoto[]) {
    const { px } = riquadroDichiarato(RIQUADRO_DELLA_FOTO[posto]);
    if (px === null) {
      guasti.push(`${posto}: il riquadro è dichiarato solo in percentuale di schermo, la larghezza chiesta sarebbe un ripiego`);
      continue;
    }
    const src = fotoDelNegozio(FOTO_DI_PROVA, posto).src;
    const chiesti = larghezzaChiesta(src);
    if (chiesti === null) {
      guasti.push(`${posto}: dall'indirizzo non si capisce quanto è larga la foto chiesta`);
      continue;
    }
    if (chiesti < px) guasti.push(`${posto}: chiede ${chiesti} pixel per un riquadro da ${px} punti — sgranata`);
    if (chiesti > px * 3) guasti.push(`${posto}: chiede ${chiesti} pixel per un riquadro da ${px} punti — più del triplo`);
    if (/[?&](height|h)=/.test(src)) guasti.push(`${posto}: la foto arriva ritagliata a quadrato, ma il riquadro non è quadrato`);
  }
  return guasti;
}
