'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { safeInternalPath } from '@/lib/safe-redirect';
import { Mail } from 'lucide-react';
import { supabase, auth } from '@/lib/supabase/client';
import { useTranslations } from 'next-intl';
import {
  leggiEmailDaConfermare,
  memoriaDellaScheda,
  rimandaLinkDiConferma,
  vistaDellaVerifica,
  type EsitoReinvio,
} from '@/lib/auth/conferma-email';

/**
 * 15/10/2026 (R43) — «REINVIA» ERA SEMPRE SPENTO PER CHI NE AVEVA BISOGNO.
 *
 * Con la conferma dell'email accesa, chi si e' appena iscritto non ha una
 * sessione: questa pagina cercava l'email solo li', e cosi' diceva «a la tua
 * email» con il pulsante grigio. Adesso l'email arriva dalla registrazione (o
 * dall'accesso) attraverso la memoria della scheda, e se manca la si chiede in
 * un campo. «Esci» compare solo a chi e' davvero entrato.
 * La logica sta in `lib/auth/conferma-email.ts`.
 */
function VerifyEmailInner() {
  const tStates = useTranslations('states');
  // #112 — Chi si stava registrando dal checkout deve poter tornare al suo
  // ordine, non alla home. Il percorso arriva dalla registrazione e passa dal
  // filtro dei percorsi interni: nessun indirizzo esterno.
  const searchParams = useSearchParams();
  const returnTo = safeInternalPath(searchParams.get('returnTo') ?? '/', '/');
  const [emailDellaSessione, setEmailDellaSessione] = useState<string | null>(null);
  const [emailRicordata, setEmailRicordata] = useState<string | null>(null);
  const [emailScritta, setEmailScritta] = useState('');
  const [verified, setVerified] = useState<boolean>(false);
  const [resending, setResending] = useState(false);
  const [esito, setEsito] = useState<EsitoReinvio | null>(null);

  useEffect(() => {
    const ricordata = leggiEmailDaConfermare(memoriaDellaScheda());
    setEmailRicordata(ricordata);
    if (ricordata) setEmailScritta(ricordata);
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data?.user;
      setEmailDellaSessione(u?.email ?? null);
      setVerified(!!u?.email_confirmed_at);
    })();
  }, []);

  const vista = vistaDellaVerifica({ emailDellaSessione, emailRicordata, emailScritta, inCorso: resending });

  async function resend(e?: React.FormEvent) {
    e?.preventDefault();
    if (!vista.puoReinviare) return;
    setResending(true);
    setEsito(null);
    try {
      const base = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
      setEsito(await rimandaLinkDiConferma(supabase, { email: vista.emailPerIlReinvio, base, returnTo }));
    } catch {
      setEsito({ esito: 'errore', messaggio: 'Non siamo riusciti a mandare l’email. Riprova tra qualche minuto.' });
    } finally {
      setResending(false);
    }
  }

  const emailDaMostrare = emailDellaSessione ?? emailRicordata;
  const accediHref = returnTo !== '/' ? `/sign-in?returnTo=${encodeURIComponent(returnTo)}` : '/sign-in';

  return (
    <div className="mx-auto max-w-md p-6">
      <div className="rounded-2xl bg-white p-8 shadow ring-1 ring-cream-300">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary-50 text-primary-600">
            <Mail size={28} strokeWidth={2.2} aria-hidden />
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-ink-900">
            {verified ? 'Email verificata' : 'Verifica la tua email'}
          </h1>
          {verified ? (
            <p className="mt-2 text-sm text-ink-600">
              Tutto a posto. Puoi continuare e usare l&apos;account.
            </p>
          ) : emailDaMostrare ? (
            <p className="mt-2 text-sm text-ink-600">
              Ti abbiamo inviato un link di conferma a{' '}
              <span className="font-medium text-ink-900">{emailDaMostrare}</span>.
              Cliccalo per attivare l&apos;account.
            </p>
          ) : (
            <p className="mt-2 text-sm text-ink-600">
              Se ti sei appena registrato, ti abbiamo inviato un link di conferma: cliccalo per attivare
              l&apos;account. Non lo trovi? Scrivi qui sotto la tua email e te lo rimandiamo.
            </p>
          )}
        </div>

        {!verified && (
          <form onSubmit={resend} className="mt-6 space-y-3">
            {vista.chiediEmail && (
              <div>
                <label htmlFor="verify-email-input" className="mb-1 block text-sm font-medium text-ink-700">
                  La tua email
                </label>
                <input
                  id="verify-email-input"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={emailScritta}
                  onChange={(e) => setEmailScritta(e.target.value)}
                  placeholder="la-tua@email.it"
                  className="w-full rounded-lg border border-cream-300 px-3 py-2 text-sm text-ink-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
                <p className="mt-1 text-xs text-ink-500">
                  Se l&apos;avevi scritta sbagliata quando ti sei registrato, registrati di nuovo con quella giusta.
                </p>
              </div>
            )}
            <button
              type="submit"
              disabled={!vista.puoReinviare}
              className="w-full rounded-lg bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50"
            >
              {resending ? tStates('sending') : 'Reinvia email di verifica'}
            </button>
            {esito && (
              <p
                role="status"
                className={`text-center text-sm ${esito.esito === 'inviato' ? 'text-olive-700' : 'text-rose-700'}`}
              >
                {esito.messaggio}
              </p>
            )}
            {vista.mostraEsci ? (
              <button
                type="button"
                onClick={() => auth.signOut().then(() => location.assign('/'))}
                className="w-full rounded-lg px-4 py-2 text-sm text-ink-600 hover:bg-cream-50"
              >
                Esci
              </button>
            ) : (
              <p className="text-center text-sm text-ink-600">
                Hai già confermato?{' '}
                <Link href={accediHref} className="font-medium text-primary-700 hover:underline">
                  Accedi
                </Link>
              </p>
            )}
          </form>
        )}

        {verified && (
          <div className="mt-6">
            <Link
              href={returnTo}
              className="block w-full rounded-lg bg-primary-700 px-4 py-2 text-center text-sm font-medium text-white hover:bg-primary-800"
            >
              {returnTo.startsWith('/checkout') ? 'Torna al tuo ordine' : 'Vai alla home'}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}
