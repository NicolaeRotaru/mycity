'use client';

import Image from 'next/image';
import { Store } from 'lucide-react';

interface Props {
  logoUrl?: string | null;
  storeName?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'w-10 h-10',
  md: 'w-14 h-14',
  lg: 'w-20 h-20',
  xl: 'w-28 h-28',
} as const;

// Px corrispondenti alle classi tailwind sopra (per il sizing di next/image).
const SIZE_PX = { sm: 40, md: 56, lg: 80, xl: 112 } as const;

// Dimensione (px) dell'icona Lucide di fallback per ogni taglia avatar.
const ICON_PX = { sm: 20, md: 24, lg: 32, xl: 44 } as const;

const StoreAvatar = ({ logoUrl, storeName, size = 'md', className = '' }: Props) => {
  const sizeClass = SIZE_CLASSES[size];

  if (logoUrl) {
    const [w, h] = sizeClass.split(' ');
    const px = SIZE_PX[size];
    return (
      <div className={`relative ${w} ${h} rounded-full overflow-hidden bg-white shrink-0 ${className}`}>
        <Image
          src={logoUrl}
          alt={storeName ?? 'logo negozio'}
          fill
          sizes={`${px}px`}
          className="object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClass} bg-primary-100 text-primary-700 rounded-full flex items-center justify-center shrink-0 ${className}`}
    >
      <Store size={ICON_PX[size]} aria-hidden />
    </div>
  );
};

export default StoreAvatar;
