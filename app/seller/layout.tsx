'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useProfile } from '@/components/hooks/useProfile';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { SubscriptionBanner } from '@/components/seller/SubscriptionBanner';
import { Store, Mail, Home, Pencil, X, PauseCircle, Clock, ArrowLeft } from 'lucide-react';

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { profile, isAuthenticated, isLoading, isSeller, isAdmin, isBuyer, isRider } = useProfile();
  const isApproved = !!profile?.is_approved;
  const allowed = (isSeller && isApproved) || isAdmin;
  type SellerProfileExt = { approval_status?: string | null; rejection_reason?: string | null };
  const profileExt = profile as (typeof profile & SellerProfileExt) | null;
  const approvalStatus = profileExt?.approval_status ?? undefined;
  const isPending   = isSeller && approvalStatus === 'pending';
  const isSuspended = isSeller && approvalStatus === 'suspended';
  const isRejected  = isSeller && approvalStatus === 'rejected';
  // Fallback per database senza migration 021/022: se non c'e' status,
  // un seller non approvato e' trattato come pending
  const pending = isSeller && !isApproved && !isSuspended && !isRejected;
  const wrongRole = isAuthenticated && !isSeller && !isAdmin; // buyer o rider qui

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/sign-in?returnTo=/seller');
    }
    // Niente più redirect silenzioso per wrong-role: mostriamo schermata
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return <LoadingState />;
  }

  // Buyer o rider che ha cliccato /seller per sbaglio (o ha digitato la URL)
  if (wrongRole) {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <div className="bg-white border-2 border-primary-200 rounded-2xl p-8 text-center">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-primary-100 flex items-center justify-center mb-4">
            <Store size={32} className="text-primary-600" aria-hidden />
          </div>
          <h1 className="text-2xl font-extrabold text-ink-900 mb-2">Quest'area è per i venditori</h1>
          <p className="text-ink-600 mb-1">
            Il tuo account è {isBuyer ? 'un acquirente' : isRider ? 'un rider' : 'di altro tipo'},
            quindi non vedi la dashboard venditori.
          </p>
          <p className="text-sm text-ink-500 mb-6 max-w-md mx-auto">
            Se hai un'attività e vuoi vendere su MyCity puoi inviare la richiesta. Approvazione entro 48h,
            poi avrai una vetrina dedicata. Abbonamento €50/mese e commissione del 10% sulle vendite.
          </p>
          <div className="flex flex-wrap gap-2 justify-center text-sm">
            <Link
              href="/sell"
              className="inline-flex items-center gap-1.5 bg-gradient-to-r from-primary-600 to-secondary-600 hover:from-primary-700 hover:to-secondary-700 text-white px-5 py-2.5 rounded-lg font-bold shadow"
            >
              <Store size={16} aria-hidden /> Diventa venditore
            </Link>
            <Link
              href={isRider ? '/rider' : '/'}
              className="inline-flex items-center gap-1.5 bg-cream-100 hover:bg-cream-200 text-ink-900 px-5 py-2.5 rounded-lg font-semibold"
            >
              <ArrowLeft size={16} aria-hidden /> Torna alla mia area
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (isSuspended) {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <div className="bg-white border-2 border-orange-200 rounded-2xl p-8 text-center">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-orange-100 flex items-center justify-center mb-4">
            <PauseCircle size={32} className="text-accent-500" aria-hidden />
          </div>
          <h1 className="text-2xl font-extrabold text-ink-900 mb-2">Negozio temporaneamente sospeso</h1>
          <p className="text-ink-600 mb-4 max-w-md mx-auto">
            Un amministratore ha sospeso il tuo negozio. La vendita è bloccata fino a quando non verrà riattivato.
            Contatta il supporto per chiarimenti.
          </p>
          <div className="flex flex-wrap gap-2 justify-center text-sm mt-4">
            <Link href="/contact" className="inline-flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-lg font-bold shadow">
              <Mail size={16} aria-hidden /> Contatta il supporto
            </Link>
            <Link href="/" className="inline-flex items-center gap-1.5 bg-cream-100 hover:bg-cream-200 text-ink-900 px-5 py-2.5 rounded-lg font-semibold">
              <Home size={16} aria-hidden /> Vai al marketplace
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (isRejected) {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <div className="bg-white border-2 border-rose-200 rounded-2xl p-8 text-center">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-rose-100 flex items-center justify-center mb-4">
            <X size={32} className="text-secondary-600" aria-hidden />
          </div>
          <h1 className="text-2xl font-extrabold text-ink-900 mb-2">Richiesta non approvata</h1>
          {profileExt?.rejection_reason && (
            <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 max-w-md mx-auto mb-3">
              <strong>Motivo:</strong> {profileExt?.rejection_reason}
            </p>
          )}
          <p className="text-ink-600 mb-4 max-w-md mx-auto">
            La tua candidatura come venditore non è stata approvata. Puoi correggere i dati e ripresentare la richiesta.
          </p>
          <div className="flex flex-wrap gap-2 justify-center text-sm mt-4">
            <Button href="/sell" icon={Pencil}>Ripresenta la richiesta</Button>
            <Button href="/" variant="secondary" icon={Home}>Vai al marketplace</Button>
          </div>
        </div>
      </div>
    );
  }

  if (isPending || pending) {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <div className="bg-white border-2 border-accent-200 rounded-2xl p-8 text-center">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-accent-100 flex items-center justify-center mb-4">
            <Clock size={32} className="text-accent-500" aria-hidden />
          </div>
          <h1 className="text-2xl font-extrabold text-ink-900 mb-2">Negozio in attesa di approvazione</h1>
          <p className="text-ink-600 mb-4 max-w-md mx-auto">
            Stiamo verificando i dati della tua attività. La dashboard sarà disponibile non appena
            il nostro team avrà approvato la richiesta (entro 48 ore lavorative).
          </p>
          <div className="flex flex-wrap gap-2 justify-center text-sm mt-4">
            <Button href="/sell" variant="secondary" icon={Pencil}>Modifica richiesta</Button>
            <Button href="/" icon={Home}>Vai al marketplace</Button>
            <Button href="/contact" variant="secondary" icon={Mail}>Contatti</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="container mx-auto p-8 text-center">
        <p className="text-ink-500 text-lg">Accesso riservato ai venditori approvati.</p>
        <div className="mt-4"><Button href="/sell">Invia richiesta</Button></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-6xl">
      {isSeller && <SubscriptionBanner status={profile?.subscription_status} />}
      <main>{children}</main>
    </div>
  );
}
