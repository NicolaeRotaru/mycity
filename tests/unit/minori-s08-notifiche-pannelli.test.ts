import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * S08 (5/11/2026) — scheda 353: negozi e fattorini hanno un posto nel loro pannello per
 * accendere le notifiche sul telefono. Prova leggera: le due pagine del profilo montano il
 * pulsante (lo stesso delle impostazioni del cliente).
 */
const RADICE = path.resolve(__dirname, '../..');

describe('le notifiche sul telefono nei pannelli di lavoro', () => {
  for (const pagina of ['app/seller/profile/page.tsx', 'app/rider/profile/page.tsx']) {
    it(pagina, () => {
      const src = readFileSync(path.join(RADICE, pagina), 'utf8');
      expect(src).toContain("import PushNotificationOptIn from '@/components/PushNotificationOptIn';");
      expect(src).toMatch(/<PushNotificationOptIn \/>/);
    });
  }
});
