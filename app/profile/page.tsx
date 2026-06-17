'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { Gift } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

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

  const { data: profile, isLoading, error } = useQuery({
    queryKey: queryKeys.profile.mine,
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
      qc.invalidateQueries({ queryKey: queryKeys.profile.mine });
      toast.success('Profilo aggiornato!');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (isLoading) return <LoadingState />;
  if (error || !profile) {
    if (typeof window !== 'undefined') router.push('/sign-in');
    return null;
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Il tuo account</h1>

      <div className="space-y-6">
        <Link
          href="/profile/referral"
          className="block rounded-2xl bg-gradient-to-r from-primary-600 to-purple-600 p-5 text-white transition-all hover:shadow-lg"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-lg font-extrabold flex items-center gap-2">
                <Gift size={20} className="text-white" aria-hidden />
                Invita un amico, prendete €5 entrambi
              </p>
              <p className="text-sm text-primary-100">Condividi il tuo codice referral</p>
            </div>
            <span className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-primary-800">
              Scopri →
            </span>
          </div>
        </Link>

        <div className="rounded-2xl border border-cream-300 bg-white p-6">
          <h2 className="mb-4 text-lg font-bold">Dati personali</h2>
          <p className="mb-4 text-sm text-ink-500">
            Email: <span className="font-mono">{profile.email}</span>
          </p>
          <form
            onSubmit={handleSubmit((d) => update.mutate(d))}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            <Input
              label="Nome e cognome"
              containerClassName="sm:col-span-2"
              {...register('full_name')}
            />
            <Input
              label="Telefono"
              inputMode="tel"
              {...register('phone')}
            />
            <Input
              label="CAP"
              inputMode="numeric"
              {...register('zip')}
            />
            <Input
              label="Indirizzo"
              containerClassName="sm:col-span-2"
              {...register('address')}
            />
            <Input
              label="Città"
              containerClassName="sm:col-span-2"
              {...register('city')}
            />
            <div className="sm:col-span-2">
              <Button type="submit" loading={update.isPending} fullWidth>
                Salva modifiche
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
