'use client';

import { QRCodeSVG } from 'qrcode.react';

interface Props {
  value: string;
  size?: number;
  className?: string;
}

/**
 * QR generato localmente (SVG, nessuna chiamata di rete).
 * In precedenza usava api.qrserver.com via <img>, ma quell'host non è nella
 * Content-Security-Policy (middleware.ts img-src) e veniva bloccato dal
 * browser: il QR non si visualizzava alla consegna. Generandolo in locale
 * il problema sparisce e funziona anche offline.
 */
const SimpleQR = ({ value, size = 180, className = '' }: Props) => {
  return (
    <QRCodeSVG
      value={value}
      size={size}
      marginSize={2}
      level="M"
      className={`bg-white rounded-lg p-2 ${className}`}
    />
  );
};

export default SimpleQR;
