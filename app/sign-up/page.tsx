'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

type Role = 'buyer' | 'seller';

const SignUp = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('buyer');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { role } },
      });
      if (error) throw error;
      toast.success(
        role === 'seller'
          ? 'Registrazione completata! Accedi e completa il profilo del negozio.'
          : 'Registrazione completata! Controlla la tua email.'
      );
      router.push('/sign-in');
    } catch (error: any) {
      toast.error(error.message || 'Errore durante la registrazione');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-8">
      <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md space-y-6">
        <h2 className="text-2xl font-bold text-gray-800">Crea il tuo account</h2>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setRole('buyer')}
            className={`p-4 rounded-lg border-2 text-left transition-all ${
              role === 'buyer'
                ? 'border-indigo-500 bg-indigo-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-2xl mb-1">🛒</div>
            <div className="font-bold text-sm">Acquirente</div>
            <div className="text-xs text-gray-500">Compra dai negozi locali</div>
          </button>
          <button
            type="button"
            onClick={() => setRole('seller')}
            className={`p-4 rounded-lg border-2 text-left transition-all ${
              role === 'seller'
                ? 'border-pink-500 bg-pink-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="text-2xl mb-1">🏪</div>
            <div className="font-bold text-sm">Venditore</div>
            <div className="text-xs text-gray-500">Vendi i tuoi prodotti</div>
          </button>
        </div>

        {role === 'seller' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-800">
            ℹ️ Dopo la registrazione dovrai completare i dati del negozio e attendere l'approvazione dell'admin.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="la-tua@email.it"
              required
              className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className={`w-full disabled:opacity-50 text-white px-4 py-2 rounded transition-colors ${
              role === 'seller'
                ? 'bg-pink-500 hover:bg-pink-600'
                : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {isLoading
              ? 'Registrazione in corso...'
              : role === 'seller'
              ? 'Registrati come venditore'
              : 'Registrati come acquirente'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-600">
          Hai già un account?{' '}
          <Link href="/sign-in" className="text-indigo-600 hover:underline">
            Accedi
          </Link>
        </p>
      </div>
    </div>
  );
};

export default SignUp;
