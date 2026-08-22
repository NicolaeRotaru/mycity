'use client';

import { VERSIONE_TESTI_LEGALI } from '@/lib/legal/versione';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ShoppingCart, Store, Bike, Gift, Mail, User, ArrowRight, type LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import Turnstile from '@/components/Turnstile';
import { LoadingState } from '@/components/ui/LoadingState';
import { Input, PasswordInput, Checkbox } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { AuthShell, AuthAlternatives } from '@/components/ui/AuthShell';
import { friendlyError } from '@/lib/errors';

/**
 * #79 — Quale versione dei testi legali si sta accettando. Va tenuta allineata
 * alle costanti VERSION di app/privacy/page.tsx e app/terms/page.tsx: se i testi
 * cambiano e questa no, il verbale dice il falso.
 */


type Role = 'buyer' | 'seller' | 'rider';

const ROLES: { value: Role; Icon: LucideIcon; title: string; subtitle: string }[] = [
  { value: 'buyer',  Icon: ShoppingCart, title: 'Acquirente', subtitle: 'Compra dai negozi locali' },
  { value: 'seller', Icon: Store,        title: 'Venditore',  subtitle: 'Vendi i tuoi prodotti' },
  { value: 'rider',  Icon: Bike,         title: 'Rider',      subtitle: 'Consegna ordini' },
];

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? '';

function isRole(v: string | null): v is Role {
  return v === 'buyer' || v === 'seller' || v === 'rider';
}

function SignUpInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const refCode = searchParams.get('ref')?.trim().toUpperCase() ?? null;
  /**
   * #112 — Dove torna chi si registra.
   *
   * Chi arrivava al checkout come ospite, cliccava «registrati» e confermava
   * l'email, riatterrava sulla home: carrello ancora li', ma l'ordine da
   * ricominciare da capo — e la bozza del checkout, salvata nella scheda del
   * browser, persa insieme alla scheda che il client di posta apre nuova.
   * L'accesso lo faceva gia' bene (`returnTo`), la registrazione no. Il link
   * di conferma porta a /auth/callback, che accetta solo percorsi interni.
   */
  const returnTo = searchParams.get('returnTo') ?? '';
  // Ruolo preselezionato dai link di reclutamento (/sign-up?role=seller|rider).
  const roleParam = searchParams.get('role');
  const initialRole: Role = isRole(roleParam) ? roleParam : 'buyer';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTos, setAcceptTos] = useState(false);
  const [role, setRole] = useState<Role>(initialRole);
  const [captchaToken, setCaptchaToken] = useState('');
  // #115 — Se il controllo anti-bot non si carica (rete che blocca Cloudflare,
  // estensione che lo taglia, guasto loro), il modulo non resta bloccato per
  // sempre: si dice cosa e' successo e si lascia mandare. La verifica vera e'
  // comunque sul server, quindi non si apre nessun buco.
  const [captchaRotto, setCaptchaRotto] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptTos) {
      toast.error('Devi accettare Termini e Privacy per registrarti');
      return;
    }
    if (TURNSTILE_SITE_KEY && !captchaToken && !captchaRotto) {
      toast.error('Completa il controllo anti-bot');
      return;
    }
    setIsLoading(true);
    try {
      let referrerId: string | null = null;
      if (refCode) {
        const { data: ref } = await supabase
          .from('profiles')
          .select('id')
          .eq('referral_code', refCode)
          .maybeSingle();
        referrerId = ref?.id ?? null;
      }

      const base = APP_URL || window.location.origin;
      const emailRedirectTo = returnTo
        ? `${base}/auth/callback?next=${encodeURIComponent(returnTo)}`
        : `${base}/auth/callback`;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // #79 — L'accettazione di Termini e Informativa non veniva registrata
          // da nessuna parte: c'era la spunta nel modulo e basta. Il giorno in
          // cui qualcuno contesta una condizione — un reso, una commissione —
          // non c'e' modo di dimostrare che l'aveva accettata, ne' QUALE
          // versione del testo aveva davanti. La versione viaggia con la
          // registrazione e il server la mette a verbale al primo accesso.
          data: {
            role,
            full_name: fullName.trim() || undefined,
            versione_testi_accettati: VERSIONE_TESTI_LEGALI,
          },
          captchaToken: captchaToken || undefined,
          emailRedirectTo,
        },
      });
      if (error) throw error;

      if (referrerId && data.user?.id && data.user.id !== referrerId) {
        await supabase.from('referrals').insert({
          referrer_id: referrerId,
          referred_id: data.user.id,
          reward_amount: 5,
        });
      }

      // #214 — Qui l'evento NON si emette piu'. Chi compila il modulo non e'
      // ancora iscritto: deve confermare l'email. Contandolo qui, la stessa
      // persona finiva contata due volte (qui e al rientro dal link) e chi non
      // confermava mai risultava iscritto lo stesso. La sorgente unica e' il
      // rientro da /auth/callback, dove l'iscrizione e' un fatto.
      toast.success('Registrazione completata! Controlla la tua email per confermare.');
      // #112 — La pagina di verifica sa dove si stava andando, e lo dice.
      router.push(returnTo ? `/auth/verify-email?returnTo=${encodeURIComponent(returnTo)}` : '/auth/verify-email');
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setIsLoading(false);
    }
  };

  const selectedRole = ROLES.find((r) => r.value === role)!;

  return (
    <>
      <h1 className="font-serif text-[34px] font-extrabold leading-tight text-ink-900">
        Crea il tuo account
      </h1>
      <p className="mt-1.5 mb-7 text-[15px] leading-relaxed text-ink-600">
        Ti serve solo per confermare l&apos;ordine — puoi pagare alla consegna.
      </p>

      {refCode && (
        <div className="mb-5 flex items-center gap-1.5 rounded-lg border border-olive-200 bg-olive-50 p-3 text-sm text-olive-900">
          <Gift size={16} strokeWidth={2.2} className="shrink-0 text-olive-600" aria-hidden />
          <span><strong>Sei stato invitato!</strong> Codice <span className="font-mono font-bold">{refCode}</span> applicato. Hai <strong>€5 di sconto</strong> sul primo ordine.</span>
        </div>
      )}

      <fieldset className="mb-5">
        <legend className="mb-2 text-sm font-medium text-ink-700">Come vuoi usare MyCity?</legend>
        <div className="grid grid-cols-3 gap-2">
          {ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRole(r.value)}
              aria-pressed={role === r.value}
              className={`rounded-xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 ${
                role === r.value
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-cream-300 hover:border-primary-300'
              }`}
            >
              <r.Icon size={22} strokeWidth={2.2} className={role === r.value ? 'text-primary-700' : 'text-ink-500'} aria-hidden />
              <span className="mt-1 block text-sm font-bold text-ink-900">{r.title}</span>
              <span className="block text-xs leading-tight text-ink-500">{r.subtitle}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          id="signup-name"
          label="Nome e cognome"
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Mario Rossi"
          autoComplete="name"
          leading={<User size={18} aria-hidden />}
        />
        <Input
          id="signup-email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="la-tua@email.it"
          required
          autoComplete="email"
          inputMode="email"
          leading={<Mail size={18} aria-hidden />}
        />
        <PasswordInput
          id="signup-password"
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Almeno 8 caratteri"
          required
          minLength={8}
          autoComplete="new-password"
        />

        <Checkbox
          checked={acceptTos}
          onChange={(e) => setAcceptTos(e.target.checked)}
          label={
            <>
              Ho letto e accetto i{' '}
              <Link href="/terms" target="_blank" className="text-primary-700 underline">Termini di servizio</Link>{' '}e l&apos;
              <Link href="/privacy" target="_blank" className="text-primary-700 underline">Informativa sulla privacy</Link>.
            </>
          }
        />

        {TURNSTILE_SITE_KEY && (
          <div className="flex justify-center">
            <Turnstile
              siteKey={TURNSTILE_SITE_KEY}
              onVerify={(t) => { setCaptchaToken(t); setCaptchaRotto(null); }}
              onExpire={() => setCaptchaToken('')}
              onError={(motivo) => setCaptchaRotto(motivo)}
            />
          </div>
        )}
        {captchaRotto && (
          <p className="text-center text-sm text-ink-600">
            {captchaRotto} Puoi provare lo stesso a registrarti: se non funziona,
            ricarica la pagina o scrivici da <Link href="/contact" className="underline">Contatti</Link>.
          </p>
        )}

        <Button type="submit" size="lg" loading={isLoading} iconRight={ArrowRight} fullWidth>
          {isLoading ? 'Registrazione in corso...' : `Registrati come ${selectedRole.title.toLowerCase()}`}
        </Button>
      </form>

      <AuthAlternatives />

      <p className="mt-6 text-[14px] text-ink-600">
        Hai già un account?{' '}
        <Link href="/sign-in" className="font-bold text-primary-700 hover:underline">Accedi</Link>
      </p>
    </>
  );
}

const SignUp = () => (
  <Suspense fallback={<LoadingState variant="inline" />}>
    <AuthShell back={{ href: '/sign-in', label: 'Torna al login' }}>
      <SignUpInner />
    </AuthShell>
  </Suspense>
);

export default SignUp;
