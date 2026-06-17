'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/Field';
import Link from 'next/link';
import { Bike, Car, MapPin, ShieldCheck, ChevronRight, Banknote, Star, Clock, FileText, HelpCircle, Package } from 'lucide-react';

const VEHICLE_LABELS: Record<string, string> = { BIKE: 'Bici', EBIKE: 'E-bike', SCOOTER: 'Scooter', CAR: 'Auto' };

const SETTINGS_LINKS: { href: string; Icon: typeof Bike; label: string }[] = [
  { href: '/rider/availability', Icon: Clock, label: 'Disponibilità e zone' },
  { href: '/rider/earnings', Icon: Banknote, label: 'Guadagni' },
  { href: '/rider/reviews', Icon: Star, label: 'Recensioni' },
  { href: '/rider/history', Icon: Package, label: 'Storico consegne' },
  { href: '/rider/onboarding', Icon: FileText, label: 'Documenti e verifica' },
  { href: '/rider/help', Icon: HelpCircle, label: 'Aiuto' },
];

export default function RiderProfilePage() {
  const qc = useQueryClient();
  const tStates = useTranslations('states');
  const tActions = useTranslations('actions');

  const { data: profile, isLoading } = useQuery({
    queryKey: queryKeys.rider.profile,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone, rider_vehicle_type, rider_vehicle_plate, rider_zones, rider_haccp_expires_on')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      return { ...data, email: user.email ?? '' };
    },
  });

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  const update = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName, phone })
        .eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.rider.profile });
      qc.invalidateQueries({ queryKey: queryKeys.profile.auth });
      toast.success('Profilo aggiornato');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (isLoading) return <LoadingState />;

  // Dati mezzo/zona raccolti in onboarding (cast difensivo: indipendente dalla
  // completezza dei tipi DB generati).
  const vehicleType = (profile as { rider_vehicle_type?: string | null } | undefined)?.rider_vehicle_type ?? null;
  const vehiclePlate = (profile as { rider_vehicle_plate?: string | null } | undefined)?.rider_vehicle_plate ?? null;
  const riderZones = ((profile as { rider_zones?: string[] | null } | undefined)?.rider_zones) ?? [];
  const haccpExpires = (profile as { rider_haccp_expires_on?: string | null } | undefined)?.rider_haccp_expires_on ?? null;
  const vehicleLabel = vehicleType ? (VEHICLE_LABELS[vehicleType] ?? vehicleType) : 'Non specificato';
  const VehicleIcon = vehicleType === 'CAR' ? Car : Bike;

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Profilo rider</h1>
        <p className="text-sm text-ink-500">I tuoi dati di contatto, visibili al cliente.</p>
      </div>

      <div className="bg-accent-50 border border-accent-200 rounded-lg p-4 text-accent-800 text-sm flex items-center gap-1.5">
        <Bike size={16} strokeWidth={2.2} aria-hidden /> Account rider attivo · {profile?.email}
      </div>

      <div className="bg-white border rounded-lg p-6 space-y-4">
        <Input
          label="Nome e cognome"
          type="text"
          defaultValue={profile?.full_name ?? ''}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Mario Rossi"
        />
        <Input
          label="Telefono"
          type="tel"
          defaultValue={profile?.phone ?? ''}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="3331234567"
          inputMode="tel"
        />
        <button
          onClick={() => update.mutate()}
          disabled={update.isPending}
          className="bg-accent-500 hover:bg-accent-600 disabled:opacity-50 text-white px-6 py-2.5 rounded font-semibold"
        >
          {update.isPending ? tStates('saving') : tActions('save')}
        </button>
      </div>

      {/* Mezzo e zone (dai dati di onboarding) */}
      <div className="bg-white border rounded-lg p-6">
        <h2 className="font-bold text-ink-900 mb-3">Mezzo e zone</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-cream-300 p-4">
            <div className="flex items-center gap-2 text-ink-500 text-xs uppercase tracking-wide mb-1">
              <VehicleIcon size={14} strokeWidth={2.2} aria-hidden /> Veicolo
            </div>
            <p className="font-semibold text-ink-900">{vehicleLabel}</p>
            {vehiclePlate && <p className="text-xs text-ink-500">Targa {vehiclePlate}</p>}
          </div>
          <div className="rounded-xl border border-cream-300 p-4">
            <div className="flex items-center gap-2 text-ink-500 text-xs uppercase tracking-wide mb-1">
              <MapPin size={14} strokeWidth={2.2} aria-hidden /> Zone preferite
            </div>
            <p className="font-semibold text-ink-900">{riderZones.length > 0 ? riderZones.join(' · ') : 'Tutta la città'}</p>
          </div>
          {haccpExpires && (
            <div className="col-span-2 rounded-xl border border-cream-300 p-4">
              <div className="flex items-center gap-2 text-ink-500 text-xs uppercase tracking-wide mb-1">
                <ShieldCheck size={14} strokeWidth={2.2} aria-hidden /> Certificato HACCP
              </div>
              <p className="font-semibold text-ink-900">
                Valido fino al {new Date(haccpExpires).toLocaleDateString('it-IT')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Impostazioni: scorciatoie alle altre sezioni rider */}
      <div className="bg-white border rounded-lg overflow-hidden divide-y divide-cream-200">
        {SETTINGS_LINKS.map(({ href, Icon, label }) => (
          <Link key={href} href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-cream-50 transition-colors">
            <Icon size={18} strokeWidth={2.2} className="text-ink-500 shrink-0" aria-hidden />
            <span className="flex-1 font-medium text-ink-800">{label}</span>
            <ChevronRight size={16} strokeWidth={2.2} className="text-ink-400 shrink-0" aria-hidden />
          </Link>
        ))}
      </div>
    </div>
  );
}
