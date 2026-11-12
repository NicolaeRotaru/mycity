'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { Gift, Check } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { INVITI_E_PUNTI_ACCESI } from '@/lib/funzioni-al-lancio';

// 5/11/2026 — Indirizzo, CAP e città stavano qui e la cassa non li leggeva mai (precompila
// solo dalla rubrica `user_addresses`): si scrivevano dati che non servivano a niente.
// Gli indirizzi di consegna stanno in «I tuoi indirizzi».
type ProfileForm = {
  full_name: string;
  phone: string;
};

export default function ProfilePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { register, handleSubmit, reset } = useForm<ProfileForm>();

  const { data: profile, isLoading, error, refetch } = useQuery({
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
  // 5/11/2026 — Qualunque errore (anche una rete debole) mandava alla pagina di accesso,
  // senza una parola. Si manda ad accedere solo chi non è entrato; una lettura caduta
  // si dice, con «Riprova».
  if (error instanceof Error && error.message === 'Non autenticato') {
    if (typeof window !== 'undefined') router.push('/sign-in?returnTo=/profile');
    return null;
  }
  if (error || !profile) {
    return (
      <ErrorState
        title="Non riusciamo a caricare il tuo profilo"
        description="Controlla la connessione e riprova."
        onRetry={() => void refetch()}
      />
    );
  }

  const displayName = (profile.full_name as string | null)?.trim() || 'Il mio account';
  const initials =
    displayName.split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase() || 'U';
  const since = (profile.created_at as string | undefined)
    ? new Date(profile.created_at as string).getFullYear()
    : null;

  return (
    <div className="max-w-2xl">
      {/* Page header dell'hub account */}
      <header className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.05em] text-primary-700">Account</p>
        <h1 className="mt-0.5 font-serif text-3xl font-extrabold leading-tight text-ink-900 sm:text-[32px]">
          Profilo
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Gestisci i tuoi dati personali. Gli indirizzi di consegna stanno in{' '}
          <Link href="/profile/addresses" className="text-primary-700 underline">I tuoi indirizzi</Link>.
        </p>
      </header>

      {/* Identità: avatar + "Cliente dal" */}
      <div className="mb-6 flex items-center gap-4">
        <span
          aria-hidden
          className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-2xl font-bold text-white"
        >
          {initials}
        </span>
        <div className="min-w-0">
          {/* 12/11/2026 (R12-015) — Un nome lungo senza spazi allargava la pagina a 871 px su
              un telefono da 360 e la faceva scorrere di lato; con gli spazi andava su 5 righe.
              Ora va a capo dove serve, si ferma a due righe e il nome intero resta nel title. */}
          <p className="font-serif text-2xl font-bold text-ink-900 [overflow-wrap:anywhere] line-clamp-2" title={displayName}>
            {displayName}
          </p>
          <p className="mt-0.5 text-sm text-ink-500">
            {since ? `Cliente dal ${since}` : profile.email}
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Inviti spenti al lancio (INVITI_E_PUNTI_ACCESI): niente riquadro che promette €5
            mentre /profile/referral dice che non c'è un premio. */}
        {INVITI_E_PUNTI_ACCESI && (
        <Link
          href="/profile/referral"
          className="block rounded-2xl bg-gradient-to-r from-primary-600 to-secondary-600 p-5 text-white transition-all hover:shadow-lg"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-lg font-extrabold font-serif flex items-center gap-2">
                <Gift size={20} className="text-white" aria-hidden />
                Invita un amico, ricevi €5 di credito
              </p>
              <p className="text-sm text-primary-100">Condividi il tuo codice referral</p>
            </div>
            <span className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-primary-800">
              Scopri →
            </span>
          </div>
        </Link>
        )}

        <div className="rounded-2xl border border-cream-300 bg-white p-6">
          <h2 className="mb-4 text-lg font-bold">Dati personali</h2>
          <p className="mb-4 text-sm text-ink-500">
            Email: <span className="break-words font-mono">{profile.email}</span>
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
            <div className="sm:col-span-2 space-y-2">
              <Button type="submit" loading={update.isPending} fullWidth>
                Salva modifiche
              </Button>
              {update.isSuccess && !update.isPending && (
                <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-olive-700" role="status">
                  <Check size={16} strokeWidth={2.4} aria-hidden /> Modifiche salvate
                </p>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
