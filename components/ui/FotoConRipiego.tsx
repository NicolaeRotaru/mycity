'use client';

import { useState } from 'react';
import Image, { type ImageProps } from 'next/image';
import { FOTO_MANCANTE } from '@/lib/foto-mancante';

/**
 * Un'<Image> che, se il file non risponde più (foto cancellata dallo spazio delle foto del
 * negozio, indirizzo scaduto), passa da sola alla foto di ripiego invece di lasciare un riquadro
 * bianco o l'icona della foto rotta. `FOTO_MANCANTE` copre il dato assente; questo copre il dato
 * presente ma irraggiungibile.
 *
 * Si ricorda l'indirizzo che è fallito, non un vero/falso: se la `src` cambia (un'altra foto,
 * un'altra variante) si riprova con la nuova.
 */
export default function FotoConRipiego({ src, alt, onError, ...resto }: ImageProps & { src: string }) {
  const [fallita, setFallita] = useState<string | null>(null);
  const inRipiego = fallita === src && src !== FOTO_MANCANTE;
  return (
    <Image
      {...resto}
      alt={alt}
      src={inRipiego ? FOTO_MANCANTE : src}
      onError={(e) => {
        if (src !== FOTO_MANCANTE) setFallita(src);
        onError?.(e);
      }}
    />
  );
}
