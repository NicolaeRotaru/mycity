'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

type Role = 'buyer' | 'seller' | 'rider';

const ROLES: { value: Role; emoji: string; title: string; subtitle: string; color: string }[] = [
  { value: 'buyer',  emoji: '🛒', title: 'Acquirente', subtitle: 'Compra dai negozi locali',  color: 'indigo' },
  { value: 'seller', emoji: '🏪', title: 'Venditore',  subtitle: 'Vendi i tuoi prodotti',     color: 'pink' },
  { value: 'rider',  emoji: '🛵', title: 'Rider',      subtitle: 'Consegna ordini',           color: 'amber' },
];

const colorClasses: Record<string, { border: string; bg: string; btn: string }> = {
  indigo: { border: 'border-indigo-500 bg-indigo-50', bg: 'bg-indigo-50 border-indigo-200 text-indigo-800', btn: 'bg-indigo-600 hover:bg-indigo-700' },
  pink:   { border: 'border-pink-500 bg-pink-50',     bg: 'bg-pink-50 border-pink-200 text-pink-800',     btn: 'bg-pink-500 hover:bg-pink-600' },
  amber:  { border: 'border-amber-500 bg-amber-50',   bg: 'bg-amber-50 border-amber-200 text-amber-800',   btn: 'bg-amber-500 hover:bg-amber-600' },
};

function SignUpInner() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('buyer');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const refCode = searchParams.get('ref')?.trim().toUpperCase() ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      // Look up referrer da referral code (best effort)
      let referrerId: string | null = null;
      if (refCode) {
        const { data: ref } = await supabase
          .from('profiles')
          .select('id')
          .eq('referral_code', refCode)
          .maybeSingle();
        referrerId = ref?.id ?? null;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { role } },
      });
      if (error) throw error;

      // Crea referral record se applicabile
      if (referrerId && data.user?.id && data.user.id !== referrerId) {
        await supabase.from('referrals').insert({
          referrer_id: referrerId,
          referred_id: data.user.id,
          reward_amount: 5,
        });
      }

      const successMsg = refCode
        ? `Registrazione completata! Hai €5 di sconto sul primo ordine. 🎉`
        : role === 'seller'
        ? 'Registrazione completata! Accedi e completa i dati del tuo negozio.'
        : role === 'rider'
        ? 'Registrazione completata! Accedi per iniziare a consegnare.'
        : 'Registrazione completata! Ora puoi accedere e iniziare a comprare.';
      toast.success(successMsg);
      router.push('/sign-in');
    } catch (error: any) {
      toast.error(error.message || 'Errore durante la registrazione');
    } finally {
      setIsLoading(false);
    }
  };

  const selectedRole = ROLES.find((r) => r.value === role)!;
  const cls = colorClasses[selectedRole.color];

  return (
    <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Crea il tuo account</h2>

      {refCode && (
        <div className="bg-emerald-50 border-2 border-emerald-200 rounded-lg p-3 text-sm text-emerald-900">
          🎁 <strong>Sei stato invitato!</strong> Codice <span className="font-mono font-bold">{refCode}</span> applicato. Hai <strong>€5 di sconto</strong> sul primo ordine.
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {ROLES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => setRole(r.value)}
            className={`p-3 rounded-lg border-2 text-left transition-all ${
              role === r.value ? colorClasses[r.color].border : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-2xl mb-1">{r.emoji}</div>
            <div className="font-bold text-sm">{r.title}</div>
            <div className="text-xs text-gray-500 leading-tight">{r.subtitle}</div>
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="la-tua@email.it" required
            className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••" required minLength={6}
            className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className={`w-full disabled:opacity-50 text-white px-4 py-2 rounded transition-colors ${cls.btn}`}
        >
          {isLoading ? 'Registrazione in corso...' : `Registrati come ${selectedRole.title.toLowerCase()}`}
        </button>
      </form>

      <p className="text-center text-sm text-gray-600">
        Hai già un account? <Link href="/sign-in" className="text-indigo-600 hover:underline">Accedi</Link>
      </p>
    </div>
  );
}

const SignUp = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-8">
    <Suspense fallback={<div className="text-gray-500">Caricamento...</div>}>
      <SignUpInner />
    </Suspense>
  </div>
);

export default SignUp;
