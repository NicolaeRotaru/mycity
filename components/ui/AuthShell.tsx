'use client';

import { useState } from 'react';
import { FRASE_RESO, frasePagamento } from '@/lib/promesse-pubbliche';
import { EXPRESS_ETA_LABEL } from '@/lib/delivery';
import Link from 'next/link';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import {
  ArrowLeft,
  Banknote,
  Truck,
  BadgeCheck,
  RotateCcw,
  Smartphone,
  Chrome,
  MessageSquareText,
  Store,
  Bike,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { VERSIONE_TESTI_LEGALI } from '@/lib/legal/versione';

/**
 * AuthShell — guscio split-screen condiviso dalle schermate buyer auth
 * (sign-in / sign-up / reset-password).
 *
 *  - SINISTRA: colonna form piatta (contenuto primario), centrata verticalmente,
 *    con un back-link opzionale in alto.
 *  - DESTRA: aside terracotta decorativo (bg-primary-700) con glow accent sfocato,
 *    tagline serif italica e 4 benefit chip. È puramente decorativo: marcato
 *    `aria-hidden` e nascosto su mobile (`hidden lg:flex`) → form full-width.
 *
 * Token-only (primary/accent/cream/ink). Nessun colore fuori palette.
 */

type BackLink = { href: string; label: string };

const BENEFITS: { Icon: LucideIcon; text: string }[] = [
  // Le due frasi che promettevano quello che il sito non fa — la carta alla consegna e il reso
  // gratuito su tutto — adesso nascono dalle promesse pubbliche, dove sono derivate dal codice.
  { Icon: Banknote, text: frasePagamento() },
  { Icon: Truck, text: `Consegna in ${EXPRESS_ETA_LABEL} dai negozi della tua via` },
  { Icon: BadgeCheck, text: '100% commercianti locali verificati' },
  { Icon: RotateCcw, text: FRASE_RESO },
];

export function AuthShell({
  back,
  children,
}: {
  /** Back-link mostrato in cima alla colonna form. */
  back?: BackLink;
  /** Contenuto della colonna form (titolo, sottotitolo, form, ecc.). */
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-cream-50">
      {/* SINISTRA — colonna form (contenuto primario) */}
      <div className="flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-14">
        <div className="w-full max-w-md mx-auto">
          {back && (
            <Link
              href={back.href}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900 transition-colors mb-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 rounded"
            >
              <ArrowLeft size={17} strokeWidth={2.2} aria-hidden />
              {back.label}
            </Link>
          )}
          {children}
        </div>
      </div>

      {/* DESTRA — aside terracotta decorativo (nascosto su mobile) */}
      <aside
        aria-hidden
        className="relative hidden lg:flex flex-col justify-center overflow-hidden bg-primary-700 px-14 text-white"
      >
        {/* glow accent sfocato */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-accent-300/25 blur-3xl" />

        <p className="relative font-serif text-3xl font-extrabold leading-tight mb-8">
          I negozi <span className="italic text-accent-300">veri</span> di Piacenza,
          ora a casa tua.
        </p>

        <ul className="relative flex flex-col gap-4">
          {BENEFITS.map(({ Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-[15px]">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/12">
                <Icon size={18} strokeWidth={2.2} className="text-accent-300" aria-hidden />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

/**
 * Divider "oppure" + provider alternativi.
 * Google è collegato via Supabase OAuth (redirect su /auth/callback). SPID e
 * SMS restano visibili come "presto" finché non si collegano i rispettivi
 * provider (nessun handler fittizio).
 */
export function AuthAlternatives() {
  const [googleLoading, setGoogleLoading] = useState(false);
  /**
   * 22/8/2026 — CHI ENTRAVA CON GOOGLE NON ACCETTAVA MAI NIENTE.
   *
   * Il modulo con email e password ha la spunta obbligatoria su Termini e
   * Informativa, e la versione dei testi viaggia con la registrazione fino al
   * verbale. Il pulsante Google, subito sotto, non aveva niente: un clic e si
   * era dentro, operativi, senza nessuna riga in `consent_log` e senza che
   * nessuno sapesse quale versione dei testi quella persona avesse davanti.
   *
   * Il giorno in cui qualcuno contesta una condizione — un reso, una
   * commissione — su quell'utente non c'e' niente da mostrare.
   *
   * Adesso la spunta c'e' anche qui, e la versione dei testi viaggia
   * nell'indirizzo di ritorno: la callback la trova e la mette a verbale.
   */
  const [condizioniAccettate, setCondizioniAccettate] = useState(false);

  const handleGoogle = async () => {
    if (!condizioniAccettate) {
      toast.error('Per continuare devi accettare Termini e Informativa privacy.');
      return;
    }
    setGoogleLoading(true);
    try {
      const ritorno = new URL('/auth/callback', window.location.origin);
      ritorno.searchParams.set('versione', VERSIONE_TESTI_LEGALI);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: ritorno.toString() },
      });
      if (error) throw error;
      // In caso di successo il browser viene rediretto a Google: non resettiamo.
    } catch (e) {
      toast.error(friendlyError(e));
      setGoogleLoading(false);
    }
  };

  return (
    <>
      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-cream-300" />
        <span className="text-xs text-ink-400">oppure</span>
        <span className="h-px flex-1 bg-cream-300" />
      </div>
      <label className="mb-3 flex items-start gap-2.5 text-[13px] leading-relaxed text-ink-700">
        <input
          type="checkbox"
          checked={condizioniAccettate}
          onChange={(e) => setCondizioniAccettate(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-cream-400 text-primary-700"
        />
        <span>
          Ho letto e accetto i{' '}
          <Link href="/terms" className="font-semibold text-primary-700 underline">Termini</Link> e l&apos;
          <Link href="/privacy" className="font-semibold text-primary-700 underline">Informativa privacy</Link>.
        </span>
      </label>
      <div className="flex gap-2.5">
        <Button variant="secondary" icon={Smartphone} fullWidth disabled title="SPID — presto disponibile">
          SPID
        </Button>
        <Button
          variant="secondary"
          icon={Chrome}
          fullWidth
          onClick={handleGoogle}
          disabled={googleLoading || !condizioniAccettate}
        >
          {googleLoading ? 'Apertura…' : 'Google'}
        </Button>
      </div>
      <button
        type="button"
        disabled
        title="Accesso via SMS — presto disponibile"
        className="mt-2.5 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-cream-300 bg-white px-3 py-3 text-sm font-bold text-ink-900 transition-colors hover:bg-cream-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <MessageSquareText size={18} className="text-primary-700" aria-hidden />
        Accedi con codice via SMS
      </button>
    </>
  );
}

/** Blocco reclutamento venditore / rider. */
export function SellerRiderRecruit() {
  return (
    <div className="mt-6 border-t border-cream-300 pt-5">
      <p className="mb-2.5 text-[13px] font-bold text-ink-700">Vuoi lavorare con MyCity?</p>
      <div className="flex gap-2.5">
        <Link
          href="/sign-up?role=seller"
          className="flex flex-1 items-center gap-2.5 rounded-xl border border-cream-300 bg-white p-3 transition-colors hover:border-primary-300 hover:bg-cream-50"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-100">
            <Store size={18} className="text-primary-700" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-[13.5px] font-bold text-ink-900">Diventa venditore</span>
            <span className="block text-xs text-ink-500">Apri il tuo negozio</span>
          </span>
        </Link>
        <Link
          href="/sign-up?role=rider"
          className="flex flex-1 items-center gap-2.5 rounded-xl border border-cream-300 bg-white p-3 transition-colors hover:border-primary-300 hover:bg-cream-50"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-100">
            <Bike size={18} className="text-primary-700" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-[13.5px] font-bold text-ink-900">Diventa rider</span>
            <span className="block text-xs text-ink-500">Consegna e guadagna</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
