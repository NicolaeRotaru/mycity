'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import AccountSidebar, { IdentitaAccount } from '@/components/account/AccountSidebar';
import MenuSezioni, { type GruppoDelMenu } from '@/components/ui/MenuSezioni';
import { VOCI_ACCOUNT, voceAccountAttiva, type ContoVoce } from '@/components/account/voci-account';
import { esciEVaiAllAccesso } from '@/lib/auth/uscita';
import { useNotificationsCount } from '@/components/hooks/useNotificationsCount';
import { useMessagesUnread } from '@/components/hooks/useMessagesUnread';

/**
 * Account shell acquirente — layout responsive 2 colonne: aside sticky ~260px
 * (AccountSidebar) + colonna contenuto. Vive SOTTO la global Navbar (è
 * content-level, non un'app dedicata).
 *
 * 28/11/2026 — SUL TELEFONO LE VOCI ERANO UNA RIGA DI PILLOLE CHE SCORREVA DI LATO.
 * Nicola, dal telefono, sulla pagina Profilo: se ne vedevano tre e mezza, le altre otto stavano fuori
 * dallo schermo, «l'estetica in questo modo qua è veramente molto brutta… mettile in forma di menu».
 * Ora in cima c'è un riquadro che dice dove sei e apre un pannello con tutte le voci, nei gruppi della
 * barra laterale (components/ui/MenuSezioni.tsx). La vede chiunque apra l'area account: il cliente,
 * l'admin, il venditore in modalità acquisto.
 */

function MenuAccountTelefono() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const notifCount = useNotificationsCount();
  const messagesUnread = useMessagesUnread();
  const [uscendo, setUscendo] = useState(false);

  const conto = (badge?: ContoVoce): number =>
    badge === 'notifications' ? notifCount : badge === 'messages' ? messagesUnread : 0;

  const gruppi: GruppoDelMenu[] = VOCI_ACCOUNT.map((g) => ({
    titolo: g.group,
    voci: g.items.map((v) => ({ href: v.href, icon: v.icon, label: v.label, conto: conto(v.badge) })),
  }));

  return (
    <MenuSezioni
      className="mb-f3 lg:hidden"
      etichetta="Menu account"
      sopratitolo="Il tuo account"
      gruppi={gruppi}
      attiva={(href) => voceAccountAttiva(pathname, href)}
      testa={<IdentitaAccount />}
      piede={(chiudi) => (
        <button
          type="button"
          disabled={uscendo}
          onClick={async () => {
            if (uscendo) return;
            // Come nel pannello «Tu»: prima si chiude, poi si esce (l'uscita naviga dopo, a modo suo).
            chiudi();
            setUscendo(true);
            await esciEVaiAllAccesso(router);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-surface-0 px-f2 py-f2 text-[15px] font-semibold text-secondary-700 shadow-warm-sm ring-1 ring-cream-200 transition-colors duration-[222ms] ease-armonia hover:bg-secondary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 disabled:opacity-60"
        >
          <LogOut size={18} strokeWidth={2.2} aria-hidden />
          Esci
        </button>
      )}
    />
  );
}

export default function AccountShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start lg:gap-7">
        {/* Sidebar desktop.
            6/9/2026 — Si bloccava a `top-24`, cioe' 96 pixel, mentre l'intestazione appiccicata in
            cima ne occupa 144 (`--header-height` in globals.css). I 48 pixel di differenza
            finivano dietro la barra terracotta, che sta sopra: la parte alta della scheda identita'
            spariva. L'offset ora lo legge dallo stesso token che usano la scheda prodotto e il
            riepilogo del carrello, cosi' resta scritto in un posto solo. */}
        <aside className="hidden lg:block lg:sticky lg:top-[var(--header-height)]">
          <AccountSidebar />
        </aside>

        {/* Menu del telefono: un riquadro che apre il pannello delle voci */}
        <MenuAccountTelefono />

        {/* Contenuto */}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
