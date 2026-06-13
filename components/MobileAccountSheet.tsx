'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Store, Bike, LogOut, X } from 'lucide-react';
import { getAccountMenuItems, type MenuRole } from '@/lib/account-menu';
import { useCloseOnBack } from './hooks/useCloseOnBack';

type Props = {
  open: boolean;
  onClose: () => void;
  role: MenuRole;
  displayName: string;
  storeLogo?: string | null;
  onSignOut: () => void;
};

/**
 * Pannello account a scomparsa dal basso (solo mobile). Espone le stesse voci
 * della tendina desktop, dato che su mobile quella tendina non esiste.
 * Si apre dalla tab "Io" della MobileTabBar, per tutti i ruoli.
 */
export default function MobileAccountSheet({ open, onClose, role, displayName, storeLogo, onSignOut }: Props) {
  // Tasto "indietro" di sistema (es. Samsung): chiude solo il drawer, niente navigazione.
  useCloseOnBack(open, onClose);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const items = getAccountMenuItems(role);
  const isSeller = role === 'seller';
  const isRider = role === 'rider';
  const isAdmin = role === 'admin';

  return (
    <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu account">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-2xl shadow-warm-lg max-h-[85vh] overflow-y-auto pb-safe">
        <div className="sticky top-0 bg-cream-100 flex items-center justify-between px-4 py-3 border-b border-ink-100">
          <div className="flex items-center gap-3 min-w-0">
            {isSeller && storeLogo ? (
              <span className="w-11 h-11 rounded-full overflow-hidden bg-white ring-1 ring-ink-100 relative shrink-0">
                <Image src={storeLogo} alt={displayName} fill sizes="44px" className="object-cover" />
              </span>
            ) : (
              <span className={`w-11 h-11 rounded-full flex items-center justify-center text-base font-bold uppercase shrink-0 ${
                isSeller ? 'bg-accent-500 text-ink-900' :
                isRider  ? 'bg-olive-500 text-white' :
                isAdmin  ? 'bg-secondary-500 text-white' :
                           'bg-primary-100 text-primary-700'
              }`}>
                {isSeller ? <Store size={20} /> : isRider ? <Bike size={20} /> : (displayName?.[0]?.toUpperCase() ?? '?')}
              </span>
            )}
            <div className="min-w-0">
              <p className="text-xs text-ink-500 uppercase tracking-wide">
                {isSeller ? 'Negozio' : isRider ? 'Rider' : isAdmin ? 'Admin' : 'Ciao'}
              </p>
              <p className="font-semibold text-ink-900 truncate">{displayName}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Chiudi" className="p-2 rounded-full hover:bg-cream-200 text-ink-500">
            <X size={20} />
          </button>
        </div>

        <ul className="py-2">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  onClick={onClose}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-ink-800 hover:bg-cream-100"
                >
                  <Icon size={18} strokeWidth={2.2} className="text-ink-500 shrink-0" aria-hidden />
                  <span className="font-medium">{it.label}</span>
                </Link>
              </li>
            );
          })}
          <li><div className="border-t border-ink-100 my-1" /></li>
          <li>
            <button
              type="button"
              onClick={() => { onClose(); onSignOut(); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-secondary-600 hover:bg-secondary-50 font-medium"
            >
              <LogOut size={18} strokeWidth={2.2} />
              Esci
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}
