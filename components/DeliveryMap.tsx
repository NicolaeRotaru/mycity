'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

export type MapPoint = {
  lat: number;
  lng: number;
  label?: string;
  color?: 'indigo' | 'rose' | 'emerald' | 'amber';
};

interface Props {
  points: MapPoint[];
  className?: string;
  zoom?: number;
}

const COLOR_HEX: Record<NonNullable<MapPoint['color']>, string> = {
  indigo:  '#4f46e5',
  rose:    '#e11d48',
  emerald: '#10b981',
  amber:   '#f59e0b',
};

const DeliveryMap = ({ points, className = 'w-full h-72 rounded-lg border z-0', zoom = 14 }: Props) => {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  // Init mappa una sola volta
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !divRef.current || mapRef.current) return;

      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const center = points[0] ?? { lat: 45.0532, lng: 9.6914 }; // Piacenza centro
      const map = L.map(divRef.current).setView([center.lat, center.lng], zoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;

      cleanup = () => {
        map.remove();
        mapRef.current = null;
        markersRef.current = [];
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aggiorna marker quando cambiano i points
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      const map = mapRef.current;
      if (cancelled || !map) return;

      // Rimuovi marker esistenti
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      // Aggiungi i nuovi
      const latlngs: Array<[number, number]> = [];
      points.forEach((p) => {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
        const color = COLOR_HEX[p.color ?? 'indigo'];
        const icon = L.divIcon({
          className: '',
          html: `
            <div style="
              background:${color};
              width:32px;height:32px;
              border-radius:50% 50% 50% 0;
              transform: rotate(-45deg);
              box-shadow: 0 4px 8px rgba(0,0,0,0.3);
              border: 3px solid white;
              display:flex;align-items:center;justify-content:center;
            ">
              <div style="transform:rotate(45deg);color:white;font-weight:bold;font-size:14px;">
                ${p.label?.[0] ?? '•'}
              </div>
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
        });

        const marker = L.marker([p.lat, p.lng], { icon });
        if (p.label) marker.bindTooltip(p.label, { permanent: false, direction: 'top' });
        marker.addTo(map);
        markersRef.current.push(marker);
        latlngs.push([p.lat, p.lng]);
      });

      // Fit bounds se piu' di un punto
      if (latlngs.length > 1) {
        map.fitBounds(latlngs, { padding: [40, 40], maxZoom: 16 });
      } else if (latlngs.length === 1) {
        map.setView(latlngs[0], zoom);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  return <div ref={divRef} className={className} />;
};

export default DeliveryMap;
