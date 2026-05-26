'use client';

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

const StoreAvatar = ({ logoUrl, storeName, size = 'md', className = '' }: Props) => {
  const sizeClass = SIZE_CLASSES[size];

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={storeName ?? 'logo negozio'}
        className={`${sizeClass.split(' ')[0]} ${sizeClass.split(' ')[1]} rounded-full object-cover bg-white shrink-0 ${className}`}
      />
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
