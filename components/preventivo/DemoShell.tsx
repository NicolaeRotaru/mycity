'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Receipt, Package, Tag, Megaphone, Camera, BarChart3,
  Users, Star, Wallet, MessageCircle, Lock, Sparkles, ArrowRight, Eye,
  Globe, Share2, TrendingUp, Video,
  type LucideIcon,
} from 'lucide-react';
import { FASCE, SERVIZI_AGENZIA, SLUG_SERVIZIO, type Abbonamento } from '@/lib/agenzia/preventivo';
import { ETICHETTE_SERVIZI } from '@/components/seller/servizi-nel-menu';
import { hrefFascia } from '@/lib/agenzia/indirizzi-servizi';
import { indirizziDemo } from '@/lib/agenzia/indirizzi-demo';
import MenuSezioni, { type GruppoDelMenu } from '@/components/ui/MenuSezioni';

/**
 * IL PANNELLO DEMO DEL LINK COL CODICE — 25/11/2026.
 *
 * Nicola: «che il link del preventivo ti porti ad una demo come quella di pane quotidiano», e alla
 * domanda «pannello demo senza accesso, entrare nell'account o un bottone?» ha scelto il primo.
 * Chi apre /preventivo/<codice> vede il pannello del SUO negozio come lo vede Pane Quotidiano:
 * menu scuro a sinistra, la dashboard con l'abbonamento, i quattro servizi e l'analisi.
 * Non serve accesso, e niente di quello che si vede tocca il negozio vero: le voci che servono a un
 * negozio aperto (ordini, prodotti, promozioni…) si vedono col lucchetto, per far capire cosa trova
 * dopo, ma non portano da nessuna parte. Per abbonarsi si sceglie la fascia e si lascia l'email,
 * come prima (app/preventivo/[codice]/abbonamento).
 */

type Voce = { href: string; icon: LucideIcon; label: string };

const ICONE_SERVIZI = { foto_video: Video, sito_web: Globe, social: Share2, analisi: TrendingUp } as const;

/** Le voci del pannello vero che nella demo si vedono ma sono chiuse (stesso ordine di SellerShell). */
const CHIUSE: Array<{ gruppo: string; voci: Array<{ icon: LucideIcon; label: string }> }> = [
  { gruppo: 'Crescita', voci: [
    { icon: Tag, label: 'Promozioni' },
    { icon: Megaphone, label: 'Sponsorizza' },
    { icon: Camera, label: 'Storie' },
    { icon: BarChart3, label: 'Analisi' },
  ] },
  { gruppo: 'Relazioni', voci: [
    { icon: Users, label: 'Clienti' },
    { icon: MessageCircle, label: 'Messaggi' },
    { icon: Star, label: 'Recensioni' },
    { icon: Wallet, label: 'Guadagni' },
  ] },
];

const CLASSE_VOCE = 'relative flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm transition-colors';

export default function DemoShell({
  codice,
  nome,
  consigliato,
  children,
}: {
  codice: string;
  nome: string;
  consigliato: Abbonamento | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const ind = indirizziDemo(codice);
  const servizi: Voce[] = SERVIZI_AGENZIA.map((id) => ({
    href: ind.servizio(SLUG_SERVIZIO[id]),
    icon: ICONE_SERVIZI[id],
    label: ETICHETTE_SERVIZI[id],
  }));
  const attiva = (href: string) => (href === ind.dashboard ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const scegli = consigliato ? hrefFascia(consigliato, ind.abbonamento) : ind.abbonamento;
  const iniziali = nome.trim().split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase() || 'M';

  const link = (v: Voce) => {
    const on = attiva(v.href);
    const Icona = v.icon;
    return (
      <Link
        key={v.href}
        href={v.href}
        aria-current={on ? 'page' : undefined}
        className={`${CLASSE_VOCE} ${on ? 'bg-primary-700 font-bold text-white' : 'font-medium text-white/[0.78] hover:bg-white/5 hover:text-white'}`}
      >
        <Icona size={17} strokeWidth={2.2} className="shrink-0" aria-hidden />
        <span className="flex-1">{v.label}</span>
      </Link>
    );
  };

  // Sul telefono le stesse voci del menu di sinistra, nello stesso ordine, più l'abbonamento.
  const CHIUSA = 'si accende quando attivi l’abbonamento';
  const gruppiDelTelefono: GruppoDelMenu[] = [
    { titolo: 'Gestione', voci: [
      { href: ind.dashboard, icon: LayoutDashboard, label: 'Dashboard' },
      { href: `${ind.dashboard}#ordini`, icon: Receipt, label: 'Ordini', chiusa: CHIUSA },
      { href: `${ind.dashboard}#prodotti`, icon: Package, label: 'Prodotti', chiusa: CHIUSA },
    ] },
    { titolo: 'Servizi', voci: servizi },
    ...CHIUSE.map((g) => ({
      titolo: g.gruppo,
      voci: g.voci.map((v) => ({ href: `${ind.dashboard}#${v.label.toLowerCase()}`, icon: v.icon, label: v.label, chiusa: CHIUSA })),
    })),
    { titolo: 'Il tuo negozio', voci: [{ href: ind.abbonamento, icon: Sparkles, label: 'Abbonamento' }] },
  ];

  return (
    <div className="min-h-screen bg-cream-100" data-testid="pannello-demo">
      {/* La fascia in cima dice subito che è una demo, come «Modalità acquisto» nel pannello vero. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary-200 bg-primary-50 px-4 py-3 sm:px-6">
        <p className="inline-flex items-center gap-2 text-sm text-ink-900">
          <Eye size={16} className="shrink-0 text-primary-700" aria-hidden />
          <span>
            <strong>Demo del pannello di {nome}</strong> — è un’anteprima: niente di quello che vedi è pubblico finché non attivi l’abbonamento.
          </span>
        </p>
        <Link
          href={scegli}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800"
        >
          Scegli l’abbonamento <ArrowRight size={15} aria-hidden />
        </Link>
      </div>

      <div className="lg:flex">
        {/* MENU — sul computer a sinistra, scuro come nel pannello vero */}
        <aside
          aria-label="Menu della demo"
          className="hidden w-[248px] shrink-0 flex-col bg-ink-900 text-white lg:sticky lg:top-0 lg:flex lg:h-screen"
        >
          <div className="flex shrink-0 items-center border-b border-white/10 px-4 pb-3.5 pt-5">
            <Link href={ind.dashboard} className="font-serif text-2xl font-extrabold leading-none tracking-tight">
              <span className="text-accent-300">My</span>
              <span className="text-white">City</span>
              <span className="ml-1.5 font-sans text-xs font-bold uppercase tracking-label text-ink-300">Seller</span>
            </Link>
          </div>
          <nav aria-label="Pannello" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
            <div className="mb-1.5">
              <p className="mx-3 mb-1 mt-1.5 text-2xs font-bold uppercase tracking-label text-white/40">Gestione</p>
              {link({ href: ind.dashboard, icon: LayoutDashboard, label: 'Dashboard' })}
              <VoceChiusa icon={Receipt} label="Ordini" />
              <VoceChiusa icon={Package} label="Prodotti" />
            </div>
            <div className="mb-1.5">
              <p className="mx-3 mb-1 mt-1.5 text-2xs font-bold uppercase tracking-label text-white/40">Servizi</p>
              {servizi.map(link)}
            </div>
            {CHIUSE.map((g) => (
              <div key={g.gruppo} className="mb-1.5">
                <p className="mx-3 mb-1 mt-1.5 text-2xs font-bold uppercase tracking-label text-white/40">{g.gruppo}</p>
                {g.voci.map((v) => <VoceChiusa key={v.label} icon={v.icon} label={v.label} />)}
              </div>
            ))}
          </nav>
          <div className="shrink-0 border-t border-white/10 p-3">
            <Link
              href={ind.abbonamento}
              aria-current={attiva(ind.abbonamento) ? 'page' : undefined}
              className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-white/5"
            >
              <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-accent-300 text-xs font-extrabold text-ink-900" aria-hidden>
                {iniziali}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{nome}</span>
                <span className="block text-xs text-white/60">
                  {consigliato ? `Demo · consigliato ${FASCE[consigliato].nome}` : 'Demo'}
                </span>
              </span>
            </Link>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* MENU — sul telefono un riquadro che apre il pannello delle voci (28/11/2026: era una riga che
              scorreva di lato, la stessa che Nicola ha trovato brutta nell'area account). Le voci chiuse si
              vedono col lucchetto, come a sinistra sul computer. */}
          <div className="border-b border-cream-300 bg-cream-50 px-4 py-f2 lg:hidden">
            <MenuSezioni
              etichetta="Pannello"
              sopratitolo={`Pannello demo · ${nome}`}
              gruppi={gruppiDelTelefono}
              attiva={attiva}
              testa={(
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-300 text-sm font-extrabold text-ink-900" aria-hidden>
                    {iniziali}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-serif text-[15px] font-bold text-ink-900">{nome}</span>
                    <span className="block text-xs text-ink-500">
                      {consigliato ? `Demo · consigliato ${FASCE[consigliato].nome}` : 'Demo'}
                    </span>
                  </span>
                </div>
              )}
            />
          </div>
          {/* Un solo «contenuto principale»: il <main> lo mette già il guscio del sito (app/layout.tsx). */}
          <div className="w-full max-w-[1100px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-7">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Una voce del pannello vero che nella demo si vede col lucchetto: si accende con l'abbonamento. */
function VoceChiusa({ icon: Icona, label }: { icon: LucideIcon; label: string }) {
  return (
    <span
      className={`${CLASSE_VOCE} cursor-not-allowed font-medium text-white/40`}
      title="Si accende quando attivi l’abbonamento"
    >
      <Icona size={17} strokeWidth={2.2} className="shrink-0" aria-hidden />
      <span className="flex-1">{label}</span>
      <Lock size={13} className="shrink-0" aria-hidden />
      <span className="sr-only">: si accende quando attivi l’abbonamento</span>
    </span>
  );
}
