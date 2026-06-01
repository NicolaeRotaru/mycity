'use client';

import { useEffect } from 'react';
import { trackExperimentExposed } from '@/lib/analytics/events';

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
    void trackExperimentExposed(experiment, variant);
  }, [experiment, variant]);

  return null;
}
