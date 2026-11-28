'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard, Receipt, Package, Wand2,
  Tag, Megaphone, Camera, BarChart3,
  Users, Star, Wallet, MessageCircle,
  Store, User, LifeBuoy,
  Sparkles, Bell, Search, Plus, Menu, X,
  PanelLeftClose, PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { esciEVaiAllAccesso } from '@/lib/auth/uscita';
import { useProfile } from '@/components/hooks/useProfile';
import { useBottomSheetA11y } from '@/components/hooks/useBottomSheetA11y';
import { queryKeys } from '@/lib/queries/keys';
import { AI_NEGOZI_ACCESA } from '@/lib/funzioni-al-lancio';
import { VOCI_SERVIZI } from '@/components/seller/servizi-nel-menu';
import MenuAccount, { usePianoDelNegozio } from '@/components/seller/MenuAccount';
import { toneFor, formatDate } from '@/lib/notifiche-aspetto';
import { eDiSdg } from '@/lib/products/sdgSeller';

type NavItem = { href: string; icon: LucideIcon; label: string; badge?: 'todo' };
type NavGroup = { group: string; items: NavItem[] };

/**
 * Seller shell — sidebar scura (ink-900) + topbar bianca sticky + Copilot.
 * Mirroring delle convenzioni di components/admin/AdminSidebar (logout via
 * supabase.auth.signOut + router, attivo via usePathname). La global chrome
 * (Navbar/Footer/MobileTabBar) si nasconde su /seller esattamente come su /admin.
 */
const NAV: NavGroup[] = [
  { group: 'Gestione', items: [
    { href: '/seller/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/seller/orders', icon: Receipt, label: 'Ordini', badge: 'todo' },
    { href: '/seller/products', icon: Package, label: 'Prodotti' },
    // AI spenta al lancio (carta #209): la voce porterebbe a «Gli strumenti AI non sono attivi».
    ...(AI_NEGOZI_ACCESA ? [{ href: '/seller/products/ai-batch', icon: Wand2, label: 'AI Studio' }] : []),
  ] },
  // 24/11/2026 — I servizi di MyCity ai venditori, subito dopo la gestione (Nicola: «le voci dei
  // servizi mettili in alto»): una voce per servizio, dal listino. «Abbonamento» sta in fondo al
  // menu, sotto il nome del negozio, come su Claude (MenuAccount).
  { group: 'Servizi', items: VOCI_SERVIZI },
  { group: 'Crescita', items: [
    { href: '/seller/promotions', icon: Tag, label: 'Promozioni' },
    { href: '/seller/promote', icon: Megaphone, label: 'Sponsorizza' },
    { href: '/seller/stories', icon: Camera, label: 'Storie' },
    { href: '/seller/analytics', icon: BarChart3, label: 'Analisi' },
  ] },
  { group: 'Relazioni', items: [
    { href: '/seller/customers', icon: Users, label: 'Clienti' },
    // 1/11/2026 — i clienti scrivono dalla scheda prodotto: senza questa voce il negozio non aveva una strada per leggerli.
    { href: '/messages', icon: MessageCircle, label: 'Messaggi' },
    { href: '/seller/reviews', icon: Star, label: 'Recensioni' },
    { href: '/seller/earnings', icon: Wallet, label: 'Guadagni' },
  ] },
  { group: 'Negozio', items: [
    { href: '/seller/site', icon: Store, label: 'La tua vetrina' },
    { href: '/seller/profile', icon: User, label: 'Profilo' },
    { href: '/seller/help', icon: LifeBuoy, label: 'Aiuto' },
  ] },
];

/**
 * 28/11/2026 — SDG AGENZIA APRIVA «ORDINI» E LEGGEVA «NESSUN ORDINE».
 *
 * Nicola, alle 00:36: entrato come SDG Agenzia, la voce «Ordini» diceva «Nessun ordine», e alle 00:34
 * era nato un ordine di servizio vero. Gli ordini di SDG non sono ordini di prodotti: stanno nella
 * tabella `ordini_sdg` e si leggono in /seller/ordini-sdg, a cui il menu non portava. Per l'account
 * di SDG la voce porta lì e si chiama «Ordini di servizio»; per tutti gli altri negozi non cambia
 * niente. Il pallino dei «da fare» conta gli ordini dei prodotti, e SDG non ne ha: per lui non c'è.
 */
const VOCE_ORDINI_DI_SERVIZIO: NavItem = { href: '/seller/ordini-sdg', icon: Receipt, label: 'Ordini di servizio' };

function menuDelNegozio(sellerId: string | null | undefined): NavGroup[] {
  if (!eDiSdg(sellerId)) return NAV;
  return NAV.map((sec) => ({
    ...sec,
    items: sec.items.map((n) => (n.href === '/seller/orders' ? VOCE_ORDINI_DI_SERVIZIO : n)),
  }));
}

const COPILOT_HREF = '/seller/products/ai-batch';

function isActive(pathname: string, href: string): boolean {
  if (href === '/seller/dashboard') {
    // Dashboard attivo anche sulla root /seller (redirect verso la dashboard).
    return pathname === '/seller/dashboard' || pathname === '/seller';
  }
  // Per SDG anche «Ordini» (/seller/orders) mostra gli ordini di servizio: la sua voce resta accesa.
  if (href === VOCE_ORDINI_DI_SERVIZIO.href && pathname === '/seller/orders') return true;
  // Tiene attiva solo la voce più specifica: products non resta attivo su
  // products/ai-batch (che ha la sua voce AI Studio).
  if (href === '/seller/products') {
    return pathname === '/seller/products' || pathname.startsWith('/seller/products/');
  }
  return pathname === href || pathname.startsWith(href + '/');
}

/**
 * Conta gli ordini "da fare" del venditore — stesso filtro della pagina ordini.
 *
 * 27/8/2026 (R075) — QUATTRO RICHIESTE AL MINUTO PER DUE PALLINI, E DUE ERANO CHIAMATE DI RETE
 * ALL'AUTENTICAZIONE. Ogni giro di questo conteggio cominciava chiedendo al servizio di
 * autenticazione chi fosse la persona: una chiamata di rete, non una lettura dalla memoria. Chi sei lo sa già la
 * pagina, che il profilo se l'è fatto dare una volta sola (`useProfile`). Adesso l'identità arriva
 * da lì, e i due sondaggi girano più piano e solo con la scheda in primo piano: il costo scala con
 * «negozi × ore aperte», che è la peggiore delle basi di calcolo.
 */
function useSellerTodoCount(sellerId: string | null) {
  const { data = 0 } = useQuery({
    queryKey: [...queryKeys.seller.orders, 'todo-count', sellerId ?? ''],
    enabled: !!sellerId,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      if (!sellerId) return 0;
      const { count, error } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('seller_id', sellerId)
        .in('delivery_status', ['NEW', 'ACCEPTED', 'READY']);
      if (error) return 0;
      return count ?? 0;
    },
  });
  return data;
}

/**
 * Le promozioni e la newsletter contano solo per chi le ha accese nelle impostazioni
 * (`notif_promos`, `notif_newsletter`): chi le ha spente non riceve la push, e il pallino
 * non deve accendersi per loro. Ritorna le categorie da lasciare fuori dal conto.
 * Se la preferenza non si legge, si va avanti senza le due categorie: un errore
 * sulla preferenza non deve spegnere il pallino degli ordini non letti.
 */
export async function categorieSpenteDelCampanello(userId: string): Promise<string[]> {
  const { data: preferenze, error } = await supabase
    .from('profiles')
    .select('notif_promos, notif_newsletter')
    .eq('id', userId)
    .maybeSingle();
  const spente: string[] = [];
  if (error || preferenze?.notif_promos !== true) spente.push('promo');
  if (error || preferenze?.notif_newsletter !== true) spente.push('newsletter');
  return spente;
}

/** Conta le notifiche non lette per il pallino del campanello. */
function useNotifUnread(userId: string | null) {
  const { data = 0 } = useQuery({
    queryKey: [...queryKeys.notifications.count, 'seller-bell', userId ?? ''],
    enabled: !!userId,
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      if (!userId) return 0;
      let conta = supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false);
      for (const categoria of await categorieSpenteDelCampanello(userId)) conta = conta.neq('category', categoria);
      const { count, error } = await conta;
      if (error) return 0;
      return count ?? 0;
    },
  });
  return data;
}

/** Quante notifiche si vedono nella tendina: le altre stanno nel Centro notifiche. */
const ULTIME_NELLA_TENDINA = 6;

type NotificaTendina = {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

/**
 * 25/11/2026 — LA TENDINA DICEVA «HAI 3 NOTIFICHE NON LETTE» E NON DICEVA QUALI.
 *
 * Nicola: «dentro la finestra delle notifiche in alto a destra siano visibili le ultime notifiche».
 * Per sapere cosa era successo il negoziante doveva aprire un'altra pagina. Ora la tendina legge le
 * ultime notifiche, con le stesse regole del pallino (le promozioni solo per chi le ha accese), e
 * solo quando è aperta: con la tendina chiusa non parte nessuna lettura in più.
 * L'utente sta in fondo alla chiave: così «Segna tutte come lette» del Centro notifiche aggiorna
 * anche questa lista (R01-001 cerca le chiavi per l'ultimo pezzo).
 */
function useUltimeNotifiche(userId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.notifications.list, 'seller-bell', userId ?? ''],
    enabled: !!userId,
    // Si apre per vedere cosa c'è di nuovo: ogni apertura rilegge.
    staleTime: 0,
    queryFn: async (): Promise<NotificaTendina[]> => {
      if (!userId) return [];
      let lista = supabase
        .from('notifications')
        .select('id, user_id, title, body, link, is_read, created_at')
        .eq('user_id', userId);
      for (const categoria of await categorieSpenteDelCampanello(userId)) lista = lista.neq('category', categoria);
      const { data, error } = await lista
        .order('created_at', { ascending: false })
        .limit(ULTIME_NELLA_TENDINA);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * 6/9/2026 — IL PANNELLO DICEVA DI ESSERE UNA FINESTRA DI DIALOGO E NON LO ERA.
 *
 * C'erano `role="dialog"` e l'etichetta, ma niente di quello che un dialogo deve
 * fare: il tasto Esc non lo chiudeva, il fuoco non entrava dentro e alla
 * chiusura non tornava al campanello. Chi lavora da sola tastiera apriva le
 * notifiche degli ordini e per uscirne doveva ritrovare il pulsante a mano.
 *
 * La regola della casa e' scritta in `components/hooks/useBottomSheetA11y.ts`:
 * nessun pannello sovrapposto scritto a mano: o passa da `components/ui/Modal.tsx`,
 * o passa da quell'hook. Qui passa dall'hook, come gia' fanno i filtri della
 * ricerca, il cassetto dell'amministrazione e la foto ingrandita del prodotto.
 */
function NotifPopover({
  unread,
  userId,
  onClose,
  triggerRef,
}: {
  unread: number;
  userId: string | null;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement>;
}) {
  const pannelloRef = useRef<HTMLDivElement>(null);
  const elencoRef = useRef<HTMLUListElement>(null);
  const qc = useQueryClient();
  const { data: ultime, isLoading, isError, refetch } = useUltimeNotifiche(userId);
  // Il pannello esiste solo da aperto: il montaggio e' l'apertura, e lo
  // smontaggio riporta il fuoco sul campanello.
  // È una tendina, non un foglio a tutto schermo: la pagina sotto continua a scorrere.
  useBottomSheetA11y(true, pannelloRef, triggerRef, onClose, { bloccaScorrimento: false });

  // Aprire una notifica la segna letta, come nel Centro notifiche. Best effort: se la scrittura
  // non riesce la notifica si apre lo stesso, e il pallino resta finché non riesce.
  const segnaLetta = (id: string) => {
    if (!userId) return;
    void supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', userId)
      .then(({ error }) => {
        if (error) return;
        void qc.invalidateQueries({ queryKey: queryKeys.notifications.count });
        void qc.invalidateQueries({ queryKey: queryKeys.notifications.list });
      });
  };

  const righe = ultime ?? [];

  // All'apertura si rilegge anche il numero delle non lette: la lista è appena letta, il numero no
  // (si aggiorna ogni due minuti), e i due non devono dire cose diverse (collaudo del 25/11).
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: [...queryKeys.notifications.count, 'seller-bell'] });
  }, [qc]);

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className="fixed inset-0 z-dropdown"
      />
      <div
        ref={pannelloRef}
        id="pannello-notifiche-venditore"
        role="dialog"
        aria-modal="true"
        aria-label="Notifiche"
        className="absolute right-0 top-[calc(100%+10px)] z-modal w-[360px] max-w-[88vw] overflow-hidden rounded-xl border border-cream-200 bg-surface-0 text-ink-900 shadow-warm-xl"
      >
        <div className="flex items-center justify-between border-b border-cream-200 px-4 py-3">
          <span className="font-serif text-base font-bold">Notifiche</span>
          {unread > 0 && (
            <span className="text-xs font-semibold text-primary-700">{unread} non lette</span>
          )}
        </div>
        {isLoading && userId ? (
          <p className="px-4 py-6 text-center text-sm text-ink-500" role="status">Carico le notifiche…</p>
        ) : isError && righe.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-6 text-center" role="alert">
            <p className="text-sm text-ink-600">Non riusciamo a leggere le notifiche.</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-full border border-cream-300 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-cream-50"
            >
              Riprova
            </button>
          </div>
        ) : righe.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-500">Nessuna notifica, per ora.</p>
        ) : (
          <ul ref={elencoRef} tabIndex={-1} className="max-h-[min(60vh,420px)] divide-y divide-cream-200 overflow-y-auto focus:outline-none" aria-label="Ultime notifiche">
            {righe.map((n) => {
              const tono = toneFor(n);
              const Icona = tono.icon;
              const dentro = (
                <div className={`flex items-start gap-3 px-4 py-3 ${n.is_read ? '' : 'bg-primary-50/40'}`}>
                  <span
                    className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tono.bg} ${tono.fg}`}
                    aria-hidden
                  >
                    <Icona size={16} strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm leading-snug ${n.is_read ? 'font-medium text-ink-700' : 'font-semibold text-ink-900'}`}>
                      {n.title}
                    </p>
                    {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-ink-600">{n.body}</p>}
                    <p className="mt-1 text-2xs text-ink-400">{formatDate(n.created_at)}</p>
                  </div>
                  {!n.is_read && (
                    <>
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-600" aria-hidden="true" />
                      <span className="sr-only">Non letta</span>
                    </>
                  )}
                </div>
              );
              return (
                <li key={n.id}>
                  {n.link ? (
                    <Link
                      href={n.link}
                      className="block hover:bg-cream-50"
                      onClick={() => {
                        if (!n.is_read) segnaLetta(n.id);
                        onClose();
                      }}
                    >
                      {dentro}
                    </Link>
                  ) : !n.is_read ? (
                    // Senza un indirizzo da aprire, il clic la segna letta (collaudo del 25/11).
                    <button
                      type="button"
                      onClick={() => {
                        segnaLetta(n.id);
                        // Letta, la voce non è più un pulsante: il fuoco resta nella tendina (collaudo del 25/11).
                        elencoRef.current?.focus();
                      }}
                      aria-label={`${n.title}: segna come letta`}
                      className="block w-full text-left hover:bg-cream-50"
                    >
                      {dentro}
                    </button>
                  ) : (
                    dentro
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Link
          href="/notifications"
          onClick={onClose}
          className="block w-full border-t border-cream-200 bg-cream-50 px-4 py-3 text-center text-sm font-semibold text-ink-700 hover:bg-cream-100"
        >
          Vedi tutte nel Centro notifiche
        </Link>
      </div>
    </>
  );
}

export default function SellerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const { profile, userEmail } = useProfile();

  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);     // mobile off-canvas drawer
  const [notifOpen, setNotifOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const notifTriggerRef = useRef<HTMLButtonElement>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  // Sotto lg il menu è un cassetto: chiuso, non si raggiunge con Tab né col lettore
  // di schermo (inert), aperto prende il fuoco, Esc lo chiude e il fuoco torna su «Apri menu».
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const aggiorna = () => setDesktop(mq.matches);
    aggiorna();
    mq.addEventListener?.('change', aggiorna);
    return () => mq.removeEventListener?.('change', aggiorna);
  }, []);
  const menuNascosto = !navOpen && !desktop;
  // `inert` si scrive a mano: React 18 non conosce ancora l'attributo. Prima del hook
  // (e in un layout effect): il fuoco che il hook mette nel menu non entra in un menu inert.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    if (menuNascosto) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [menuNascosto]);
  useBottomSheetA11y(navOpen && !desktop, menuRef, hamburgerRef, () => setNavOpen(false));

  // L'identità arriva dal profilo già condiviso: due chiamate di rete al minuto in meno (R075).
  // SDG non ha ordini di prodotti: il conteggio non parte, e la sua voce non ha il pallino.
  const sdg = eDiSdg(profile?.id);
  const nav = menuDelNegozio(profile?.id);
  const todo = useSellerTodoCount(sdg ? null : profile?.id ?? null);
  const notifUnread = useNotifUnread(profile?.id ?? null);
  const { etichetta: piano } = usePianoDelNegozio();

  const storeName = profile?.store_name || profile?.full_name || profile?.email || userEmail || 'Negozio';
  const initials =
    storeName.trim().split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase() || 'S';

  // Chiude il drawer mobile a ogni cambio rotta.
  useEffect(() => { setNavOpen(false); }, [pathname]);

  /**
   * 6/9/2026 — QUANTO E' ALTA QUESTA BARRA, DETTO A CHI STA SOTTO.
   *
   * La barra in cima all'area venditore resta ferma mentre la pagina scorre, e
   * passa sopra a tutto quello che si ferma anche lui. Chi si deve fermare piu'
   * in basso — l'anteprima della vetrina, per esempio — tirava a indovinare
   * («sedici pixel») e finiva coperto, perche' la barra e' alta quanto il campo
   * di ricerca piu' i suoi margini.
   *
   * Adesso l'altezza vera la scrive qui la barra stessa, in una variabile che
   * chiunque puo' leggere: `--seller-topbar-height`. E' lo stesso modo in cui il
   * sito pubblico dichiara `--header-height` in globals.css, ma misurata invece
   * che scritta a mano, cosi' resta giusta anche quando la barra cambia.
   */
  useEffect(() => {
    const scrivi = () => {
      const h = topbarRef.current?.offsetHeight;
      if (h) document.documentElement.style.setProperty('--seller-topbar-height', `${h}px`);
    };
    scrivi();
    window.addEventListener('resize', scrivi);
    return () => {
      window.removeEventListener('resize', scrivi);
      document.documentElement.style.removeProperty('--seller-topbar-height');
    };
  }, []);

  const handleSignOut = async () => {
    await esciEVaiAllAccesso(router);
  };

  const onSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = searchRef.current?.value.trim();
    router.push(q ? `/seller/products?q=${encodeURIComponent(q)}` : '/seller/products');
  };

  // Larghezza sidebar: collapsed solo su desktop (lg+). Su mobile è full-drawer.
  const asideWidth = collapsed ? 'lg:w-[76px]' : 'lg:w-[248px]';

  return (
    <div className="min-h-screen bg-cream-100 lg:flex">
      {/* Backdrop drawer mobile */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          aria-hidden
          className="fixed inset-0 z-modal bg-black/45 lg:hidden"
        />
      )}

      {/* SIDEBAR */}
      <aside
        ref={menuRef}
        aria-hidden={menuNascosto || undefined}
        className={`fixed inset-y-0 left-0 z-modal flex h-dvh lg:h-screen w-[260px] max-w-[82vw] flex-col bg-ink-900 text-white transition-transform duration-200 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:sticky lg:top-0 lg:z-sidebar lg:max-w-none lg:translate-x-0 ${asideWidth}`}
        aria-label="Menu venditore"
      >
        {/* Brand + collapse */}
        <div
          className={`flex shrink-0 items-center gap-2 border-b border-white/10 px-4 pb-3.5 pt-5 ${
            collapsed ? 'lg:justify-center lg:px-2.5' : 'justify-between'
          }`}
        >
          {!collapsed && (
            <Link href="/seller/dashboard" prefetch={false} className="font-serif text-2xl font-extrabold leading-none tracking-tight">
              <span className="text-accent-300">My</span>
              <span className="text-white">City</span>
              <span className="ml-1.5 font-sans text-xs font-bold uppercase tracking-label text-ink-300">
                Seller
              </span>
            </Link>
          )}
          {/* Collapse — desktop */}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Espandi menu' : 'Comprimi menu'}
            title={collapsed ? 'Espandi menu' : 'Comprimi menu'}
            className="hidden h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20 lg:inline-flex"
          >
            {collapsed ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
          </button>
          {/* Chiudi drawer — mobile */}
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Chiudi menu"
            className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20 lg:hidden"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* Copilot — gestisci parlando (spento con l'AI dei negozi, carta #209) */}
        {AI_NEGOZI_ACCESA && (
        <div className={`shrink-0 px-3 pb-1 pt-3 ${collapsed ? 'lg:px-2.5' : ''}`}>
          <Link
            href={COPILOT_HREF}
            prefetch={false}
            title="Copilot — gestisci parlando"
            className={`flex w-full items-center gap-2.5 rounded-lg bg-gradient-to-br from-primary-600 to-secondary-600 px-3.5 py-3 text-left text-white shadow-warm hover:from-primary-700 hover:to-secondary-700 ${
              collapsed ? 'lg:justify-center lg:px-2.5' : ''
            }`}
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/20">
              <Sparkles size={18} aria-hidden />
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-extrabold">Copilot</span>
                <span className="block text-xs text-white/80">Gestisci parlando</span>
              </span>
            )}
          </Link>
        </div>
        )}

        {/* Nav */}
        <nav className={`flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2 ${collapsed ? 'lg:px-2' : ''}`}>
          {nav.map((sec) => (
            <div key={sec.group} className="mb-1.5">
              {!collapsed && (
                <p className="mx-3 mb-1 mt-1.5 text-2xs font-bold uppercase tracking-label text-white/40">
                  {sec.group}
                </p>
              )}
              {sec.items.map((n) => {
                const on = isActive(pathname, n.href);
                const Icon = n.icon;
                const showBadge = n.badge === 'todo' && todo > 0;
                return (
                  // Niente precarico: ogni pagina /seller ripassa dal controllo d'accesso del
                  // middleware (getUser + lettura del profilo). Precaricate tutte insieme, le voci
                  // della barra facevano due chiamate a Supabase ciascuna a ogni apertura del pannello.
                  <Link
                    key={n.href}
                    href={n.href}
                    prefetch={false}
                    aria-current={on ? 'page' : undefined}
                    title={n.label}
                    className={`relative flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm transition-colors ${
                      collapsed ? 'lg:justify-center lg:px-2.5' : ''
                    } ${
                      on
                        ? 'bg-primary-700 font-bold text-white'
                        : 'font-medium text-white/[0.78] hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Icon size={17} strokeWidth={2.2} className="shrink-0" aria-hidden />
                    {!collapsed && <span className="flex-1">{n.label}</span>}
                    {/* Badge esteso */}
                    {showBadge && !collapsed && (
                      <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent-500 px-1.5 text-xs font-bold text-ink-900">
                        {todo > 99 ? '99+' : todo}
                      </span>
                    )}
                    {/* Badge collapsed: pallino in alto a destra */}
                    {showBadge && collapsed && (
                      <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-accent-500" aria-hidden />
                    )}
                    {showBadge && (
                      <span className="sr-only">{todo} ordini da gestire</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer: il negozio e il suo piano, come su Claude (24/11/2026). Il menu che si apre porta
            all'abbonamento, al Profilo, al marketplace e all'uscita. */}
        <div className={`shrink-0 border-t border-white/10 p-3 pb-safe ${collapsed ? 'lg:px-2' : ''}`}>
          <MenuAccount
            nome={storeName}
            iniziali={initials}
            email={profile?.email || userEmail || null}
            compatto={collapsed}
            onEsci={handleSignOut}
          />
        </div>
      </aside>

      {/* MAIN COLUMN */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* TOPBAR */}
        <header
          ref={topbarRef}
          className="sticky top-0 z-sticky flex items-center gap-4 border-b border-cream-300 bg-surface-0 px-4 py-3 sm:px-6 lg:px-7"
        >
          {/* Hamburger — mobile */}
          <button
            ref={hamburgerRef}
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Apri menu"
            className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-ink-700 hover:bg-cream-100 lg:hidden"
          >
            <Menu size={22} aria-hidden />
          </button>

          {/* Search pill */}
          <form onSubmit={onSearchSubmit} role="search" className="relative min-w-0 flex-1 sm:max-w-[380px]">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
              <Search size={17} aria-hidden />
            </span>
            <input
              ref={searchRef}
              type="search"
              name="q"
              aria-label="Cerca fra i tuoi prodotti"
              placeholder="Cerca fra i tuoi prodotti…"
              className="w-full rounded-full border border-cream-300 bg-cream-50 py-2.5 pl-10 pr-4 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus-visible:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-700"
            />
          </form>

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            {/* Pubblica prodotto */}
            <Link
              href="/seller/products/new"
              className="inline-flex items-center gap-1.5 rounded-full bg-primary-700 px-3.5 py-2.5 text-sm font-bold text-white shadow-warm-sm transition-colors hover:bg-primary-800"
            >
              <Plus size={16} strokeWidth={2.4} aria-hidden />
              <span className="hidden sm:inline">Pubblica prodotto</span>
            </Link>

            {/* Notifiche */}
            <div className="relative">
              <button
                ref={notifTriggerRef}
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                aria-label="Notifiche"
                aria-haspopup="dialog"
                aria-expanded={notifOpen}
                aria-controls="pannello-notifiche-venditore"
                className="relative inline-flex items-center justify-center rounded-full p-2 text-ink-600 hover:bg-cream-100"
              >
                <Bell size={20} aria-hidden />
                {notifUnread > 0 && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-secondary-600" aria-hidden />
                )}
              </button>
              {notifOpen && (
                <NotifPopover
                  unread={notifUnread}
                  userId={profile?.id ?? null}
                  onClose={() => setNotifOpen(false)}
                  triggerRef={notifTriggerRef}
                />
              )}
            </div>

            {/* Avatar negozio — sul computer il negozio e il piano stanno in fondo al menu
                (MenuAccount); qui restano per il telefono e il tablet, dove il menu è chiuso. */}
            <Link href="/seller/profile" className="flex items-center gap-2 lg:hidden" title={`${storeName} · ${piano.testo}`}>
              <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-sm font-bold text-white">
                {initials}
              </span>
              <span className="hidden leading-tight md:block">
                <span className="block max-w-[140px] truncate text-sm font-bold text-ink-900">{storeName}</span>
                <span className={`block text-xs ${piano.tono === 'attivo' ? 'font-semibold text-primary-700' : piano.tono === 'da_sistemare' ? 'font-semibold text-amber-700' : 'text-ink-400'}`}>
                  {piano.testo}
                </span>
              </span>
            </Link>
          </div>
        </header>

        {/* CONTENT
            6/9/2026 — qui c'era un secondo `<main>`. Il guscio del sito
            (app/layout.tsx) avvolge gia' tutto in `<main id="main-content">`, e
            un `<main>` dentro un `<main>` non e' HTML valido: chi naviga con il
            lettore di schermo salta da un punto di riferimento all'altro e si
            trova due «contenuto principale», senza sapere quale sia quello
            buono. Il punto di riferimento resta uno solo, quello fuori. */}
        <div className="w-full max-w-[1100px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-7">
          {children}
        </div>
      </div>

      {/* Copilot FAB — sempre raggiungibile */}
      {AI_NEGOZI_ACCESA && pathname !== COPILOT_HREF && (
        <Link
          href={COPILOT_HREF}
          aria-label="Chiedi al Copilot"
          title="Chiedi al Copilot"
          className="fixed bottom-6 right-6 z-overlay inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-primary-600 to-secondary-600 px-4 py-3.5 text-sm font-bold text-white shadow-warm-xl hover:from-primary-700 hover:to-secondary-700"
        >
          <Sparkles size={19} aria-hidden />
          <span className="hidden sm:inline">Copilot</span>
        </Link>
      )}
    </div>
  );
}
