'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useProfile } from './hooks/useProfile';

type Props = {
  sellerId: string;
  className?: string;
  label?: string;
};

/**
 * Pulsante "Contatta venditore": apre (o crea) una conversazione tra il buyer
 * loggato e il seller indicato, poi naviga alla pagina della conversazione.
 *
 * Se l'utente non è loggato lo manda al sign-in con returnTo sulla pagina
 * corrente. Se è seller / rider / admin nasconde il pulsante (non ha senso
 * mostrarlo nel proprio negozio o se non sei un acquirente).
 */
export default function ContactSellerButton({ sellerId, className = '', label = 'Contatta il negozio' }: Props) {
  const router = useRouter();
  const { isAuthenticated, isRider, isAdmin, profile } = useProfile();
  const [loading, setLoading] = useState(false);

  // Non mostrare il bottone se sono lo stesso seller (vedo il mio prodotto)
  if (isAuthenticated && profile?.id === sellerId) return null;
  // I rider e admin operano in aree pro: niente chat dal listing pubblico.
  // I seller possono scrivere ad altri seller (es. per fornitura).
  if (isRider || isAdmin) return null;

  const handleClick = async () => {
    if (!isAuthenticated) {
      const returnTo = typeof window !== 'undefined' ? window.location.pathname : '/';
      router.push(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sellerId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Errore');
      router.push(`/messages/${json.conversationId}`);
    } catch (err: any) {
      toast.error(err.message ?? 'Impossibile aprire la chat');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center justify-center gap-2 border border-primary-200 bg-white hover:bg-primary-50 text-primary-800 disabled:opacity-50 px-4 py-2.5 rounded-lg font-semibold text-sm transition-colors ${className}`}
    >
      <MessageCircle size={16} />
      {loading ? 'Apertura…' : label}
    </button>
  );
}
