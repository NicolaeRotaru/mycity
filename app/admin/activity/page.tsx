'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Eye, Clock, Globe, Smartphone, Tablet, Monitor, Bot, Users, Activity,
  LogIn, ShoppingBag, Package, MessageSquare, ShieldAlert, Cpu, Radio,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';

type EventRow = {
  id: string;
  category: string;
  event_type: string;
  action: string | null;
  summary: string | null;
  actor_id: string | null;
  user_id: string | null;
  anon_id: string | null;
  session_id: string | null;
  target_table: string | null;
  target_id: string | null;
  path: string | null;
  referrer: string | null;
  ip: string | null;
  user_agent: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  country: string | null;
  city: string | null;
  is_bot: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  user: { full_name: string | null; email: string | null } | null;
};

const CATEGORY_META: Record<string, { label: string; icon: typeof Eye; color: string }> = {
  visitor:    { label: 'Visitatori',  icon: Globe,        color: 'sky' },
  auth:       { label: 'Accessi',     icon: LogIn,        color: 'violet' },
  commerce:   { label: 'Commercio',   icon: ShoppingBag,  color: 'emerald' },
  catalog:    { label: 'Catalogo',    icon: Package,      color: 'amber' },
  content:    { label: 'Contenuti',   icon: MessageSquare,color: 'pink' },
  user:       { label: 'Utenti',      icon: Users,        color: 'indigo' },
  moderation: { label: 'Moderazione', icon: ShieldAlert,  color: 'rose' },
  system:     { label: 'Sistema',     icon: Cpu,          color: 'slate' },
};

const DEVICE_ICON: Record<string, typeof Eye> = {
  mobile: Smartphone, tablet: Tablet, desktop: Monitor, bot: Bot,
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const SELECT = `
  id, category, event_type, action, summary, actor_id, user_id, anon_id, session_id,
  target_table, target_id, path, referrer, ip, user_agent, device_type, browser, os,
  country, city, is_bot, metadata, created_at,
  user:profiles!activity_events_user_id_fkey ( full_name, email )
`;

export default function AdminActivityPage() {
  const [tab, setTab] = useState<'feed' | 'visitors'>('feed');
  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [hideBots, setHideBots] = useState(true);

  // ---- Feed principale (live) -------------------------------------------------
  const { data: rows = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.activity({ category, hideBots }),
    refetchInterval: 15_000,
    queryFn: async (): Promise<EventRow[]> => {
      let q = supabase
        .from('activity_events')
        .select(SELECT)
        .order('created_at', { ascending: false })
        .limit(300);
      if (category) q = q.eq('category', category);
      if (hideBots) q = q.eq('is_bot', false);
      const { data } = await q;
      return (data ?? []) as unknown as EventRow[];
    },
  });

  // ---- Sintesi ultime 24h (aggregazione client-side) --------------------------
  const { data: recent = [] } = useQuery({
    queryKey: queryKeys.admin.activitySummary,
    refetchInterval: 30_000,
    queryFn: async (): Promise<EventRow[]> => {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data } = await supabase
        .from('activity_events')
        .select(SELECT)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(3000);
      return (data ?? []) as unknown as EventRow[];
    },
  });

  const summary = useMemo(() => {
    const realtime = recent.filter((r) => !r.is_bot);
    const now = Date.now();
    const fiveMin = now - 5 * 60_000;
    const onlineSet = new Set<string>();
    const uniqueVisitors = new Set<string>();
    const byCategory: Record<string, number> = {};
    const byDevice: Record<string, number> = {};
    let logins = 0;
    let loggedInViews = 0;
    let anonViews = 0;

    for (const r of realtime) {
      const visitorKey = r.anon_id || r.session_id || r.ip || r.id;
      if (new Date(r.created_at).getTime() >= fiveMin) onlineSet.add(visitorKey);
      uniqueVisitors.add(visitorKey);
      byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
      if (r.category === 'visitor' && r.event_type === 'page_view') {
        if (r.user_id) loggedInViews++; else anonViews++;
        if (r.device_type) byDevice[r.device_type] = (byDevice[r.device_type] ?? 0) + 1;
      }
      if (r.event_type === 'login') logins++;
    }

    const topPaths = Object.entries(
      realtime
        .filter((r) => r.path)
        .reduce<Record<string, number>>((acc, r) => {
          acc[r.path as string] = (acc[r.path as string] ?? 0) + 1;
          return acc;
        }, {}),
    ).sort((a, b) => b[1] - a[1]).slice(0, 6);

    const topIps = Object.entries(
      realtime
        .filter((r) => r.ip)
        .reduce<Record<string, number>>((acc, r) => {
          acc[r.ip as string] = (acc[r.ip as string] ?? 0) + 1;
          return acc;
        }, {}),
    ).sort((a, b) => b[1] - a[1]).slice(0, 6);

    return {
      online: onlineSet.size,
      uniqueVisitors: uniqueVisitors.size,
      logins,
      loggedInViews,
      anonViews,
      byCategory,
      byDevice,
      topPaths,
      topIps,
    };
  }, [recent]);

  // ---- Vista visitatori (raggruppa per anon_id/ip) ----------------------------
  const visitors = useMemo(() => {
    const map = new Map<string, {
      key: string; ip: string | null; device: string | null; browser: string | null;
      os: string | null; country: string | null; pages: number; first: string; last: string;
      loggedIn: boolean; userLabel: string | null;
    }>();
    for (const r of recent) {
      if (hideBots && r.is_bot) continue;
      const key = r.anon_id || r.ip || r.session_id || r.id;
      const existing = map.get(key);
      const label = r.user?.full_name ?? r.user?.email ?? null;
      if (!existing) {
        map.set(key, {
          key, ip: r.ip, device: r.device_type, browser: r.browser, os: r.os,
          country: r.country, pages: r.event_type === 'page_view' ? 1 : 0,
          first: r.created_at, last: r.created_at,
          loggedIn: !!r.user_id, userLabel: label,
        });
      } else {
        if (r.event_type === 'page_view') existing.pages++;
        if (r.created_at < existing.first) existing.first = r.created_at;
        if (r.created_at > existing.last) existing.last = r.created_at;
        if (r.user_id) { existing.loggedIn = true; existing.userLabel = label ?? existing.userLabel; }
        existing.ip = existing.ip ?? r.ip;
        existing.device = existing.device ?? r.device_type;
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.last > b.last ? -1 : 1)).slice(0, 100);
  }, [recent, hideBots]);

  const filteredRows = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.ip ?? '').toLowerCase().includes(s) ||
      (r.anon_id ?? '').toLowerCase().includes(s) ||
      (r.user?.email ?? '').toLowerCase().includes(s) ||
      (r.user?.full_name ?? '').toLowerCase().includes(s) ||
      (r.summary ?? '').toLowerCase().includes(s) ||
      (r.path ?? '').toLowerCase().includes(s),
    );
  }, [rows, search]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-ink-500 hover:text-ink-800">← Dashboard admin</Link>
        <h1 className="text-3xl font-serif font-bold mt-2 text-ink-900 flex items-center gap-2">
          <Eye size={26} className="text-primary-600" />
          Sorveglianza
        </h1>
        <p className="text-sm text-ink-500 mt-1">
          Tutto ciò che accade sulla piattaforma in tempo reale: visite (anche anonime), accessi,
          ordini, modifiche. Aggiornamento automatico ogni 15s.
        </p>
      </div>

      {/* KPI in tempo reale */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi icon={Radio} label="Online ora" value={summary.online} color="emerald" hint="ultimi 5 min" />
        <Kpi icon={Users} label="Visitatori 24h" value={summary.uniqueVisitors} color="sky" />
        <Kpi icon={LogIn} label="Accessi 24h" value={summary.logins} color="violet" />
        <Kpi icon={Globe} label="Viste anonime" value={summary.anonViews} color="amber" />
        <Kpi icon={Activity} label="Viste loggati" value={summary.loggedInViews} color="indigo" />
      </div>

      {/* Categorie (clic per filtrare) */}
      <div>
        <h2 className="font-bold text-ink-900 mb-2 text-sm">Categorie (ultime 24h)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {Object.entries(CATEGORY_META).map(([key, meta]) => {
            const Icon = meta.icon;
            const active = category === key;
            return (
              <button
                key={key}
                onClick={() => { setCategory(active ? '' : key); setTab('feed'); }}
                className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  active ? 'border-primary-400 bg-primary-50' : 'border-cream-300 bg-white hover:bg-cream-50'
                }`}
              >
                <Icon size={16} className={`text-${meta.color}-600`} strokeWidth={2.2} aria-hidden />
                <span className="text-lg font-bold text-ink-900 leading-none">{summary.byCategory[key] ?? 0}</span>
                <span className="text-[11px] text-ink-500 truncate w-full">{meta.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Device + top liste */}
      <div className="grid md:grid-cols-3 gap-3">
        <Panel title="Dispositivi (viste 24h)">
          {Object.keys(summary.byDevice).length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-1.5">
              {Object.entries(summary.byDevice).sort((a, b) => b[1] - a[1]).map(([d, n]) => {
                const Icon = DEVICE_ICON[d] ?? Monitor;
                return (
                  <li key={d} className="flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-1.5 text-ink-700 capitalize">
                      <Icon size={14} aria-hidden /> {d}
                    </span>
                    <span className="font-bold text-ink-900">{n}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Pagine più viste">
          {summary.topPaths.length === 0 ? <Empty /> : (
            <ul className="space-y-1.5">
              {summary.topPaths.map(([p, n]) => (
                <li key={p} className="flex items-center justify-between text-sm gap-2">
                  <span className="text-ink-700 truncate">{p}</span>
                  <span className="font-bold text-ink-900 shrink-0">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="IP più attivi">
          {summary.topIps.length === 0 ? <Empty /> : (
            <ul className="space-y-1.5">
              {summary.topIps.map(([ip, n]) => (
                <li key={ip} className="flex items-center justify-between text-sm gap-2">
                  <button onClick={() => { setSearch(ip); setTab('feed'); }} className="text-primary-700 hover:underline truncate font-mono text-xs">{ip}</button>
                  <span className="font-bold text-ink-900 shrink-0">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Tabs + filtri */}
      <div className="flex items-center justify-between flex-wrap gap-3 border-b border-cream-200 pb-2">
        <div className="flex gap-1">
          {(['feed', 'visitors'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                tab === t ? 'bg-primary-600 text-white' : 'text-ink-600 hover:bg-cream-100'
              }`}
            >
              {t === 'feed' ? 'Feed eventi' : 'Visitatori'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca IP, utente, pagina…"
            className="bg-cream-50 border border-cream-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 w-48"
          />
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer">
            <input type="checkbox" checked={hideBots} onChange={(e) => setHideBots(e.target.checked)} />
            Nascondi bot
          </label>
        </div>
      </div>

      {tab === 'feed' ? (
        isLoading ? (
          <div className="space-y-2">{[...Array(8)].map((_, i) => <div key={i} className="h-14 rounded-xl skeleton" />)}</div>
        ) : filteredRows.length === 0 ? (
          <div className="bg-white border border-cream-300 rounded-2xl p-12 text-center">
            <Clock size={36} className="mx-auto text-ink-300 mb-3" />
            <p className="text-ink-600 font-medium">Nessun evento</p>
            <p className="text-sm text-ink-400 mt-1">Gli eventi compariranno qui in tempo reale.</p>
          </div>
        ) : (
          <div className="bg-white border border-cream-300 rounded-2xl divide-y divide-cream-200 overflow-hidden">
            {filteredRows.map((r) => <FeedRow key={r.id} row={r} />)}
          </div>
        )
      ) : (
        <div className="bg-white border border-cream-300 rounded-2xl overflow-hidden">
          <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2 bg-cream-50 text-xs font-semibold text-ink-600">
            <span className="col-span-3">Visitatore</span>
            <span className="col-span-2">IP</span>
            <span className="col-span-2">Dispositivo</span>
            <span className="col-span-1 text-right">Pagine</span>
            <span className="col-span-2">Prima</span>
            <span className="col-span-2">Ultima</span>
          </div>
          <div className="divide-y divide-cream-200">
            {visitors.length === 0 ? <div className="p-8 text-center text-ink-500 text-sm">Nessun visitatore.</div> :
              visitors.map((v) => (
                <div key={v.key} className="px-4 py-3 grid md:grid-cols-12 gap-1 md:gap-2 text-sm items-center hover:bg-cream-50">
                  <div className="md:col-span-3 min-w-0">
                    {v.loggedIn ? (
                      <span className="font-semibold text-ink-900 truncate block">👤 {v.userLabel ?? 'Utente'}</span>
                    ) : (
                      <span className="text-ink-500 truncate block">Anonimo · {v.key.slice(0, 8)}…</span>
                    )}
                  </div>
                  <div className="md:col-span-2 font-mono text-xs text-ink-600 truncate">{v.ip ?? '—'}</div>
                  <div className="md:col-span-2 text-ink-600 capitalize truncate">
                    {v.device ?? '—'}{v.browser ? ` · ${v.browser}` : ''}{v.country ? ` · ${v.country}` : ''}
                  </div>
                  <div className="md:col-span-1 md:text-right font-bold text-ink-900">{v.pages}</div>
                  <div className="md:col-span-2 text-xs text-ink-400">{formatDateTime(v.first)}</div>
                  <div className="md:col-span-2 text-xs text-ink-400">{formatDateTime(v.last)}</div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, color, hint }: { icon: typeof Eye; label: string; value: number; color: string; hint?: string }) {
  return (
    <div className={`bg-white border-2 border-${color}-200 rounded-xl p-4`}>
      <div className="flex items-center justify-between">
        <Icon size={18} className={`text-${color}-600`} aria-hidden />
        {hint && <span className="text-[10px] uppercase tracking-wide text-ink-400">{hint}</span>}
      </div>
      <p className="text-2xl font-bold text-ink-900 mt-1">{value}</p>
      <p className="text-xs text-ink-500">{label}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-cream-300 rounded-xl p-4">
      <h3 className="text-xs font-bold text-ink-700 mb-2 uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-ink-400">Nessun dato.</p>;
}

function FeedRow({ row: r }: { row: EventRow }) {
  const meta = CATEGORY_META[r.category] ?? CATEGORY_META.system;
  const Icon = meta.icon;
  const DeviceIcon = r.device_type ? (DEVICE_ICON[r.device_type] ?? null) : null;
  const who = r.user?.full_name ?? r.user?.email ?? (r.anon_id ? `Anonimo ${r.anon_id.slice(0, 6)}…` : 'sistema');
  return (
    <div className="px-4 py-3 hover:bg-cream-50 transition-colors">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex items-start gap-2">
          <span className={`mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-lg bg-${meta.color}-100 shrink-0`}>
            <Icon size={13} className={`text-${meta.color}-700`} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-ink-900 text-sm">{r.summary ?? r.event_type}</p>
            <p className="text-xs text-ink-500 flex items-center gap-1.5 flex-wrap">
              <span className="font-medium">{who}</span>
              {r.is_bot && <span className="px-1.5 rounded bg-cream-200 text-ink-500">bot</span>}
              {r.ip && <span className="font-mono">{r.ip}</span>}
              {DeviceIcon && <span className="inline-flex items-center gap-0.5"><DeviceIcon size={11} />{r.browser ?? r.device_type}</span>}
              {r.country && <span>{r.country}</span>}
            </p>
          </div>
        </div>
        <span className="text-xs text-ink-400 shrink-0">{formatDateTime(r.created_at)}</span>
      </div>
      {r.metadata && Object.keys(r.metadata).length > 0 && (
        <details className="mt-1.5 ml-8">
          <summary className="text-xs text-ink-500 cursor-pointer hover:text-ink-700">Dettagli</summary>
          <pre className="mt-1 text-xs bg-cream-50 border border-cream-200 rounded p-2 overflow-x-auto">
            {JSON.stringify(r.metadata, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
