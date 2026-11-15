'use client';

import { useState } from 'react';
import { Share2, Copy, MessageCircle, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import type { CartItem } from '@/lib/cart';
import { trackShareCart } from '@/lib/analytics/events';
import { formatPrice } from '@/lib/format';

type Props = {
  items: CartItem[];
};

/** Quante righe porta un link: lo stesso tetto che legge /shared-cart (MAX_ITEMS). */
const RIGHE_PER_LINK = 50;

/**
 * "Condividi carrello" — genera un link WhatsApp/Email/copy che apre la
 * pagina /shared-cart con la lista prodotti precompilata.
 *
 * Tecnica: encoda gli ID dei prodotti in querystring (?cart=id1:qty1,id2:qty2)
 * e /shared-cart parsea + carica nel carrello locale del destinatario.
 * Usa la primitiva Modal (focus-trap + Esc + return-focus + scroll-lock).
 */
export default function ShareCartButton({ items }: Props) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  const baseUrl = typeof window !== 'undefined'
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_APP_URL ?? 'https://mycity-marketplace.com');

  // 5/11/2026 — La variante viaggia con la riga: nel testo («Torta · grande × 1») e nel link, come
  // terzo pezzo, così chi riceve la lista sa quale aveva scelto chi l'ha mandata.
  const voce = (i: CartItem) => `${i.id}:${i.quantity}${i.variantLabel ? `:${encodeURIComponent(i.variantLabel)}` : ''}`;
  // 13/11/2026 (R19-016) — /shared-cart legge al massimo 50 righe per link (MAX_ITEMS, tetto
  // anti-abuso): una lista più lunga si manda in più link, così nessun link nasce già tagliato.
  const shareUrls: string[] = [];
  for (let k = 0; k < items.length; k += RIGHE_PER_LINK) {
    const cartParam = items.slice(k, k + RIGHE_PER_LINK).map(voce).join(',');
    shareUrls.push(`${baseUrl}/shared-cart?cart=${encodeURIComponent(cartParam)}`);
  }
  const doveAprirla = shareUrls.length === 1
    ? `Apri il link per vederla:\n${shareUrls[0]}`
    : `La lista è lunga: apri tutti e ${shareUrls.length} i link per vederla intera:\n${shareUrls.map((u, n) => `${n + 1}) ${u}`).join('\n')}`;

  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const itemList = items
    .slice(0, 8)
    .map((i) => `· ${i.name}${i.variantLabel ? ` · ${i.variantLabel}` : ''} × ${i.quantity}`)
    .join('\n');
  const text = `Ciao! Ho preparato una lista della spesa su MyCity:\n\n${itemList}${items.length > 8 ? `\n... e altri ${items.length - 8}` : ''}\n\nTotale: ${formatPrice(total)}\n\n${doveAprirla}`;

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const emailUrl = `mailto:?subject=${encodeURIComponent('Lista della spesa MyCity')}&body=${encodeURIComponent(text)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      // #224 — La condivisione della lista era nel catalogo eventi ma non la
      // emetteva nessuno: tre pulsanti muti.
      void trackShareCart('copy_link');
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

      <Modal open={open} onClose={() => setOpen(false)} title="Condividi la lista della spesa" size="sm">
        <p className="text-sm text-ink-600 mb-4">
          Manda la lista al partner o a un amico per concordare la spesa. Apriranno il marketplace già con tutti gli articoli pronti.
        </p>
        {shareUrls.length > 1 && (
          <p className="text-sm text-ink-600 mb-4">
            La lista ha {items.length} righe: la mando in {shareUrls.length} link, perché ogni link ne porta al massimo {RIGHE_PER_LINK}.
          </p>
        )}
        <div className="space-y-2">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void trackShareCart('whatsapp')}
            className="w-full inline-flex items-center gap-3 bg-[#25D366] hover:bg-[#1FAD53] text-white px-4 py-3 rounded-lg font-semibold transition-colors"
          >
            <MessageCircle size={18} />
            Condividi su WhatsApp
          </a>
          <a
            href={emailUrl}
            onClick={() => void trackShareCart('email')}
            className="w-full inline-flex items-center gap-3 bg-primary-700 hover:bg-primary-800 text-white px-4 py-3 rounded-lg font-semibold transition-colors"
          >
            <Mail size={18} />
            Invia via email
          </a>
          <button
            type="button"
            onClick={copy}
            className="w-full inline-flex items-center gap-3 bg-white border border-cream-300 hover:border-primary-300 text-ink-900 px-4 py-3 rounded-lg font-semibold transition-colors"
          >
            <Copy size={18} aria-hidden />
            Copia testo
          </button>
        </div>
      </Modal>
    </>
  );
}
