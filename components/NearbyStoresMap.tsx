'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export type NearbyStore = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

interface Props {
  userPos: { lat: number; lng: number } | null;
  stores: NearbyStore[];
  radiusKm: number;
  className?: string;
}

const PIACENZA = { lat: 45.0532, lng: 9.6914 };
const PRIMARY = '#C0492C'; // terracotta (design system)

/**
 * Mappa interattiva dei negozi "Vicino a te" (Leaflet + OpenStreetMap).
 * Mostra la posizione dell'utente, un cerchio col raggio scelto e i negozi
 * come marker cliccabili (→ pagina negozio). Riusa il pattern di DeliveryMap
 * (lazy import di leaflet, fix icone, cleanup su unmount).
 */
const NearbyStoresMap = ({
  userPos,
  stores,
  radiusKm,
  className = 'w-full h-[70vh] rounded-2xl border border-surface-200 z-0',
}: Props) => {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layersRef = useRef<any[]>([]);
  const router = useRouter();

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

      const center = userPos ?? PIACENZA;
      const map = L.map(divRef.current).setView([center.lat, center.lng], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;

      cleanup = () => {
        map.remove();
        mapRef.current = null;
        layersRef.current = [];
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aggiorna marker negozi + posizione utente + cerchio raggio
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      const map = mapRef.current;
      if (cancelled || !map) return;

      // Rimuovi i layer precedenti
      layersRef.current.forEach((l) => l.remove());
      layersRef.current = [];

      // Marker negozi (cliccabili → pagina negozio)
      stores.forEach((s) => {
        if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return;
        const icon = L.divIcon({
          className: '',
          html: `
            <div style="
              background:${PRIMARY};width:30px;height:30px;
              border-radius:50% 50% 50% 0;transform:rotate(-45deg);
              box-shadow:0 4px 8px rgba(0,0,0,.3);border:3px solid white;
              display:flex;align-items:center;justify-content:center;
            ">
              <div style="transform:rotate(45deg);color:white;font-weight:bold;font-size:13px;">
                ${(s.name?.[0] ?? '•').toUpperCase()}
              </div>
            </div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 30],
        });
        const marker = L.marker([s.lat, s.lng], { icon }).addTo(map);
        marker.bindTooltip(s.name, { direction: 'top' });
        marker.on('click', () => router.push(`/store/${s.id}`));
        layersRef.current.push(marker);
      });

      // Posizione utente + cerchio col raggio scelto
      if (userPos && Number.isFinite(userPos.lat) && Number.isFinite(userPos.lng)) {
        const userIcon = L.divIcon({
          className: '',
          html: `<div style="width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 0 0 4px rgba(37,99,235,.25);"></div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        const me = L.marker([userPos.lat, userPos.lng], { icon: userIcon, interactive: false }).addTo(map);
        me.bindTooltip('Tu sei qui', { direction: 'top' });
        layersRef.current.push(me);

        const circle = L.circle([userPos.lat, userPos.lng], {
          radius: radiusKm * 1000,
          color: PRIMARY,
          weight: 2,
          fillColor: PRIMARY,
          fillOpacity: 0.08,
        }).addTo(map);
        layersRef.current.push(circle);

        map.fitBounds(circle.getBounds(), { padding: [24, 24] });
      } else {
        // Senza geolocalizzazione: inquadra i negozi disponibili
        const pts = stores
          .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
          .map((s) => [s.lat, s.lng] as [number, number]);
        if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
        else if (pts.length === 1) map.setView(pts[0], 14);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPos, stores, radiusKm]);

  return <div ref={divRef} className={className} />;
};

export default NearbyStoresMap;
