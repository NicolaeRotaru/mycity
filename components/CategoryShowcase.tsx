'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Shirt, Apple, Sparkles, Home as HomeIcon, Smartphone,
  Leaf, Gamepad2, BookOpen, Trophy, Tag, ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { statoDellaVista } from '@/lib/stato-vista';
import { sizedImage } from '@/lib/image-url';
import { domandaCategoriePubbliche } from '@/lib/queries/categorie-pubbliche';
import { fotoDiCategoria, motivoDaSegnalare } from '@/lib/immagine-categoria';
import { logger } from '@/lib/logger';

/**
 * 1/11/2026 — IN VETRINA SOLO LE CATEGORIE CON QUALCOSA DENTRO.
 *
 * Delle nove categorie principali solo Alimentari aveva prodotti: la home ne mostrava sei, cinque
 * vuote, e il piede ne elencava nove, otto vuote. Ogni tessera vuota è un clic che porta a una
 * pagina senza niente. Adesso una categoria si mostra se ha almeno un prodotto disponibile, suo o
 * di una sua sottocategoria (lo stesso conto della mappa del sito, `app/sitemap.ts`).
 *
 * La risposta è l'elenco degli id «pieni». La chiave è condivisa tra la home e il piede: sulla
 * stessa pagina la lettura parte una volta sola. Se la lettura fallisce si mostrano tutte, come
 * prima: un errore di rete non deve far sparire le categorie vere.
 */
export const CHIAVE_CATEGORIE_PIENE = ['categories', 'con-prodotti'] as const;

/**
 * Quanti prodotti si guardano al massimo per sapere quali categorie sono piene, e in pagine da
 * quante righe: il database ne restituisce al massimo mille per domanda (`max_rows`), quindi un
 * `limit(5000)` secco ne portava mille, in un ordine qualunque, e oltre una categoria vera poteva
 * sparire. Ora si sfoglia per id, mille alla volta.
 */
const PRODOTTI_LETTI_PER_LE_CATEGORIE = 5000;
const RIGHE_PER_PAGINA = 1000;

/** Le categorie che hanno un prodotto: la sua e tutte quelle sopra di lei. */
export function categorieConProdotti(
  categorie: ReadonlyArray<{ id: string; parent_id?: string | null }>,
  prodotti: ReadonlyArray<{ category_id?: string | null }>,
): string[] {
  const madreDi = new Map(categorie.map((c) => [c.id, c.parent_id ?? null]));
  const piene = new Set<string>();
  for (const p of prodotti) {
    let id = p.category_id ?? null;
    // Il tetto ai passi tiene fermo il giro se una categoria finisse per essere madre di sé stessa.
    for (let passi = 0; id && !piene.has(id) && passi < 10; passi += 1) {
      piene.add(id);
      id = madreDi.get(id) ?? null;
    }
  }
  return [...piene];
}

type ClientPiene = { from: (tabella: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export function domandaCategoriePiene(supa: ClientPiene) {
  return {
    queryKey: CHIAVE_CATEGORIE_PIENE,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<string[]> => {
      // 5/11/2026 — Contano solo i prodotti dei negozi approvati, come nella mappa del sito: un
      // venditore collegato vede anche i suoi prodotti per le regole del database, e per lui una
      // categoria con soli prodotti di un negozio non approvato risultava piena.
      const [cat, negozi] = await Promise.all([
        supa.from('categories').select('id, parent_id'),
        supa.from('seller_public_profiles').select('id').limit(2000),
      ]);
      if (cat.error) throw cat.error;
      if (negozi.error) throw negozi.error;
      const approvati = new Set(((negozi.data ?? []) as { id: string }[]).map((n) => n.id));
      const prodotti: { id: string; category_id: string | null; seller_id: string | null }[] = [];
      let ultimo: string | null = null;
      while (prodotti.length < PRODOTTI_LETTI_PER_LE_CATEGORIE) {
        let q = supa
          .from('products')
          .select('id, category_id, seller_id')
          .eq('status', 'available')
          .order('id', { ascending: true })
          .limit(RIGHE_PER_PAGINA);
        if (ultimo) q = q.gt('id', ultimo);
        const pagina = await q;
        if (pagina.error) throw pagina.error;
        const righe = (pagina.data ?? []) as typeof prodotti;
        prodotti.push(...righe);
        if (righe.length < RIGHE_PER_PAGINA) break;
        ultimo = righe[righe.length - 1].id;
      }
      return categorieConProdotti(cat.data ?? [], prodotti.filter((p) => !!p.seller_id && approvati.has(p.seller_id)));
    },
  };
}

/**
 * Tiene solo le categorie piene. `piene` assente (lettura fallita) = tutte, come prima.
 * Una categoria senza id (la riserva scritta nel codice) non si può controllare: resta.
 */
export function soloLePiene<T extends { id?: string }>(categorie: T[], piene: ReadonlyArray<string> | null | undefined): T[] {
  if (!piene) return categorie;
  const insieme = new Set(piene);
  return categorie.filter((c) => !c.id || insieme.has(c.id));
}

const ICON_MAP: Record<string, LucideIcon> = {
  abbigliamento:  Shirt,
  alimentari:     Apple,
  bellezza:       Sparkles,
  'casa-cucina':  HomeIcon,
  casa:           HomeIcon,
  cucina:         HomeIcon,
  elettronica:    Smartphone,
  giardino:       Leaf,
  giocattoli:     Gamepad2,
  libri:          BookOpen,
  sport:          Trophy,
};

// Il colore della tessera. È del marchio, ed è quello che si vede finché una
// foto vera non c'è (o se la foto non carica). Questo elenco può restare nel
// codice: è la nostra tavolozza, non un contenuto da cambiare dal pannello.
const GRAD_MAP: Record<string, string> = {
  alimentari:     'from-olive-500 to-olive-700',
  abbigliamento:  'from-primary-400 to-primary-700',
  bellezza:       'from-secondary-400 to-secondary-700',
  'casa-cucina':  'from-accent-400 to-accent-600',
  casa:           'from-accent-400 to-accent-600',
  cucina:         'from-accent-400 to-accent-600',
  elettronica:    'from-ink-600 to-ink-900',
  giardino:       'from-olive-400 to-olive-600',
  giocattoli:     'from-secondary-400 to-secondary-600',
  libri:          'from-primary-400 to-primary-600',
  sport:          'from-olive-500 to-olive-700',
};

// 8/9/2026 (lotto gravi, corsia 17) — QUI C'ERANO UNDICI FOTO SCRITTE A MANO.
//
// Erano foto d'archivio Pexels scelte "a stima", le stesse che può avere in home
// qualunque sito del mondo, su un mercato che dice di essere i negozi di
// Piacenza. E per cambiarne una bisognava ripubblicare il sito, perché la
// tabella `categories` non aveva nessuna colonna per l'immagine.
//
// Adesso la foto è un dato: sta in `categories.image_url` (migrazione 159) e la
// decide `lib/immagine-categoria.ts`. Questo componente non sceglie più nessuna
// immagine — la chiede. Finché la colonna è vuota si vede il gradiente qui
// sopra, che almeno è nostro.
const iconFor = (slug: string): LucideIcon => ICON_MAP[slug] ?? Tag;
/**
 * I due veli delle tessere (12/11/2026, R08-013).
 *
 * Sopra una foto serve il velo pieno: la foto può essere chiara ovunque.
 * Sul gradiente del marchio basta un'ombra dal basso, dove sta il nome, che sale
 * SENZA risalite (55% → 30% → niente): una fermata a metà più chiara di quella in
 * alto faceva la banda chiara. Al 37% — l'altezza della seconda riga di un nome
 * lungo — l'ombra vale ancora circa il 36%, e il bianco sulla tessera più chiara
 * (senape accent-400) sta sopra 4,5:1. Prova: tests/unit/riparazione-r08-le-tessere-senza-foto.test.tsx.
 */
const VELO_SULLA_FOTO = 'from-black/70 via-black/15 to-black/25';
const VELO_SENZA_FOTO = 'from-black/55 via-black/30 to-transparent';

const gradFor = (slug: string): string => GRAD_MAP[slug] ?? 'from-primary-500 to-primary-700';

/**
 * Quante tessere stanno in home. Il resto si raggiunge dal link «Vedi tutte le categorie»:
 * prima il taglio era muto — sei su otto, e nessun modo di arrivare alle altre due, mentre
 * il sottotitolo prometteva «tutte le categorie del mercato locale».
 */
const TESSERE_IN_HOME = 6;

/**
 * Quante foto partono subito. Le tessere sono la prima cosa con un'immagine che si vede sul
 * telefono — e arrivano gia' dentro l'HTML grazie al precarico del server — ma erano tutte
 * `loading="lazy"`: il browser le metteva in coda dietro al resto e le apriva a bassa
 * priorita', quindi l'elemento piu' grande della pagina compariva tardi. Le prime quattro
 * riempiono lo schermo di un telefono: quelle partono subito, le altre restano pigre.
 */
const TESSERE_SUBITO = 4;

/**
 * `titolo`/`sottotitolo` stanno QUI e non nel renderer per una ragione precisa: il titolo va
 * nascosto insieme alla griglia, e l'unico che sa se la griglia ha qualcosa è questo componente.
 *
 * `MaybeSection` non basterebbe: decide guardando se il figlio ha del testo, e un titolo statico
 * scritto dal renderer è testo — la sezione risulterebbe piena anche con zero categorie sotto.
 */
type Props = { titolo?: string; sottotitolo?: string };

/**
 * Tessere di categoria: gradiente del marchio, icona e nome. La foto compare
 * sopra il gradiente solo quando c'è davvero, cioè quando qualcuno l'ha messa
 * in `categories.image_url`. Se manca o non carica, resta il gradiente.
 */
const CategoryShowcase = ({ titolo, sottotitolo }: Props = {}) => {
  // 30/8/2026 (R068) — La domanda sta in `lib/queries/catalogo.ts`, e da li' la
  // fa anche il server prima di mandare la pagina. Perche' il precarico serva a
  // qualcosa, le due domande devono essere LA STESSA: stessa chiave, stessa
  // forma della risposta. Riscritta in due posti, basta una lettera diversa
  // nella chiave e il browser va in rete lo stesso — senza che nessuno lo veda.
  //
  // 3/9/2026 — la lettura passa da `/api/catalogo/categorie`, che risponde con
  // «vale sessanta secondi»: la stessa risposta serve tutti i visitatori invece
  // di essere richiesta una volta per ognuno. La CHIAVE resta quella di
  // `domandaCategorie`, altrimenti il precarico del server non verrebbe
  // riconosciuto. Se la rotta non risponde si legge dal database come prima.
  const { data: tutte = [], isLoading: caricoCategorie, isError } = useQuery(domandaCategoriePubbliche(supabase));
  // La lettura delle piene NON blocca il disegno: il server precarica solo le categorie, e
  // aspettarla metteva gli scheletri nell'HTML del server (Google e il primo disegno non vedevano
  // nessuna tessera). Finché non c'è si mostrano tutte, come prima; quando arriva si filtra.
  const piene = useQuery(domandaCategoriePiene(supabase));
  const isLoading = caricoCategorie;
  const categories = useMemo(
    () => soloLePiene(tutte, piene.isError ? null : piene.data),
    [tutte, piene.isError, piene.data],
  );

  // Le tessere che finiscono in home, ognuna con la sua foto già decisa dal
  // dato. Si calcola qui, prima delle uscite anticipate qui sotto: un hook non
  // può stare dopo un `return`, o cambia di numero tra un giro e l'altro.
  const tessere = useMemo(
    () => categories.slice(0, TESSERE_IN_HOME).map((c) => ({ c, foto: fotoDiCategoria(c) })),
    [categories],
  );

  // UN INDIRIZZO SCRITTO MALE NON SPARISCE IN SILENZIO. Se qualcuno salva nel
  // pannello una foto che il browser non potrà caricare, prima non se ne
  // accorgeva nessuno: si vedeva un gradiente, come quando la foto non c'è.
  // Adesso resta scritto nei log del browser, con dentro l'indirizzo da
  // correggere. Il campo vuoto — lo stato normale di oggi — non si segnala.
  useEffect(() => {
    for (const { c, foto } of tessere) {
      const daDire = motivoDaSegnalare(foto);
      if (daDire) logger.warn('[categorie] foto di categoria scartata', { slug: c.slug, dettaglio: daDire });
    }
  }, [tessere]);

  // Le foto che non si sono caricate: per loro la tessera torna gradiente, velo compreso.
  const [fotoRotte, setFotoRotte] = useState<ReadonlySet<string>>(() => new Set());
  const segnaRotta = (slug: string) =>
    setFotoRotte((prima) => (prima.has(slug) ? prima : new Set(prima).add(slug)));

  // Tre esiti. Prima il componente leggeva solo `data` e disegnava comunque la griglia: finché la
  // risposta non arrivava restava un vuoto sotto il titolo «Cosa cerchi oggi?», e se la lettura
  // falliva ci restava per sempre — un titolo che promette e non consegna, in cima alla home.
  const vista = statoDellaVista({ letto: !isLoading, caricando: isLoading, errore: isError || undefined, quanti: categories.length });

  if (vista.mostraScheletro) {
    return (
      <>
        {(titolo || sottotitolo) && (
          <div className="text-center mb-5">
            {titolo && <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900">{titolo}</h2>}
            {sottotitolo && <p className="text-ink-500 text-sm mt-2">{sottotitolo}</p>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="aspect-[4/3] skeleton rounded-xl" />
          ))}
          <span className="sr-only">Carico le categorie…</span>
        </div>
      </>
    );
  }

  // Senza categorie o con la lettura rotta non si disegna niente: il titolo sopra sparisce insieme
  // alla sezione (`MaybeSection` nel renderer), invece di restare appeso su un vuoto.
  if (vista.mostraErrore || vista.mostraVuoto) return null;

  const altreOltreLeMostrate = categories.length > TESSERE_IN_HOME;

  const intestazione = (titolo || sottotitolo) ? (
    <div className="text-center mb-5">
      {titolo && <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900">{titolo}</h2>}
      {sottotitolo && <p className="text-ink-500 text-sm mt-2">{sottotitolo}</p>}
      {altreOltreLeMostrate && (
        <Link
          href="/categorie"
          className="mt-2 inline-flex items-center gap-1 min-h-[44px] px-3 text-sm font-semibold text-primary-700 hover:text-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 rounded-full"
        >
          Vedi tutte le categorie
          <ArrowRight size={16} strokeWidth={2.4} aria-hidden />
        </Link>
      )}
    </div>
  ) : null;

  return (
    <>
    {intestazione}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tessere.map(({ c, foto }, i) => {
        const Icon = iconFor(c.slug);
        const grad = gradFor(c.slug);
        return (
          <Link
            key={c.id}
            href={`/category/${c.slug}`}
            className="group relative flex aspect-[4/3] items-end overflow-hidden rounded-2xl shadow-card transition-transform hover:-translate-y-0.5"
          >
            {/* Base: gradiente di categoria (è anche il fallback) */}
            <div className={`absolute inset-0 bg-gradient-to-br ${grad}`} />
            {/* La foto vera, solo se c'è nel dato */}
            {foto.src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sizedImage(foto.src, 'card')}
                alt=""
                aria-hidden
                loading={i < TESSERE_SUBITO ? 'eager' : 'lazy'}
                fetchPriority={i < TESSERE_SUBITO ? 'high' : 'auto'}
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                onError={(e) => {
                  // La tessera torna al gradiente — ma non di nascosto. Prima
                  // qui c'era solo il `display:none`: una foto sparita restava
                  // invisibile anche a noi, e la home perdeva un'immagine senza
                  // che nessuno lo sapesse.
                  e.currentTarget.style.display = 'none';
                  segnaRotta(c.slug);
                  logger.warn('[categorie] la foto della tessera non si è caricata', { slug: c.slug, src: foto.src });
                }}
              />
            )}
            {/* Scrim per leggibilità. 5/11/2026 — Il velo scuro pieno serve solo sopra una foto:
                senza, scuriva tutto il gradiente del marchio e lasciava una banda chiara in mezzo.
                12/11/2026 (R08-013) — «Sopra una foto» vuol dire una foto CARICATA: prima bastava
                l'indirizzo nel dato, e una foto rotta lasciava il velo pieno, con la banda, sul
                gradiente. E sul gradiente l'ombra al 35% faceva scendere il nome bianco a circa
                4:1 sulla senape: ora VELO_SENZA_FOTO, che regge 4,5:1 e sale senza bande. */}
            <div
              className={`absolute inset-0 bg-gradient-to-t ${
                foto.src && !fotoRotte.has(c.slug) ? VELO_SULLA_FOTO : VELO_SENZA_FOTO
              }`}
            />
            {/* L'icona sta su un cerchio scuro suo, così il gradiente in alto resta pulito e
                l'icona bianca resta sopra 3:1 anche sulla tessera più chiara. */}
            <span className="absolute left-2 top-2 rounded-full bg-black/30 p-1 text-white">
              <Icon size={18} strokeWidth={2.2} />
            </span>
            <span className="relative p-3 text-sm font-bold leading-tight text-white drop-shadow">{c.name}</span>
          </Link>
        );
      })}
    </div>
    </>
  );
};

export default CategoryShowcase;
