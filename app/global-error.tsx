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
        <div style={{ maxWidth: 500, margin: '60px auto', padding: '0 16px', textAlign: 'center' }}>
          <div
            style={{
              width: 64, height: 64, borderRadius: 999, background: '#FEE2E2',
              color: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32, margin: '0 auto 16px',
            }}
          >
            !
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>Errore inatteso</h1>
          <p style={{ fontSize: 14, color: '#57534E', margin: '0 0 24px' }}>
            L'applicazione ha riscontrato un errore. Stiamo già indagando.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: '#A03B25', color: 'white', border: 0, padding: '12px 24px',
              borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer',
            }}
          >
            Ricarica
          </button>
        </div>
      </body>
    </html>
  );
}
