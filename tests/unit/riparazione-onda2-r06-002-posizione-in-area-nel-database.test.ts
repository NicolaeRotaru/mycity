import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AREA_SERVITA, FRASE_NEGOZIO_FUORI_AREA } from '@/lib/ordini/zona-di-consegna';
import { friendlyError } from '@/lib/errors';

/**
 * Onda 2 · R06-002 — La posizione del negozio poteva finire lontano da Piacenza e il modulo la
 * salvava lo stesso: il profilo scrive store_lat e store_lng dal browser, e il controllo dell'area
 * stava solo nel selettore della mappa.
 *
 * La guardia vera sta nel database (migrazione «la posizione del negozio resta in area»): la prova
 * col database vero è tests/sql/rls/onda2-e2-posizione-negozio-in-area.test.sql (Postgres locale).
 * Qui si controlla che il riquadro scritto nella migrazione sia lo stesso di AREA_SERVITA: se Nicola
 * sceglie un raggio o sposta i bordi, si cambiano insieme, o il sito e il database direbbero due cose.
 */

const DIR = join(process.cwd(), 'migrations');
const file = readdirSync(DIR).find((f) => /la_posizione_del_negozio_resta_in_area\.sql$/.test(f));

describe('R06-002 · la posizione del negozio si controlla anche nel database', () => {
  it('la migrazione c’è', () => {
    expect(file, 'manca la guardia nel database: il controllo stava solo nel browser').toBeTruthy();
  });

  const sql = file ? readFileSync(join(DIR, file), 'utf8') : '';

  it('il riquadro del database è AREA_SERVITA', () => {
    const lat = /NEW\.store_lat BETWEEN ([\d.]+) AND ([\d.]+)/.exec(sql);
    const lng = /NEW\.store_lng BETWEEN ([\d.]+) AND ([\d.]+)/.exec(sql);
    expect(lat && [Number(lat[1]), Number(lat[2])]).toEqual([AREA_SERVITA.sud, AREA_SERVITA.nord]);
    expect(lng && [Number(lng[1]), Number(lng[2])]).toEqual([AREA_SERVITA.ovest, AREA_SERVITA.est]);
  });

  it('guarda le scritture della posizione sul profilo, e rifiuta con 23514', () => {
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF store_lat, store_lng ON public\.profiles/);
    expect(sql).toMatch(/ERRCODE = '23514'/);
    // Idempotente: si può riapplicare.
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.posizione_negozio_in_area/);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS profiles_posizione_negozio_in_area ON public\.profiles/);
  });

  it('il rifiuto del database arriva al negozio con la frase del selettore, non «valore non valido»', () => {
    const errore = { code: '23514', message: 'La posizione del negozio è fuori da Piacenza e dintorni, dove consegniamo' };
    expect(friendlyError(errore)).toBe(FRASE_NEGOZIO_FUORI_AREA);
  });
});
