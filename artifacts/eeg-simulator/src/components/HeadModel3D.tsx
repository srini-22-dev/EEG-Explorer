import React, { useMemo, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Montage, GROUP_COLORS } from '../utils/montages';
import { electrodePositions3D } from '../utils/electrodePositions3D';
import {
  subscribe,
  getActiveElectrodes,
  getActiveChannels,
  getElectrodesForChannel,
  setHoverElectrodes,
} from '../utils/highlightStore';

type HeadModel3DProps = {
  montage: Montage;
  headOpacity?: number;
  brainOpacity?: number;
};

/**
 * Signed volume of a closed triangle mesh (divergence theorem). Its sign reports
 * the winding order: positive means counter-clockwise faces with outward normals,
 * negative means the triangles are wound backwards.
 *
 * Deliberately duplicated from scripts/src/mesh.ts — that module is Node-only
 * (node:fs) and lives in a different package, and this file must not gain a build
 * dependency on the tooling. Keep the two in step; the sign convention is the part
 * that matters.
 */
function signedVolume(positions: Float32Array, indices: Uint32Array): number {
  let v = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

/**
 * One in-flight fetch + one BufferGeometry per file, for the lifetime of the page.
 *
 * This cache is not an optimisation detail, it is load-bearing. `useMeshBin` is
 * called from four places (the two visible meshes, and previously two more for
 * picking), and without a cache each call issued its own fetch and its own
 * `computeVertexNormals()` over a quarter-million triangles — the same two files
 * downloaded twice each and four full normal passes on panel open. Keyed by
 * filename and stored at module scope so it also survives the panel being
 * toggled off and back on.
 */
const meshCache = new Map<string, Promise<THREE.BufferGeometry>>();

function loadMesh(file: string): Promise<THREE.BufferGeometry> {
  const cached = meshCache.get(file);
  if (cached) return cached;

  const url = `${import.meta.env.BASE_URL}models/${file}`;
  const p = fetch(url)
    .then(r => r.arrayBuffer())
    .then(buf => {
      // [vertexCount: u32][faceCount: u32][positions: f32 x v x 3][indices: u32 x f x 3]
      // See scripts/src/mesh.ts, which writes it.
      const view = new DataView(buf);
      const vCount = view.getUint32(0, true);
      const fCount = view.getUint32(4, true);
      const positions = new Float32Array(buf, 8, vCount * 3);
      const indices = new Uint32Array(buf, 8 + vCount * 3 * 4, fCount * 3).slice();

      // A backstop, not the fix. A mesh wound clockwise makes computeVertexNormals()
      // produce normals pointing *into* the surface, and three.js's default FrontSide
      // culling then renders it inside-out — you see the far interior wall through the
      // near surface, at any opacity. The exports used to arrive that way because their
      // axis map mirrored the head; that is corrected upstream now, and this branch no
      // longer fires. It stays because a re-export with a flipped axis is a silent
      // regression otherwise, and because the alternative — DoubleSide — would hide the
      // problem while doubling the lit-surface count and flattening the shading.
      if (signedVolume(positions, indices) < 0) {
        for (let i = 0; i < indices.length; i += 3) {
          const t = indices[i + 1];
          indices[i + 1] = indices[i + 2];
          indices[i + 2] = t;
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      geo.computeVertexNormals();
      return geo;
    });

  meshCache.set(file, p);
  return p;
}

function useMeshBin(file: string): THREE.BufferGeometry | null {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadMesh(file).then(g => { if (!cancelled) setGeometry(g); });
    return () => { cancelled = true; };
  }, [file]);
  return geometry;
}

// Display-resolution surfaces (scripts/src/compressMeshes.ts), NOT the analysis
// masters skin.bin/brain.bin those are decimated from. The masters stay the
// reference geometry — build1020.ts ray-casts the 10-20 positions onto skin.bin —
// but at ~9 MB and half a million triangles they are not what a teaching panel
// should be downloading and rasterising. The LOD pair is 1.5 MB and 85k triangles
// for a measured mean surface deviation of 0.05-0.10 mm.
const BRAIN_MESH = 'brain_lod.bin';
const SKIN_MESH = 'skin_lod.bin';

function Brain({ opacity = 0.8 }: { opacity?: number }) {
  // Single Surface-Nets cortex from the skull-stripped MNI152 volume, built in
  // the same pass and shared normalisation as the scalp (scripts/src/
  // buildHeadAndBrain.ts), so it is the SAME subject and seated inside it by
  // construction.
  const brain = useMeshBin(BRAIN_MESH);
  if (!brain) return null;
  return (
    // `transparent` must track the opacity value. Leaving it permanently on puts the
    // mesh in the blended pass even at opacity 1, where a deeply folded cortical
    // surface cannot be depth-sorted correctly against itself.
    // roughness dropped from 0.85: a fully matte surface has no specular
    // highlight to move across the folds as the model rotates, so lowering it
    // gives the light something to catch and trace the gyral contours with.
    <mesh geometry={brain}>
      <meshStandardMaterial
        color="#d4a0a0"
        transparent={opacity < 1}
        opacity={opacity}
        roughness={0.55}
        metalness={0.05}
      />
    </mesh>
  );
}

/**
 * The scalp shell, extracted from the MNI152_T1_1mm template — the same surface
 * `scripts/src/build1020.ts` constructs the electrode positions on, so the
 * markers sit on the rendered head by construction rather than by coincidence.
 *
 * Rendered after the brain with depth writing disabled while see-through, so the
 * cortex behind it composites correctly instead of being depth-rejected.
 */
function HeadSkin({
  opacity = 0.3,
  dragActive = false,
  onDragTo,
}: {
  opacity?: number;
  // While an electrode is being dragged, the scalp mesh is the surface the marker
  // is snapped onto: `onDragTo` receives the ray/scalp intersection so the caller
  // can place the marker exactly on the head, the same surface build1020.ts casts
  // the calibrated positions onto.
  dragActive?: boolean;
  onDragTo?: (point: THREE.Vector3) => void;
}) {
  const skin = useMeshBin(SKIN_MESH);
  if (!skin) return null;
  const isTransparent = opacity < 1;
  return (
    <mesh
      geometry={skin}
      renderOrder={1}
      onPointerMove={dragActive && onDragTo ? (e) => { e.stopPropagation(); onDragTo(e.point); } : undefined}
    >
      <meshStandardMaterial
        color="#e8beac"
        transparent={isTransparent}
        opacity={opacity}
        depthWrite={!isTransparent}
        roughness={0.7}
        metalness={0}
      />
    </mesh>
  );
}

// One sphere for all 21 markers. Size comes from the mesh's scale, so the single
// geometry serves both the resting and the enlarged-when-active radius.
const MARKER_GEOMETRY = new THREE.SphereGeometry(0.03, 16, 16);

// Marker materials are drawn from a handful of montage-group colours plus white
// and grey, so they are cached by appearance rather than rebuilt per electrode
// on every highlight change.
const markerMaterials = new Map<string, THREE.MeshStandardMaterial>();
function markerMaterial(color: string, emissive: boolean): THREE.MeshStandardMaterial {
  const key = `${color}|${emissive}`;
  let m = markerMaterials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      emissive: emissive ? color : '#000000',
      emissiveIntensity: emissive ? 0.5 : 0,
    });
    markerMaterials.set(key, m);
  }
  return m;
}

/**
 * Dim the labels whose electrode is on the far side of the head.
 *
 * The labels are DOM overlays, so without this they sit on top of the head at
 * full strength even when their electrode is round the back, and the near-side
 * layout becomes unreadable. drei's `<Html occlude>` does this by ray-casting
 * every label against the meshes every frame; against a scalp and a cortex with
 * no BVH between them that was 21 casts per frame through hundreds of thousands
 * of triangles, which is what made the panel lag.
 *
 * The scalp is a closed surface enclosing the origin, so "is this point on the
 * far side" is answerable without touching the geometry: an electrode's outward
 * normal is its own position vector, and it faces the camera exactly when that
 * normal has a positive dot product with the direction from the electrode to the
 * camera. That is exact for a convex surface and off only around the ears and
 * nose, where a label is at a grazing angle and either answer looks reasonable.
 *
 * Written straight to `style.opacity` through refs rather than React state: the
 * value changes continuously while the model spins, and routing that through a
 * re-render would rebuild the marker tree on every frame of a drag.
 */
function useFacingLabels(
  names: string[],
  positionOf: (name: string) => [number, number, number],
  activeOf: (name: string) => boolean,
) {
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useFrame(({ camera }) => {
    for (const name of names) {
      const el = labelRefs.current[name];
      if (!el) continue;
      const p = positionOf(name);
      const nx = p[0], ny = p[1], nz = p[2];
      const vx = camera.position.x - nx, vy = camera.position.y - ny, vz = camera.position.z - nz;
      const facing = nx * vx + ny * vy + nz * vz > 0;
      const opacity = facing ? 0.7 : activeOf(name) ? 0.3 : 0.12;
      const next = String(opacity);
      if (el.style.opacity !== next) el.style.opacity = next;
    }
  });
  return labelRefs;
}

function ElectrodeMarkers({
  montage,
  positionOf,
  onBeginDrag,
}: {
  montage: Montage;
  positionOf: (name: string) => [number, number, number];
  onBeginDrag: (name: string) => void;
}) {
  // The highlight store is external to React; this counter exists purely to pull
  // a re-render when it changes so the getters below are re-read.
  const [, bumpHighlight] = React.useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribe(bumpHighlight), []);

  const names = useMemo(() => Object.keys(electrodePositions3D), []);

  const activeElectrodes = getActiveElectrodes();

  // Channel-side highlights (e.g. hovering a trace on the EEG canvas) don't touch
  // hoveredElectrodes/clickedElectrodes directly, so also light up the electrodes
  // belonging to any active channel.
  const channelElectrodes = new Set<string>();
  getActiveChannels().forEach(idx => {
    getElectrodesForChannel(idx, montage).forEach(el => channelElectrodes.add(el));
  });

  const isActive = (name: string) => activeElectrodes.has(name) || channelElectrodes.has(name);

  // Find electrodes in montage, and the montage-group color each one should render
  // with (an electrode used by more than one channel just takes the first group it
  // appears in — good enough for a reference/orientation color, not a data encoding).
  const electrodeGroupColor = useMemo(() => {
    const m = new Map<string, string>();
    montage.channels.forEach(ch => {
      const color = GROUP_COLORS[ch.group] || '#4ade80';
      if (ch.active && ch.active !== 'ECG' && !m.has(ch.active)) m.set(ch.active, color);
      if (ch.reference && ch.reference !== 'AVG' && ch.reference !== 'CONTRA' && ch.reference !== 'IPSI' && !m.has(ch.reference)) {
        m.set(ch.reference, color);
      }
    });
    return m;
  }, [montage]);

  const labelRefs = useFacingLabels(names, positionOf, isActive);

  return (
    <group>
      {names.map((name) => {
        const pos = positionOf(name);
        const groupColor = electrodeGroupColor.get(name);
        const inMontage = groupColor !== undefined;
        const active = isActive(name);
        const color = inMontage ? (active ? '#ffffff' : groupColor!) : '#555555';
        const scale = active ? 1.5 : 1.0;

        return (
          <mesh
            key={name}
            position={pos}
            scale={[scale, scale, scale]}
            geometry={MARKER_GEOMETRY}
            material={markerMaterial(color, active)}
            onPointerDown={(e) => {
              e.stopPropagation();
              onBeginDrag(name);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHoverElectrodes(new Set([name]));
              document.body.style.cursor = 'grab';
            }}
            onPointerOut={(e) => {
              e.stopPropagation();
              setHoverElectrodes(new Set());
              document.body.style.cursor = 'auto';
            }}
          >
            <Html distanceFactor={5} zIndexRange={[100, 0]} position={[0, 0.05, 0]}>
              <div
                ref={el => { labelRefs.current[name] = el; }}
                style={{ opacity: 0.7 }}
                className={`px-1 py-0.5 rounded text-[10px] font-bold ${active ? 'bg-white text-black' : 'bg-black/50 text-white'}`}
              >
                {name}
              </div>
            </Html>
          </mesh>
        );
      })}
    </group>
  );
}

function MontageEdges({
  montage,
  positionOf,
}: {
  montage: Montage;
  positionOf: (name: string) => [number, number, number];
}) {
  const [, bumpHighlight] = React.useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribe(bumpHighlight), []);

  const activeChannels = getActiveChannels();
  const activeElectrodes = getActiveElectrodes();

  return (
    <group>
      {montage.channels.map((ch, i) => {
        if (!ch.active || ch.active === 'ECG') return null;

        const isChannelActive = activeChannels.has(i);
        const isElectrodeActive = (ch.active && activeElectrodes.has(ch.active as string)) || (ch.reference && activeElectrodes.has(ch.reference as string));
        const isActive = isChannelActive || isElectrodeActive;

        const p1 = positionOf(ch.active as string);
        let p2: [number, number, number] | undefined;

        if (ch.reference && ch.reference !== 'AVG' && ch.reference !== 'CONTRA' && ch.reference !== 'IPSI') {
          p2 = positionOf(ch.reference as string);
        } else if (ch.reference === 'AVG' || ch.reference === 'CONTRA' || ch.reference === 'IPSI') {
          p2 = [0, 0, 0]; // Center point
        }

        if (!p1 || !p2) return null;

        const color = GROUP_COLORS[ch.group] || '#ffffff';

        return (
          <Line
            key={i}
            points={[p1, p2]}
            color={isActive ? '#ffffff' : color}
            lineWidth={isActive ? 3 : 1}
            transparent
            opacity={isActive ? 0.8 : 0.2}
          />
        );
      })}
    </group>
  );
}

export function HeadModel3D({ montage, headOpacity = 0.3, brainOpacity = 0.8 }: HeadModel3DProps) {
  // Visual-only marker repositioning. These overrides move where a marker is
  // *drawn* (and the montage edges that touch it); they are deliberately NOT fed
  // back into electrodePositions3D, which forward.ts reads to build the leadfield.
  // So the recorded signal stays exactly as calibrated — dragging is for
  // inspecting layout / spatial relationships, not for re-deriving the montage.
  const [overrides, setOverrides] = useState<Record<string, [number, number, number]>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  // The drag target is also mirrored in a ref so the scalp's per-move handler
  // reads the current electrode without waiting for a re-render.
  const draggingRef = useRef<string | null>(null);
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);

  const positionOf = (name: string): [number, number, number] =>
    overrides[name] ?? electrodePositions3D[name];

  const beginDrag = (name: string) => {
    draggingRef.current = name;
    setDragging(name);
    // Suspend the camera controls immediately (not on next render) so the same
    // pointerdown that grabs the marker doesn't also start an orbit.
    if (controlsRef.current) controlsRef.current.enabled = false;
    document.body.style.cursor = 'grabbing';
  };

  const dragTo = (point: THREE.Vector3) => {
    const name = draggingRef.current;
    if (!name) return;
    setOverrides(o => ({ ...o, [name]: [point.x, point.y, point.z] }));
  };

  // Pointer-up can land anywhere (off the head, outside the canvas), so end the
  // drag from a window listener rather than a mesh handler.
  useEffect(() => {
    if (!dragging) return;
    const end = () => {
      draggingRef.current = null;
      setDragging(null);
      if (controlsRef.current) controlsRef.current.enabled = true;
      document.body.style.cursor = 'auto';
    };
    window.addEventListener('pointerup', end);
    return () => window.removeEventListener('pointerup', end);
  }, [dragging]);

  const hasOverrides = Object.keys(overrides).length > 0;

  return (
    <div className="w-full h-full relative bg-slate-900" onContextMenu={(e) => e.preventDefault()}>
      {hasOverrides && (
        <button
          onClick={() => setOverrides({})}
          className="absolute top-2 right-2 z-10 px-2 py-1 rounded text-[11px] font-semibold bg-black/60 text-white hover:bg-black/80"
          title="Return every marker to its calibrated 10-20 position"
        >
          Reset positions
        </button>
      )}
      {/*
        `frameloop="demand"` because this panel is a static anatomical reference,
        not an animation: nothing in it moves unless the user moves the camera or
        a highlight changes. Left on the default continuous loop it re-rendered
        the scalp and cortex 60 times a second forever, alongside the EEG canvas's
        own animation loop, for an image that had not changed. R3F invalidates on
        every React commit, so montage/opacity/highlight changes still repaint.

        `dpr` capped at 2: a 4K or Retina panel would otherwise rasterise both
        surfaces at 3-4x the pixels for no visible gain on a translucent head.
      */}
      <Canvas camera={{ position: [0, 0, 3], fov: 45 }} frameloop="demand" dpr={[1, 2]}>
        {/*
          A pial surface reads as folds through the highlight/shadow gradient
          crossing each gyrus, not through vertex count — there's no shadow map
          here to carve out the sulci, so that gradient is the only depth cue
          available. The previous balance (0.4 ambient + 0.8 key + 0.3 fill) sat
          the fill light too close to the key, which flattened that gradient into
          a near-uniform pink. Dropping ambient and fill and raising the key
          steepens the falloff across each fold so the surface reads as terrain
          instead of a smooth blob; the fill stays on only to keep the far side
          of the brain from going pure black.
        */}
        <ambientLight intensity={0.22} />
        <directionalLight position={[5, 5, 5]} intensity={1.1} />
        <directionalLight position={[-3, 2, -5]} intensity={0.18} />

        <group>
          <HeadSkin opacity={headOpacity} dragActive={dragging !== null} onDragTo={dragTo} />
          <Brain opacity={brainOpacity} />
          <ElectrodeMarkers montage={montage} positionOf={positionOf} onBeginDrag={beginDrag} />
          <MontageEdges montage={montage} positionOf={positionOf} />
        </group>

        {/*
          Damping still settles correctly under `frameloop="demand"`: drei's
          OrbitControls calls controls.update() from its own useFrame, and the
          resulting `change` event invalidates, so the post-release glide keeps
          requesting frames until it comes to rest and then stops on its own.
        */}
        <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.05} />
      </Canvas>
    </div>
  );
}
