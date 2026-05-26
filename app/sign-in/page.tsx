'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { auth, supabase } from '@/lib/supabase/client';
import { safeInternalPath } from '@/lib/safe-redirect';
import { toast } from 'sonner';
import Turnstile from '@/components/Turnstile';
import { LoadingState } from '@/components/ui/LoadingState';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

// Traduzioni dei messaggi più comuni che Supabase restituisce in inglese.
// Tutto ciò che non matcha cade nel fallback generico.
function translateAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email o password non corrette';
  if (m.includes('email not confirmed'))       return 'Email non confermata. Controlla la posta e clicca sul link che ti abbiamo inviato.';
  if (m.includes('user not found'))            return 'Nessun account con questa email';
  if (m.includes('rate limit') || m.includes('too many'))
                                               return 'Troppi tentativi. Riprova fra qualche minuto.';
  if (m.includes('password'))                  return 'Password non valida';
  if (m.includes('email'))                     return 'Email non valida';
  return 'Accesso non riuscito. Riprova.';
}

const SignInForm = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeInternalPath(searchParams.get('returnTo'), '/');

  // Difesa lato client: se Supabase ha mandato l'utente qui invece che
  // su /reset-password (Site URL configurata male), intercetta il flusso
  // di recovery e redirigi alla pagina giusta — preservando l'hash con
  // il token di accesso.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash.includes('type=recovery')) {
      router.replace('/reset-password' + window.location.hash);
      return;
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') router.replace('/reset-password');
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      toast.error('Completa il controllo anti-bot');
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await auth.signIn(email, password, { captchaToken });
      if (error) throw error;

      // Gate verifica email anche client-side (difesa in profondità)
      if (data?.user && !data.user.email_confirmed_at) {
        toast.error('Devi confermare la tua email prima di accedere');
        router.push('/auth/verify-email');
        return;
      }

      toast.success('Accesso effettuato!');
      router.push(returnTo);
      router.refresh();
    } catch (error: any) {
      toast.error(translateAuthError(error?.message ?? ''));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email.trim()) {
      toast.error('Inserisci la tua email per ricevere il link di reset');
      return;
    }
    setSendingReset(true);
    try {
      const redirectTo = typeof window !== 'undefined'
        ? `${window.location.origin}/reset-password`
        : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (error) throw error;
      toast.success('Ti abbiamo inviato un\'email per reimpostare la password');
    } catch (err: any) {
      toast.error(translateAuthError(err?.message ?? ''));
    } finally {
      setSendingReset(false);
    }
  };

  return (
    <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-ink-800">Accedi</h2>
        <p className="text-sm text-ink-500 mt-1">Bentornato su MyCity</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink-700 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="la-tua@email.it"
            autoComplete="email"
            required
            className="w-full border p-2 rounded text-base focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-ink-700">Password</label>
            <button
              type="button"
              onClick={handleResetPassword}
              disabled={sendingReset}
              className="text-xs text-primary-700 hover:underline disabled:opacity-50"
            >
              {sendingReset ? 'Invio…' : 'Password dimenticata?'}
            </button>
          </div>
          <div className="relative">
            <input
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              className="w-full border p-2 pr-12 rounded focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              aria-label={showPwd ? 'Nascondi password' : 'Mostra password'}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-500 hover:text-ink-700 px-2 py-1"
            >
              {showPwd ? '🙈' : '👁'}
            </button>
          </div>
        </div>
        {TURNSTILE_SITE_KEY && (
          <div className="flex justify-center">
            <Turnstile
              siteKey={TURNSTILE_SITE_KEY}
              onVerify={setCaptchaToken}
              onExpire={() => setCaptchaToken('')}
            />
          </div>
        )}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-primary-700 hover:bg-primary-800 disabled:opacity-50 text-white px-4 py-2 rounded transition-colors font-semibold"
        >
          {isLoading ? 'Accesso in corso...' : 'Accedi'}
        </button>
      </form>
      <p className="text-center text-sm text-ink-600">
        Non hai un account?{' '}
        <Link href="/sign-up" className="text-primary-700 hover:underline font-semibold">
          Registrati
        </Link>
      </p>
    </div>
  );
};

const SignIn = () => (
  <div className="min-h-screen flex items-center justify-center bg-cream-50 p-4">
    <Suspense fallback={<LoadingState variant="inline" />}>
      <SignInForm />
    </Suspense>
  </div>
);

export default SignIn;
