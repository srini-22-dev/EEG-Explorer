// Electrode scalp positions, projected onto the real Colin27 scalp surface
// (see scripts/src/processColinMesh.ts) along each electrode's original
// hand-authored 10-20 direction. Regenerate via that script if the head
// mesh or electrode set changes.
export const electrodePositions3D: Record<string, [number, number, number]> = {
  Fp1: [-0.2597, 0.4328, 0.7358],
  Fp2: [0.2575, 0.4291, 0.7295],
  F7: [-0.6709, 0.2368, 0.4736],
  F3: [-0.334, 0.5846, 0.5011],
  Fz: [0, 0.6771, 0.5078],
  F4: [0.331, 0.5793, 0.4966],
  F8: [0.6572, 0.232, 0.4639],
  T3: [-0.8231, 0.0866, 0],
  C3: [-0.4163, 0.7077, 0],
  Cz: [0, 0.8331, 0],
  C4: [0.4164, 0.7079, 0],
  T4: [0.8037, 0.0846, 0],
  T5: [-0.7047, 0.2487, -0.4974],
  P3: [-0.3679, 0.6439, -0.5519],
  Pz: [0, 0.7381, -0.5536],
  P4: [0.363, 0.6352, -0.5445],
  T6: [0.6923, 0.2443, -0.4887],
  O1: [-0.2689, 0.3585, -0.8066],
  O2: [0.2684, 0.3579, -0.8052],
  A1: [-0.8231, -0.1646, 0.0823],
  A2: [0.8173, -0.1635, 0.0817],
};
