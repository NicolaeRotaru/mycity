'use client';

interface Props {
  value: string;
  size?: number;
  className?: string;
}

const SimpleQR = ({ value, size = 180, className = '' }: Props) => {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(value)}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={`QR code: ${value}`}
      width={size}
      height={size}
      className={`bg-white rounded-lg ${className}`}
    />
  );
};

export default SimpleQR;
