'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Store, Percent, Sparkles, Gift, MapPin, Flame, PiggyBank,
  LayoutGrid, ChevronDown, Search, X,
  Shirt, Apple, Home as HomeIcon, Smartphone, Leaf, Gamepad2, BookOpen, Trophy, Tag,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

type Entry = { href: string; icon: LucideIcon; label: string };

/**
 * Destinazioni speciali (asse "per intenzione"): lenti curate sul catalogo,
 * NON categorie merceologiche. Quelle merceologiche vivono nel mega-menu.
 */
const DESTINATIONS: Entry[] = [
  { href: '/stores',         icon: Store,     label: 'Tutti i negozi' },
  { href: '/promozioni',     icon: Percent,   label: 'Promozioni' },
  { href: '/novita',         icon: Sparkles,  label: 'Novità' },
  { href: '/regali',         icon: Gift,      label: 'Regali' },
  { href: '/near',           icon: MapPin,    label: 'Vicino a te' },
  { href: '/piu-venduti',    icon: Flame,     label: 'Più venduti' },
  { href: '/piccoli-prezzi', icon: PiggyBank, label: 'Piccoli prezzi' },
];

const ICON_MAP: Record<string, LucideIcon> = {
  abbigliamento: Shirt, alimentari: Apple, bellezza: Sparkles,
  'casa-cucina': HomeIcon, casa: HomeIcon, cucina: HomeIcon,
  elettronica: Smartphone, giardino: Leaf, giocattoli: Gamepad2,
  libri: BookOpen, sport: Trophy,
};
const iconFor = (slug: string): LucideIcon => ICON_MAP[slug] ?? Tag;

/** Il pannello aperto dal pulsante «Tutte le categorie» (serve ad aria-controls). */
const PANNELLO_ID = 'mega-menu-categorie';

type Cat = { id: string; slug: string; name: string; parent_id: string | null; icon: string | null };

/**
 * Barra sotto l'header (terracotta). TUTTE le voci scorrono insieme in
 * orizzontale: il bottone "Tutte le categorie" (mega-menu merceologico) sta
 * nella stessa riga `overflow-x-auto` delle destinazioni speciali. La tendina
 * del mega-menu è invece un fratello della riga, ancorato al root `relative`
 * (che NON ha overflow) così non viene tagliata.
 */
const CategoryBar = () => {
  const pathname = usePathname() ?? '';
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /**
   * 31/8/2026 — LA RIGA SCORREVA E NON LO DICEVA A NESSUNO.
   * Sul telefono in questa riga ci stanno il pulsante «Tutte le categorie» e
   * poco altro: le altre sette destinazioni — Promozioni, Novità, Regali,
   * Vicino a te, Più venduti, Piccoli prezzi — sono lì a destra, ma la barra
   * di scorrimento è nascosta (`scrollbar-hide`) e non c'era nessun altro
   * segno al suo posto. Chi non prova a trascinare non sa che esistono.
   * Qui la riga si misura da sola e, quando c'è dell'altro oltre il bordo, lo
   * mostra con una sfumatura da quel lato. Quando ci sta tutto, non compare
   * niente: il segno non deve mentire.
   */
  const rigaRef = useRef<HTMLDivElement>(null);
  const [altro, setAltro] = useState({ aSinistra: false, aDestra: false });

  useEffect(() => {
    const riga = rigaRef.current;
    if (!riga) return;
    const misura = () => {
      const massimo = riga.scrollWidth - riga.clientWidth;
      setAltro({
        aSinistra: riga.scrollLeft > 4,
        aDestra: massimo > 4 && riga.scrollLeft < massimo - 4,
      });
    };
    misura();
    riga.addEventListener('scroll', misura, { passive: true });
    window.addEventListener('resize', misura);
    return () => {
      riga.removeEventListener('scroll', misura);
      window.removeEventListener('resize', misura);
    };
  }, []);

  // 27/8/2026 (R106) — con Esc il pannello si chiudeva e il fuoco cadeva sul
  // corpo della pagina: chi naviga da tastiera ripartiva dall'inizio del sito.
  const pulsanteRef = useRef<HTMLButtonElement>(null);
  const pannelloRef = useRef<HTMLDivElement>(null);

  /**
   * 6/9/2026 — SI APRIVA, MA DA TASTIERA NON CI SI ENTRAVA.
   * Il pannello è un fratello della riga scorrevole, quindi nell'ordine della
   * pagina viene DOPO le sette destinazioni: chi premeva Tab dopo aver aperto
   * «Tutte le categorie» finiva su «Tutti i negozi» della barra, non dentro al
   * pannello appena aperto. Qui il fuoco entra sul primo link del pannello;
   * con Esc torna sul pulsante (poco sopra). Non è una finestra modale — si
   * chiude anche cliccando fuori — quindi niente trappola del fuoco e niente
   * blocco dello scorrimento: si sposta il fuoco, e basta.
   * Con preventScroll, perché il pannello si apre già sotto il pulsante: chi tocca
   * lo schermo non deve vedersi saltare la pagina.
   */
  useEffect(() => {
    if (!open) return;
    pannelloRef.current?.querySelector<HTMLElement>('a[href]')?.focus({ preventScroll: true });
  }, [open]);

  const { data: cats = [] } = useQuery({
    queryKey: ['categories', 'tree'],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Cat[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, slug, name, parent_id, icon')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Cat[];
    },
  });

  useEffect(() => {
    if (!open) return;
    /**
     * 6/9/2026 — SUL TELEFONO IL PANNELLO POTEVA RESTARE APERTO.
     * Si ascoltava solo `mousedown`, che è un evento del mouse: su Safari iOS
     * il tocco lo fa nascere solo sopra gli elementi che il browser considera
     * cliccabili, quindi un dito appoggiato su un pezzo qualunque di pagina
     * poteva non chiudere niente. `pointerdown` è lo stesso gesto per dito,
     * penna e mouse insieme: un solo ascoltatore, tutti e tre i modi di
     * indicare. (Il dito su un vero iPhone non l'ho potuto provare da qui.)
     */
    const onClick = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      pulsanteRef.current?.focus();
    };
    document.addEventListener('pointerdown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('pointerdown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const tops = cats.filter((c) => c.parent_id === null);
  const childrenOf = (id: string) => cats.filter((c) => c.parent_id === id);

  return (
    <div ref={rootRef} className="relative">
      <div className="container mx-auto px-3 sm:px-4">
        {/* Tab underline-style: divider sottile sotto la barra, voce attiva con
            underline + colore accent (per mockup navbar). */}
        <div className="relative">
        <div ref={rigaRef} className="flex items-center gap-1 overflow-x-auto scrollbar-hide border-b border-white/10 text-sm">
          {/* Mega-menu trigger — stessa riga delle tab, attivo quando aperto */}
          <button
            ref={pulsanteRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            /* Solo da aperto: a pannello chiuso quell'id non esiste, e un
               riferimento a un elemento che non c'è è a sua volta un difetto. */
            aria-controls={open ? PANNELLO_ID : undefined}
            /* 27/8/2026 (R106) — diceva `menu`, e allora un lettore di schermo
               promette la navigazione con le frecce e, dentro un `role="menu"`,
               può arrivare a nascondere tutto ciò che non è una voce di menu.
               Qui dentro ci sono link normali: si dice che si apre qualcosa, e
               basta. */
            aria-haspopup="true"
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 font-semibold transition-colors focus-visible:outline-white ${
              open
                ? 'border-accent-400 text-accent-200'
                : 'border-transparent text-white/90 hover:text-white'
            }`}
          >
            <LayoutGrid size={15} strokeWidth={2.2} />
            Tutte le categorie
            <ChevronDown size={13} strokeWidth={2.6} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {DESTINATIONS.map((e) => {
            const Icon = e.icon;
            const active = isActive(e.href);
            return (
              <Link
                key={e.href}
                href={e.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 transition-colors focus-visible:outline-white ${
                  active
                    ? 'border-accent-400 font-semibold text-accent-200'
                    : 'border-transparent font-medium text-white/90 hover:text-white'
                }`}
              >
                <Icon size={14} strokeWidth={2.2} />
                {e.label}
              </Link>
            );
          })}
        </div>

          {altro.aSinistra && (
            <div
              aria-hidden
              data-scorrimento="sinistra"
              className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-primary-700 to-transparent"
            />
          )}
          {altro.aDestra && (
            <div
              aria-hidden
              data-scorrimento="destra"
              className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-primary-700 to-transparent"
            />
          )}
        </div>
      </div>

      {/* Pannello mega-menu: fratello della riga scrollabile, ancorato al root
          `relative` senza overflow → non viene clippato. */}
      {open && (
        <div className="pointer-events-none absolute left-0 right-0 top-full z-50">
          <div className="container mx-auto px-3 sm:px-4">
            {/* 6/9/2026 — il pannello elenca tutte le categorie principali con
                fino a sei sottocategorie ciascuna, su telefono in due colonne:
                diventava molto più alto dello schermo e copriva la pagina sotto.
                Ora si ferma a 70vh e scorre dentro di sé; overscroll-contain
                perché arrivato in fondo non trascini via la pagina. */}
            <div
              ref={pannelloRef}
              id={PANNELLO_ID}
              className="pointer-events-auto mt-1 max-h-[70vh] w-full max-w-[900px] overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 text-ink-800 shadow-warm-lg ring-1 ring-cream-300"
            >
              {/*
                6/9/2026 — DAL TELEFONO NON SI SAPEVA COME USCIRE.
                Il pannello copre quasi tutto lo schermo e le uniche due uscite
                erano toccare una categoria — cioè andarsene dalla pagina — o
                ritrovare il pulsante «Tutte le categorie», che a pannello aperto
                sta sopra il bordo e non sembra più un interruttore. Nessuna X,
                nessun velo da toccare dietro. Qui c'è la X, come nel pannello dei
                filtri e in quello dell'account: 44 punti di lato, il minimo per
                un pollice, e chiudendo il fuoco torna sul pulsante che ha aperto,
                come già fa Esc. Su schermo grande non serve e non si vede: lì il
                mega-menu si chiude allontanando il puntatore o cliccando fuori.
              */}
              <div className="mb-3 flex items-center justify-between sm:hidden">
                <span className="text-sm font-bold text-ink-900">Categorie</span>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    pulsanteRef.current?.focus();
                  }}
                  aria-label="Chiudi le categorie"
                  className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-600 transition-colors hover:bg-cream-100 hover:text-ink-900"
                >
                  <X size={20} strokeWidth={2.4} aria-hidden />
                </button>
              </div>

              <div className="mb-4 flex flex-wrap gap-2 border-b border-cream-200 pb-4">
                <Link href="/stores" onClick={() => setOpen(false)} className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1.5 text-sm font-semibold text-primary-700 hover:bg-primary-100">
                  <Store size={15} strokeWidth={2.2} /> Tutti i negozi
                </Link>
                <Link href="/search" onClick={() => setOpen(false)} className="inline-flex items-center gap-2 rounded-full bg-cream-100 px-3 py-1.5 text-sm font-semibold text-ink-700 hover:bg-cream-200">
                  <Search size={15} strokeWidth={2.2} /> Tutti i prodotti
                </Link>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
                {tops.map((top) => {
                  const Icon = iconFor(top.slug);
                  const kids = childrenOf(top.id);
                  return (
                    <div key={top.id}>
                      <Link
                        href={`/category/${top.slug}`}
                        onClick={() => setOpen(false)}
                        className="mb-2 flex items-center gap-2 font-bold text-ink-900 hover:text-primary-700"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
                          <Icon size={15} strokeWidth={2.2} />
                        </span>
                        {top.name}
                      </Link>
                      <ul className="space-y-1.5 pl-1">
                        {kids.length > 0 ? (
                          kids.slice(0, 6).map((ch) => (
                            <li key={ch.id}>
                              <Link href={`/category/${ch.slug}`} onClick={() => setOpen(false)} className="text-sm text-ink-600 hover:text-primary-700">
                                {ch.name}
                              </Link>
                            </li>
                          ))
                        ) : (
                          <li>
                            <Link href={`/category/${top.slug}`} onClick={() => setOpen(false)} className="text-xs font-semibold text-ink-400 hover:text-primary-700">
                              Vedi tutto →
                            </Link>
                          </li>
                        )}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CategoryBar;
