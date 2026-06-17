// ===== Seller: Products =====
function ProductsView() {
  const [editing, setEditing] = React.useState(null); // product or 'new'
  const [q, setQ] = React.useState('');
  const STATUS = { active: ['Attivo', 'new'], soldout: ['Esaurito', 'soldout'], draft: ['Bozza', 'local'] };
  const list = window.SC_PRODUCTS.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <div style={{ flex: 1, maxWidth: '320px' }}><Input placeholder="Cerca nel catalogo…" value={q} onChange={(e) => setQ(e.target.value)} leading={<Icon name="search" size={16} color="var(--ink-400)" />} /></div>
        <div style={{ marginLeft: 'auto' }}><Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Nuovo prodotto</Button></div>
      </div>
      <Card variant="bordered" padding="none">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left', fontSize: '12px', color: 'var(--ink-500)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            <th style={th}>Prodotto</th><th style={th}>Categoria</th><th style={th}>Prezzo</th><th style={th}>Scorte</th><th style={th}>Venduti</th><th style={th}>Stato</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid var(--cream-200)' }}>
                <td style={td}><div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><img src={imgUrl(p.kw, p.lock)} alt={p.name} style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-md)', objectFit: 'cover' }} /><span style={{ fontWeight: 600, color: 'var(--ink-900)' }}>{p.name}</span></div></td>
                <td style={td}>{p.cat}</td>
                <td style={{ ...td, fontWeight: 700, color: 'var(--ink-900)' }}>{fmt(p.price)}</td>
                <td style={td}><span style={{ color: p.stock === 0 ? 'var(--secondary-600)' : p.stock <= 3 ? 'var(--accent-700)' : 'var(--ink-700)', fontWeight: p.stock <= 3 ? 700 : 500 }}>{p.stock}</span></td>
                <td style={td}>{p.sold}</td>
                <td style={td}><Badge variant={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge></td>
                <td style={{ ...td, textAlign: 'right' }}><Button variant="ghost" size="sm" icon="pencil" onClick={() => setEditing(p)}>Modifica</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <ProductEditor product={editing === 'new' ? null : editing} open={!!editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function ProductEditor({ product, open, onClose }) {
  if (!open) return null;
  const isNew = !product;
  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'Nuovo prodotto' : 'Modifica prodotto'} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Annulla</Button><Button variant="primary" icon="check" onClick={onClose}>{isNew ? 'Pubblica' : 'Salva'}</Button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '18px' }}>
        <div>
          <div style={{ width: '120px', height: '120px', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--cream-300)', background: 'var(--surface-100)' }}>
            {product ? <img src={imgUrl(product.kw, product.lock)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-300)' }}><Icon name="image-plus" size={28} color="var(--ink-300)" /></div>}
          </div>
          <Button variant="secondary" size="sm" icon="upload" style={{ marginTop: '8px', width: '120px' }}>Foto</Button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Input label="Nome prodotto" defaultValue={product ? product.name : ''} placeholder="Es. Coppa Piacentina DOP 200g" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <Input label="Prezzo (€)" defaultValue={product ? String(product.price) : ''} placeholder="0,00" />
            <Input label="Scorte" defaultValue={product ? String(product.stock) : ''} placeholder="0" />
            <Select label="Categoria" defaultValue={product ? product.cat : 'Salumi'}><option>Salumi</option><option>Formaggi</option><option>Conserve</option></Select>
          </div>
          <div>
            <label style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ink-700)' }}>Descrizione</label>
            <textarea rows="3" defaultValue={product ? 'Stagionata 90 giorni, taglio a mano.' : ''} placeholder="Racconta il prodotto…" style={{ width: '100%', boxSizing: 'border-box', marginTop: '5px', border: '1px solid var(--cream-300)', borderRadius: 'var(--radius-md)', padding: '10px 12px', fontFamily: 'var(--font-sans)', fontSize: '15px', resize: 'vertical', outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Badge variant="local">DOP</Badge><Badge variant="local">Taglio a mano</Badge><button style={{ border: '1px dashed var(--cream-400)', background: 'transparent', color: 'var(--primary-700)', borderRadius: 'var(--radius-sm)', fontSize: '11px', padding: '2px 8px', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>+ Tag</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
