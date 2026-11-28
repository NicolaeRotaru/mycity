'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { Map as MappaLeaflet, LayerGroup } from 'leaflet';
import type { Cliente } from '@/lib/agenti/clienti';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATEGORIE, COLORI, categoriaDi, coloreDi, type Categoria, type Colore } from '@/lib/agenti/clienti-vista';
import { ICONE } from './IconaCategoria';

// Il disegno di ogni icona si fa una volta per categoria (650 segnaposti, 10 categorie).
const disegni = new Map<Categoria, string>();
const disegno = (cat: Categoria) => {
  if (!disegni.has(cat)) disegni.set(cat, renderToStaticMarkup(createElement(ICONE[cat], { size: 16, color: '#FFFFFF', strokeWidth: 2.25, 'aria-hidden': true })));
  return disegni.get(cat)!;
};
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Il segnaposto: l'icona della categoria su un tondo del colore dello stato. */
export function htmlSegnaposto(nome: string, cat: Categoria, colore: Colore, scelto: boolean): string {
  const lato = scelto ? 36 : 28;
  return `<div role="img" aria-label="${esc(`${nome}: ${CATEGORIE[cat]}, ${COLORI[colore].parola}`)}" style="width:${lato}px;height:${lato}px;border-radius:50%;background:${COLORI[colore].tinta};border:${scelto ? '3px solid #1C1A18' : '2px solid #FFFFFF'};box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;">${disegno(cat)}</div>`;
}

/**
 * La mappa dei clienti da visitare (28/11/2026): un segnaposto per attività con l'icona della categoria (Nicola,
 * 02:15) sul colore dello stato. Leaflet e
 * OpenStreetMap come components/NearbyStoresMap.tsx (la CSP apre già *.tile.openstreetmap.org). La lista resta
 * l'alternativa accessibile alla mappa.
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
      const m = L.map(div.current, { scrollWheelZoom: false }).setView([PANE_QUOTIDIANO.lat, PANE_QUOTIDIANO.lon], 14);
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
        const sua = c.osm === scelto;
        const lato = sua ? 36 : 28;
        const icon = L.divIcon({ className: '', html: htmlSegnaposto(c.nome, categoriaDi(c), coloreDi(c), sua), iconSize: [lato, lato], iconAnchor: [lato / 2, lato / 2] });
        const p = L.marker([c.lat, c.lon], { icon, title: c.nome, alt: c.nome, keyboard: true, zIndexOffset: sua ? 1000 : 0 });
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
