'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { Map as MappaLeaflet, LayerGroup } from 'leaflet';
import type { Cliente } from '@/lib/agenti/clienti';
import { COLORI, coloreDi } from '@/lib/agenti/clienti-vista';

/**
 * La mappa dei clienti da visitare (28/11/2026): un puntino per attività, colorato per stato. Leaflet e
 * OpenStreetMap come components/NearbyStoresMap.tsx (la CSP apre già *.tile.openstreetmap.org). I puntini si
 * disegnano su un'unica tela (preferCanvas): 650 segnaposti veri rallenterebbero il telefono.
 * Toccare un puntino sceglie l'attività: la scheda la mostra la pagina, sotto la mappa.
 */

const PANE_QUOTIDIANO = { lat: 45.0529, lon: 9.6917 };

type Props = {
  clienti: Cliente[];
  scelto: string | null;
  onScegli: (osm: string) => void;
  io?: { lat: number; lon: number } | null;
};

export default function MappaClienti({ clienti, scelto, onScegli, io }: Props) {
  const div = useRef<HTMLDivElement>(null);
  const mappa = useRef<MappaLeaflet | null>(null);
  const strato = useRef<LayerGroup | null>(null);
  const inquadrata = useRef(false);
  const scegli = useRef(onScegli);
  scegli.current = onScegli;

  useEffect(() => {
    let annullato = false;
    let pulisci: (() => void) | undefined;
    (async () => {
      const L = (await import('leaflet')).default;
      if (annullato || !div.current || mappa.current) return;
      const m = L.map(div.current, { preferCanvas: true, scrollWheelZoom: false }).setView([PANE_QUOTIDIANO.lat, PANE_QUOTIDIANO.lon], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(m);
      L.circleMarker([PANE_QUOTIDIANO.lat, PANE_QUOTIDIANO.lon], { radius: 8, color: '#1C1A18', weight: 3, fillColor: '#FFFFFF', fillOpacity: 1, interactive: false })
        .bindTooltip('Pane Quotidiano', { direction: 'top' }).addTo(m);
      strato.current = L.layerGroup().addTo(m);
      mappa.current = m;
      pulisci = () => { m.remove(); mappa.current = null; strato.current = null; };
    })();
    return () => { annullato = true; pulisci?.(); };
  }, []);

  useEffect(() => {
    let annullato = false;
    (async () => {
      const L = (await import('leaflet')).default;
      // La mappa nasce in modo asincrono: se i dati arrivano prima, si riprova fra un attimo.
      for (let i = 0; i < 20 && !mappa.current && !annullato; i++) await new Promise((r) => setTimeout(r, 100));
      const m = mappa.current, g = strato.current;
      if (annullato || !m || !g) return;
      g.clearLayers();
      const punti: [number, number][] = [];
      for (const c of clienti) {
        if (c.lat === null || c.lon === null) continue;
        const tinta = COLORI[coloreDi(c)].tinta;
        const sua = c.osm === scelto;
        const p = L.circleMarker([c.lat, c.lon], { radius: sua ? 10 : 6, color: sua ? '#1C1A18' : '#FFFFFF', weight: sua ? 3 : 1.5, fillColor: tinta, fillOpacity: 0.95 });
        p.bindTooltip(c.nome, { direction: 'top' });
        p.on('click', () => scegli.current(c.osm));
        p.addTo(g);
        punti.push([c.lat, c.lon]);
      }
      if (io) {
        L.circleMarker([io.lat, io.lon], { radius: 7, color: '#FFFFFF', weight: 3, fillColor: '#1C1A18', fillOpacity: 1, interactive: false }).bindTooltip('Tu sei qui').addTo(g);
      }
      if (!inquadrata.current && punti.length > 1) { m.fitBounds(punti, { padding: [24, 24], maxZoom: 15 }); inquadrata.current = true; }
      if (scelto) {
        const c = clienti.find((x) => x.osm === scelto);
        if (c && c.lat !== null && c.lon !== null) m.panTo([c.lat, c.lon]);
      }
    })();
    return () => { annullato = true; };
  }, [clienti, scelto, io]);

  return <div ref={div} className="h-[55vh] w-full rounded-2xl border border-surface-200 z-0" role="region" aria-label="Mappa dei clienti da visitare" />;
}
