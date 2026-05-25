'use client';

import { useEffect, useState } from 'react';

const COLORS = ['#C0492C', '#E8A33D', '#5A7C42', '#EE9F86', '#FBD891', '#7C8B5A'];

/**
 * Confetti burst per momenti di gratificazione: acquisto completato,
 * primo prodotto pubblicato, raggiunto un livello, ecc.
 *
 * Genera N particelle a posizione casuale che esplodono via CSS animation.
 * Si auto-dismount dopo 1.5s. Non blocca interazione (pointer-events-none).
 */
type Props = {
  /** Mostra l'esplosione una volta. Quando torna false, niente confetti. */
  trigger: boolean;
  count?: number;
  duration?: number;
};

export default function ConfettiBurst({ trigger, count = 40, duration = 1200 }: Props) {
  const [pieces, setPieces] = useState<Array<{
    id: number; left: string; bg: string; rotation: number; tx: number; ty: number; delay: number;
  }>>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!trigger) return;
    const arr = Array.from({ length: count }, (_, i) => ({
      id: i,
      left: `${50 + (Math.random() - 0.5) * 20}%`,
      bg: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * 720 - 360,
      tx: (Math.random() - 0.5) * 600,
      ty: -200 - Math.random() * 400,
      delay: Math.random() * 100,
    }));
    setPieces(arr);
    setVisible(true);
    const id = setTimeout(() => setVisible(false), duration + 200);
    return () => clearTimeout(id);
  }, [trigger, count, duration]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            top: '40%',
            left: p.left,
            background: p.bg,
            animationDelay: `${p.delay}ms`,
            animationDuration: `${duration}ms`,
            ['--end-transform' as any]: `translate(${p.tx}px, ${p.ty}px) rotate(${p.rotation}deg)`,
          }}
        />
      ))}
    </div>
  );
}
