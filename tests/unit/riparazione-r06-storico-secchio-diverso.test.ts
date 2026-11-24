// R06-006 e R06-007 — Lo storico predefinito delle foto non deve finire in silenzio nello stesso secchio
// della copia:
//  - 006: "b2:/mycity-foto/copie" (la barra iniziale, che per rclone su B2 e S3 non conta) dava
//    "b2:/mycity-foto/copie-storico", cioe' il secchio mycity-foto, notte verde e nessun avviso;
//  - 007: "cifrata:copie" (un remote crypt, che scrive dentro il secchio di un altro remote) dava
//    "cifrata:copie-storico", lo stesso secchio sotto la cifratura.
// Blocco delle foto di scripts/backup-db.sh con rclone finto nel PATH (aiutante R15, solo letto) che in
// piu' risponde a `rclone listremotes --long` con i tipi dei remote: nessuna rete, nessuna chiave.
import { chmodSync, existsSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mondoFinto } from './riparazione-r15-rclone-finto'

function elenco(d: string): string[] {
  if (!existsSync(d)) return []
  return (readdirSync(d, { recursive: true, withFileTypes: true }) as Array<{ isFile(): boolean; name: string; parentPath?: string; path?: string }>)
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath ?? e.path ?? d, e.name).slice(d.length + 1))
    .sort()
}

/** Il mondo finto dell'aiutante, con un rclone che conosce anche i tipi dei remote (come rclone.conf). */
function mondoConTipi(tipi: Record<string, string>) {
  const m = mondoFinto()
  const bin = join(m.radice, '_bin')
  renameSync(join(bin, 'rclone'), join(bin, 'rclone-base'))
  const righe = Object.entries(tipi).map(([nome, tipo]) => `${(nome + ':').padEnd(12)} ${tipo}`).join('\n')
  writeFileSync(join(bin, 'rclone'), [
    '#!/usr/bin/env bash',
    'if [[ "$1" == "listremotes" ]]; then',
    "  cat <<'REMOTE'",
    righe,
    'REMOTE',
    '  exit 0',
    'fi',
    `exec "${join(bin, 'rclone-base')}" "$@"`,
  ].join('\n') + '\n')
  chmodSync(join(bin, 'rclone'), 0o755)
  return m
}

const TIPI = { src: 's3', b2: 'b2', cifrata: 'crypt', archivio: 'alias', nas: 'sftp', altra: 'b2', oci: 'oracleobjectstorage', qing: 'qingstor', sj: 'storj' }

describe('R06-006 · una destinazione su B2 scritta con la barra iniziale', () => {
  it('"b2:/mycity-foto/copie": lo storico va in "b2:mycity-foto-storico/copie", non dentro mycity-foto', () => {
    const m = mondoConTipi(TIPI)
    m.file('src:products', 'a.jpg')
    m.file('b2:mycity-foto/copie/products', 'a.jpg')
    m.file('b2:mycity-foto/copie/products', 'cancellata.jpg')
    m.cartella('b2:mycity-foto-storico')
    const r = m.lancia({ STORAGE_SYNC_SOURCE: 'src:', STORAGE_SYNC_DEST: 'b2:/mycity-foto/copie', STORAGE_SYNC_BUCKETS: 'products' })
    expect(r.uscita).toBe(0)
    expect(r.out).toContain('storico in b2:mycity-foto-storico/copie;')
    expect(elenco(join(m.radice, 'b2', 'mycity-foto-storico'))).toEqual(['copie/T1/products/cancellata.jpg'])
    expect(
      elenco(join(m.radice, 'b2', 'mycity-foto')).filter((f) => !f.startsWith('copie/products/') && !f.startsWith('copie/_memoria-copia/')),
      'lo storico e\' finito nello stesso secchio della copia',
    ).toEqual([])
  })

  it('"b2://mycity-foto/copie" (due barre): lo stesso, secchio dello storico accanto', () => {
    const m = mondoConTipi(TIPI)
    m.file('src:products', 'a.jpg')
    m.cartella('b2:mycity-foto-storico')
    const r = m.lancia({ STORAGE_SYNC_SOURCE: 'src:', STORAGE_SYNC_DEST: 'b2://mycity-foto/copie', STORAGE_SYNC_BUCKETS: 'products' })
    expect(r.uscita).toBe(0)
    expect(r.out).toContain('storico in b2:mycity-foto-storico/copie;')
  })

  it.each(['oci', 'qing', 'sj'])('"%s:/secchio/dir" (oracleobjectstorage, qingstor, storj): lo storico va nel secchio accanto, non in quello della copia', (remote) => {
    const m = mondoConTipi(TIPI)
    m.file('src:products', 'a.jpg')
    m.file(`${remote}:secchio/dir/products`, 'cancellata.jpg')
    m.cartella(`${remote}:secchio-storico`)
    const r = m.lancia({ STORAGE_SYNC_SOURCE: 'src:', STORAGE_SYNC_DEST: `${remote}:/secchio/dir`, STORAGE_SYNC_BUCKETS: 'products' })
    expect(r.uscita).toBe(0)
    expect(r.out).toContain(`storico in ${remote}:secchio-storico/dir;`)
    expect(elenco(join(m.radice, remote, 'secchio-storico'))).toEqual(['dir/T1/products/cancellata.jpg'])
  })

  it('controprova: un percorso assoluto su sftp ("nas:/mnt/x") resta "nas:/mnt/x-storico"', () => {
    const m = mondoConTipi(TIPI)
    m.file('src:products', 'a.jpg')
    m.file('nas:mnt/x/products', 'cancellata.jpg')
    const r = m.lancia({ STORAGE_SYNC_SOURCE: 'src:', STORAGE_SYNC_DEST: 'nas:/mnt/x', STORAGE_SYNC_BUCKETS: 'products' })
    expect(r.uscita).toBe(0)
    expect(r.out).toContain('storico in nas:/mnt/x-storico;')
    expect(elenco(join(m.radice, 'nas', 'mnt', 'x-storico'))).toEqual(['T1/products/cancellata.jpg'])
  })

  it('controprova: "b2:mycity-foto/copie" senza barra resta "b2:mycity-foto-storico/copie"', () => {
    const m = mondoConTipi(TIPI)
    m.file('src:products', 'a.jpg')
    m.cartella('b2:mycity-foto-storico')
    const r = m.lancia({ STORAGE_SYNC_SOURCE: 'src:', STORAGE_SYNC_DEST: 'b2:mycity-foto/copie', STORAGE_SYNC_BUCKETS: 'products' })
    expect(r.uscita).toBe(0)
    expect(r.out).toContain('storico in b2:mycity-foto-storico/copie;')
  })
})

describe('R06-007 · una destinazione cifrata (o un alias) con una cartella', () => {
  it.each(['cifrata:copie', 'cifrata:copie/foto', 'archivio:copie'])('"%s" senza STORAGE_SYNC_STORICO: niente storico nello stesso secchio, la notte e\' rossa e dice cosa impostare', (dest) => {
    const m = mondoConTipi(TIPI)
    m.file('src:products', 'a.jpg')
    m.file(`${dest}/products`, 'cancellata.jpg')
    const r = m.lancia({ STORAGE_SYNC_SOURCE: 'src:', STORAGE_SYNC_DEST: dest, STORAGE_SYNC_BUCKETS: 'products' })
    expect(r.uscita, 'la notte e\' verde con lo storico sotto la stessa cifratura').not.toBe(0)
    expect(r.out).toContain('esito-foto: fallita')
    expect(r.out).toContain('STORAGE_SYNC_STORICO')
    expect(r.out).not.toContain('copiate e riaperte')
    expect(existsSync(join(m.radice, dest.split(':')[0], `${dest.split(':')[1].split('/')[0]}-storico`)), 'lo storico e\' stato creato accanto alla copia').toBe(false)
    expect(elenco(join(m.radice, dest.split(':')[0]))).toContain(`${dest.split(':')[1]}/products/cancellata.jpg`)
  })

  it('con STORAGE_SYNC_STORICO impostato la copia cifrata parte, e lo storico va dove si e\' detto', () => {
    const m = mondoConTipi(TIPI)
    m.file('src:products', 'a.jpg')
    m.file('cifrata:copie/products', 'cancellata.jpg')
    m.cartella('altra:storico-foto')
    const r = m.lancia({ STORAGE_SYNC_SOURCE: 'src:', STORAGE_SYNC_DEST: 'cifrata:copie', STORAGE_SYNC_BUCKETS: 'products', STORAGE_SYNC_STORICO: 'altra:storico-foto' })
    expect(r.uscita).toBe(0)
    expect(r.out).toContain('storico in altra:storico-foto;')
    expect(elenco(join(m.radice, 'altra', 'storico-foto'))).toEqual(['T1/products/cancellata.jpg'])
  })
})
