'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import Link from 'next/link';
import { apiErrorMessage } from '@/lib/errors';
import { Check, ArrowLeft } from 'lucide-react';

type DocKind = 'id_front' | 'id_back' | 'selfie' | 'rider_license' | 'rider_insurance' | 'rider_haccp';

type DocDef = { kind: DocKind; label: string; required: boolean; hint: string };

const DOCS: DocDef[] = [
  { kind: 'id_front',       label: 'Documento identita\' — fronte',  required: true,  hint: 'Carta d\'identita\' o passaporto. JPG/PNG/PDF max 8 MB.' },
  { kind: 'id_back',        label: 'Documento identita\' — retro',   required: false, hint: 'Necessario per carta d\'identita\' italiana.' },
  { kind: 'selfie',         label: 'Selfie con documento',           required: true,  hint: 'Foto del tuo viso tenendo il documento accanto, per face match.' },
  { kind: 'rider_license',  label: 'Patente di guida',               required: true,  hint: 'Obbligatoria per scooter/auto.' },
  { kind: 'rider_insurance',label: 'Polizza RC',                     required: true,  hint: 'Assicurazione responsabilita\' civile valida.' },
  { kind: 'rider_haccp',    label: 'Attestato HACCP (se food)',      required: false, hint: 'Solo se consegnerai alimenti.' },
];

export default function RiderOnboardingPage() {
  const router = useRouter();
  const tForms = useTranslations('forms');
  const [uploading, setUploading] = useState<DocKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  type RiderProfile = {
    rider_license_url?: string | null;
    rider_insurance_url?: string | null;
    kyc_id_doc_front_url?: string | null;
    kyc_id_doc_back_url?: string | null;
    kyc_selfie_url?: string | null;
    [k: string]: unknown;
  };
  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [form, setForm] = useState({
    legal_first_name: '',
    legal_last_name: '',
    legal_fiscal_code: '',
    legal_birth_date: '',
    rider_vehicle_type: 'BIKE' as 'BIKE' | 'EBIKE' | 'SCOOTER' | 'CAR',
    rider_vehicle_plate: '',
    rider_license_expires_on: '',
    rider_insurance_expires_on: '',
  });

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u?.user) {
        router.replace('/sign-in?returnTo=/rider/onboarding');
        return;
      }
      const { data: p } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', u.user.id)
        .single();
      setProfile(p);
      if (p) {
        setForm((f) => ({
          ...f,
          legal_first_name: p.legal_first_name ?? '',
          legal_last_name: p.legal_last_name ?? '',
          legal_fiscal_code: p.legal_fiscal_code ?? '',
          legal_birth_date: p.legal_birth_date ?? '',
          rider_vehicle_type: p.rider_vehicle_type ?? 'BIKE',
          rider_vehicle_plate: p.rider_vehicle_plate ?? '',
          rider_license_expires_on: p.rider_license_expires_on ?? '',
          rider_insurance_expires_on: p.rider_insurance_expires_on ?? '',
        }));
      }
    })();
  }, [router]);

  async function uploadDoc(kind: DocKind, file: File) {
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/kyc/upload-document', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token ?? ''}` },
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(apiErrorMessage(data, 'Upload fallito'));
      toast.success(`${kind} caricato`);
      setProfile((p) => ({ ...(p ?? {}), [columnForKind(kind)]: data.url }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore upload');
    } finally {
      setUploading(null);
    }
  }

  async function saveAndStartCheck() {
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('Sessione scaduta');

      // 1) Salva form anagrafico
      const { error: uErr } = await supabase
        .from('profiles')
        .update(form)
        .eq('id', userId);
      if (uErr) throw uErr;

      // 2) Lancia KYC check
      const r = await fetch('/api/kyc/start-check', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token ?? ''}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(apiErrorMessage(data, 'KYC fallito'));
      toast.success(data.status === 'APPROVED' ? 'KYC approvato!' : 'KYC inviato, verifica in corso');
      router.push('/rider');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore');
    } finally {
      setSubmitting(false);
    }
  }

  const allRequiredUploaded = DOCS.filter((d) => d.required).every((d) => profile?.[columnForKind(d.kind)]);

  return (
    <div className="pb-6">
      {/* Header serif con back, in stile telefono rider */}
      <div className="flex items-center gap-2.5 px-4 pb-1 pt-3">
        <Link
          href="/rider/profile"
          aria-label="Indietro"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-700 hover:bg-cream-100"
        >
          <ArrowLeft size={20} aria-hidden />
        </Link>
        <h1 className="font-serif text-[22px] font-extrabold text-ink-900">Onboarding rider</h1>
      </div>
      <p className="px-4 text-[13px] text-ink-600">
        Completa i 3 passi qui sotto per attivare il tuo account rider. Dopo la verifica
        potrai accettare consegne.
      </p>

      <section className="mx-4 mt-5 rounded-xl border border-cream-300 bg-surface-0 p-4">
        <h2 className="font-serif text-[17px] font-bold text-ink-900">1. Dati anagrafici</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Nome" value={form.legal_first_name} onChange={(v) => setForm((f) => ({ ...f, legal_first_name: v }))} />
          <Field label="Cognome" value={form.legal_last_name} onChange={(v) => setForm((f) => ({ ...f, legal_last_name: v }))} />
          <Field label="Codice fiscale" value={form.legal_fiscal_code} onChange={(v) => setForm((f) => ({ ...f, legal_fiscal_code: v.toUpperCase() }))} />
          <Field label="Data di nascita" type="date" value={form.legal_birth_date} onChange={(v) => setForm((f) => ({ ...f, legal_birth_date: v }))} />
        </div>
      </section>

      <section className="mx-4 mt-4 rounded-xl border border-cream-300 bg-surface-0 p-4">
        <h2 className="font-serif text-[17px] font-bold text-ink-900">2. Mezzo di trasporto</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block font-medium text-ink-700">Tipo</span>
            <select
              value={form.rider_vehicle_type}
              onChange={(e) => setForm((f) => ({ ...f, rider_vehicle_type: e.target.value as 'BIKE' | 'EBIKE' | 'SCOOTER' | 'CAR' }))}
              className="mt-1 w-full rounded-lg border border-cream-300 bg-surface-0 px-3 py-2"
            >
              <option value="BIKE">Bici</option>
              <option value="EBIKE">E-bike</option>
              <option value="SCOOTER">Scooter</option>
              <option value="CAR">Auto</option>
            </select>
          </label>
          <Field label="Targa (se motorizzato)" value={form.rider_vehicle_plate} onChange={(v) => setForm((f) => ({ ...f, rider_vehicle_plate: v.toUpperCase() }))} />
          <Field label="Scadenza patente" type="date" value={form.rider_license_expires_on} onChange={(v) => setForm((f) => ({ ...f, rider_license_expires_on: v }))} />
          <Field label="Scadenza polizza RC" type="date" value={form.rider_insurance_expires_on} onChange={(v) => setForm((f) => ({ ...f, rider_insurance_expires_on: v }))} />
        </div>
      </section>

      <section className="mx-4 mt-4 rounded-xl border border-cream-300 bg-surface-0 p-4">
        <h2 className="font-serif text-[17px] font-bold text-ink-900">3. Documenti</h2>
        <div className="mt-4 space-y-3">
          {DOCS.map((d) => {
            const uploaded = !!profile?.[columnForKind(d.kind)];
            return (
              <div key={d.kind} className="rounded-lg border border-cream-300 bg-surface-0 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-ink-900">
                      {d.label} {d.required && <span className="text-secondary-600">*</span>}
                    </div>
                    <div className="text-xs text-ink-500 mt-0.5">{d.hint}</div>
                    {uploaded && <div className="mt-1 text-xs text-olive-700 flex items-center gap-1.5"><Check size={14} strokeWidth={2.2} aria-hidden /> Caricato</div>}
                  </div>
                  <label className="inline-flex cursor-pointer items-center rounded-lg bg-cream-100 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-cream-200">
                    {uploading === d.kind ? tForms('uploading') : (uploaded ? tForms('replacePhoto') : tForms('uploadPhoto'))}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadDoc(d.kind, f);
                      }}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="mt-6 px-4">
        <button
          onClick={saveAndStartCheck}
          disabled={submitting || !allRequiredUploaded}
          className="w-full rounded-lg bg-primary-700 px-6 py-3 text-sm font-bold text-white hover:bg-primary-800 disabled:opacity-50"
        >
          {submitting ? tForms('submitting') : tForms('saveAndStart')}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="text-sm">
      <span className="block font-medium text-ink-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-cream-300 px-3 py-2"
      />
    </label>
  );
}

function columnForKind(kind: DocKind): string {
  return ({
    id_front:        'kyc_id_doc_front_url',
    id_back:         'kyc_id_doc_back_url',
    selfie:          'kyc_selfie_url',
    rider_license:   'rider_license_url',
    rider_insurance: 'rider_insurance_url',
    rider_haccp:     'rider_haccp_url',
  } as Record<DocKind, string>)[kind];
}
