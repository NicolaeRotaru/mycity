'use client';

import { useState } from 'react';
import { Play } from 'lucide-react';

/**
 * 5/11/2026 — IL VIDEO ESTERNO SI CARICA SOLO QUANDO LA PERSONA LO CHIEDE.
 *
 * L'iframe di YouTube o Vimeo partiva appena il riquadro entrava nello schermo: il browser
 * contattava Google o Vimeo senza che nessuno l'avesse chiesto, e senza consenso. Adesso al suo
 * posto c'è un riquadro con il pulsante «Guarda il video (YouTube)»: l'iframe nasce al tocco.
 */
export default function VideoAlClic({
  provider,
  src,
  titolo,
}: {
  provider: 'youtube' | 'vimeo';
  src: string;
  titolo: string;
}) {
  const [acceso, setAcceso] = useState(false);
  const nome = provider === 'vimeo' ? 'Vimeo' : 'YouTube';

  if (!acceso) {
    return (
      <button
        type="button"
        onClick={() => setAcceso(true)}
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-900 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-300"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15">
          <Play size={28} aria-hidden />
        </span>
        <span className="text-sm font-semibold">Guarda il video ({nome})</span>
        <span className="max-w-xs px-4 text-center text-xs text-white/80">
          Al tocco il video si carica da {nome}, che riceve il tuo indirizzo IP.
        </span>
      </button>
    );
  }

  return (
    <iframe
      src={`${src}${src.includes('?') ? '&' : '?'}autoplay=1`}
      title={titolo}
      className="absolute inset-0 w-full h-full"
      referrerPolicy="strict-origin-when-cross-origin"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
    />
  );
}
