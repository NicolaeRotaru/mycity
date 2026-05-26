'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';

// Centro Italia (Roma) come fallback iniziale prima che il seller imposti la propria posizione
const DEFAULT_MAP_CENTER = { lat: 41.9028, lng: 12.4964 };

const isValidLatLng = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' &&
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

export type StoreLocation = {
  address: string;
  lat: number;
  lng: number;
};

interface Props {
  defaultValue?: Partial<StoreLocation>;
  onChange: (loc: StoreLocation) => void;
}

const StoreLocationPicker = ({ defaultValue, onChange }: Props) => {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  const initialCoords = isValidLatLng(defaultValue?.lat, defaultValue?.lng)
    ? { lat: defaultValue!.lat as number, lng: defaultValue!.lng as number }
    : DEFAULT_MAP_CENTER;
  const hadInvalidStoredCoords =
    (defaultValue?.lat !== undefined || defaultValue?.lng !== undefined) &&
    !isValidLatLng(defaultValue?.lat, defaultValue?.lng);

  const [address, setAddress] = useState(defaultValue?.address ?? '');
  const [coords, setCoords] = useState(initialCoords);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(
    hadInvalidStoredCoords
      ? 'Le coordinate salvate non sono valide. Cerca di nuovo l\'indirizzo o trascina il pin sulla mappa, poi salva.'
      : null
  );

  // Sincronizza il parent con le coord (eventualmente sanificate) all'avvio
  useEffect(() => {
    onChange({ address, lat: initialCoords.lat, lng: initialCoords.lng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Init mappa (una volta sola)
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapDivRef.current || mapRef.current) return;

      // Fix per le icone Leaflet con Next/Webpack
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const map = L.map(mapDivRef.current).setView([coords.lat, coords.lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      const marker = L.marker([coords.lat, coords.lng], { draggable: true }).addTo(map);

      const updatePos = (lat: number, lng: number) => {
        setCoords({ lat, lng });
        onChange({ address, lat, lng });
      };

      marker.on('dragend', () => {
        const p = marker.getLatLng();
        updatePos(p.lat, p.lng);
      });

      map.on('click', (e: any) => {
        marker.setLatLng(e.latlng);
        updatePos(e.latlng.lat, e.latlng.lng);
      });

      mapRef.current = map;
      markerRef.current = marker;

      cleanup = () => {
        map.remove();
        mapRef.current = null;
        markerRef.current = null;
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincronizza il marker quando coords cambiano da geocoding/geolocation
  useEffect(() => {
    if (markerRef.current && mapRef.current) {
      markerRef.current.setLatLng([coords.lat, coords.lng]);
      mapRef.current.setView([coords.lat, coords.lng], 16);
    }
  }, [coords.lat, coords.lng]);

  const searchAddress = async () => {
    if (!address.trim()) {
      setError('Inserisci un indirizzo prima di cercare');
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const hasCountry = /italia|italy/i.test(address);
      const parts = [address];
      if (!hasCountry) parts.push('Italia');
      const q = encodeURIComponent(parts.join(', '));
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=it`
      );
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        setError('Indirizzo non trovato. Prova ad essere più specifico o sposta il pin sulla mappa.');
        return;
      }
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      if (!isValidLatLng(lat, lng)) {
        setError('Posizione non valida ricevuta dal servizio. Sposta il pin sulla mappa.');
        return;
      }
      setCoords({ lat, lng });
      onChange({ address, lat, lng });
    } catch {
      setError('Errore di rete durante la ricerca. Riprova.');
    } finally {
      setSearching(false);
    }
  };

  const useMyLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Geolocalizzazione non supportata dal browser');
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(newCoords);
        onChange({ ...newCoords, address });
        setLocating(false);
      },
      (err) => {
        setError('Impossibile ottenere la posizione: ' + err.message);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink-700 mb-1">
          Indirizzo del negozio
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              onChange({ address: e.target.value, lat: coords.lat, lng: coords.lng });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                searchAddress();
              }
            }}
            placeholder="Es. Via Roma 1, Milano"
            className="w-full sm:flex-1 min-w-0 border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
          <Button
            type="button"
            onClick={searchAddress}
            loading={searching}
            size="sm"
          >🔍 Cerca</Button>
        </div>
      </div>

      <div className="flex justify-between items-center text-sm flex-wrap gap-2">
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="text-primary-700 hover:underline disabled:opacity-50"
        >
          {locating ? '📡 Ricerca posizione...' : '🎯 Usa la mia posizione attuale'}
        </button>
        <span className="text-xs text-ink-400 font-mono">
          📍 {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
        </span>
      </div>

      {error && (
        <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded p-2">
          {error}
        </p>
      )}

      <div
        ref={mapDivRef}
        className="w-full h-64 rounded-lg border bg-cream-100 z-0"
      />

      <p className="text-xs text-ink-500">
        💡 Cerca un indirizzo, usa la tua posizione, oppure <strong>trascina il pin</strong> sulla mappa per impostare la posizione esatta del negozio.
      </p>
    </div>
  );
};

export default StoreLocationPicker;
