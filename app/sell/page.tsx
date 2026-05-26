'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { useProfile } from '@/components/hooks/useProfile';
import SellerApplicationForm, { type SellerApplicationData } from '@/components/SellerApplicationForm';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

const fetchProfile = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Non autenticato');
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  return { ...data, email: user.email };
};

export default function SellPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { isAuthenticated, isLoading: profileLoading, isSeller } = useProfile();

  const { data: profile, isLoading } = useQuery({ queryKey: queryKeys.profile.me, queryFn: fetchProfile, enabled: isAuthenticated });

  // Se sei già seller approvato, /sell non ha senso → vai al profilo negozio
  useEffect(() => {
    if (profileLoading || !profile) return;
    if (isSeller && profile.approval_status === 'approved') {
      router.replace('/seller/profile');
    }
  }, [isSeller, profile, profileLoading, router]);

  const submit = useMutation({
    mutationFn: async (form: SellerApplicationData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');

      const now = new Date().toISOString();
      const { error } = await supabase.from('profiles').update({
        // Contatti
        phone: form.contactPhone,
        // Anagrafica titolare
        legal_first_name:      form.legalFirstName,
        legal_last_name:       form.legalLastName,
        legal_fiscal_code:     form.legalFiscalCode.toUpperCase(),
        legal_birth_date:      form.legalBirthDate,
        legal_residence_addr:  form.legalResidenceAddr,
        legal_residence_city:  form.legalResidenceCity,
        legal_residence_zip:   form.legalResidenceZip,
        // Azienda
        business_legal_name: form.businessLegalName,
        business_vat_number: form.businessVatNumber.toUpperCase(),
        business_form:       form.businessForm,
        business_address:    form.businessAddress,
        business_city:       form.businessCity,
        business_zip:        form.businessZip,
        business_pec:        form.businessPec || null,
        business_sdi:        form.businessSdi ? form.businessSdi.toUpperCase() : null,
        // Vetrina
        store_name:          form.storeName,
        store_phone:         form.contactPhone,
        store_description:   form.storeDescription || null,
        store_logo:          form.storeLogo,
        store_media:         form.storeMedia,
        store_address:       form.storeAddress,
        store_lat:           form.storeLat,
        store_lng:           form.storeLng,
        // Pagamenti
        billing_iban:        form.billingIban ? form.billingIban.toUpperCase() : null,
        // Stato richiesta
        role:                'seller',
        is_approved:         false,
        approval_status:     'pending',
        approval_requested_at: now,
        // Consensi
        tos_accepted_at:        now,
        privacy_accepted_at:    now,
        data_accuracy_confirmed_at: now,
      }).eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.profile.me });
      qc.invalidateQueries({ queryKey: ['auth-profile'] });
      toast.success('Richiesta inviata! Ti contatteremo entro 48h.');
    },
    onError: (err: any) => toast.error(friendlyError(err)),
  });

  if (profileLoading || isLoading) {
    return <LoadingState />;
  }

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto p-8 max-w-md text-center bg-white rounded-2xl mt-8">
        <h1 className="text-2xl font-bold mb-2">Diventa venditore</h1>
        <p className="text-ink-600 mb-6">Serve un account per inviare la richiesta.</p>
        <Link href="/sign-in?returnTo=/sell" className="inline-block bg-primary-700 hover:bg-primary-800 text-white px-6 py-3 rounded-lg font-bold">
          Accedi o registrati
        </Link>
      </div>
    );
  }

  // STATO: già in attesa di approvazione
  if (profile?.approval_status === 'pending' && profile?.role === 'seller') {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <PendingNotice requestedAt={profile.approval_requested_at} />
      </div>
    );
  }

  // STATO: richiesta rifiutata in passato — può ripresentare
  const wasRejected = profile?.approval_status === 'rejected';

  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-3xl">
      {wasRejected && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 mb-6">
          <h2 className="font-bold text-rose-900 mb-1">❌ Richiesta precedente non approvata</h2>
          {profile.rejection_reason && (
            <p className="text-sm text-rose-800">Motivo: {profile.rejection_reason}</p>
          )}
          <p className="text-sm text-rose-700 mt-1">Correggi i dati indicati e invia nuovamente.</p>
        </div>
      )}

      <SellerApplicationForm
        defaultValues={{
          contactEmail:    profile?.email ?? '',
          contactPhone:    profile?.phone ?? '',
          legalFirstName:  profile?.legal_first_name ?? profile?.full_name?.split(' ')[0] ?? '',
          legalLastName:   profile?.legal_last_name  ?? profile?.full_name?.split(' ').slice(1).join(' ') ?? '',
          legalFiscalCode: profile?.legal_fiscal_code ?? '',
          legalBirthDate:  profile?.legal_birth_date ?? '',
          legalResidenceAddr: profile?.legal_residence_addr ?? profile?.address ?? '',
          legalResidenceCity: profile?.legal_residence_city ?? profile?.city ?? '',
          legalResidenceZip:  profile?.legal_residence_zip  ?? profile?.zip  ?? '',
          businessLegalName: profile?.business_legal_name ?? '',
          businessVatNumber: profile?.business_vat_number ?? '',
          businessForm:      profile?.business_form ?? 'ditta_individuale',
          businessAddress:   profile?.business_address ?? '',
          businessCity:      profile?.business_city ?? '',
          businessZip:       profile?.business_zip ?? '',
          businessPec:       profile?.business_pec ?? '',
          businessSdi:       profile?.business_sdi ?? '',
          storeName:         profile?.store_name ?? '',
          storeDescription:  profile?.store_description ?? '',
          billingIban:       profile?.billing_iban ?? '',
          storeLogo:         profile?.store_logo ?? null,
          storeMedia:        Array.isArray(profile?.store_media) ? profile.store_media : [],
          storeAddress:      profile?.store_address ?? '',
          storeLat:          profile?.store_lat ?? undefined,
          storeLng:          profile?.store_lng ?? undefined,
        }}
        onSubmit={(data) => submit.mutate(data)}
        isLoading={submit.isPending}
      />
    </div>
  );
}

function PendingNotice({ requestedAt }: { requestedAt: string | null }) {
  return (
    <div className="bg-white border-2 border-accent-200 rounded-2xl p-8 text-center">
      <div className="w-20 h-20 mx-auto rounded-2xl bg-accent-100 flex items-center justify-center text-4xl mb-4">
        ⏳
      </div>
      <h1 className="text-2xl font-extrabold text-ink-900 mb-2">Richiesta in valutazione</h1>
      <p className="text-ink-600 mb-4 max-w-md mx-auto">
        Abbiamo ricevuto la tua candidatura come venditore. Il nostro team la sta valutando.
        {requestedAt && (
          <> Inviata il <strong>{new Date(requestedAt).toLocaleDateString('it', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>.</>
        )}
      </p>
      <p className="text-sm text-ink-500 mb-6">
        Ti contatteremo entro <strong>48 ore lavorative</strong> via email e con una notifica in piattaforma.
        Nel frattempo puoi continuare a comprare normalmente.
      </p>
      <div className="flex flex-wrap gap-2 justify-center text-sm">
        <Link href="/?as=buyer" className="bg-primary-700 hover:bg-primary-800 text-white px-5 py-2.5 rounded-lg font-semibold">
          🏠 Continua a comprare
        </Link>
        <Link href="/contact" className="bg-cream-100 hover:bg-cream-200 text-ink-900 px-5 py-2.5 rounded-lg font-semibold">
          ✉️ Contatta il supporto
        </Link>
      </div>
    </div>
  );
}
