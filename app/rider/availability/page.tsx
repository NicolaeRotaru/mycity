'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Calendar, MapPin, CheckCircle2, Circle, Plus, Save, TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { LoadingState } from '@/components/ui/LoadingState';
import { Card } from '@/components/ui/Card';

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

type Availability = {
  online: boolean;
  schedule: Record<DayKey, { enabled: boolean; from: string; to: string }>;
};

const DAYS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Lunedì' },
  { key: 'tue', label: 'Martedì' },
  { key: 'wed', label: 'Mercoledì' },
  { key: 'thu', label: 'Giovedì' },
  { key: 'fri', label: 'Venerdì' },
  { key: 'sat', label: 'Sabato' },
  { key: 'sun', label: 'Domenica' },
];

const DEFAULT_SCHEDULE: Availability['schedule'] = {
  mon: { enabled: true, from: '12:00', to: '14:00' },
  tue: { enabled: true, from: '12:00', to: '14:00' },
  wed: { enabled: true, from: '12:00', to: '14:00' },
  thu: { enabled: true, from: '12:00', to: '14:00' },
  fri: { enabled: true, from: '12:00', to: '14:00' },
  sat: { enabled: false, from: '12:00', to: '14:00' },
  sun: { enabled: false, from: '12:00', to: '14:00' },
};

const DEFAULT_AVAIL: Availability = { online: false, schedule: DEFAULT_SCHEDULE };

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
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [avail, setAvail] = useState<Availability>(DEFAULT_AVAIL);
  const [zones, setZones] = useState<string[]>([]);
  const [customZone, setCustomZone] = useState('');

  // Carica la disponibilità persistita dal profilo del rider.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);
      const { data } = await supabase
        .from('profiles')
        .select('rider_is_online, rider_schedule, rider_zones')
        .eq('id', user.id)
        .single();
      if (data) {
        setAvail({
          online: !!data.rider_is_online,
          schedule: (data.rider_schedule as Availability['schedule'] | null) ?? DEFAULT_SCHEDULE,
        });
        setZones((data.rider_zones as string[] | null) ?? []);
      }
      setLoading(false);
    })();
  }, []);

  const persist = async (patch: Record<string, unknown>) => {
    if (!userId) return;
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
    if (error) toast.error('Errore nel salvataggio. Riprova.');
  };

  const save = (next: Availability, silent = false) => {
    setAvail(next);
    void persist({ rider_is_online: next.online, rider_schedule: next.schedule });
    if (!silent) toast.success('Preferenze salvate');
  };

  const saveZones = (next: string[]) => {
    setZones(next);
    void persist({ rider_zones: next });
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

  if (loading) return <LoadingState />;

  return (
    <div className="pb-5">
      {/* ScreenHead */}
      <div className="px-5 pb-2 pt-4">
        <h1 className="font-serif text-[26px] font-extrabold text-ink-900">Turni & zone</h1>
        <p className="mt-0.5 text-[13px] text-ink-500">Quando e dove vuoi consegnare</p>
      </div>

      {/* Stato online — switch iOS */}
      <div className="px-4 pb-4">
        <Card variant="bordered" padding="md">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-ink-900">Stato</p>
              <p className="text-[13px] text-ink-500">{avail.online ? 'Online · ricevi consegne' : 'Offline'}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={avail.online}
              aria-label={avail.online ? 'Vai offline' : 'Vai online'}
              onClick={() => save({ ...avail, online: !avail.online })}
              className={`relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors ${
                avail.online ? 'bg-olive-500' : 'bg-cream-300'
              }`}
            >
              <span
                className="absolute top-[3px] h-6 w-6 rounded-full bg-white shadow-sm transition-all"
                style={{ left: avail.online ? '25px' : '3px' }}
              />
            </button>
          </div>
        </Card>
      </div>

      {/* Zone preferite */}
      <div className="px-4 pb-4">
        <p className="mb-1 text-[13px] font-bold uppercase tracking-[0.03em] text-ink-700">Zone preferite</p>
        <p className="mb-3 text-xs text-ink-500">Ricevi prima le consegne in queste zone. Max 6.</p>
        <div className="flex flex-col gap-2">
          {SUGGESTED_ZONES.map((z) => {
            const active = zones.includes(z);
            return (
              <button
                key={z}
                type="button"
                onClick={() => toggleZone(z)}
                aria-pressed={active}
                className={`flex items-center justify-between rounded-lg border bg-surface-0 px-3.5 py-3 transition-colors ${
                  active ? 'border-primary-400' : 'border-cream-300'
                }`}
              >
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <MapPin size={15} className={active ? 'text-primary-600' : 'text-ink-400'} aria-hidden /> {z}
                </span>
                {active
                  ? <CheckCircle2 size={20} className="text-primary-600" aria-hidden />
                  : <Circle size={20} className="text-ink-300" aria-hidden />}
              </button>
            );
          })}
        </div>

        {/* Zona personalizzata */}
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={customZone}
            onChange={(e) => setCustomZone(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomZone(); } }}
            placeholder="Aggiungi una zona…"
            maxLength={40}
            aria-label="Aggiungi una zona personalizzata"
            className="min-w-0 flex-1 rounded-lg border border-cream-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
          <button
            type="button"
            onClick={addCustomZone}
            disabled={!customZone.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-primary-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-primary-800 disabled:opacity-40"
          >
            <Plus size={15} strokeWidth={2.4} aria-hidden /> Aggiungi
          </button>
        </div>
        {zones.length > 0 && (
          <p className="mt-2 text-xs text-ink-500">Selezionate: {zones.length}/6</p>
        )}
      </div>

      {/* Orari preferiti (promemoria personale) */}
      <div className="px-4 pb-4">
        <p className="mb-2.5 flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-[0.03em] text-ink-700">
          <Calendar size={15} aria-hidden /> Orari preferiti
        </p>
        <Card variant="bordered" padding="md">
          <p className="mb-3 text-xs text-ink-500">
            Le tue fasce orarie preferite (promemoria). Per ricevere consegne ricordati di metterti <strong>online</strong>.
          </p>
          <div className="flex flex-col gap-2">
            {DAYS.map((d) => {
              const cfg = avail.schedule[d.key];
              return (
                <div
                  key={d.key}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-2.5 ${
                    cfg.enabled ? 'border-cream-300 bg-surface-0' : 'border-cream-200 bg-cream-50 opacity-60'
                  }`}
                >
                  <label className="flex w-24 shrink-0 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={cfg.enabled}
                      onChange={(e) => save({
                        ...avail,
                        schedule: { ...avail.schedule, [d.key]: { ...cfg, enabled: e.target.checked } },
                      }, true)}
                      className="h-4 w-4 rounded text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-[13px] font-semibold">{d.label}</span>
                  </label>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      type="time"
                      value={cfg.from}
                      disabled={!cfg.enabled}
                      aria-label={`${d.label} dalle`}
                      onChange={(e) => save({
                        ...avail,
                        schedule: { ...avail.schedule, [d.key]: { ...cfg, from: e.target.value } },
                      }, true)}
                      className="min-w-0 flex-1 rounded border border-cream-300 px-2 py-1 text-sm disabled:bg-cream-100"
                    />
                    <span className="shrink-0 text-sm text-ink-400">→</span>
                    <input
                      type="time"
                      value={cfg.to}
                      disabled={!cfg.enabled}
                      aria-label={`${d.label} alle`}
                      onChange={(e) => save({
                        ...avail,
                        schedule: { ...avail.schedule, [d.key]: { ...cfg, to: e.target.value } },
                      }, true)}
                      className="min-w-0 flex-1 rounded border border-cream-300 px-2 py-1 text-sm disabled:bg-cream-100"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Orari di punta */}
      <div className="px-4 pb-4">
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.03em] text-ink-700">Orari di punta</p>
        <Card variant="flat" padding="md" className="border border-primary-100 bg-primary-50">
          <div className="flex items-start gap-2.5">
            <TrendingUp size={18} className="shrink-0 text-primary-700" aria-hidden />
            <p className="text-[13px] leading-relaxed text-primary-900">
              Più consegne tra le <strong>12–14</strong> e le <strong>19–21</strong>. Tieni la disponibilità ON nei picchi per guadagnare di più.
            </p>
          </div>
        </Card>
      </div>

      <div className="px-4">
        <div className="flex items-center gap-1.5 rounded-lg border border-olive-200 bg-olive-50 p-3.5 text-[13px] text-olive-900">
          <Save size={16} strokeWidth={2.2} className="shrink-0" aria-hidden /> Le preferenze sono salvate sul tuo profilo e sincronizzate su tutti i dispositivi.
        </div>
      </div>
    </div>
  );
}
