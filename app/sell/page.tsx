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
import { controlloEta } from '@/lib/maggiore-eta';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { queryKeys, invalidaProfiloDiChiEntrato } from '@/lib/queries/keys';
import { X, Hourglass, Home, Mail } from 'lucide-react';

/**
 * QUANTO CI METTIAMO A RISPONDERE A CHI CHIEDE DI VENDERE — scritto una volta sola.
 *
 * 6/9/2026 — LA STESSA PAGINA PROMETTEVA DUE TEMPI DIVERSI. Il messaggio subito
 * dopo l'invio diceva «entro 48h», il riquadro «Richiesta in valutazione» — la
 * stessa pagina, dieci righe piu' sotto — diceva «entro 48 ore lavorative».
 * Non e' la stessa promessa: 48 ore di calendario da un venerdi' sera scadono
 * di domenica, 48 ore lavorative scadono martedi'. Il negoziante che scrive
 * venerdi' e non sente nessuno lunedi' pensa che MyCity non risponda — e il
 * primo contatto con un negozio nuovo parte gia' con un dubbio.
 *
 * Due frasi scritte a mano nello stesso file si separano il giorno dopo. Qui
 * il tempo e' UNO: si cambia qui e cambiano tutti e due i punti.
 *
 * (La casa naturale sarebbe `lib/promesse-pubbliche.ts`, dove vivono le altre
 * promesse pubbliche; quel file sta fuori dal perimetro di questo lotto e il
 * trasloco resta da fare.)
 */
const TEMPO_RISPOSTA_NEGOZI = '48 ore lavorative';

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

      /**
       * 8/9/2026 — LA SECONDA PORTA CHE SCRIVE LA DATA DI NASCITA.
       *
       * Il difetto era stato visto sul modulo del fattorino, ma `legal_birth_date`
       * ce l'hanno due strade, e sono tutte e due `update` fatti dal browser: se
       * si chiude il cancello solo di là, un quindicenne si iscrive come negozio.
       * Le condizioni d'uso, al punto 3, dicono diciotto anni — non «diciotto
       * anni se consegni».
       *
       * Questo è il freno del browser. Quello che non si scavalca è il vincolo
       * sul database (migrazione 156).
       */
      const eta = controlloEta(form.legalBirthDate);
      if (!eta.ok) throw new Error(eta.messaggio ?? 'Controlla la data di nascita.');

      /**
       * 31/10/2026 (ondata 4) — LA RICHIESTA LA SCRIVE IL SERVER.
       *
       * Qui c'era un aggiornamento del profilo fatto dal browser con dentro
       * `role: 'seller'`. La guardia del database sui profili (migrazione 119)
       * non lascia a nessuno cambiarsi il ruolo da solo — giustamente — e chi si
       * era iscritto come cliente veniva respinto dopo aver compilato tutto il
       * modulo. Adesso decide e scrive /api/seller/apply, che controlla anche
       * chi può chiedere (un negozio sospeso no).
       */
      const risposta = await fetch('/api/seller/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!risposta.ok) {
        const corpo = (await risposta.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(corpo?.error?.message ?? 'Non è stato possibile inviare la richiesta. Riprova fra un momento.');
      }
    },
    onSuccess: () => {
      invalidaProfiloDiChiEntrato(qc);
      toast.success(`Richiesta inviata! Ti contatteremo entro ${TEMPO_RISPOSTA_NEGOZI}.`);
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (profileLoading || isLoading) {
    return <LoadingState />;
  }

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto p-8 max-w-md text-center bg-white rounded-2xl mt-8">
        <h1 className="text-2xl font-bold mb-2">Diventa venditore</h1>
        <p className="text-ink-600 mb-6">Serve un account per inviare la richiesta.</p>
        <Button href="/sign-in?returnTo=/sell" size="lg">Accedi o registrati</Button>
      </div>
    );
  }

  // STATO: già in attesa di approvazione.
  // Ondata 10 — «pending» da solo non basta: la funzione del database che crea
  // il profilo fa nascere OGNI profilo in 'pending', anche chi non ha mai
  // mandato niente. La richiesta vera è quella con approval_requested_at
  // (lo scrive l'invio del modulo qui sotto): senza, si mostra il modulo.
  if (profile?.approval_status === 'pending' && profile?.role === 'seller' && profile?.approval_requested_at) {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <PendingNotice requestedAt={profile.approval_requested_at} />
      </div>
    );
  }

  // STATO: negozio sospeso. La sospensione la toglie lo staff: il modulo qui
  // non si mostra, perché rimandarlo riportava il negozio «in attesa» e lo
  // rimetteva nella coda delle richieste nuove (il server ora lo rifiuta).
  if (profile?.approval_status === 'suspended') {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <SuspendedNotice />
      </div>
    );
  }

  // STATO: richiesta rifiutata in passato — può ripresentare
  const wasRejected = profile?.approval_status === 'rejected';

  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-3xl">
      {wasRejected && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 mb-6">
          <h2 className="font-bold text-rose-900 mb-1 flex items-center gap-2"><X size={20} className="text-rose-600 shrink-0" aria-hidden /> Richiesta precedente non approvata</h2>
          {profile.rejection_reason && (
            <p className="text-sm text-rose-800">Motivo: {profile.rejection_reason}</p>
          )}
          <p className="text-sm text-rose-700 mt-1">Correggi i dati indicati e invia nuovamente.</p>
        </div>
      )}

      <SellerApplicationForm
        defaultValues={{
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
          businessAddress:   profile?.business_address ?? '',
          businessCity:      profile?.business_city ?? '',
          businessZip:       profile?.business_zip ?? '',
          storeName:         profile?.store_name ?? '',
          storeDescription:  profile?.store_description ?? '',
          billingIban:       profile?.billing_iban ?? '',
          storeLogo:         profile?.store_logo ?? null,
          storeMedia:        Array.isArray(profile?.store_media) ? profile.store_media : [],
          storeAddress:      profile?.store_address ?? '',
          storeLat:          profile?.store_lat ?? undefined,
          storeLng:          profile?.store_lng ?? undefined,
        }}
        emailAccesso={profile?.email ?? null}
        onSubmit={(data) => submit.mutate(data)}
        isLoading={submit.isPending}
      />
    </div>
  );
}

function SuspendedNotice() {
  return (
    <div className="bg-white border-2 border-secondary-200 rounded-2xl p-8 text-center">
      <h1 className="text-2xl font-extrabold text-ink-900 mb-2">Il tuo negozio è sospeso</h1>
      <p className="text-ink-600 mb-6">
        Non serve rimandare la richiesta: per capire il motivo e riattivare il negozio scrivi all&apos;assistenza.
      </p>
      <Button href="/contact" size="lg">Scrivi all&apos;assistenza</Button>
    </div>
  );
}

function PendingNotice({ requestedAt }: { requestedAt: string | null }) {
  return (
    <div className="bg-white border-2 border-accent-200 rounded-2xl p-8 text-center">
      <div className="w-20 h-20 mx-auto rounded-2xl bg-accent-100 flex items-center justify-center mb-4">
        <Hourglass size={32} className="text-accent-500" aria-hidden />
      </div>
      <h1 className="text-2xl font-extrabold text-ink-900 mb-2">Richiesta in valutazione</h1>
      <p className="text-ink-600 mb-4 max-w-md mx-auto">
        Abbiamo ricevuto la tua candidatura come venditore. Il nostro team la sta valutando.
        {requestedAt && (
          <> Inviata il <strong>{new Date(requestedAt).toLocaleDateString('it', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>.</>
        )}
      </p>
      <p className="text-sm text-ink-500 mb-6">
        Ti contatteremo entro <strong>{TEMPO_RISPOSTA_NEGOZI}</strong> via email e con una notifica in piattaforma.
        Nel frattempo puoi continuare a comprare normalmente.
      </p>
      <div className="flex flex-wrap gap-2 justify-center text-sm">
        <Button href="/"><span className="inline-flex items-center gap-2"><Home size={18} aria-hidden /> Continua a comprare</span></Button>
        <Link href="/contact" className="inline-flex items-center gap-2 bg-cream-100 hover:bg-cream-200 text-ink-900 px-5 py-2.5 rounded-lg font-semibold">
          <Mail size={18} aria-hidden /> Contatta il supporto
        </Link>
      </div>
    </div>
  );
}
