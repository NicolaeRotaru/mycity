'use client';

import { useRef, Suspense, useEffect, useState } from 'react';
import { traduciErroreAuth } from '@/lib/errors';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { safeInternalPath } from '@/lib/safe-redirect';
import { toast } from 'sonner';
import Turnstile, { type ManopolaAntiBot } from '@/components/Turnstile';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { Input, PasswordInput } from '@/components/ui/Field';
import { AuthShell, AuthAlternatives, SellerRiderRecruit } from '@/components/ui/AuthShell';
import { trackSignedIn } from '@/lib/analytics/events';
import { avvisoAlRitornoSullAccesso, indirizzoSenzaLaSessione, type AvvisoDiAccesso } from '@/lib/auth/link-email';
import {
  esitoDellaRispostaDiAccesso,
  memoriaDellaScheda,
  percorsoVerificaEmail,
  ricordaEmailDaConfermare,
} from '@/lib/auth/conferma-email';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

// Traduzioni dei messaggi più comuni che Supabase restituisce in inglese.
// Tutto ciò che non matcha cade nel fallback generico.
/**
 * Il ripiego di QUESTA schermata, dopo la traduzione condivisa.
 *
 * Il corpo di questa funzione viveva solo qui e nessun altro poteva usarlo: registrazione
 * e cambio password chiamavano `friendlyError`, che di errori Auth non sapeva niente, e
 * si vedevano uscire l'inglese. Adesso la traduzione sta in `lib/errors.ts`, condivisa.
 *
 * Qui restano le due reti larghe — «contiene password», «contiene email» — perche' qui
 * sono giuste: su una schermata di accesso ogni errore parla di accesso. Nella funzione
 * condivisa sarebbero sbagliate, perche' lei vede ogni errore dell'applicazione.
 */
function translateAuthError(msg: string): string {
  const condivisa = traduciErroreAuth(msg);
  if (condivisa) return condivisa;
  const m = String(msg || '').toLowerCase();
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Troppi tentativi. Riprova fra qualche minuto.';
  if (m.includes('password')) return 'Password non valida';
  if (m.includes('email')) return 'Email non valida';
  return 'Accesso non riuscito. Riprova.';
}

const SignInForm = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  /**
   * 22/8/2026 — IL GETTONE ANTI-BOT SI CONSUMA AL PRIMO TENTATIVO.
   *
   * Cloudflare lo da' valido una volta sola. Se qualcosa va storto — la
   * password sbagliata, l'email gia' presa — quel gettone e' gia' stato speso:
   * al secondo tentativo il server lo rifiuta, e il messaggio parla di anti-bot
   * su una schermata dove non c'e' niente da ripremere. La persona resta fuori
   * dal proprio account per un errore di battitura. Qui se ne chiede uno nuovo.
   */
  const antiBot = useRef<ManopolaAntiBot>(null);
  const rigeneraGettone = () => {
    setCaptchaToken('');
    antiBot.current?.reset();
  };

  // #115 — Se il controllo anti-bot non si carica (rete che blocca Cloudflare,
  // estensione che lo taglia, guasto loro), il modulo non resta bloccato per
  // sempre: si dice cosa e' successo e si lascia mandare. La verifica vera e'
  // comunque sul server, quindi non si apre nessun buco.
  const [captchaRotto, setCaptchaRotto] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeInternalPath(searchParams.get('returnTo'), '/');
  /**
   * 15/10/2026 (R13) — L'ERRORE NELL'INDIRIZZO ADESSO SI LEGGE.
   *
   * Chi apriva il link di conferma su un altro dispositivo finiva qui con
   * `?error=callback_failed`, e la pagina leggeva solo `returnTo`: nessuna
   * parola, e la persona pensava di aver sbagliato qualcosa. Il frammento (#…)
   * il server non lo vede, quindi lo si legge qui, dopo il montaggio.
   */
  const [avviso, setAvviso] = useState<AvvisoDiAccesso | null>(null);
  const erroreDelRitorno = searchParams.get('error');

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
    setAvviso(avvisoAlRitornoSullAccesso(erroreDelRitorno, window.location.hash));
    // Una sessione lasciata nel frammento non deve restare nella barra degli
    // indirizzi (e nella cronologia): l'avviso e' gia' stato letto. Nello
    // stesso colpo `error` diventa il codice che, senza frammento, dice la
    // stessa cosa: alla ricarica «email confermata» non diventa un errore.
    const pulito = indirizzoSenzaLaSessione(
      erroreDelRitorno,
      window.location.hash,
      window.location.pathname,
      window.location.search,
    );
    if (pulito !== null) window.history.replaceState(window.history.state, '', pulito);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') router.replace('/reset-password');
    });
    return () => sub.subscription.unsubscribe();
  }, [router, erroreDelRitorno]);

  /** Chi ha l'email da confermare va dove puo' farsi rimandare il link, con l'email gia' scritta. */
  const vaiAllaVerifica = () => {
    ricordaEmailDaConfermare(memoriaDellaScheda(), email);
    router.push(percorsoVerificaEmail(returnTo));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (TURNSTILE_SITE_KEY && !captchaToken && !captchaRotto) {
      toast.error('Completa il controllo anti-bot');
      return;
    }
    setIsLoading(true);
    try {
      /**
       * 22/8/2026 — I FRENI CONTRO CHI PROVA MILLE PASSWORD NON PROTEGGEVANO
       * NIENTE, PERCHE' L'ACCESSO NON CI PASSAVA.
       *
       * Esistono due rotte server (`/api/auth/signin` e `/api/auth/signup`),
       * un modulo che le serve e le loro prove. Dentro ci sono due freni: dieci
       * tentativi ogni cinque minuti per indirizzo di RETE, e altrettanti per
       * indirizzo EMAIL — il secondo chiude proprio il caso che il primo lascia
       * aperto, cioe' chi prova mille password su un account solo cambiando
       * rete a ogni tentativo.
       *
       * Nessuno le chiamava. Il modulo di accesso parlava direttamente con
       * Supabase dal browser: quei freni erano codice morto che dava
       * l'impressione che una difesa esistesse. Contro chi prova password a
       * raffica restava solo quello che fa Supabase dal suo lato, che qui non
       * e' configurato e da qui non si misura.
       *
       * Adesso l'accesso passa dal server, e la sessione che torna indietro
       * viene installata nel browser: da fuori non cambia niente, ma i due
       * freni sono in funzione.
       */
      const risposta = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, captchaToken: captchaToken || undefined }),
      });
      const corpo = await risposta.json().catch(() => null);
      const esito = esitoDellaRispostaDiAccesso(risposta.ok, corpo);
      // 15/10/2026 (R43) — Prima questo caso finiva nel ripiego e usciva
      // «Email non valida» (il messaggio contiene la parola «email»): la
      // persona aveva la password giusta e veniva rimandata indietro.
      if (esito.tipo === 'email-da-confermare') {
        toast.info('La tua email non è ancora confermata: qui puoi farti rimandare il link.');
        vaiAllaVerifica();
        return;
      }
      if (esito.tipo === 'errore') throw new Error(esito.messaggio);
      const data = corpo as { user?: { id: string; email_confirmed_at?: string | null }; session?: { access_token: string; refresh_token: string } } | null;
      // La sessione arriva dal server: qui si installa nel browser, cosi' tutto
      // il resto del sito la vede come prima.
      if (data?.session?.access_token && data.session.refresh_token) {
        const { error: errSessione } = await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        if (errSessione) throw errSessione;
      }

      // Gate verifica email anche client-side (difesa in profondità)
      if (data?.user && !data.user.email_confirmed_at) {
        toast.error('Devi confermare la tua email prima di accedere');
        vaiAllaVerifica();
        return;
      }

      toast.success('Accesso effettuato!');
      // 30/8/2026 (R168) — Da qui si entra con email e password, e prima non lo
      // diceva: il canale restava «sconosciuto» e i due ingressi non si
      // potevano confrontare.
      if (data?.user?.id) trackSignedIn(data.user.id, 'email');
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
      rigeneraGettone();
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

      {avviso && (
        <p
          role={avviso.tono === 'errore' ? 'alert' : 'status'}
          className={`mb-5 rounded-lg border p-3 text-sm ${
            avviso.tono === 'errore'
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-olive-200 bg-olive-50 text-olive-900'
          }`}
        >
          {avviso.testo}
        </p>
      )}

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
              ref={antiBot}
              siteKey={TURNSTILE_SITE_KEY}
              onVerify={(t) => { setCaptchaToken(t); setCaptchaRotto(null); }}
              onExpire={() => setCaptchaToken('')}
              onError={(motivo) => setCaptchaRotto(motivo)}
            />
          </div>
        )}
        {captchaRotto && (
          <p className="text-center text-sm text-ink-600">
            {captchaRotto} Puoi provare lo stesso ad accedere: se non funziona,
            ricarica la pagina o scrivici da <Link className="underline" href="/contact">Contatti</Link>.
          </p>
        )}
        <Button type="submit" size="lg" loading={isLoading} iconRight={ArrowRight} fullWidth>
          {isLoading ? 'Accesso in corso…' : 'Accedi'}
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
