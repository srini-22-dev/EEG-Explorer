/**
 * Repairs the handedness of the Colin27 meshes already committed to public/models.
 *
 * Run: pnpm --filter @workspace/scripts run fix-mesh-frame
 *
 * These files were written by an earlier `processColinMesh.ts` whose axis map swapped
 * Y and Z without negating anything — an odd permutation, determinant -1, so a
 * mirror rather than a rotation. `processColinMesh.ts` is now correct, but it needs
 * the raw FreeSurfer `.asc` surfaces, which are not in the repo. This script applies
 * the same correction directly to the exported binaries so the frame can be fixed
 * without them. Once the raw surfaces are available again, re-running
 * `process-colin-mesh` supersedes this and produces identical output.
 *
 * Safe to run more than once. A closed surface wound counter-clockwise has positive
 * signed volume; mirroring flips that sign. So the sign *is* the state flag: negative
 * means still mirrored, positive means already repaired. Nothing else is touched —
 * a reflection preserves every distance, so the forward model is unaffected.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { MODELS, readBinAt, signedVolume } from './mesh';

const FILES = ['skin.bin', 'lh_pial.bin', 'rh_pial.bin'];

for (const file of FILES) {
  const full = path.join(MODELS, file);
  // `pos` is a view onto `buf`, so negating it edits the buffer we write back.
  const mesh = readBinAt(full);

  const before = signedVolume(mesh);
  if (before > 0) {
    console.log(`${file}: already right-handed (volume ${before.toFixed(3)}), unchanged`);
    continue;
  }
  for (let i = 0; i < mesh.pos.length; i += 3) mesh.pos[i] = -mesh.pos[i];
  fs.writeFileSync(full, mesh.buf);
  console.log(`${file}: mirrored in x, volume ${before.toFixed(3)} -> ${signedVolume(mesh).toFixed(3)}`);
}
