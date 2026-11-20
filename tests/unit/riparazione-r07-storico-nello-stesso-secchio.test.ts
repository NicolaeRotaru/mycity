// R07-009 — se il secchio dello storico delle foto non si crea, lo script ripiega su una cartella
// dentro il secchio della copia. La notte resta verde (cambiarlo e' una scelta di Nicola), ma il
// ripiego deve comparire nel riepilogo del lavoro e come avviso, non solo nel registro.
// Solo dati finti: rclone finto nel PATH (aiutante delle prove R15), nessuna rete.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bloccoFoto, mondoFinto } from './riparazione-r15-rclone-finto'

function lanciaColRiepilogo(radice: string, env: Record<string, string>) {
  const riepilogo = join(radice, '_riepilogo.md')
  const preambolo = `set -euo pipefail; TS=T1; riepilogo_lavoro() { printf '%s\\n' "$1" >> "${riepilogo}"; }\n`
  const r = spawnSync('bash', ['-c', preambolo + bloccoFoto()], {
    env: {
      ...process.env,
      DB_URL: '',
      STORAGE_SYNC_STORICO: '',
      PATH: `${join(radice, '_bin')}:${process.env.PATH}`,
      FAKE_ROOT: radice,
      HOME: radice,
      ...env,
    },
    encoding: 'utf8',
  })
  return {
    uscita: r.status,
    out: (r.stdout || '') + (r.stderr || ''),
    riepilogo: existsSync(riepilogo) ? readFileSync(riepilogo, 'utf8') : '',
  }
}

describe('R07-009 · lo storico nello stesso secchio della copia non passa in silenzio', () => {
  // 20/11/2026 (R02-005) — La scelta di Nicola è arrivata: senza il secchio dello storico la notte è
  // rossa e lo storico non va mai nel secchio della copia (niente più ripiego su «/_storico»). Il
  // riepilogo del lavoro dice perché. Prova di comportamento: riparazione-r02-backup-storico-rosso.
  it('secchio -storico assente e non creabile: notte rossa, niente ripiego, il riepilogo lo dice', () => {
    const m = mondoFinto()
    m.file('src:products', 'p.jpg')
    m.cartella('b2:mycity-foto')
    const r = lanciaColRiepilogo(m.radice, {
      STORAGE_SYNC_SOURCE: 'src:',
      STORAGE_SYNC_DEST: 'b2:mycity-foto',
      STORAGE_SYNC_BUCKETS: 'products',
      FAKE_MKDIR_FAIL: '1',
    })
    expect(r.uscita, r.out).toBe(5)
    expect(r.out).not.toContain('b2:mycity-foto/_storico')
    expect(existsSync(join(m.radice, 'b2', 'mycity-foto', '_storico'))).toBe(false)
    expect(r.riepilogo).toContain('manca il secchio dello storico')
    expect(r.riepilogo).toContain('b2:mycity-foto-storico')
  })

  it('secchio -storico che esiste: nessun avviso di ripiego nel riepilogo', () => {
    const m = mondoFinto()
    m.file('src:products', 'p.jpg')
    m.cartella('b2:mycity-foto')
    m.cartella('b2:mycity-foto-storico')
    const r = lanciaColRiepilogo(m.radice, {
      STORAGE_SYNC_SOURCE: 'src:',
      STORAGE_SYNC_DEST: 'b2:mycity-foto',
      STORAGE_SYNC_BUCKETS: 'products',
    })
    expect(r.uscita, r.out).toBe(0)
    expect(r.riepilogo).not.toContain('stesso secchio della copia')
    expect(r.out).not.toContain('::warning::Lo storico')
  })
})
