import React, { useMemo, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
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

// Loads one of the preprocessed Colin27 surface meshes (see
// scripts/src/processColinMesh.ts) — real scalp/cortical anatomy from the
// public-domain Colin27 atlas, not a procedural approximation. Binary layout:
// [vertexCount: u32][faceCount: u32][positions: f32 * vertexCount * 3][indices: u32 * faceCount * 3].
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
        const indices = new Uint32Array(buf, 8 + vCount * 3 * 4, fCount * 3);
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
  const lh = useMeshBin('lh_pial.bin');
  const rh = useMeshBin('rh_pial.bin');
  const material = (
    <meshStandardMaterial color="#d4a0a0" transparent opacity={opacity} roughness={0.85} metalness={0.05} />
  );
  return (
    <group>
      {lh && <mesh geometry={lh}>{material}</mesh>}
      {rh && <mesh geometry={rh}>{material}</mesh>}
    </group>
  );
}

function HeadSkin({ opacity = 0.3 }: { opacity?: number }) {
  const skin = useMeshBin('skin.bin');
  if (!skin) return null;
  return (
    <mesh geometry={skin}>
      <meshPhysicalMaterial color="#e8beac" transparent opacity={opacity} roughness={0.6} transmission={0.2} />
    </mesh>
  );
}

function ElectrodeMarkers({ montage }: { montage: Montage }) {
  const [highlightState, setHighlightState] = useState(getHighlightState());
  
  useEffect(() => {
    return subscribe(() => {
      setHighlightState(getHighlightState());
    });
  }, []);

  const activeElectrodes = getActiveElectrodes();

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
      {Object.entries(electrodePositions3D).map(([name, pos]) => {
        const groupColor = electrodeGroupColor.get(name);
        const inMontage = groupColor !== undefined;
        const isActive = activeElectrodes.has(name);
        const color = inMontage ? (isActive ? '#ffffff' : groupColor!) : '#555555';
        const scale = isActive ? 1.5 : 1.0;
        
        return (
          <mesh 
            key={name} 
            position={pos} 
            scale={[scale, scale, scale]}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHoverElectrodes(new Set([name]));
            }}
            onPointerOut={(e) => {
              e.stopPropagation();
              setHoverElectrodes(new Set());
            }}
            onClick={(e) => {
              e.stopPropagation();
              toggleClickElectrode(name);
            }}
          >
            <sphereGeometry args={[0.03, 16, 16]} />
            <meshStandardMaterial color={color} emissive={isActive ? color : '#000000'} emissiveIntensity={isActive ? 0.5 : 0} />
            <Html distanceFactor={5} zIndexRange={[100, 0]} position={[0, 0.05, 0]}>
              <div className={`px-1 py-0.5 rounded text-[10px] font-bold ${isActive ? 'bg-white text-black' : 'bg-black/50 text-white'}`}>
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

export function HeadModel3D({ montage, headOpacity = 0.3, brainOpacity = 0.8 }: HeadModel3DProps) {
  return (
    <div className="w-full h-full relative bg-slate-900">
      <Canvas camera={{ position: [0, 0, 3], fov: 45 }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
        <directionalLight position={[-3, 2, -5]} intensity={0.3} />
        
        <group>
          <HeadSkin opacity={headOpacity} />
          <Brain opacity={brainOpacity} />
          <ElectrodeMarkers montage={montage} />
          <MontageEdges montage={montage} />
        </group>
        
        <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
      </Canvas>
    </div>
  );
}
