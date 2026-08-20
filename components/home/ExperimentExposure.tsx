'use client';

import { useEffect } from 'react';
import { trackExperimentExposed } from '@/lib/analytics/events';
import { registraProprietaPersistenti } from '@/lib/analytics/posthog';

/**
 * Registra l'esposizione a una variante di esperimento (`experiment_exposed`).
 * Server-assegnata a monte (middleware/cookie): qui notifichiamo solo PostHog,
 * una volta per mount. Componente invisibile.
 */
export default function ExperimentExposure({
  experiment,
  variant,
}: {
  experiment: string;
  variant: string;
}) {
  useEffect(() => {
    // #215 — La variante va attaccata a TUTTI gli eventi che seguono, non solo
    // all'esposizione. Prima si sapeva chi aveva visto quale home, ma non chi
    // di loro aveva poi comprato: l'esperimento non era misurabile, cioe' non
    // era un esperimento. Con la super-property ogni evento successivo della
    // sessione porta con se' la variante.
    void registraProprietaPersistenti({ [`${experiment}_variant`]: variant });
    void trackExperimentExposed(experiment, variant);
  }, [experiment, variant]);

  return null;
}
