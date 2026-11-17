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
  it('secchio -storico assente e non creabile: notte verde ma riepilogo e avviso lo dicono', () => {
    const m = mondoFinto()
    m.file('src:products', 'p.jpg')
    m.cartella('b2:mycity-foto')
    const r = lanciaColRiepilogo(m.radice, {
      STORAGE_SYNC_SOURCE: 'src:',
      STORAGE_SYNC_DEST: 'b2:mycity-foto',
      STORAGE_SYNC_BUCKETS: 'products',
      FAKE_MKDIR_FAIL: '1',
    })
    // Il comportamento della copia non cambia: stesso ripiego, stessa uscita.
    expect(r.uscita, r.out).toBe(0)
    expect(r.out).toContain('b2:mycity-foto/_storico')
    // Quello che mancava: il riepilogo del lavoro e l'avviso.
    expect(r.riepilogo).toContain('stesso secchio della copia')
    expect(r.riepilogo).toContain('b2:mycity-foto/_storico')
    expect(r.out).toMatch(/::warning::Lo storico delle foto e' nello stesso secchio della copia/)
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
