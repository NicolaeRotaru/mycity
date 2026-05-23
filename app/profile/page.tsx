'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

type ProfileForm = {
  full_name: string;
  phone: string;
  address: string;
  city: string;
  zip: string;
};

export default function ProfilePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { register, handleSubmit, reset } = useForm<ProfileForm>();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    qc.clear();
    router.push('/sign-in');
    router.refresh();
  };

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ['my-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      return { ...data, email: user.email };
    },
  });

  useEffect(() => {
    if (profile) {
      reset({
        full_name: profile.full_name ?? '',
        phone:     profile.phone ?? '',
        address:   profile.address ?? '',
        city:      profile.city ?? '',
        zip:       profile.zip ?? '',
      });
    }
  }, [profile, reset]);

  const update = useMutation({
    mutationFn: async (form: ProfileForm) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase.from('profiles').update(form).eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-profile'] });
      toast.success('Profilo aggiornato!');
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (isLoading) return <div className="container mx-auto p-8 text-center">Caricamento...</div>;
  if (error || !profile) {
    if (typeof window !== 'undefined') router.push('/sign-in');
    return null;
  }

  return (
    <div className="container mx-auto px-6 py-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Il tuo account</h1>

      {/* BANNER INVITA AMICI */}
      <Link
        href="/profile/referral"
        className="block bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl p-5 mb-6 hover:shadow-lg transition-all"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-extrabold text-lg">🎁 Invita un amico, prendete €5 entrambi</p>
            <p className="text-indigo-100 text-sm">Condividi il tuo codice referral</p>
          </div>
          <span className="bg-white text-indigo-700 px-3 py-1.5 rounded-lg font-bold text-sm shrink-0">
            Scopri →
          </span>
        </div>
      </Link>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <Link href="/orders" className="bg-white border rounded-lg p-5 hover:shadow-md transition-shadow">
          <div className="text-3xl mb-2">📦</div>
          <h3 className="font-bold">I tuoi ordini</h3>
          <p className="text-sm text-gray-500 hidden sm:block">Traccia e ripeti</p>
        </Link>
        <Link href="/favorites" className="bg-white border rounded-lg p-5 hover:shadow-md transition-shadow">
          <div className="text-3xl mb-2">♥</div>
          <h3 className="font-bold">Preferiti</h3>
          <p className="text-sm text-gray-500 hidden sm:block">I tuoi prodotti salvati</p>
        </Link>
        <Link href="/profile/addresses" className="bg-white border rounded-lg p-5 hover:shadow-md transition-shadow">
          <div className="text-3xl mb-2">📍</div>
          <h3 className="font-bold">Indirizzi</h3>
          <p className="text-sm text-gray-500 hidden sm:block">Casa, ufficio…</p>
        </Link>
        <Link href="/groups" className="bg-white border rounded-lg p-5 hover:shadow-md transition-shadow">
          <div className="text-3xl mb-2">🤝</div>
          <h3 className="font-bold">Gruppi acquisto</h3>
          <p className="text-sm text-gray-500 hidden sm:block">Unisciti e risparmia</p>
        </Link>
      </div>

      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-lg font-bold mb-4">Dati personali</h2>
        <p className="text-sm text-gray-500 mb-4">
          Email: <span className="font-mono">{profile.email}</span>
        </p>
        <form
          onSubmit={handleSubmit((d) => update.mutate(d))}
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">Nome e cognome</label>
            <input {...register('full_name')} className="w-full border p-2 rounded" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Telefono</label>
            <input {...register('phone')} className="w-full border p-2 rounded" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">CAP</label>
            <input {...register('zip')} className="w-full border p-2 rounded" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">Indirizzo</label>
            <input {...register('address')} className="w-full border p-2 rounded" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">Città</label>
            <input {...register('city')} className="w-full border p-2 rounded" />
          </div>
          <button
            type="submit"
            disabled={update.isPending}
            className="sm:col-span-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-2 rounded transition-colors"
          >
            {update.isPending ? 'Salvataggio...' : 'Salva modifiche'}
          </button>
        </form>
      </div>

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="text-red-600 hover:text-red-700 font-semibold disabled:opacity-50 flex items-center gap-2"
        >
          <span>↪</span>
          <span>{signingOut ? 'Disconnessione...' : 'Esci dal tuo account'}</span>
        </button>
      </div>
    </div>
  );
}
