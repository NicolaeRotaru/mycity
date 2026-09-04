'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { User } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useProfile } from './hooks/useProfile';
import { useCartCount } from './hooks/useCartCount';
import { useMessagesUnread } from './hooks/useMessagesUnread';
import MobileAccountSheet from './MobileAccountSheet';
import SupportChatModal from './SupportChatModal';
import type { MenuRole } from '@/lib/account-menu';
import { useShoppingMode } from './hooks/useShoppingMode';
import { schedeInFondo, serveIlPulsanteAccount, type Scheda } from '@/lib/ui/schede-in-fondo';

/**
 * L'elenco delle schede e la decisione sul pulsante «Tu» vivono in
 * `lib/ui/schede-in-fondo.ts`: qui dentro nessuna prova poteva accorgersi che
 * al venditore in modalità acquisto comparivano due porte per lo stesso
 * pannello (R097).
 */
type Tab = Scheda;

/**
 * Bottom tab bar mobile — feel "app nativa" (Glovo, Deliveroo, Just Eat).
 * 5 tab massimo (best practice mobile UX). Cambia in base al ruolo.
 *
 * La tab "Io" apre un pannello a scomparsa (MobileAccountSheet) con tutte le
 * voci della tendina account desktop, che su mobile non esiste — vale per
 * buyer, seller e rider.
 *
 * Si nasconde su sign-in / sign-up e dentro al thread chat
 * (dove la bottom bar competerebbe con l'input messaggio).
 */
export default function MobileTabBar() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const { profile, userEmail, isAuthenticated, isSeller, isRider, isAdmin, isBuyer } = useProfile();
  const shoppingMode = useShoppingMode(isSeller);
  const sellerShopping = isSeller && shoppingMode;
  const cartCount = useCartCount();
  const msgUnread = useMessagesUnread();
  const t = useTranslations('nav');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);

  // Hide in auth flow + checkout + thread chat. Su /checkout la bottom tab bar
  // (fixed bottom-0, z-30) coprirebbe la CTA sticky "Conferma ordine / Paga"
  // (z-sticky 20): il pulsante risultava parzialmente coperto su mobile (funnel
  // critico). Su /seller e /rider la navigazione mobile è gestita dallo shell
  // dedicato (drawer off-canvas SellerShell; bottom tab bar di RiderShell),
  // quindi nascondiamo la tab bar globale per non avere doppia chrome.
  const nascosta =
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/sign-up') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/checkout') ||
    pathname.startsWith('/seller') ||
    pathname.startsWith('/rider') ||
    /^\/messages\/[^/]+/.test(pathname);

  // 124 — La pagina riservava sempre 72px in fondo, anche dove questa barra non
  // c'è: una striscia di vuoto sotto il contenuto, su tutta l'area venditore,
  // fattorino, checkout e accesso. La classe dice al foglio di stile quando
  // l'altezza vale zero, e l'altezza resta scritta in un posto solo.
  useEffect(() => {
    document.body.classList.toggle('senza-tabbar', nascosta);
    return () => document.body.classList.remove('senza-tabbar');
  }, [nascosta]);

  if (nascosta) return null;

  const tabs: Tab[] = schedeInFondo(
    { isAuthenticated, isSeller, isRider, isAdmin, sellerShopping },
    t,
    { carrello: cartCount, messaggi: msgUnread },
  );

  const isActive = (href: string, exact?: boolean) =>
    href === '/' || exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');

  // Tra le tab che combaciano col path, tiene attiva solo la più specifica
  // (href più lungo). Evita che una rotta padre (/seller/products) resti
  // evidenziata su una figlia con tab propria (/seller/products/new).
  const matchedHref = tabs.reduce<string | null>(
    (best, tab) =>
      isActive(tab.href, tab.exact) && (!best || tab.href.length > best.length) ? tab.href : best,
    null,
  );

  const role: MenuRole = isAdmin ? 'admin' : (isSeller && !sellerShopping) ? 'seller' : isRider ? 'rider' : isAuthenticated ? 'buyer' : null;
  const displayName =
    profile?.full_name?.split(' ')[0] ??
    profile?.store_name ??
    profile?.email?.split('@')[0] ??
    userEmail?.split('@')[0] ??
    'utente';

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/sign-in');
    router.refresh();
  };

  const tabClass = (active: boolean) =>
    `relative w-full flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
      active ? 'text-primary-600' : 'text-ink-500 hover:text-ink-800'
    }`;

  const renderInner = (tab: Tab, active: boolean) => {
    const Icon = tab.icon;
    return (
      <>
        <div className="relative">
          <Icon size={22} strokeWidth={active ? 2.4 : 2} aria-hidden />
          {/* 27/8/2026 (R109) — il numero c'era ma nudo, e prima dell'etichetta:
              si sentiva «3 Carrello». Adesso la pallina è muta e accanto c'è il
              pezzo che dice di cosa sono quei tre. */}
          {tab.badge && tab.badge > 0 ? (
            <span aria-hidden className="absolute -top-1.5 -right-2 bg-primary-600 text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center">
              {tab.badge > 99 ? '99+' : tab.badge}
            </span>
          ) : null}
        </div>
        <span className={`text-[11px] font-medium ${active ? 'font-semibold' : ''}`}>
          {tab.label}
        </span>
        {tab.badge && tab.badge > 0 ? (
          <span className="sr-only">, {tab.badge} {tab.badgeUnita ?? 'non letti'}</span>
        ) : null}
        {active && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary-600 rounded-b" />}
      </>
    );
  };

  return (
    <>
      <nav
        role="navigation"
        aria-label="Navigazione principale"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-ink-100 shadow-warm-lg pb-safe"
      >
        <ul className="flex items-stretch justify-around">
          {tabs.map((tab) => {
            const pathActive = isActive(tab.href, tab.exact) && tab.href === matchedHref;
            const active = tab.isAccount
              ? (sheetOpen || pathActive)
              : tab.isSupport
                ? supportOpen
                : pathActive;
            return (
              <li key={tab.href} className="flex-1">
                {tab.isAccount ? (
                  <button
                    type="button"
                    onClick={() => setSheetOpen(true)}
                    className={tabClass(active)}
                    aria-haspopup="dialog"
                    aria-expanded={sheetOpen}
                  >
                    {renderInner(tab, active)}
                  </button>
                ) : tab.isSupport ? (
                  <button
                    type="button"
                    onClick={() => setSupportOpen(true)}
                    className={tabClass(active)}
                    aria-haspopup="dialog"
                    aria-expanded={supportOpen}
                  >
                    {renderInner(tab, active)}
                  </button>
                ) : (
                  // 142 — Senza `aria-current` la scheda attiva era segnalata
                  // solo dal colore: chi non lo distingue, o non vede affatto,
                  // non sapeva dove si trovava.
                  <Link href={tab.href} aria-current={active ? 'page' : undefined} className={tabClass(active)}>
                    {renderInner(tab, active)}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* "Tu" flottante: solo a chi è dentro, e solo dove la barra non ha già la
          sua porta all'account.
          30/8/2026 (R097) — prima la condizione era «venditore o amministratore»,
          e al venditore in modalità acquisto — che è un cliente a tutti gli
          effetti, con la sua scheda «Io» — compariva un secondo pulsante tondo
          sospeso sopra la griglia dei prodotti.
          3/9/2026 — E IL CERCHIO SPUNTAVA ANCHE A CHI NON HA UN ACCOUNT.
          La regola condivisa guarda le schede: fra quelle del visitatore non c'è
          nessuna porta all'account (c'è «Accedi», che è un'altra cosa), quindi
          rispondeva «serve» e il cerchio grigio si appoggiava sopra la colonna
          destra della griglia prodotti — dove stanno prezzo e pulsante «+».
          Chi lo toccava si vedeva proporre di uscire da un account che non ha
          mai avuto. È il primo giro di chi arriva dal QR in vetrina o dal link
          su WhatsApp: attrito e sfiducia proprio mentre decide se comprare.
          Il pannello dietro al cerchio si apre solo da qui e dalla scheda
          «Io»: senza account nessuna delle due esiste più, quindi quel menu
          adesso è irraggiungibile per chi non è entrato. */}
      {isAuthenticated && serveIlPulsanteAccount(tabs) && (
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label={t('me')}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          className={`md:hidden fixed right-4 z-40 w-14 h-14 rounded-full bg-white text-ink-700 shadow-warm-lg ring-1 ring-ink-100 flex items-center justify-center hover:bg-cream-50 transition-colors ${
            isSeller ? 'bottom-44' : 'bottom-24'
          }`}
        >
          <User size={24} strokeWidth={2.2} />
        </button>
      )}

      <MobileAccountSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        role={role}
        displayName={displayName}
        storeLogo={profile?.store_logo ?? null}
        onSignOut={handleSignOut}
      />

      {/* Assistenza per il buyer: aperta dalla tab "Assistenza" nella barra. */}
      {isBuyer && (
        // `role` qui è una proprietà del componente (compratore/venditore), non
        // un ruolo ARIA: la regola di lint non può distinguerlo.
        // eslint-disable-next-line jsx-a11y/aria-role
        <SupportChatModal open={supportOpen} onClose={() => setSupportOpen(false)} role="buyer" />
      )}
    </>
  );
}
