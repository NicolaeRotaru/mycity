'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ShoppingCart, Store, Bike, Gift, type LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import Turnstile from '@/components/Turnstile';
import { trackSignupCompleted } from '@/lib/analytics/events';
import { LoadingState } from '@/components/ui/LoadingState';
import { Input, Checkbox } from '@/components/ui/Field';
import { friendlyError } from '@/lib/errors';

type Role = 'buyer' | 'seller' | 'rider';

const ROLES: { value: Role; Icon: LucideIcon; title: string; subtitle: string; color: string }[] = [
  { value: 'buyer',  Icon: ShoppingCart, title: 'Acquirente', subtitle: 'Compra dai negozi locali',  color: 'indigo' },
  { value: 'seller', Icon: Store,        title: 'Venditore',  subtitle: 'Vendi i tuoi prodotti',     color: 'red' },
  { value: 'rider',  Icon: Bike,         title: 'Rider',      subtitle: 'Consegna ordini',           color: 'amber' },
];

const colorClasses: Record<string, { border: string; bg: string; btn: string }> = {
  indigo: { border: 'border-primary-500 bg-primary-50', bg: 'bg-primary-50 border-primary-200 text-primary-800', btn: 'bg-primary-700 hover:bg-primary-800' },
  red:    { border: 'border-secondary-600 bg-secondary-50', bg: 'bg-secondary-50 border-secondary-200 text-secondary-800',     btn: 'bg-secondary-600 hover:bg-secondary-700' },
  amber:  { border: 'border-accent-500 bg-accent-50',   bg: 'bg-accent-50 border-accent-200 text-accent-800',   btn: 'bg-accent-500 hover:bg-accent-600' },
};

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? '';

function SignUpInner() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTos, setAcceptTos] = useState(false);
  const [role, setRole] = useState<Role>('buyer');
  const [captchaToken, setCaptchaToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const refCode = searchParams.get('ref')?.trim().toUpperCase() ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptTos) {
      toast.error('Devi accettare Termini e Privacy per registrarti');
      return;
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
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

      const emailRedirectTo = `${APP_URL || window.location.origin}/auth/callback`;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { role },
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

      if (data.user?.id) trackSignupCompleted(data.user.id, role);
      toast.success('Registrazione completata! Controlla la tua email per confermare.');
      router.push('/auth/verify-email');
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setIsLoading(false);
    }
  };

  const selectedRole = ROLES.find((r) => r.value === role)!;
  const cls = colorClasses[selectedRole.color];

  return (
    <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md space-y-6">
      <h2 className="text-2xl font-bold text-ink-800">Crea il tuo account</h2>

      {refCode && (
        <div className="bg-olive-50 border-2 border-olive-200 rounded-lg p-3 text-sm text-olive-900 flex items-center gap-1.5">
          <Gift size={16} strokeWidth={2.2} className="text-olive-600 shrink-0" aria-hidden />
          <span><strong>Sei stato invitato!</strong> Codice <span className="font-mono font-bold">{refCode}</span> applicato. Hai <strong>€5 di sconto</strong> sul primo ordine.</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {ROLES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => setRole(r.value)}
            className={`p-3 rounded-lg border-2 text-left transition-all ${
              role === r.value ? colorClasses[r.color].border : 'border-cream-300 hover:border-cream-300'
            }`}
          >
            <div className="mb-1"><r.Icon size={24} strokeWidth={2.2} aria-hidden /></div>
            <div className="font-bold text-sm">{r.title}</div>
            <div className="text-xs text-ink-500 leading-tight">{r.subtitle}</div>
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
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
        />
        <Input
          id="signup-password"
          label="Password"
          type="password"
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
              onVerify={setCaptchaToken}
              onExpire={() => setCaptchaToken('')}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className={`w-full disabled:opacity-50 text-white px-4 py-2 rounded transition-colors ${cls.btn}`}
        >
          {isLoading ? 'Registrazione in corso...' : `Registrati come ${selectedRole.title.toLowerCase()}`}
        </button>
      </form>

      <p className="text-center text-sm text-ink-600">
        Hai già un account? <Link href="/sign-in" className="text-primary-700 hover:underline">Accedi</Link>
      </p>
    </div>
  );
}

const SignUp = () => (
  <div className="min-h-screen flex items-center justify-center bg-cream-50 px-4 py-8">
    <Suspense fallback={<LoadingState variant="inline" />}>
      <SignUpInner />
    </Suspense>
  </div>
);

export default SignUp;
