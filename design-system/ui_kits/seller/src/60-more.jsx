// ===== Seller: Earnings, Promos, Reviews, Customers, Profile =====
function EarningsView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <Card variant="bordered" padding="lg" style={{ background: 'var(--olive-50)', borderColor: 'var(--olive-200)' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--olive-800)', fontWeight: 600 }}>Saldo disponibile</p>
          <p style={{ margin: '6px 0 12px', fontFamily: 'var(--font-serif)', fontSize: '32px', fontWeight: 800, color: 'var(--ink-900)' }}>€1.226,40</p>
          <Button variant="success" icon="banknote">Richiedi payout</Button>
        </Card>
        <Card variant="bordered" padding="lg" style={{ background: 'var(--secondary-50)', borderColor: 'var(--secondary-200)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div><p style={{ margin: 0, fontSize: '13px', color: 'var(--secondary-700)', fontWeight: 600 }}>Contanti incassati da saldare</p><p style={{ margin: '6px 0 12px', fontFamily: 'var(--font-serif)', fontSize: '32px', fontWeight: 800, color: 'var(--ink-900)' }}>€612,00</p></div>
            <Icon name="wallet" size={26} color="var(--secondary-600)" />
          </div>
          <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--ink-600)' }}>I rider ti consegnano i contanti raccolti; la quota MyCity viene trattenuta dal payout.</p>
          <Button variant="secondary" icon="check">Conferma saldo contanti</Button>
        </Card>
      </div>
      <Card variant="bordered" padding="none">
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--cream-200)' }}><h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 700, color: 'var(--ink-900)' }}>Storico payout</h2></div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left', fontSize: '12px', color: 'var(--ink-500)', textTransform: 'uppercase' }}><th style={th}>ID</th><th style={th}>Periodo</th><th style={th}>Importo</th><th style={th}>Stato</th><th style={th}>Data</th></tr></thead>
          <tbody>{window.SC_PAYOUTS.map((p) => (
            <tr key={p.id} style={{ borderTop: '1px solid var(--cream-200)' }}><td style={{ ...td, fontWeight: 700, color: 'var(--ink-900)' }}>{p.id}</td><td style={td}>{p.period}</td><td style={{ ...td, fontWeight: 700 }}>{fmt(p.amount)}</td><td style={td}><Badge variant="new">{p.status}</Badge></td><td style={td}>{p.when}</td></tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}

function PromosView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex' }}><div style={{ marginLeft: 'auto' }}><Button variant="primary" icon="plus">Nuova promozione</Button></div></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        {window.SC_PROMOS.map((p) => (
          <Card key={p.id} variant="bordered" padding="lg">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, background: 'var(--cream-200)', padding: '3px 8px', borderRadius: 'var(--radius-sm)', color: 'var(--ink-800)' }}>{p.id}</span>
              <Badge variant={p.status === 'active' ? 'new' : 'soldout'}>{p.status === 'active' ? 'Attiva' : 'Terminata'}</Badge>
            </div>
            <p style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '18px', fontWeight: 700, color: 'var(--ink-900)' }}>{p.type}</p>
            <p style={{ margin: '2px 0 12px', fontSize: '13px', color: 'var(--ink-500)' }}>{p.cond}</p>
            <div style={{ height: '8px', background: 'var(--cream-200)', borderRadius: '4px', overflow: 'hidden' }}><div style={{ width: (p.uses / p.cap * 100) + '%', height: '100%', background: 'var(--accent-500)' }} /></div>
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--ink-500)' }}>{p.uses} / {p.cap} utilizzi</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ReviewsView() {
  const [reviews, setReviews] = React.useState(window.SC_REVIEWS);
  function reply(i) { setReviews((prev) => prev.map((r, j) => j === i ? { ...r, reply: 'Grazie mille per il feedback!' } : r)); }
  const avg = (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1).replace('.', ',');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Card variant="bordered" padding="lg"><div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ textAlign: 'center' }}><div style={{ fontFamily: 'var(--font-serif)', fontSize: '40px', fontWeight: 800, color: 'var(--ink-900)', lineHeight: 1 }}>{avg}</div><div style={{ fontSize: '12px', color: 'var(--ink-500)' }}>{window.SC_STORE.reviews} recensioni</div></div>
        <div style={{ flex: 1, fontSize: '14px', color: 'var(--ink-600)' }}>Rispondi alle recensioni per fidelizzare i clienti. Un negozio che risponde vende il <strong style={{ color: 'var(--ink-900)' }}>+23%</strong>.</div>
      </div></Card>
      {reviews.map((r, i) => (
        <Card key={i} variant="bordered" padding="lg">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <span style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'var(--cream-200)', color: 'var(--primary-700)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px' }}>{initials(r.who)}</span>
            <div style={{ flex: 1 }}><strong style={{ fontSize: '14px', color: 'var(--ink-900)' }}>{r.who}</strong><div style={{ fontSize: '12px', color: 'var(--ink-400)' }}>{r.when} · {r.product}</div></div>
            <div style={{ display: 'inline-flex', gap: '1px' }}>{[1, 2, 3, 4, 5].map((s) => <Icon key={s} name="star" size={14} color={s <= r.rating ? 'var(--accent-500)' : 'var(--cream-300)'} />)}</div>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: '14px', color: 'var(--ink-700)', lineHeight: 1.5 }}>{r.text}</p>
          {r.reply
            ? <div style={{ background: 'var(--cream-50)', borderLeft: '3px solid var(--primary-400)', padding: '10px 12px', borderRadius: '0 var(--radius-md) var(--radius-md) 0', fontSize: '13px', color: 'var(--ink-700)' }}><strong style={{ color: 'var(--primary-700)' }}>La tua risposta · </strong>{r.reply}</div>
            : <Button variant="secondary" size="sm" icon="reply" onClick={() => reply(i)}>Rispondi</Button>}
        </Card>
      ))}
    </div>
  );
}

function CustomersView() {
  return (
    <Card variant="bordered" padding="none">
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ textAlign: 'left', fontSize: '12px', color: 'var(--ink-500)', textTransform: 'uppercase' }}><th style={th}>Cliente</th><th style={th}>Zona</th><th style={th}>Ordini</th><th style={th}>Speso</th><th style={th}>Ultimo</th></tr></thead>
        <tbody>{window.SC_CUSTOMERS.map((c) => (
          <tr key={c.name} style={{ borderTop: '1px solid var(--cream-200)' }}>
            <td style={td}><div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><span style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px' }}>{initials(c.name)}</span><span style={{ fontWeight: 600, color: 'var(--ink-900)' }}>{c.name}</span></div></td>
            <td style={td}>{c.area}</td><td style={td}>{c.orders}</td><td style={{ ...td, fontWeight: 700, color: 'var(--ink-900)' }}>{fmt(c.spent)}</td><td style={td}>{c.last}</td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

function ProfileView() {
  const s = window.SC_STORE;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
      <Card variant="bordered" padding="lg">
        <SectionTitle>Vetrina</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Input label="Nome negozio" defaultValue={s.name} />
          <Input label="Zona" defaultValue={s.area} />
          <Select label="Categoria principale" defaultValue="Gastronomia"><option>Gastronomia</option><option>Alimentari</option><option>Vini & Cantina</option></Select>
          <div><label style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ink-700)' }}>Descrizione</label><textarea rows="3" defaultValue="Salumi e formaggi piacentini selezionati, tagliati a mano ogni giorno." style={{ width: '100%', boxSizing: 'border-box', marginTop: '5px', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-md)', padding: '10px 12px', fontFamily: 'var(--font-sans)', fontSize: '15px', resize: 'vertical' }} /></div>
          <div><Button variant="primary">Salva vetrina</Button></div>
        </div>
      </Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <Card variant="bordered" padding="lg">
          <SectionTitle>Orari & consegna</SectionTitle>
          {[['Lun – Ven', '8:00 – 19:30'], ['Sabato', '8:00 – 19:30'], ['Domenica', 'Chiuso']].map(([d, h]) => (
            <div key={d} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--cream-200)', fontSize: '14px' }}><span style={{ color: 'var(--ink-600)' }}>{d}</span><span style={{ fontWeight: 600, color: h === 'Chiuso' ? 'var(--secondary-600)' : 'var(--ink-900)' }}>{h}</span></div>
          ))}
          <div style={{ marginTop: '12px' }}><Checkbox defaultChecked label="Consegna in giornata disponibile" /></div>
        </Card>
        <Card variant="bordered" padding="lg" style={{ background: 'var(--ink-900)', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}><Icon name="shield-check" size={20} color="var(--accent-400)" /><strong style={{ fontFamily: 'var(--font-serif)', fontSize: '17px' }}>Piano {s.plan}</strong></div>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink-300)', lineHeight: 1.5 }}>Zero commissioni sugli ordini. Attivo dal {s.since}. Verificato da MyCity.</p>
        </Card>
      </div>
    </div>
  );
}
