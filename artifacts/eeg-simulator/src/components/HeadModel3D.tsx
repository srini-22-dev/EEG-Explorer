import React, { useMemo, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { Montage, GROUP_COLORS } from '../utils/montages';
import { electrodePositions3D } from '../utils/electrodePositions3D';
import {
  subscribe,
  getHighlightState,
  setHoverElectrodes,
  toggleClickElectrode,
  getActiveElectrodes,
  getActiveChannels,
  getChannelsUsingElectrode,
  getElectrodesForChannel
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

// Loads one of the preprocessed surface meshes (see scripts/src/processColinMesh.ts
// and scripts/src/processHeadMesh.ts). Binary layout:
// [vertexCount: u32][faceCount: u32][positions: f32 * vertexCount * 3][indices: u32 * faceCount * 3].
//
// A backstop, not the fix. A mesh wound clockwise makes computeVertexNormals()
// produce normals pointing *into* the surface, and three.js's default FrontSide
// culling then renders it inside-out — you see the far interior wall through the
// near surface, at any opacity. The Colin27 exports used to arrive that way because
// their axis map mirrored the head; that is corrected upstream now
// (scripts/src/processColinMesh.ts, scripts/src/fixMeshFrame.ts) and this branch no
// longer fires. It stays because a re-export with a flipped axis is a silent
// regression otherwise, and because the alternative — DoubleSide — would hide the
// problem while doubling the lit-surface count and flattening the brain's shading.
function useMeshBin(file: string): THREE.BufferGeometry | null {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    let cancelled = false;
    const url = `${import.meta.env.BASE_URL}models/${file}`;
    fetch(url)
      .then(r => r.arrayBuffer())
      .then(buf => {
        if (cancelled) return;
        const view = new DataView(buf);
        const vCount = view.getUint32(0, true);
        const fCount = view.getUint32(4, true);
        const positions = new Float32Array(buf, 8, vCount * 3);
        const indices = new Uint32Array(buf, 8 + vCount * 3 * 4, fCount * 3).slice();

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
        setGeometry(geo);
      });
    return () => { cancelled = true; };
  }, [file]);

  return geometry;
}

function Brain({ opacity = 0.8 }: { opacity?: number }) {
  // Single Surface-Nets cortex from the skull-stripped MNI152 volume, built in
  // the same pass and shared normalisation as skin.bin (scripts/src/
  // buildHeadAndBrain.ts), so it is the SAME subject as the scalp and seated
  // inside it by construction — not the former Colin27 pial approximation.
  const brain = useMeshBin('brain.bin');
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
 * The scalp shell, extracted from the MNI152_T1_1mm template. This is the same
 * surface `scripts/src/build1020.ts` constructs the electrode positions on, so
 * the markers sit on the rendered head by construction rather than by
 * coincidence. It is the same subject as brain.bin — both come from the two
 * co-registered MNI152 templates in the same build pass.
 *
 * Rendered after the brain with depth writing disabled while see-through, so the
 * cortex behind it composites correctly instead of being depth-rejected.
 */
function HeadSkin({ opacity = 0.3 }: { opacity?: number }) {
  const skin = useMeshBin('skin.bin');
  if (!skin) return null;
  const isTransparent = opacity < 1;
  return (
    <mesh geometry={skin} renderOrder={1}>
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

function ElectrodeMarkers({ montage }: { montage: Montage }) {
  const [highlightState, setHighlightState] = useState(getHighlightState());
  const controls = useThree(s => s.controls) as any;

  useEffect(() => {
    return subscribe(() => {
      setHighlightState(getHighlightState());
    });
  }, []);

  // TEMP DRAG EDITING — hand-position markers to seed electrodePositions3D.ts.
  // Left-drag slides a marker along the scalp: the pointer ray is cast against
  // skin.bin and the marker snaps to the nearest surface hit, seated 2% proud
  // (matching build1020's seating), so it stays on the head as you move it.
  // Right/middle button is left for the camera (OrbitControls). Live positions
  // live in posRef, mirrored to window.__electrodePositions;
  // window.__dumpElectrodes() prints the table. Remove this block (and the
  // CameraBridge/useThree import) when done.
  const posRef = React.useRef<Record<string, [number, number, number]>>(
    JSON.parse(JSON.stringify(electrodePositions3D)),
  );
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  const drag = React.useRef<{ name: string } | null>(null);
  const raycaster = React.useRef(new THREE.Raycaster());
  // An invisible copy of the scalp to raycast against. DoubleSide so a hit
  // registers regardless of the mesh's triangle winding; the geometry is already
  // in scene space with no group transform, so identity matrixWorld is correct.
  const skinGeo = useMeshBin('skin.bin');
  const skinPick = useMemo(() => {
    if (!skinGeo) return null;
    const m = new THREE.Mesh(skinGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.updateMatrixWorld();
    return m;
  }, [skinGeo]);
  // The brain is the other occluder for the labels below (its geometry is already
  // in scene space, so identity matrixWorld is correct, like skinPick).
  const brainGeo = useMeshBin('brain.bin');
  const brainPick = useMemo(() => {
    if (!brainGeo) return null;
    const m = new THREE.Mesh(brainGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.updateMatrixWorld();
    return m;
  }, [brainGeo]);
  // Occlusion targets for drei <Html> raycast mode. It reads each entry's
  // `.current`, so wrap the meshes as refs. A label whose electrode sits behind
  // the scalp/cortex from the camera is dimmed rather than hidden (see below).
  const occluders = useMemo(
    () => [skinPick, brainPick].filter(Boolean).map(m => ({ current: m })) as React.RefObject<THREE.Object3D>[],
    [skinPick, brainPick],
  );
  const [occluded, setOccluded] = useState<Record<string, boolean>>({});
  const ORDER = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T3', 'C3', 'Cz', 'C4', 'T4',
    'T5', 'P3', 'Pz', 'P4', 'T6', 'O1', 'O2', 'A1', 'A2'];
  useEffect(() => {
    (window as any).__electrodePositions = posRef.current;
    (window as any).__dumpElectrodes = () =>
      ORDER.map(k => `  ${k}: [${posRef.current[k].map(n => +n.toFixed(4)).join(', ')}],`).join('\n');
  }, []);

  const onDown = (name: string) => (e: any) => {
    const button = e.nativeEvent ? e.nativeEvent.button : e.button;
    if (button !== 0) return; // left places; leave right/middle for the camera
    e.stopPropagation();
    drag.current = { name };
    if (controls) controls.enabled = false;
    e.target.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: any) => {
    if (!drag.current || !skinPick) return;
    e.stopPropagation();
    raycaster.current.set(e.ray.origin, e.ray.direction);
    const hits = raycaster.current.intersectObject(skinPick, false);
    if (hits.length === 0) return; // pointer off the scalp — ignore
    const h = hits[0].point; // nearest surface hit (the scalp facing the camera)
    posRef.current[drag.current.name] = [h.x * 1.02, h.y * 1.02, h.z * 1.02];
    force();
  };
  const onUp = (e: any) => {
    if (!drag.current) return;
    const p = posRef.current[drag.current.name];
    // eslint-disable-next-line no-console
    console.log(`${drag.current.name}: [${p.map(n => +n.toFixed(4)).join(', ')}]`);
    drag.current = null;
    if (controls) controls.enabled = true;
    e.target.releasePointerCapture?.(e.pointerId);
  };

  const activeElectrodes = getActiveElectrodes();

  // Channel-side highlights (e.g. hovering a trace on the EEG canvas) don't touch
  // hoveredElectrodes/clickedElectrodes directly, so also light up the electrodes
  // belonging to any active channel.
  const channelElectrodes = new Set<string>();
  getActiveChannels().forEach(idx => {
    getElectrodesForChannel(idx, montage).forEach(el => channelElectrodes.add(el));
  });

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

  return (
    <group>
      {Object.keys(posRef.current).map((name) => {
        const pos = posRef.current[name];
        const groupColor = electrodeGroupColor.get(name);
        const inMontage = groupColor !== undefined;
        const isActive = activeElectrodes.has(name) || channelElectrodes.has(name);
        const color = inMontage ? (isActive ? '#ffffff' : groupColor!) : '#555555';
        const scale = isActive ? 1.5 : 1.0;

        return (
          <mesh
            key={name}
            position={pos}
            scale={[scale, scale, scale]}
            onPointerDown={onDown(name)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHoverElectrodes(new Set([name]));
            }}
            onPointerOut={(e) => {
              e.stopPropagation();
              setHoverElectrodes(new Set());
            }}
          >
            <sphereGeometry args={[0.03, 16, 16]} />
            <meshStandardMaterial color={color} emissive={isActive ? color : '#000000'} emissiveIntensity={isActive ? 0.5 : 0} />
            <Html
              distanceFactor={5}
              zIndexRange={[100, 0]}
              position={[0, 0.05, 0]}
              occlude={occluders.length ? occluders : undefined}
              onOcclude={(hidden) => setOccluded(o => (o[name] === hidden ? o : { ...o, [name]: hidden }))}
            >
              <div
                // Labels are DOM overlays, so they'd otherwise sit on top of the
                // head at full strength even when their electrode is round the
                // back. Drop occluded ones' opacity hard so the near-side layout
                // stays readable; active labels keep a little more presence.
                style={{ opacity: occluded[name] ? (isActive ? 0.3 : 0.12) : undefined }}
                className={`px-1 py-0.5 rounded text-[10px] font-bold opacity-70 ${isActive ? 'bg-white text-black' : 'bg-black/50 text-white'}`}
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

function MontageEdges({ montage }: { montage: Montage }) {
  const [highlightState, setHighlightState] = useState(getHighlightState());
  
  useEffect(() => {
    return subscribe(() => {
      setHighlightState(getHighlightState());
    });
  }, []);

  const activeChannels = getActiveChannels();
  const activeElectrodes = getActiveElectrodes();

  return (
    <group>
      {montage.channels.map((ch, i) => {
        if (!ch.active || ch.active === 'ECG') return null;
        
        const isChannelActive = activeChannels.has(i);
        const isElectrodeActive = ch.active && activeElectrodes.has(ch.active as string) || (ch.reference && activeElectrodes.has(ch.reference as string));
        const isActive = isChannelActive || isElectrodeActive;
        
        let p1 = electrodePositions3D[ch.active as string];
        let p2: [number, number, number] | undefined;

        if (ch.reference && ch.reference !== 'AVG' && ch.reference !== 'CONTRA' && ch.reference !== 'IPSI') {
          p2 = electrodePositions3D[ch.reference as string];
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

// TEMP DEBUG BRIDGE — exposes camera + controls on window so screenshots can be
// taken from exact, repeatable angles while hand-tuning electrode positions.
// Remove before finishing.
function CameraBridge() {
  const camera = useThree(s => s.camera);
  const controls = useThree(s => s.controls);
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => {
    (window as any).__three = { camera, controls, invalidate };
  }, [camera, controls, invalidate]);
  return null;
}

export function HeadModel3D({ montage, headOpacity = 0.3, brainOpacity = 0.8 }: HeadModel3DProps) {
  return (
    <div className="w-full h-full relative bg-slate-900" onContextMenu={(e) => e.preventDefault()}>
      <Canvas camera={{ position: [0, 0, 3], fov: 45 }}>
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
          <HeadSkin opacity={headOpacity} />
          <Brain opacity={brainOpacity} />
          <ElectrodeMarkers montage={montage} />
          <MontageEdges montage={montage} />
        </group>

        <CameraBridge />
        <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
      </Canvas>
    </div>
  );
}
