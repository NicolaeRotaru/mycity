'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

const AVAIL_KEY = 'mycity_rider_availability';
const ZONES_KEY = 'mycity_rider_zones';

type Availability = {
  online: boolean;
  schedule: Record<DayKey, { enabled: boolean; from: string; to: string }>;
};

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
const DAYS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Lunedì' },
  { key: 'tue', label: 'Martedì' },
  { key: 'wed', label: 'Mercoledì' },
  { key: 'thu', label: 'Giovedì' },
  { key: 'fri', label: 'Venerdì' },
  { key: 'sat', label: 'Sabato' },
  { key: 'sun', label: 'Domenica' },
];

const DEFAULT_AVAIL: Availability = {
  online: false,
  schedule: {
    mon: { enabled: true, from: '12:00', to: '14:00' },
    tue: { enabled: true, from: '12:00', to: '14:00' },
    wed: { enabled: true, from: '12:00', to: '14:00' },
    thu: { enabled: true, from: '12:00', to: '14:00' },
    fri: { enabled: true, from: '12:00', to: '14:00' },
    sat: { enabled: false, from: '12:00', to: '14:00' },
    sun: { enabled: false, from: '12:00', to: '14:00' },
  },
};

const SUGGESTED_ZONES = [
  'Centro storico',
  'Stazione',
  'Borgo Faxhall',
  'San Lazzaro',
  'Roma',
  'Manfredi',
  'Besurica',
  'Farnesiana',
];

export default function RiderAvailabilityPage() {
  const [avail, setAvail] = useState<Availability>(DEFAULT_AVAIL);
  const [zones, setZones] = useState<string[]>([]);
  const [customZone, setCustomZone] = useState('');

  useEffect(() => {
    try {
      const a = localStorage.getItem(AVAIL_KEY);
      if (a) setAvail({ ...DEFAULT_AVAIL, ...JSON.parse(a) });
    } catch {}
    try {
      const z = localStorage.getItem(ZONES_KEY);
      if (z) setZones(JSON.parse(z));
    } catch {}
  }, []);

  const save = (next: Availability, silent = false) => {
    setAvail(next);
    localStorage.setItem(AVAIL_KEY, JSON.stringify(next));
    if (!silent) toast.success('Preferenze salvate');
  };

  const saveZones = (next: string[]) => {
    setZones(next);
    localStorage.setItem(ZONES_KEY, JSON.stringify(next));
  };

  const toggleZone = (zone: string) => {
    if (zones.includes(zone)) {
      saveZones(zones.filter((z) => z !== zone));
    } else {
      if (zones.length >= 6) {
        toast.error('Massimo 6 zone preferite');
        return;
      }
      saveZones([...zones, zone]);
    }
  };

  const addCustomZone = () => {
    const z = customZone.trim();
    if (!z) return;
    if (zones.includes(z)) { toast.error('Zona già presente'); return; }
    if (zones.length >= 6) { toast.error('Massimo 6 zone'); return; }
    saveZones([...zones, z]);
    setCustomZone('');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900">🟢 Disponibilità</h1>
        <p className="text-sm text-gray-500">Imposta quando e dove vuoi ricevere consegne.</p>
      </div>

      {/* Online toggle */}
      <section className={`border-2 rounded-2xl p-6 transition-colors ${
        avail.online
          ? 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-300'
          : 'bg-gray-50 border-gray-200'
      }`}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className={`relative inline-flex h-3 w-3 ${avail.online ? '' : 'opacity-30'}`}>
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${avail.online ? 'bg-emerald-400' : 'bg-gray-300'} opacity-75`} />
              <span className={`relative inline-flex rounded-full h-3 w-3 ${avail.online ? 'bg-emerald-500' : 'bg-gray-400'}`} />
            </span>
            <div>
              <p className="text-xl font-extrabold text-gray-900">
                {avail.online ? 'Sei online' : 'Sei offline'}
              </p>
              <p className="text-xs text-gray-600">
                {avail.online
                  ? 'Stai ricevendo proposte di consegna'
                  : 'Non riceverai proposte fino a quando non ti metterai online'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => save({ ...avail, online: !avail.online })}
            className={`px-6 py-3 rounded-xl font-bold text-white text-base shadow transition-all ${
              avail.online
                ? 'bg-rose-500 hover:bg-rose-600'
                : 'bg-emerald-500 hover:bg-emerald-600 hover:scale-105'
            }`}
          >
            {avail.online ? '⏸ Vai offline' : '▶ Vai online'}
          </button>
        </div>
      </section>

      {/* Settimanale */}
      <section className="bg-white border rounded-xl p-5">
        <h2 className="font-bold text-gray-900 mb-4">📅 Orari preferiti</h2>
        <p className="text-xs text-gray-500 mb-4">
          Indica quando preferisci lavorare. Riceverai notifiche solo in quegli orari (anche se sei offline manuale).
        </p>
        <div className="space-y-2">
          {DAYS.map((d) => {
            const cfg = avail.schedule[d.key];
            return (
              <div key={d.key} className={`flex items-center gap-3 p-3 rounded-lg border ${cfg.enabled ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
                <label className="flex items-center gap-2 w-32 shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cfg.enabled}
                    onChange={(e) => save({
                      ...avail,
                      schedule: { ...avail.schedule, [d.key]: { ...cfg, enabled: e.target.checked } },
                    }, true)}
                    className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500"
                  />
                  <span className="font-semibold text-sm">{d.label}</span>
                </label>
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="time"
                    value={cfg.from}
                    disabled={!cfg.enabled}
                    onChange={(e) => save({
                      ...avail,
                      schedule: { ...avail.schedule, [d.key]: { ...cfg, from: e.target.value } },
                    }, true)}
                    className="border rounded px-2 py-1 text-sm disabled:bg-gray-100"
                  />
                  <span className="text-gray-400 text-sm">→</span>
                  <input
                    type="time"
                    value={cfg.to}
                    disabled={!cfg.enabled}
                    onChange={(e) => save({
                      ...avail,
                      schedule: { ...avail.schedule, [d.key]: { ...cfg, to: e.target.value } },
                    }, true)}
                    className="border rounded px-2 py-1 text-sm disabled:bg-gray-100"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Zone preferite */}
      <section className="bg-white border rounded-xl p-5">
        <h2 className="font-bold text-gray-900 mb-2">📍 Zone preferite</h2>
        <p className="text-xs text-gray-500 mb-4">
          Riceverai prima le consegne in queste zone. Max 6. Lascia vuoto per ricevere ovunque.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          {SUGGESTED_ZONES.map((z) => {
            const active = zones.includes(z);
            return (
              <button
                key={z}
                type="button"
                onClick={() => toggleZone(z)}
                className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                  active
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-amber-400'
                }`}
              >
                {active ? '✓ ' : '+ '}{z}
              </button>
            );
          })}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={customZone}
            onChange={(e) => setCustomZone(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomZone(); } }}
            placeholder="Aggiungi una zona personalizzata…"
            maxLength={40}
            className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <button
            type="button"
            onClick={addCustomZone}
            disabled={!customZone.trim()}
            className="bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-semibold"
          >
            Aggiungi
          </button>
        </div>

        {zones.length > 0 && (
          <div className="mt-3 text-xs text-gray-500">
            Selezionate: {zones.length}/6
          </div>
        )}
      </section>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
        💡 Le preferenze sono salvate localmente. Per sincronizzarle tra dispositivi, completa il tuo{' '}
        <Link href="/rider/profile" className="font-bold underline">profilo rider</Link>.
      </div>
    </div>
  );
}
