// ===== Earnings · Availability · Profile =====
function Earnings() {
  const [period, setPeriod] = React.useState('7d');
  const periods = [['today', 'Oggi'], ['7d', '7 giorni'], ['30d', '30 giorni'], ['all', 'Tutto']];
  const k = window.RD_KPI, e7 = window.RD_EARN_7D, max = Math.max(...e7);
  const days = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
  return (
    <div style={{ paddingBottom: '20px' }}>
      <ScreenHead title="Guadagni" sub="Tutto quello che hai incassato" />
      <div style={{ display: 'flex', gap: '6px', padding: '0 16px 14px', overflowX: 'auto' }}>
        {periods.map(([id, l]) => <button key={id} onClick={() => setPeriod(id)} style={{ flexShrink: 0, border: 0, background: period === id ? 'var(--accent-500)' : 'var(--surface-0)', color: period === id ? 'var(--ink-900)' : 'var(--ink-600)', fontWeight: 600, fontSize: '13px', padding: '7px 14px', borderRadius: '999px', cursor: 'pointer', fontFamily: 'var(--font-sans)', boxShadow: period === id ? 'none' : 'inset 0 0 0 1px var(--cream-300)' }}>{l}</button>)}
      </div>

      {/* big number */}
      <div style={{ margin: '0 16px 16px', borderRadius: 'var(--radius-2xl)', padding: '22px', background: 'linear-gradient(135deg, var(--accent-100), var(--cream-200))', border: '1px solid var(--accent-200)' }}>
        <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--accent-800)' }}>Hai guadagnato</p>
        <p style={{ margin: '4px 0 0', fontSize: '46px', fontWeight: 800, color: 'var(--ink-900)', lineHeight: 1 }}>{fmt(k.weekEarned)}</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '16px' }}>
          <div style={{ background: 'rgba(255,255,255,.6)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}><p style={{ margin: 0, fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-500)', fontWeight: 700 }}>Consegne</p><p style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--ink-900)' }}>{k.weekDeliveries}</p></div>
          <div style={{ background: 'rgba(255,255,255,.6)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}><p style={{ margin: 0, fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-500)', fontWeight: 700 }}>Media/consegna</p><p style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--ink-900)' }}>{fmt(k.avgPerDelivery)}</p></div>
        </div>
      </div>

      {/* chart */}
      <div style={{ margin: '0 16px 16px' }}>
        <Card variant="bordered" padding="md">
          <p style={{ margin: '0 0 14px', fontWeight: 700, color: 'var(--ink-900)', fontSize: '14px' }}>Ultimi 7 giorni</p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '110px' }}>
            {e7.map((v, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', height: '100%' }}>
                <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}><div title={fmt(v)} style={{ width: '100%', height: `${(v / max) * 100}%`, minHeight: '5px', background: 'linear-gradient(180deg, var(--accent-400), var(--accent-600))', borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0' }} /></div>
                <span style={{ fontSize: '10px', color: 'var(--ink-400)' }}>{days[i]}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* payouts info */}
      <div style={{ margin: '0 16px' }}>
        <Card variant="flat" padding="md" style={{ background: 'var(--olive-50)', border: '1px solid var(--olive-200)' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <Lucide name="landmark" size={18} color="var(--olive-700)" />
            <div>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--olive-900)' }}>Compensi sul tuo IBAN</p>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--olive-800)', lineHeight: 1.5 }}>Le consegne con carta vengono versate ~24h dopo. I contanti li incassi direttamente alla consegna.</p>
            </div>
          </div>
        </Card>
      </div>

      {/* history */}
      <div style={{ margin: '16px 16px 0' }}>
        <SectionLabel>Storico consegne</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {window.RD_HISTORY.map((h) => (
            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--surface-0)', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-lg)', padding: '12px 14px' }}>
              <span style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--olive-50)', color: 'var(--olive-700)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Lucide name="check" size={17} stroke={2.4} color="var(--olive-700)" /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--ink-900)' }}>{h.store} → {h.cust}</p>
                <p style={{ margin: 0, fontSize: '11px', color: 'var(--ink-400)' }}>{h.when} · {h.pay === 'cod' ? 'Contanti' : 'Carta'}</p>
              </div>
              <span style={{ fontWeight: 700, color: 'var(--olive-700)' }}>{fmt(h.fee)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Availability({ online, onToggle }) {
  const [zones, setZones] = React.useState(window.RD_ZONES);
  const toggleZone = (i) => setZones((z) => z.map((x, j) => j === i ? { ...x, on: !x.on } : x));
  return (
    <div style={{ paddingBottom: '20px' }}>
      <ScreenHead title="Turni & zone" sub="Quando e dove vuoi consegnare" />
      <div style={{ margin: '0 16px 16px' }}>
        <Card variant="bordered" padding="md">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div><p style={{ margin: 0, fontWeight: 700, color: 'var(--ink-900)' }}>Stato</p><p style={{ margin: 0, fontSize: '13px', color: 'var(--ink-500)' }}>{online ? 'Online · ricevi consegne' : 'Offline'}</p></div>
            <button onClick={onToggle} style={{ border: 0, cursor: 'pointer', width: '52px', height: '30px', borderRadius: '999px', background: online ? 'var(--olive-500)' : 'var(--cream-300)', position: 'relative' }}><span style={{ position: 'absolute', top: '3px', left: online ? '25px' : '3px', width: '24px', height: '24px', borderRadius: '50%', background: '#fff', transition: 'left var(--dur-base)', boxShadow: 'var(--shadow-sm)' }} /></button>
          </div>
        </Card>
      </div>
      <div style={{ margin: '0 16px 16px' }}>
        <SectionLabel>Zone preferite</SectionLabel>
        <p style={{ margin: '-4px 0 12px', fontSize: '12px', color: 'var(--ink-500)' }}>Ricevi prima le consegne in queste zone.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {zones.map((z, i) => (
            <button key={z.name} onClick={() => toggleZone(i)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-0)', border: `1.5px solid ${z.on ? 'var(--primary-400)' : 'var(--cream-300)'}`, borderRadius: 'var(--radius-lg)', padding: '12px 14px', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 600, color: 'var(--ink-900)' }}><Lucide name="map-pin" size={15} color={z.on ? 'var(--primary-600)' : 'var(--ink-400)'} /> {z.name}</span>
              <Lucide name={z.on ? 'check-circle-2' : 'circle'} size={20} color={z.on ? 'var(--primary-600)' : 'var(--ink-300)'} />
            </button>
          ))}
        </div>
      </div>
      <div style={{ margin: '0 16px' }}>
        <SectionLabel>Orari di punta</SectionLabel>
        <Card variant="flat" padding="md" style={{ background: 'var(--primary-50)', border: '1px solid var(--primary-100)' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <Lucide name="trending-up" size={18} color="var(--primary-700)" />
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--primary-900)', lineHeight: 1.5 }}>Più consegne tra le <strong>12–14</strong> e le <strong>19–21</strong>. Tieni la disponibilità ON nei picchi per guadagnare di più.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Profile() {
  const r = window.RD_RIDER;
  return (
    <div style={{ paddingBottom: '20px' }}>
      <div style={{ padding: '24px 20px', textAlign: 'center', background: 'linear-gradient(135deg, var(--primary-700), var(--secondary-700))', color: '#fff' }}>
        <span style={{ width: '72px', height: '72px', borderRadius: '50%', background: 'rgba(255,255,255,.18)', border: '3px solid rgba(255,255,255,.3)', color: '#fff', fontWeight: 800, fontSize: '26px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{r.initials}</span>
        <p style={{ margin: '12px 0 0', fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 800 }}>{r.name}</p>
        <p style={{ margin: '2px 0 0', fontSize: '13px', opacity: 0.85, display: 'inline-flex', alignItems: 'center', gap: '5px' }}><Lucide name="star" size={14} color="var(--accent-300)" /> {String(r.rating).replace('.', ',')} · {r.deliveries} consegne</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', padding: '16px' }}>
        <InfoTile icon="bike" label="Veicolo" value={r.vehicle} />
        <InfoTile icon="map-pin" label="Zona base" value={r.zone} />
      </div>
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {[['user', 'Dati personali'], ['landmark', 'IBAN e compensi'], ['bell', 'Notifiche'], ['shield-check', 'Documenti'], ['life-buoy', 'Assistenza'], ['log-out', 'Esci']].map(([ic, l]) => (
          <button key={l} style={{ display: 'flex', alignItems: 'center', gap: '12px', border: 0, borderBottom: '1px solid var(--cream-200)', background: 'transparent', padding: '14px 4px', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '15px', color: l === 'Esci' ? 'var(--secondary-600)' : 'var(--ink-800)', textAlign: 'left', width: '100%' }}>
            <Lucide name={ic} size={19} color={l === 'Esci' ? 'var(--secondary-600)' : 'var(--ink-500)'} /> <span style={{ flex: 1 }}>{l}</span>
            {l !== 'Esci' && <Lucide name="chevron-right" size={17} color="var(--ink-300)" />}
          </button>
        ))}
      </div>
    </div>
  );
}
function InfoTile({ icon, label, value }) {
  return (
    <div style={{ background: 'var(--surface-0)', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-lg)', padding: '14px' }}>
      <Lucide name={icon} size={18} color="var(--primary-600)" />
      <p style={{ margin: '8px 0 0', fontSize: '11px', color: 'var(--ink-400)', textTransform: 'uppercase', fontWeight: 700 }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: '14px', fontWeight: 600, color: 'var(--ink-900)' }}>{value}</p>
    </div>
  );
}
