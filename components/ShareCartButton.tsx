'use client';

import { useState } from 'react';
import { Share2, Copy, MessageCircle, Mail } from 'lucide-react';
import { toast } from 'sonner';
import type { CartItem } from '@/lib/cart';

type Props = {
  items: CartItem[];
};

/**
 * "Condividi carrello" — genera un link WhatsApp/Email/copy che apre il
 * marketplace con la lista prodotti precompilata.
 *
 * Tecnica: encoda gli ID dei prodotti in querystring (?cart=id1:qty1,id2:qty2)
 * e una pagina di destinazione (TODO: /shared-cart) li ricarica nel carrello
 * locale del destinatario.
 *
 * Per ora apre direttamente il dominio + testo formattato con lista articoli.
 */
export default function ShareCartButton({ items }: Props) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  const baseUrl = typeof window !== 'undefined'
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_APP_URL ?? 'https://mycity-marketplace.com');

  const cartParam = items.map((i) => `${i.id}:${i.quantity}`).join(',');
  const shareUrl = `${baseUrl}/?cart=${encodeURIComponent(cartParam)}`;

  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const itemList = items.slice(0, 8).map((i) => `· ${i.name} × ${i.quantity}`).join('\n');
  const text = `Ciao! Ho preparato una lista della spesa su MyCity:\n\n${itemList}${items.length > 8 ? `\n... e altri ${items.length - 8}` : ''}\n\nTotale: €${total.toFixed(2)}\n\nApri il link per vederla:\n${shareUrl}`;

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const emailUrl = `mailto:?subject=${encodeURIComponent('Lista della spesa MyCity')}&body=${encodeURIComponent(text)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Link copiato!');
      setOpen(false);
    } catch {
      toast.error('Impossibile copiare');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-sm font-semibold text-primary-700 hover:text-primary-800 hover:underline"
      >
        <Share2 size={16} />
        Condividi la lista
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fadeIn" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-warm-xl animate-popIn space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-serif font-bold text-ink-900">Condividi la lista della spesa</h3>
            <p className="text-sm text-ink-600">
              Manda la lista al partner o a un amico per concordare la spesa. Apriranno il marketplace già con tutti gli articoli pronti.
            </p>

            <div className="space-y-2">
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center gap-3 bg-[#25D366] hover:bg-[#1FAD53] text-white px-4 py-3 rounded-lg font-semibold transition-colors"
              >
                <MessageCircle size={18} />
                Condividi su WhatsApp
              </a>
              <a
                href={emailUrl}
                className="w-full inline-flex items-center gap-3 bg-primary-700 hover:bg-primary-800 text-white px-4 py-3 rounded-lg font-semibold transition-colors"
              >
                <Mail size={18} />
                Invia via email
              </a>
              <button
                onClick={copy}
                className="w-full inline-flex items-center gap-3 bg-white border border-cream-300 hover:border-primary-300 text-ink-900 px-4 py-3 rounded-lg font-semibold transition-colors"
              >
                <Copy size={18} />
                Copia testo
              </button>
            </div>

            <button onClick={() => setOpen(false)} className="w-full text-xs text-ink-500 hover:text-ink-800">
              Chiudi
            </button>
          </div>
        </div>
      )}
    </>
  );
}
