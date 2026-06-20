'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bike, Wallet, CalendarClock, User, type LucideIcon } from 'lucide-react';
import SOSButton from '@/components/rider/SOSButton';

/**
 * RiderShell — guscio mobile "phone-shaped" del rider.
 *
 * Esperienza da app nativa (Glovo/Deliveroo): una colonna centrata larga ~480px
 * su fondo neutro, con una BOTTOM TAB BAR fissa a 4 tab. Sostituisce la
 * MobileTabBar globale (nascosta su /rider come per /seller e /admin) e replica
 * le convenzioni dello shell venditore: attivo via usePathname, brand tokens,
 * safe-area iOS. Il logout NON vive qui: resta nella tab Profilo / account sheet.
 *
 * Avvolge SOLO il branch rider-approvato di app/rider/layout.tsx. Il SOSButton
 * (P0-7, sicurezza rider) resta flottante e raggiungibile sopra la tab bar.
 */

type Tab = { href: string; icon: LucideIcon; label: string; exact?: boolean };

const TABS: Tab[] = [
  { href: '/rider', icon: Bike, label: 'Consegne', exact: true },
  { href: '/rider/earnings', icon: Wallet, label: 'Guadagni' },
  { href: '/rider/availability', icon: CalendarClock, label: 'Turni' },
  { href: '/rider/profile', icon: User, label: 'Profilo' },
];

function isActive(pathname: string, tab: Tab): boolean {
  // /rider è la home (consegne): attiva solo sul match esatto e sul dettaglio
  // consegna (/rider/orders/...), che non ha tab propria.
  if (tab.exact) {
    return pathname === '/rider' || pathname.startsWith('/rider/orders');
  }
  return pathname === tab.href || pathname.startsWith(tab.href + '/');
}

export default function RiderShell({
  children,
  showSOS = true,
}: {
  children: React.ReactNode;
  /** SOS solo per rider veri (un admin che ispeziona /rider non lo vede). */
  showSOS?: boolean;
}) {
  const pathname = usePathname() ?? '';

  // Consegna attiva (/rider/orders/[id]): flusso full-screen "map-led" con footer
  // sticky proprio. Nascondiamo la tab bar (come Glovo durante la consegna) per
  // non avere due barre in fondo, e togliamo il padding-bottom dedicato.
  const isActiveDelivery = /^\/rider\/orders\/[^/]+/.test(pathname);

  return (
    <div className="min-h-screen w-full bg-cream-100">
      {/* Colonna phone-width centrata */}
      <div className="relative mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-surface-0 shadow-warm-sm sm:my-0">
        {/* Contenuto scrollabile — padding in fondo per non finire sotto la tab bar */}
        <main className={`flex-1 ${isActiveDelivery ? '' : 'pb-[calc(76px+env(safe-area-inset-bottom,0px))]'}`}>
          {children}
        </main>

        {/* SOS sempre raggiungibile: flottante, sopra la tab bar (P0-7). */}
        {showSOS && <SOSButton />}

        {/* BOTTOM TAB BAR fissa — ancorata alla colonna phone-width. */}
        {!isActiveDelivery && (
        <nav
          aria-label="Navigazione rider"
          className="fixed bottom-0 z-sticky w-full max-w-[480px] border-t border-cream-300 bg-surface-0 shadow-warm-lg"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <ul className="grid grid-cols-4">
            {TABS.map((tab) => {
              const on = isActive(pathname, tab);
              const Icon = tab.icon;
              return (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    aria-current={on ? 'page' : undefined}
                    className={`relative flex flex-col items-center justify-center gap-0.5 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${
                      on ? 'text-primary-700' : 'text-ink-400 hover:text-ink-700'
                    }`}
                  >
                    <Icon size={22} strokeWidth={on ? 2.4 : 2} aria-hidden />
                    <span className={`text-[10px] tracking-tight ${on ? 'font-bold' : 'font-medium'}`}>
                      {tab.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        )}
      </div>
    </div>
  );
}
