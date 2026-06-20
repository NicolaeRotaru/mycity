'use client';

import { useEffect } from 'react';
import { captureError } from '@/lib/analytics/sentry';

/**
 * Global error boundary — cattura errori nel layout root (es. provider crash).
 *
 * Deve includere <html> e <body> perché viene sostituito al root.
 * NON può importare CSS o usare le fonts del layout (sono già crashate).
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureError(error, { digest: error.digest, context: 'global-error' });
  }, [error]);

  return (
    <html lang="it">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#FBF7F0', color: '#2C2A28', minHeight: '100vh' }}>
        <div style={{ maxWidth: 460, margin: '80px auto', padding: '0 24px', textAlign: 'center' }} role="alert">
          {/* Medallion tono secondary (burgundy) — coerente con states.html. */}
          <div
            style={{
              width: 96, height: 96, borderRadius: 999, background: '#FDF2F2',
              color: '#B82A28', display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 24px',
            }}
            aria-hidden
          >
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          </div>
          <h1 style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 30, fontWeight: 800, margin: '0 0 10px' }}>
            Qualcosa è andato storto
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: '#44403C', margin: '0 0 24px' }}>
            Si è verificato un errore imprevisto. Riprova tra un momento — se il problema continua, scrivici.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: '#A03B25', color: 'white', border: 0, padding: '12px 22px',
              borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            Riprova
          </button>
        </div>
      </body>
    </html>
  );
}
