'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase, auth } from '@/lib/supabase/client';
import { useTranslations } from 'next-intl';

export default function VerifyEmailPage() {
  const tStates = useTranslations('states');
  const [email, setEmail] = useState<string | null>(null);
  const [verified, setVerified] = useState<boolean>(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState<'ok' | 'err' | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data?.user;
      setEmail(u?.email ?? null);
      setVerified(!!u?.email_confirmed_at);
    })();
  }, []);

  async function resend() {
    if (!email) return;
    setResending(true);
    setResent(null);
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    setResending(false);
    setResent(error ? 'err' : 'ok');
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <div className="rounded-2xl bg-white p-8 shadow ring-1 ring-cream-300">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary-50 text-3xl">
            ✉️
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-ink-900">
            {verified ? 'Email verificata' : 'Verifica la tua email'}
          </h1>
          {verified ? (
            <p className="mt-2 text-sm text-ink-600">
              Tutto a posto. Puoi continuare e usare l&apos;account.
            </p>
          ) : (
            <p className="mt-2 text-sm text-ink-600">
              Ti abbiamo inviato un link di conferma a{' '}
              <span className="font-medium text-ink-900">{email ?? 'la tua email'}</span>.
              Cliccalo per attivare l&apos;account.
            </p>
          )}
        </div>

        {!verified && (
          <div className="mt-6 space-y-3">
            <button
              onClick={resend}
              disabled={resending || !email}
              className="w-full rounded-lg bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50"
            >
              {resending ? tStates('sending') : 'Reinvia email di verifica'}
            </button>
            {resent === 'ok' && (
              <p className="text-center text-sm text-olive-700">
                Email inviata. Controlla anche la cartella spam.
              </p>
            )}
            {resent === 'err' && (
              <p className="text-center text-sm text-rose-700">
                Errore nell&apos;invio. Riprova tra qualche minuto.
              </p>
            )}
            <button
              onClick={() => auth.signOut().then(() => location.assign('/'))}
              className="w-full rounded-lg px-4 py-2 text-sm text-ink-600 hover:bg-cream-50"
            >
              Esci
            </button>
          </div>
        )}

        {verified && (
          <div className="mt-6">
            <Link
              href="/"
              className="block w-full rounded-lg bg-primary-700 px-4 py-2 text-center text-sm font-medium text-white hover:bg-primary-800"
            >
              Vai alla home
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
