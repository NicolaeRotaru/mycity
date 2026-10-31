import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deliveryEtaMinutes, haversineKm } from '@/lib/geo';
import { RAGGIO_CONSEGNA_KM, VELOCITA_MEDIA_BICI_KMH } from '@/lib/constants';
import { EXPRESS_ETA_MAX, EXPRESS_ETA_LABEL } from '@/lib/delivery';
import { fuoriZonaDiConsegna } from '@/lib/ordini/zona-di-consegna';

/**
 * 31/10/2026 (ondata 3) — LA VELOCE IN 30-60 MINUTI STA IN PIEDI AL CONFINE DEI 5 KM.
 *
 * La scheda del difetto: con 10 km il conto in bici dava 55 minuti senza contare l'andata del
 * fattorino al negozio, cioè 5 minuti di margine prima di sforare. Il registro dei fatti dice altro:
 * il confine è 5 km (`consegna.raggio`) e la veloce promette 30-60 minuti (`consegna.promessa`).
 * Qui si esegue il conto al confine, si prova che oltre il confine non si consegna (quindi nemmeno
 * la veloce), e si controlla che il commento accanto a `RAGGIO_CONSEGNA_KM` non dica più che la
 * promessa è «in giornata, non a minuti»: chi legge quel commento deve trovare la promessa vera.
 */

// Un negozio nel centro di Piacenza; un grado di latitudine misura circa 111,2 km.
const NEGOZIO = { lat: 45.0526, lng: 9.693 };
const aNord = (km: number) => ({ lat: NEGOZIO.lat + km / 111.195, lng: NEGOZIO.lng });
const consegnaA = (km: number) => {
  const casa = aNord(km);
  return { storeLat: NEGOZIO.lat, storeLng: NEGOZIO.lng, deliveryLat: casa.lat, deliveryLng: casa.lng };
};

describe('il conto della veloce al confine', () => {
  it('a 5 km: preparazione + viaggio + andata del fattorino al negozio stanno dentro i 60 minuti', () => {
    expect(RAGGIO_CONSEGNA_KM).toBe(5);
    expect(EXPRESS_ETA_LABEL).toBe('30-60 min');
    const andataAlNegozio = (RAGGIO_CONSEGNA_KM / VELOCITA_MEDIA_BICI_KMH) * 60;
    expect(deliveryEtaMinutes(RAGGIO_CONSEGNA_KM)).toBe(35);
    expect(deliveryEtaMinutes(RAGGIO_CONSEGNA_KM) + andataAlNegozio).toBeLessThanOrEqual(EXPRESS_ETA_MAX);
  });

  it('oltre i 5 km non si consegna, quindi la veloce non si offre; dentro sì', () => {
    expect(haversineKm(NEGOZIO.lat, NEGOZIO.lng, aNord(5.5).lat, aNord(5.5).lng)).toBeGreaterThan(5);
    expect(fuoriZonaDiConsegna(consegnaA(5.5))).toBe(true);
    expect(fuoriZonaDiConsegna(consegnaA(4.5))).toBe(false);
  });
});

describe('il commento del confine dice la promessa vera', () => {
  it('lib/constants.ts non scrive più che la promessa è «in giornata» e non a minuti', () => {
    const src = readFileSync(join(process.cwd(), 'lib/constants.ts'), 'utf8');
    expect(src).not.toMatch(/promessa sui tempi[\s\S]{0,120}«in giornata»/);
    expect(src).not.toMatch(/non una stima a minuti/);
    expect(src).toMatch(/veloce in 30-60 minuti/);
  });
});
