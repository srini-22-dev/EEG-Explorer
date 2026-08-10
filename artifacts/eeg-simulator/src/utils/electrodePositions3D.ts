// Electrode scalp positions, projected onto the head mesh by
// scripts/src/processHeadMesh.ts along each electrode's hand-authored 10-20
// direction. Regenerate with that script if the head model changes.
export const electrodePositions3D: Record<string, [number, number, number]> = {
  Fp1: [-0.2612, 0.4353, 0.74],
  Fp2: [0.2548, 0.4246, 0.7218],
  F7: [-0.5741, 0.2026, 0.4053],
  F3: [-0.3461, 0.6057, 0.5192],
  Fz: [0, 0.7204, 0.5403],
  F4: [0.3429, 0.6001, 0.5144],
  F8: [0.5551, 0.1959, 0.3919],
  T3: [-0.6589, 0.0694, 0],
  C3: [-0.4392, 0.7467, 0],
  Cz: [0, 0.9112, 0],
  C4: [0.4433, 0.7536, 0],
  T4: [0.6587, 0.0693, 0],
  T5: [-0.6558, 0.2315, -0.4629],
  P3: [-0.3866, 0.6766, -0.58],
  Pz: [0, 0.7957, -0.5967],
  P4: [0.3916, 0.6853, -0.5874],
  T6: [0.6831, 0.2411, -0.4822],
  O1: [-0.2941, 0.3922, -0.8824],
  O2: [0.3016, 0.4021, -0.9048],
  A1: [-0.6411, -0.1282, 0.0641],
  A2: [0.6406, -0.1281, 0.0641],
};
