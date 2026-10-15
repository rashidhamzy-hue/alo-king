import React, {useMemo} from 'react';
import {ThreeCanvas} from '@remotion/three';
import {useThree} from '@react-three/fiber';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import {useVideoConfig} from 'remotion';
import {quadToMatrix3d} from '../lib/homography';
import {C, Tone} from '../brand/tokens';

/**
 * A phone built from Three.js primitives: an extruded rounded-rectangle body with a bevel, a glass face, side buttons and
 * a camera ring. The screen content is ordinary HTML laid on the glass with a homography, so text stays sharp at any angle.
 * The pose is a pure function of the frame (no useFrame), as Remotion requires.
 */
export type Pose = {x: number; y: number; z: number; rx: number; ry: number; rz: number; s: number};

export const CAMERA = {fov: 30, z: 8.3};
const BODY = {w: 1.0, h: 2.06, depth: 0.075, bevel: 0.022, r: 0.165};
const GLASS = {w: 0.93, h: 1.99, r: 0.135};
export const SCREEN_PX = {w: 390, h: 834};

const roundedRect = (w: number, h: number, r: number) => {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
};

const Environment: React.FC = () => {
  const {gl, scene} = useThree();
  useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }, [gl, scene]);
  return null;
};

const frontZ = BODY.depth / 2 + BODY.bevel;

const PhoneMesh: React.FC<{pose: Pose; tone: Tone}> = ({pose, tone}) => {
  const bodyGeo = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(roundedRect(BODY.w - 2 * BODY.bevel, BODY.h - 2 * BODY.bevel, BODY.r - BODY.bevel), {
      depth: BODY.depth,
      bevelEnabled: true,
      bevelThickness: BODY.bevel,
      bevelSize: BODY.bevel,
      bevelSegments: 6,
      curveSegments: 24,
    });
    g.translate(0, 0, -BODY.depth / 2);
    return g;
  }, []);
  const glassGeo = useMemo(() => new THREE.ShapeGeometry(roundedRect(GLASS.w + 0.02, GLASS.h + 0.02, GLASS.r + 0.01), 24), []);
  const frame = tone === 'night' ? '#3a3340' : '#d9c7a6';
  return (
    <group position={[pose.x, pose.y, pose.z]} rotation={[pose.rx, pose.ry, pose.rz]} scale={pose.s}>
      <mesh geometry={bodyGeo}>
        <meshPhysicalMaterial color={frame} metalness={0.85} roughness={0.32} clearcoat={0.6} clearcoatRoughness={0.25} />
      </mesh>
      {/* Glass face (the HTML screen sits on top of this). */}
      <mesh geometry={glassGeo} position={[0, 0, frontZ + 0.001]}>
        <meshPhysicalMaterial color="#050407" metalness={0.2} roughness={0.08} clearcoat={1} />
      </mesh>
      {/* Side buttons. */}
      {[
        [-1, 0.52, 0.16],
        [-1, 0.3, 0.16],
        [1, 0.42, 0.28],
      ].map(([side, y, len], i) => (
        <mesh key={i} position={[(side * BODY.w) / 2 + side * 0.006, y, 0]}>
          <boxGeometry args={[0.02, len, 0.05]} />
          <meshStandardMaterial color={frame} metalness={0.9} roughness={0.3} />
        </mesh>
      ))}
      {/* Back camera ring, seen when the phone turns. */}
      <mesh position={[-0.24, 0.72, -frontZ - 0.012]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.025, 40]} />
        <meshPhysicalMaterial color="#0c0a0e" metalness={0.6} roughness={0.2} clearcoat={1} />
      </mesh>
    </group>
  );
};

const project = (pose: Pose, width: number, height: number) => {
  const cam = new THREE.PerspectiveCamera(CAMERA.fov, width / height, 0.1, 100);
  cam.position.set(0, 0, CAMERA.z);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(pose.x, pose.y, pose.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.rx, pose.ry, pose.rz)),
    new THREE.Vector3(pose.s, pose.s, pose.s),
  );
  const z = frontZ + 0.003;
  const corners = [
    [-GLASS.w / 2, GLASS.h / 2],
    [GLASS.w / 2, GLASS.h / 2],
    [GLASS.w / 2, -GLASS.h / 2],
    [-GLASS.w / 2, -GLASS.h / 2],
  ].map(([x, y]) => {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(m).project(cam);
    return [((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height] as [number, number];
  }) as [[number, number], [number, number], [number, number], [number, number]];
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(m);
  const centre = new THREE.Vector3(0, 0, z).applyMatrix4(m);
  const facing = normal.dot(new THREE.Vector3().subVectors(cam.position, centre)) > 0;
  return {corners, facing};
};

export const Phone3D: React.FC<{pose: Pose; tone: Tone; children: React.ReactNode; glow?: number}> = ({pose, tone, children, glow = 1}) => {
  const {width, height} = useVideoConfig();
  const {corners, facing} = project(pose, width, height);
  const transform = quadToMatrix3d(SCREEN_PX.w, SCREEN_PX.h, corners);
  const cx = (corners[0][0] + corners[2][0]) / 2;
  const cy = (corners[0][1] + corners[2][1]) / 2;
  const night = tone === 'night';
  return (
    <>
      {/* Light behind the phone: a warm shop-sign glow at night, a soft shadow by day. */}
      <div
        style={{
          position: 'absolute',
          left: cx - 520,
          top: cy - 640,
          width: 1040,
          height: 1280,
          borderRadius: '50%',
          background: night
            ? `radial-gradient(closest-side, rgba(244,182,60,${0.28 * glow}), rgba(244,182,60,0) 70%)`
            : `radial-gradient(closest-side, rgba(133,84,0,${0.16 * glow}), rgba(133,84,0,0) 70%)`,
          pointerEvents: 'none',
        }}
      />
      <ThreeCanvas width={width} height={height} camera={{fov: CAMERA.fov, position: [0, 0, CAMERA.z], near: 0.1, far: 100}} gl={{antialias: true}} style={{position: 'absolute', inset: 0}}>
        <Environment />
        <ambientLight intensity={night ? 0.35 : 0.7} />
        <directionalLight position={[3, 4, 6]} intensity={night ? 1.2 : 1.6} />
        <directionalLight position={[-4, 2, -2]} intensity={night ? 2.4 : 0.8} color={night ? C.gold : '#ffffff'} />
        <pointLight position={[2.5, -2, 3]} intensity={night ? 6 : 2} color={night ? C.goldHi : '#ffffff'} distance={12} />
        <PhoneMesh pose={pose} tone={tone} />
      </ThreeCanvas>
      {facing ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: SCREEN_PX.w,
            height: SCREEN_PX.h,
            transformOrigin: '0 0',
            transform,
            borderRadius: 52,
            overflow: 'hidden',
            backfaceVisibility: 'hidden',
          }}
        >
          {children}
          {/* Glass sheen that slides with the turn. */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(${115 + pose.ry * 60}deg, rgba(255,255,255,0) 30%, rgba(255,255,255,${night ? 0.07 : 0.12}) 45%, rgba(255,255,255,0) 60%)`,
              pointerEvents: 'none',
            }}
          />
        </div>
      ) : null}
    </>
  );
};
