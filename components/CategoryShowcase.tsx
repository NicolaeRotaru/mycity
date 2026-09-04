'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Shirt, Apple, Sparkles, Home as HomeIcon, Smartphone,
  Leaf, Gamepad2, BookOpen, Trophy, Tag,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { statoDellaVista } from '@/lib/stato-vista';
import { sizedImage } from '@/lib/image-url';
import { domandaCategoriePubbliche } from '@/lib/queries/categorie-pubbliche';

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

// Gradiente di base per categoria (fallback se la foto non carica).
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

// Foto per categoria (Pexels, host ammesso dalla CSP). Scelte "a stima" e NON
// verificabili dalla sandbox: se un URL non carica resta il gradiente sotto.
// Sostituibili in un attimo con foto proprie (URL Pexels o upload Supabase).
const IMG_MAP: Record<string, string> = {
  abbigliamento: 'https://images.pexels.com/photos/996329/pexels-photo-996329.jpeg',
  alimentari:    'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg',
  bellezza:      'https://images.pexels.com/photos/2587370/pexels-photo-2587370.jpeg',
  'casa-cucina': 'https://images.pexels.com/photos/1571460/pexels-photo-1571460.jpeg',
  casa:          'https://images.pexels.com/photos/1571460/pexels-photo-1571460.jpeg',
  cucina:        'https://images.pexels.com/photos/2724748/pexels-photo-2724748.jpeg',
  elettronica:   'https://images.pexels.com/photos/356056/pexels-photo-356056.jpeg',
  giardino:      'https://images.pexels.com/photos/1005058/pexels-photo-1005058.jpeg',
  giocattoli:    'https://images.pexels.com/photos/168866/pexels-photo-168866.jpeg',
  libri:         'https://images.pexels.com/photos/159711/pexels-photo-159711.jpeg',
  sport:         'https://images.pexels.com/photos/163403/pexels-photo-163403.jpeg',
};

const iconFor = (slug: string): LucideIcon => ICON_MAP[slug] ?? Tag;
const gradFor = (slug: string): string => GRAD_MAP[slug] ?? 'from-primary-500 to-primary-700';
const imgFor = (slug: string): string | null => IMG_MAP[slug] ?? null;


/**
 * Tessere illustrate con foto reale per categoria (overlay scuro per la
 * leggibilità del nome). Se la foto manca o non carica, resta il gradiente
 * di categoria come base.
 */
/**
 * `titolo`/`sottotitolo` stanno QUI e non nel renderer per una ragione precisa: il titolo va
 * nascosto insieme alla griglia, e l'unico che sa se la griglia ha qualcosa è questo componente.
 *
 * `MaybeSection` non basterebbe: decide guardando se il figlio ha del testo, e un titolo statico
 * scritto dal renderer è testo — la sezione risulterebbe piena anche con zero categorie sotto.
 */
type Props = { titolo?: string; sottotitolo?: string };

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
  const { data: categories = [], isLoading, isError } = useQuery(domandaCategoriePubbliche(supabase));

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

  const intestazione = (titolo || sottotitolo) ? (
    <div className="text-center mb-5">
      {titolo && <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900">{titolo}</h2>}
      {sottotitolo && <p className="text-ink-500 text-sm mt-2">{sottotitolo}</p>}
    </div>
  ) : null;

  return (
    <>
    {intestazione}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {categories.slice(0, 6).map((c) => {
        const Icon = iconFor(c.slug);
        const grad = gradFor(c.slug);
        const img = imgFor(c.slug);
        return (
          <Link
            key={c.id}
            href={`/category/${c.slug}`}
            className="group relative flex aspect-[4/3] items-end overflow-hidden rounded-2xl shadow-card transition-transform hover:-translate-y-0.5"
          >
            {/* Base: gradiente di categoria (fallback) */}
            <div className={`absolute inset-0 bg-gradient-to-br ${grad}`} />
            {/* Foto reale (se presente) */}
            {img && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sizedImage(img, 'card')}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            )}
            {/* Scrim per leggibilità */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-black/25" />
            <span className="absolute left-2.5 top-2.5 text-white drop-shadow">
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
