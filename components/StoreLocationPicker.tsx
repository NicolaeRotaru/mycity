'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useId, useRef, useState } from 'react';
import type { Map as MappaLeaflet, Marker } from 'leaflet';
import { Search, RadioTower, Target, MapPin, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { dentroLAreaServita, FRASE_NEGOZIO_FUORI_AREA } from '@/lib/ordini/zona-di-consegna';

// 31/10/2026 — LA MAPPA SI APRE SU PIACENZA, E QUEL PUNTO NON È IL NEGOZIO.
// Prima si apriva su Roma e il selettore mandava subito quelle coordinate al modulo: chi scriveva
// l'indirizzo senza premere «Cerca» salvava il negozio a Roma, a 500 km dai clienti, fuori dal
// raggio di consegna (lib/ordini/zona-di-consegna.ts). Ora il punto di partenza è il centro di
// Piacenza, e finché il negozio non cerca l'indirizzo, usa il GPS o tocca la mappa, la posizione
// mandata al modulo ha `confermata: false`: il modulo non la salva e dice cosa fare.
const DEFAULT_MAP_CENTER = { lat: 45.0532, lng: 9.6914 };
// Il punto di partenza di prima. Un negozio salvato con queste coordinate esatte non ha mai dato
// la sua posizione: si tratta come «posizione mai data», non come il suo negozio.
const VECCHIO_PUNTO_DI_PARTENZA = { lat: 41.9028, lng: 12.4964 };

const isValidLatLng = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' &&
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

export type StoreLocation = {
  address: string;
  lat: number;
  lng: number;
  /**
   * true solo se la posizione l'ha data il negozio: salvata prima, cercata, presa dal GPS, toccata
   * o trascinata sulla mappa. false = è il punto in cui si apre la mappa: non va salvata.
   */
  confermata: boolean;
};

interface Props {
  defaultValue?: Partial<StoreLocation>;
  onChange: (loc: StoreLocation) => void;
  /** 25/11/2026 — Il nome del campo: un bar non ha un «negozio». Se manca resta quello di sempre. */
  etichetta?: string;
}

const StoreLocationPicker = ({ defaultValue, onChange, etichetta }: Props) => {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MappaLeaflet | null>(null);
  const markerRef = useRef<Marker | null>(null);

  const eraIlVecchioPuntoDiPartenza =
    defaultValue?.lat === VECCHIO_PUNTO_DI_PARTENZA.lat && defaultValue?.lng === VECCHIO_PUNTO_DI_PARTENZA.lng;
  const posizioneSalvataVera =
    isValidLatLng(defaultValue?.lat, defaultValue?.lng) && !eraIlVecchioPuntoDiPartenza;
  const initialCoords = posizioneSalvataVera
    ? { lat: defaultValue!.lat as number, lng: defaultValue!.lng as number }
    : DEFAULT_MAP_CENTER;
  const hadInvalidStoredCoords =
    (defaultValue?.lat !== undefined || defaultValue?.lng !== undefined) &&
    !isValidLatLng(defaultValue?.lat, defaultValue?.lng);

  // Generato, non scritto a mano: il modulo compare in piu' schermate e due campi con lo stesso
  // identificativo farebbero leggere al lettore di schermo sempre il primo.
  const idIndirizzo = useId();
  const [address, setAddress] = useState(defaultValue?.address ?? '');
  // La mappa registra i suoi ascoltatori una volta sola: senza questo, toccarla rimandava al modulo
  // l'indirizzo di quando si era aperta (spesso vuoto), e il modulo diceva «inserisci l'indirizzo».
  const indirizzoRef = useRef(address);
  const [confermata, setConfermata] = useState(posizioneSalvataVera);
  const [coords, setCoords] = useState(initialCoords);
  // 26/11/2026 — Il posto che «Cerca» ha trovato, scritto per intero («Via Roma, Piacenza, …»): prima
  // il negozio vedeva solo il segnaposto e non leggeva da nessuna parte in quale città era finito.
  const [trovato, setTrovato] = useState<string | null>(null);
  // Il testo è cambiato dopo l'ultima posizione data: la posizione vecchia non vale più (vedi sotto).
  const [daRicercare, setDaRicercare] = useState(false);
  // Una posizione fuori da Piacenza e dintorni non si conferma: qui il perché, finché non se ne dà una buona.
  const [avvisoArea, setAvvisoArea] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(
    hadInvalidStoredCoords
      ? 'Le coordinate salvate non sono valide. Cerca di nuovo l\'indirizzo o trascina il pin sulla mappa, poi salva.'
      : eraIlVecchioPuntoDiPartenza
        ? 'La posizione salvata non è il tuo negozio: era il punto in cui si apriva la mappa, a Roma. Cerca l\'indirizzo o tocca la mappa sul negozio, poi salva.'
        : null
  );

  // Sincronizza il parent con le coord (eventualmente sanificate) all'avvio
  useEffect(() => {
    onChange({ address, lat: initialCoords.lat, lng: initialCoords.lng, confermata: posizioneSalvataVera });
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
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
                // #76 — Le icone del segnaposto arrivavano da unpkg.com, un CDN di
        // terzi: ogni persona che apriva una mappa faceva una richiesta a un
        // sito che non e' nostro, e quel sito vedeva il suo indirizzo di rete.
        // Un destinatario dei dati in piu' — mai dichiarato nell'informativa —
        // per tre file da pochi chilobyte. Ora stanno da noi: sparisce il
        // destinatario, sparisce la richiesta esterna, e la mappa carica prima.
        iconRetinaUrl: '/mappa/marker-icon-2x.png',
        iconUrl:       '/mappa/marker-icon.png',
        shadowUrl:     '/mappa/marker-shadow.png',
      });

      const map = L.map(mapDivRef.current).setView([coords.lat, coords.lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      const marker = L.marker([coords.lat, coords.lng], { draggable: true }).addTo(map);

      const updatePos = (lat: number, lng: number) => {
        setCoords({ lat, lng });
        // 26/11/2026 — Un tocco o un trascinamento fuori da Piacenza e dintorni non è il negozio.
        const buona = dentroLAreaServita(lat, lng);
        setConfermata(buona);
        setAvvisoArea(buona ? null : FRASE_NEGOZIO_FUORI_AREA);
        if (buona) setDaRicercare(false);
        onChange({ address: indirizzoRef.current, lat, lng, confermata: buona });
      };

      marker.on('dragend', () => {
        const p = marker.getLatLng();
        updatePos(p.lat, p.lng);
      });

      map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
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
      // 27/11/2026 — Senza città la ricerca era un testo libero nel riquadro di Piacenza e dintorni:
      // «Via Roma 12» poteva diventare la Via Roma di Podenzano, a 10 km, e si confermava. Se la città
      // manca (dopo l'ultima virgola, come la legge lib/geocodifica.ts, o in fondo al testo) si cerca a Piacenza.
      const testo = address.trim().replace(/,\s*(italia|italy)\s*$/i, '').replace(/[\s,]+$/, '');
      const coda = testo.includes(',') ? testo.slice(testo.lastIndexOf(',') + 1).trim() : '';
      // 28/11/2026 (onda 2, R06-002) — Una lettera qualunque dopo la virgola non è una città: «Via Roma,
      // 12/B», «Via Roma, 12 bis», «Via Roma 12, int. 3» restavano «…, Italia» e potevano confermare
      // la via omonima di un altro comune. La coda è una città se ha il CAP, oppure se ha lettere e
      // non comincia con un numero né con «bis», «ter», «int.», «interno», «scala», «piano».
      const codaECivico = /^\d/.test(coda) || /^(bis|ter|int\.?|interno|scala|sc\.|piano|p\.)(\s|\d|$)/i.test(coda);
      const haCitta = /\d{5}/.test(coda) || (/\p{L}/u.test(coda) && !codaECivico) || /piacenza(\s*\(?pc\)?)?$/i.test(testo);
      // 🟠-15: geocoding via proxy server-side (UA corretto, rate-limit, timeout).
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: `${testo}${haCitta ? '' : ', Piacenza'}, Italia` }),
      });
      // Servizio degli indirizzi giù o limitato (429, 5xx): non è «indirizzo non trovato».
      if (res.status === 429 || res.status >= 500) {
        // 27/11/2026 — Il freno della rotta (`rate_limited`: troppe ricerche da qui in un minuto) non è il
        // servizio che non risponde: si dice che il limite viene dalle ricerche del negozio.
        const corpo = await res.json().catch(() => null);
        setError(
          corpo?.error === 'rate_limited'
            ? 'Hai fatto troppe ricerche di indirizzi in un minuto. Riprova fra poco, o sposta il pin sulla mappa.'
            : 'Il servizio che cerca gli indirizzi non risponde in questo momento. Riprova fra poco, o sposta il pin sulla mappa.',
        );
        return;
      }
      const data = await res.json();
      if (!data || data.lat == null || data.lng == null) {
        setError('Indirizzo non trovato. Prova ad essere più specifico o sposta il pin sulla mappa.');
        return;
      }
      const lat = data.lat as number;
      const lng = data.lng as number;
      if (!isValidLatLng(lat, lng)) {
        setError('Posizione non valida ricevuta dal servizio. Sposta il pin sulla mappa.');
        return;
      }
      const nome = typeof data.nome === 'string' && data.nome.trim() ? data.nome.trim() : null;
      setTrovato(nome);
      // 26/11/2026 — Il primo risultato poteva essere la Via Roma di un'altra città, e si confermava
      // senza guardare dove fosse. Fuori da Piacenza e dintorni non si conferma e non si sposta il
      // segnaposto: si dice cosa è stato trovato e cosa fare.
      if (!dentroLAreaServita(lat, lng)) {
        setAvvisoArea(FRASE_NEGOZIO_FUORI_AREA);
        return;
      }
      setAvvisoArea(null);
      setDaRicercare(false);
      setCoords({ lat, lng });
      setConfermata(true);
      onChange({ address, lat, lng, confermata: true });
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
        setLocating(false);
        // 26/11/2026 — Chi aggiorna il profilo da casa, fuori città, non sposta il negozio lì.
        if (!dentroLAreaServita(newCoords.lat, newCoords.lng)) {
          setAvvisoArea(FRASE_NEGOZIO_FUORI_AREA);
          return;
        }
        setAvvisoArea(null);
        setDaRicercare(false);
        setCoords(newCoords);
        setConfermata(true);
        onChange({ ...newCoords, address: indirizzoRef.current, confermata: true });
      },
      (err) => {
        // Il testo del browser (err.message) arriva in inglese o vuoto: si dice in italiano dal codice.
        setError(
          err.code === 1
            ? 'Il browser non dà il permesso di usare la posizione: attivalo nelle impostazioni, oppure cerca l’indirizzo o tocca la mappa.'
            : 'Impossibile ottenere la posizione in questo momento: riprova, oppure cerca l’indirizzo o tocca la mappa.',
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  };

  return (
    <div className="space-y-3">
      <div>
        {/* L'etichetta si vedeva ma il browser non la associava al campo: senza `htmlFor` e senza
            `id` il nome del campo veniva solo dal segnaposto, che sparisce appena si scrive. E qui
            si scrive l'indirizzo da cui dipende la zona di consegna. */}
        <label htmlFor={idIndirizzo} className="block text-sm font-medium text-ink-700 mb-1">
          {etichetta ?? 'Indirizzo del negozio'}
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id={idIndirizzo}
            type="text"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              indirizzoRef.current = e.target.value;
              // 26/11/2026 — Il testo nuovo partiva con le coordinate vecchie e `confermata` com'era:
              // chi vedeva la mappa nel posto sbagliato e aggiungeva «, Piacenza» senza ripremere
              // «Cerca» salvava le coordinate dell'altra città. Cambiato il testo, la posizione va
              // ridata: con «Cerca» o toccando la mappa.
              if (confermata) setDaRicercare(true);
              setConfermata(false);
              setTrovato(null);
              onChange({ address: e.target.value, lat: coords.lat, lng: coords.lng, confermata: false });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                searchAddress();
              }
            }}
            placeholder="Es. Via Roma 1, Milano"
            className="w-full sm:flex-1 min-w-0 border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-700"
          />
          <Button
            type="button"
            onClick={searchAddress}
            loading={searching}
            size="sm"
          >
            <span className="inline-flex items-center gap-1">
              <Search size={16} aria-hidden />
              Cerca
            </span>
          </Button>
        </div>
      </div>

      {trovato && (
        <p className="text-xs text-ink-600">
          Trovato: <span className="font-medium">{trovato}</span>
        </p>
      )}
      {daRicercare && (
        <p role="status" className="text-sm text-ink-700">
          Hai cambiato l’indirizzo: premi «Cerca» per aggiornare la posizione, oppure tocca la mappa sul negozio.
        </p>
      )}

      <div className="flex justify-between items-center text-sm flex-wrap gap-2">
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="text-primary-700 hover:underline disabled:opacity-50 inline-flex items-center gap-1"
        >
          {locating ? (
            <RadioTower size={16} aria-hidden />
          ) : (
            <Target size={16} aria-hidden />
          )}
          {locating ? 'Ricerca posizione…' : 'Usa la mia posizione attuale'}
        </button>
        <span className="text-xs text-ink-400 font-mono inline-flex items-center gap-1">
          <MapPin size={16} aria-hidden />
          {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
        </span>
      </div>

      {avvisoArea && (
        <p role="alert" className="text-sm font-medium text-secondary-600 bg-secondary-50 border border-secondary-200 rounded p-2">
          {avvisoArea}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-secondary-600 bg-secondary-50 border border-secondary-200 rounded p-2">
          {error}
        </p>
      )}

      <div
        ref={mapDivRef}
        className="w-full h-64 rounded-lg border bg-cream-100 z-0"
      />

      <p className="text-xs text-ink-500 flex items-start gap-1">
        <Lightbulb size={16} aria-hidden className="shrink-0 mt-0.5" />
        <span>Cerca un indirizzo, usa la tua posizione, oppure <strong>trascina il pin</strong> sulla mappa per impostare la posizione esatta del negozio.</span>
      </p>
    </div>
  );
};

export default StoreLocationPicker;
