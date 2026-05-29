'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package, Heart, MapPin, Settings, Users, HelpCircle, LifeBuoy, Mail, ChevronRight, LogOut,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

type ProfileForm = {
  full_name: string;
  phone: string;
  address: string;
  city: string;
  zip: string;
};

const ACCOUNT_LINKS = [
  { href: '/orders',            icon: Package,    label: 'I tuoi ordini',   sub: 'Traccia e ripeti' },
  { href: '/favorites',         icon: Heart,      label: 'Preferiti',       sub: 'Prodotti salvati' },
  { href: '/profile/addresses', icon: MapPin,     label: 'Indirizzi',       sub: 'Casa, ufficio…' },
  { href: '/profile/settings',  icon: Settings,   label: 'Impostazioni',    sub: 'Password, notifiche, privacy' },
  { href: '/groups',            icon: Users,      label: 'Gruppi acquisto', sub: 'Unisciti e risparmia' },
  { href: '/faq',               icon: HelpCircle, label: 'FAQ',             sub: 'Domande frequenti' },
  { href: '/help',              icon: LifeBuoy,   label: 'Assistenza',      sub: 'Centro di aiuto' },
  { href: '/contact',           icon: Mail,       label: 'Contattaci',      sub: 'Parla con noi' },
];

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
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-5xl">
      <h1 className="text-2xl font-bold mb-6">Il tuo account</h1>

      <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
        {/* SINISTRA — menu account */}
        <aside className="h-fit lg:sticky lg:top-24">
          <nav className="divide-y divide-cream-100 overflow-hidden rounded-2xl border border-cream-300 bg-white">
            {ACCOUNT_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-cream-50"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700 transition-colors group-hover:bg-primary-600 group-hover:text-white">
                  <l.icon size={18} strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink-900">{l.label}</span>
                  <span className="block truncate text-xs text-ink-500">{l.sub}</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-ink-300 transition-colors group-hover:text-primary-600" />
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 font-semibold text-rose-600 transition-colors hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
          >
            <LogOut size={16} />
            {signingOut ? 'Disconnessione…' : 'Esci dal tuo account'}
          </button>
        </aside>

        {/* DESTRA — referral + dati personali */}
        <div className="space-y-6">
          <Link
            href="/profile/referral"
            className="block rounded-2xl bg-gradient-to-r from-primary-600 to-purple-600 p-5 text-white transition-all hover:shadow-lg"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-extrabold">🎁 Invita un amico, prendete €5 entrambi</p>
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
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium">Nome e cognome</label>
                <input {...register('full_name')} className="w-full rounded border p-2" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Telefono</label>
                <input {...register('phone')} className="w-full rounded border p-2" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">CAP</label>
                <input {...register('zip')} className="w-full rounded border p-2" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium">Indirizzo</label>
                <input {...register('address')} className="w-full rounded border p-2" />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium">Città</label>
                <input {...register('city')} className="w-full rounded border p-2" />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" loading={update.isPending} fullWidth>
                  Salva modifiche
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
