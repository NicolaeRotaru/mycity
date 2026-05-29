'use client';

import Image from 'next/image';

interface Props {
  logoUrl?: string | null;
  storeName?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'w-10 h-10 text-xl',
  md: 'w-14 h-14 text-2xl',
  lg: 'w-20 h-20 text-4xl',
  xl: 'w-28 h-28 text-5xl',
} as const;

// Px corrispondenti alle classi tailwind sopra (per il sizing di next/image).
const SIZE_PX = { sm: 40, md: 56, lg: 80, xl: 112 } as const;

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
      🏪
    </div>
  );
};

export default StoreAvatar;
