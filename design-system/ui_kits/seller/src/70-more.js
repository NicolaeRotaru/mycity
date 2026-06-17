// ===== Promotions · Reviews · Customers =====
function Promotions({ onNew }) {
  const promos = window.SC_PROMOS;
  return (
    <div>
      <PageTitle title="Promozioni" sub="Sconti e offerte a tempo per i tuoi prodotti"
        action={<Button variant="primary" icon="plus" onClick={onNew}>Nuova promo</Button>} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {promos.map((p) => (
          <Card key={p.id} variant="bordered" padding="lg">
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <span style={{ width: '48px', height: '48px', borderRadius: 'var(--radius-md)', background: p.active ? 'var(--secondary-100)' : 'var(--surface-100)', color: p.active ? 'var(--secondary-600)' : 'var(--ink-400)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Lucide name={p.type === 'shipping' ? 'truck' : 'tag'} size={22} stroke={2.2} color={p.active ? 'var(--secondary-600)' : 'var(--ink-400)'} /></span>
              <div style={{ flex: 1, minWidth: '180px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <p style={{ margin: 0, fontWeight: 700, color: 'var(--ink-900)', fontSize: '15px' }}>{p.name}</p>
                  {p.active ? <Badge variant="new">Attiva</Badge> : <span style={{ fontSize: '12px', color: 'var(--ink-400)', fontWeight: 600 }}>Terminata</span>}
                </div>
                <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-500)' }}>{p.product} · scade il {p.ends}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--secondary-600)' }}>{p.type === 'shipping' ? 'Sped. gratis' : `-${p.value}%`}</p>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--ink-400)' }}>{p.used} utilizzi</p>
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                <span style={{ position: 'relative', width: '40px', height: '23px', borderRadius: '999px', background: p.active ? 'var(--olive-500)' : 'var(--cream-400)', transition: 'background var(--dur-base)' }}>
                  <span style={{ position: 'absolute', top: '2px', left: p.active ? '19px' : '2px', width: '19px', height: '19px', borderRadius: '50%', background: '#fff', transition: 'left var(--dur-base)', boxShadow: 'var(--shadow-sm)' }} />
                </span>
              </label>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Reviews() {
  const reviews = window.SC_REVIEWS;
  const avg = window.SC_STORE.rating;
  return (
    <div>
      <PageTitle title="Recensioni" sub="Reputazione e feedback dei clienti" />
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: '24px', alignItems: 'start' }}>
        <Card variant="flat" padding="lg">
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '46px', fontWeight: 800, color: 'var(--ink-900)', lineHeight: 1 }}>{avg.toFixed(1).replace('.', ',')}</div>
            <div style={{ margin: '8px 0' }}><Stars value={avg} size={18} /></div>
            <div style={{ fontSize: '13px', color: 'var(--ink-500)' }}>{window.SC_STORE.reviews} recensioni</div>
          </div>
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {[[5, 82], [4, 13], [3, 3], [2, 1], [1, 1]].map(([s, pct]) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--ink-500)' }}>
                <span style={{ width: '8px' }}>{s}</span><Lucide name="star" size={11} color="var(--accent-500)" />
                <span style={{ flex: 1, height: '6px', background: 'var(--cream-200)', borderRadius: '3px', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--accent-500)' }} /></span>
                <span style={{ width: '28px', textAlign: 'right' }}>{pct}%</span>
              </div>
            ))}
          </div>
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {reviews.map((r, i) => (
            <Card key={i} variant="bordered" padding="md">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                <span style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'var(--cream-200)', color: 'var(--primary-700)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px' }}>{initials(r.who)}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><strong style={{ fontSize: '14px', color: 'var(--ink-900)' }}>{r.who}</strong><Stars value={r.rating} size={13} /></div>
                  <span style={{ fontSize: '12px', color: 'var(--ink-400)' }}>{r.when} · {r.product}</span>
                </div>
              </div>
              <p style={{ margin: '0 0 10px', fontSize: '14px', lineHeight: 1.55, color: 'var(--ink-700)' }}>{r.text}</p>
              {r.reply
                ? <div style={{ background: 'var(--cream-50)', borderLeft: '3px solid var(--primary-400)', borderRadius: '0 var(--radius-md) var(--radius-md) 0', padding: '8px 12px' }}><p style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: 'var(--primary-700)' }}>La tua risposta</p><p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-600)' }}>{r.reply}</p></div>
                : <Button variant="ghost" size="sm" icon="reply">Rispondi</Button>}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function Customers() {
  const custs = window.SC_CUSTOMERS;
  return (
    <div>
      <PageTitle title="Clienti" sub="Chi compra dal tuo negozio" />
      <Card variant="bordered" padding="none">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-sans)' }}>
          <thead><tr style={{ background: 'var(--cream-50)', borderBottom: '1px solid var(--cream-300)' }}>{['Cliente', 'Ordini', 'Speso', 'Ultimo'].map((h, i) => <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '12px 18px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-500)' }}>{h}</th>)}</tr></thead>
          <tbody>
            {custs.map((c) => (
              <tr key={c.name} style={{ borderBottom: '1px solid var(--cream-200)' }}>
                <td style={{ padding: '12px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))', color: '#fff', fontWeight: 700, fontSize: '13px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{c.initials}</span>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink-900)' }}>{c.name}</span>
                  </div>
                </td>
                <td style={{ padding: '12px 18px', textAlign: 'right', color: 'var(--ink-700)' }}>{c.orders}</td>
                <td style={{ padding: '12px 18px', textAlign: 'right', fontWeight: 700, color: 'var(--ink-900)' }}>{fmt(c.spent)}</td>
                <td style={{ padding: '12px 18px', textAlign: 'right', color: 'var(--ink-500)', fontSize: '13px' }}>{c.last}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
