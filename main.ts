// Kestrel Ridge Rally — hand-in program.
//
// Copies the playable game (game/) and its screenshots (screenshots/) from
// this repository into the output directory, then writes the entry dossier
// with the kit's buildDossier so the gate can rebuild and compare it byte
// for byte. Runs on Node 22 with the standard library only, no network.
//
// The output directory is MAKEFUN_OUTPUT_DIR when set, else /output.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The caps the bounty's scorer builds with: the dossier text cap plus the
// refusal limits for screenshots and the game tree.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
} as const;

function stageIntoOutput(): void {
  // Start from an empty output so stale files can never leak into an entry.
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  for (const part of ['game', 'screenshots']) {
    const from = join(repoRoot, part);
    if (!existsSync(from)) throw new Error(`main.ts: ${part}/ is missing from the repository`);
    cpSync(from, join(outputDir, part), { recursive: true });
  }
}

function main(): void {
  stageIntoOutput();
  const dossier = buildDossier(outputDir, DOSSIER_CAPS);
  writeFileSync(join(outputDir, 'dossier.json'), dossier);
  console.log(`Kestrel Ridge Rally: game and screenshots staged in ${outputDir}, dossier ${dossier.length} bytes.`);
}

main();
