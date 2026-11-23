import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('package.json: le librerie usate dalle prove sono dichiarate', () => {
  it('@testing-library/dom, attr-accept ed esbuild stanno in devDependencies alla versione del lock', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8'));
    for (const nome of ['@testing-library/dom', 'attr-accept', 'esbuild']) {
      const versione = lock.packages[`node_modules/${nome}`].version;
      expect(pkg.devDependencies[nome], nome).toBe(versione);
      expect(lock.packages[''].devDependencies[nome], nome).toBe(versione);
    }
  });
});
