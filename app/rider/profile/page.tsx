'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/Field';
import Link from 'next/link';
import {
  Bike, Car, MapPin, ChevronRight, Star, Clock, FileText, HelpCircle, Package,
  Banknote, IdCard, ShieldCheck, FileCheck, CircleCheck, CircleAlert, LogOut,
  type LucideIcon,
} from 'lucide-react';

const VEHICLE_LABELS: Record<string, string> = { BIKE: 'Bici', EBIKE: 'E-bike', SCOOTER: 'Scooter', CAR: 'Auto' };

const SETTINGS_LINKS: { href: string; Icon: LucideIcon; label: string }[] = [
  { href: '/rider/reviews', Icon: Star, label: 'Le mie recensioni' },
  { href: '/rider/history', Icon: Package, label: 'Storico consegne' },
  { href: '/rider/availability', Icon: Clock, label: 'Disponibilità e zone' },
  { href: '/rider/earnings', Icon: Banknote, label: 'Guadagni e compensi' },
  { href: '/rider/onboarding', Icon: FileText, label: 'Documenti e verifica' },
  { href: '/rider/help', Icon: HelpCircle, label: 'Aiuto' },
];

export default function RiderProfilePage() {
  const qc = useQueryClient();
  const router = useRouter();
  const tStates = useTranslations('states');
  const tActions = useTranslations('actions');

  const { data: profile, isLoading } = useQuery({
    queryKey: queryKeys.rider.profile,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone, rider_vehicle_type, rider_vehicle_plate, rider_zones, rider_haccp_expires_on, rider_license_expires_on, rider_insurance_expires_on, kyc_id_doc_front_url')
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

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/sign-in');
    router.refresh();
  };

  if (isLoading) return <LoadingState />;

  // Dati mezzo/zona/compliance (cast difensivo: indipendente dalla completezza dei tipi DB generati).
  const p = profile as Record<string, unknown> | undefined;
  const vehicleType = (p?.rider_vehicle_type as string | null) ?? null;
  const vehiclePlate = (p?.rider_vehicle_plate as string | null) ?? null;
  const riderZones = (p?.rider_zones as string[] | null) ?? [];
  const haccpExpires = (p?.rider_haccp_expires_on as string | null) ?? null;
  const licenseExpires = (p?.rider_license_expires_on as string | null) ?? null;
  const insuranceExpires = (p?.rider_insurance_expires_on as string | null) ?? null;
  const idUploaded = !!(p?.kyc_id_doc_front_url as string | null);
  const vehicleLabel = vehicleType ? (VEHICLE_LABELS[vehicleType] ?? vehicleType) : 'Non specificato';
  const VehicleIcon = vehicleType === 'CAR' ? Car : Bike;

  const fullNameStr = String(profile?.full_name || profile?.email || 'Rider');
  const initials = fullNameStr.trim().split(/\s+/).map((w: string) => w[0] ?? '').slice(0, 2).join('').toUpperCase() || 'R';

  // Compliance / documenti: stato calcolato dalle scadenze reali.
  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('it-IT') : null);
  const soon = (d: string | null) => !!d && (new Date(d).getTime() - Date.now()) < 60 * 86400000; // <60gg
  type DocStatus = 'ok' | 'soon' | 'missing';
  const docs: { Icon: LucideIcon; label: string; sub: string; status: DocStatus }[] = [
    {
      Icon: IdCard, label: 'Patente di guida',
      sub: licenseExpires ? `Scade ${fmtDate(licenseExpires)}` : 'Da caricare',
      status: !licenseExpires ? 'missing' : soon(licenseExpires) ? 'soon' : 'ok',
    },
    {
      Icon: ShieldCheck, label: 'Assicurazione RC',
      sub: insuranceExpires ? `Scade ${fmtDate(insuranceExpires)}` : 'Da caricare',
      status: !insuranceExpires ? 'missing' : soon(insuranceExpires) ? 'soon' : 'ok',
    },
    {
      Icon: FileCheck, label: 'Documento identità',
      sub: idUploaded ? 'Verificato' : 'Da caricare',
      status: idUploaded ? 'ok' : 'missing',
    },
    {
      Icon: ShieldCheck, label: 'Attestato HACCP',
      sub: haccpExpires ? `Scade ${fmtDate(haccpExpires)}` : 'Facoltativo (food)',
      status: haccpExpires ? (soon(haccpExpires) ? 'soon' : 'ok') : 'missing',
    },
  ];
  const STATUS_META: Record<DocStatus, { bg: string; text: string; label: string; Icon: LucideIcon }> = {
    ok:      { bg: 'bg-olive-50',     text: 'text-olive-700',     label: 'OK',          Icon: CircleCheck },
    soon:    { bg: 'bg-accent-50',    text: 'text-accent-700',    label: 'In scadenza', Icon: Clock },
    missing: { bg: 'bg-secondary-50', text: 'text-secondary-600', label: 'Mancante',    Icon: CircleAlert },
  };

  return (
    <div className="pb-5">
      {/* Hero avatar con gradiente brand */}
      <div className="bg-gradient-to-br from-primary-700 to-secondary-700 px-5 py-6 text-center text-white">
        <span className="inline-flex h-[72px] w-[72px] items-center justify-center rounded-full border-[3px] border-white/30 bg-white/[0.18] text-[26px] font-extrabold">
          {initials}
        </span>
        <p className="mt-3 font-serif text-[22px] font-extrabold">{fullNameStr}</p>
        <p className="mt-0.5 text-[13px] text-white/85">{profile?.email}</p>
      </div>

      {/* Mezzo + zona */}
      <div className="grid grid-cols-2 gap-2.5 p-4">
        <div className="rounded-lg border border-cream-300 bg-surface-0 p-3.5">
          <VehicleIcon size={18} className="text-primary-600" aria-hidden />
          <p className="mt-2 text-[11px] font-bold uppercase text-ink-400">Veicolo</p>
          <p className="mt-0.5 text-sm font-semibold text-ink-900">{vehicleLabel}</p>
          {vehiclePlate && <p className="text-[11px] text-ink-500">Targa {vehiclePlate}</p>}
        </div>
        <div className="rounded-lg border border-cream-300 bg-surface-0 p-3.5">
          <MapPin size={18} className="text-primary-600" aria-hidden />
          <p className="mt-2 text-[11px] font-bold uppercase text-ink-400">Zone base</p>
          <p className="mt-0.5 text-sm font-semibold text-ink-900">{riderZones.length > 0 ? riderZones.join(' · ') : 'Tutta la città'}</p>
        </div>
      </div>

      {/* Dati personali (form esistente) */}
      <div className="px-4 pb-4">
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.03em] text-ink-700">Dati personali</p>
        <div className="space-y-4 rounded-xl border border-cream-300 bg-surface-0 p-4">
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
            className="w-full rounded-lg bg-primary-700 px-6 py-2.5 font-semibold text-white hover:bg-primary-800 disabled:opacity-50"
          >
            {update.isPending ? tStates('saving') : tActions('save')}
          </button>
        </div>
      </div>

      {/* Documenti & compliance */}
      <div className="px-4 pb-4">
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.03em] text-ink-700">Documenti & compliance</p>
        <div className="flex flex-col gap-2">
          {docs.map((d) => {
            const meta = STATUS_META[d.status];
            const StatusIcon = meta.Icon;
            return (
              <div key={d.label} className="flex items-center gap-3 rounded-lg border border-cream-300 bg-surface-0 px-3.5 py-3">
                <span className={`inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full ${meta.bg}`}>
                  <d.Icon size={18} className={meta.text} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink-900">{d.label}</p>
                  <p className="text-xs text-ink-500">{d.sub}</p>
                </div>
                {d.status === 'missing' ? (
                  <Link
                    href="/rider/onboarding"
                    className={`shrink-0 rounded-full px-3 py-[7px] text-xs font-bold text-white ${d.status === 'missing' ? 'bg-secondary-600 hover:bg-secondary-700' : ''}`}
                  >
                    Carica
                  </Link>
                ) : (
                  <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-bold ${meta.text}`}>
                    <StatusIcon size={14} aria-hidden /> {meta.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Scorciatoie + logout */}
      <div className="px-4">
        <div className="flex flex-col">
          {SETTINGS_LINKS.map(({ href, Icon, label }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 border-b border-cream-200 px-1 py-3.5 text-[15px] text-ink-800 hover:bg-cream-50"
            >
              <Icon size={19} className="shrink-0 text-ink-500" aria-hidden />
              <span className="flex-1">{label}</span>
              <ChevronRight size={17} className="shrink-0 text-ink-300" aria-hidden />
            </Link>
          ))}
          <button
            type="button"
            onClick={handleSignOut}
            className="flex items-center gap-3 px-1 py-3.5 text-left text-[15px] font-medium text-secondary-600 hover:bg-secondary-50"
          >
            <LogOut size={19} className="shrink-0" aria-hidden />
            <span className="flex-1">Esci</span>
          </button>
        </div>
      </div>
    </div>
  );
}
