import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// 5/11/2026 — La pagina è 'use client' e non può dichiarare il titolo: ereditava quello della home,
// e chi usa il lettore di schermo cambiava pagina senza sentire dove era arrivato (WCAG 2.4.2).
export const metadata: Metadata = { title: 'Reimposta la password · MyCity' };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
