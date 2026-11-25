import localFont from 'next/font/local';

/**
 * 25/11/2026 — IL CARATTERE DEL TITOLO DELLA HOME, PRECARICATO SOLO IN HOME.
 *
 * Il titolo «I veri negozi di Piacenza» e' la cosa piu' grande che si vede aprendo la home (per
 * Lighthouse e' l'LCP) e usa Fraunces grassetto, dritto e corsivo («veri»): gli stessi file della
 * famiglia di tutto il sito (app/layout.tsx), che pero' non si precarica piu'.
 *
 * Next precarica un carattere nelle pagine che importano il file dove e' dichiarato: dichiarato
 * qui, il precarico vale solo per la home. Se il titolo aspettasse il carattere senza precarico,
 * si ridisegnerebbe col carattere vero dopo il JavaScript, e per Lighthouse arriverebbe tardi.
 */
export const carattereDelTitolo = localFont({
  src: [
    { path: '../../app/fonts/fraunces-latin-700-normal.woff2', weight: '700', style: 'normal' },
    { path: '../../app/fonts/fraunces-latin-700-italic.woff2', weight: '700', style: 'italic' },
  ],
  display: 'swap',
  adjustFontFallback: 'Times New Roman',
});
