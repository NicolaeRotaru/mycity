'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, ArrowRight } from 'lucide-react';
import { auth, supabase } from '@/lib/supabase/client';
import { safeInternalPath } from '@/lib/safe-redirect';
import { toast } from 'sonner';
import Turnstile from '@/components/Turnstile';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { Input, PasswordInput } from '@/components/ui/Field';
import { AuthShell, AuthAlternatives, SellerRiderRecruit } from '@/components/ui/AuthShell';
import { trackSignedIn } from '@/lib/analytics/events';

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
      if (data?.user?.id) trackSignedIn(data.user.id);
      // Atterra sulla home del ruolo (seller/rider/admin) così, dopo un cambio
      // account, non resti sulla pagina del ruolo precedente. I buyer rispettano
      // l'eventuale returnTo (es. checkout).
      let dest = returnTo;
      if (data?.user?.id) {
        try {
          const { data: prof } = await supabase
            .from('profiles').select('role').eq('id', data.user.id).single();
          const r = prof?.role;
          if (r === 'admin') dest = '/admin';
          else if (r === 'seller') dest = '/seller/dashboard';
          else if (r === 'rider') dest = '/rider';
        } catch { /* fallback: returnTo */ }
      }
      router.push(dest);
      router.refresh();
    } catch (error) {
      toast.error(translateAuthError(error instanceof Error ? error.message : ''));
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
    } catch (err) {
      toast.error(translateAuthError(err instanceof Error ? err.message : ''));
    } finally {
      setSendingReset(false);
    }
  };

  // Preserva returnTo verso la registrazione (es. checkout → login → registrati).
  const signUpHref = returnTo && returnTo !== '/'
    ? `/sign-up?returnTo=${encodeURIComponent(returnTo)}`
    : '/sign-up';

  return (
    <>
      <h1 className="font-serif text-[34px] font-extrabold leading-tight text-ink-900">
        Bentornato su MyCity
      </h1>
      <p className="mt-1.5 mb-7 text-[15px] leading-relaxed text-ink-600">
        Accedi per seguire i tuoi ordini e i negozi preferiti.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          id="signin-email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="la-tua@email.it"
          autoComplete="email"
          inputMode="email"
          leading={<Mail size={18} aria-hidden />}
          required
        />
        <PasswordInput
          id="signin-password"
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          required
          labelAction={
            <button
              type="button"
              onClick={handleResetPassword}
              disabled={sendingReset}
              className="text-xs text-primary-700 hover:underline disabled:opacity-50"
            >
              {sendingReset ? 'Invio…' : 'Password dimenticata?'}
            </button>
          }
        />
        {TURNSTILE_SITE_KEY && (
          <div className="flex justify-center">
            <Turnstile
              siteKey={TURNSTILE_SITE_KEY}
              onVerify={setCaptchaToken}
              onExpire={() => setCaptchaToken('')}
            />
          </div>
        )}
        <Button type="submit" size="lg" loading={isLoading} iconRight={ArrowRight} fullWidth>
          {isLoading ? 'Accesso in corso...' : 'Accedi'}
        </Button>
      </form>

      <AuthAlternatives />

      <p className="mt-6 text-[14px] text-ink-600">
        Non hai un account?{' '}
        <Link href={signUpHref} className="font-bold text-primary-700 hover:underline">
          Registrati
        </Link>
      </p>

      <SellerRiderRecruit />
    </>
  );
};

const SignIn = () => (
  <Suspense fallback={<LoadingState variant="inline" />}>
    <AuthShell back={{ href: '/', label: 'Torna alla home' }}>
      <SignInForm />
    </AuthShell>
  </Suspense>
);

export default SignIn;
