import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 26/11/2026 — LE MAPPE MANDANO A OPENSTREETMAP E A GOOGLE LA ZONA DI CASA, L'INFORMATIVA NO.
 *
 * Le mappe del sito scaricano le tessere da tile.openstreetmap.org (la zona mostrata è spesso
 * quella dell'indirizzo di consegna o della posizione del cliente), e «Naviga» del Rider apre
 * Google Maps con la destinazione della consegna. L'informativa nominava OpenStreetMap solo per
 * cercare gli indirizzi, e Google Maps per niente. La prova disegna l'informativa vera e la
 * confronta con quello che fanno i file delle mappe.
 */

const ROOT = join(__dirname, '..', '..');
const leggi = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const testo = (h: string) =>
  h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

afterEach(() => {
  vi.resetModules();
});

async function informativa(): Promise<string> {
  const { default: PrivacyPage } = await import('@/app/privacy/page');
  return testo(renderToStaticMarkup(createElement(PrivacyPage)));
}

describe('l’informativa dice cosa ricevono le mappe', () => {
  it('le mappe del sito scaricano davvero le tessere da OpenStreetMap (la premessa della prova)', () => {
    for (const f of ['components/DeliveryMap.tsx', 'components/NearbyStoresMap.tsx', 'components/StoreLocationPicker.tsx']) {
      expect(leggi(f), f).toContain('tile.openstreetmap.org');
    }
    expect(leggi('app/rider/orders/[id]/page.tsx')).toContain('https://www.google.com/maps/dir/');
  });

  it('OpenStreetMap: non solo la ricerca degli indirizzi, anche le tessere con la zona mostrata', async () => {
    const t = await informativa();
    const riga = t.slice(t.indexOf('OpenStreetMap Foundation'), t.indexOf('OpenStreetMap Foundation') + 600);
    expect(riga).toMatch(/tessere della mappa/);
    expect(riga).toMatch(/indirizzo IP/);
    expect(riga).toMatch(/zona mostrata/);
  });

  it('Google Maps è nominato, con la destinazione della consegna che riceve da «Naviga»', async () => {
    const t = await informativa();
    expect(t).toMatch(/Google Maps/);
    const i = t.indexOf('(Google Maps)');
    expect(i, 'manca la voce di Google Maps fra i destinatari').toBeGreaterThanOrEqual(0);
    const riga = t.slice(i, i + 600);
    expect(riga).toMatch(/Naviga/);
    expect(riga).toMatch(/indirizzo dell'Acquirente/);
  });
});
