import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { buildClub, contactShadow, specKey, type ClubSpec } from './clubModel';
import { configureRenderer, createStage, frame } from './stage';

/*
 * Bag cards show a rendered picture of each club head. One hidden renderer
 * draws them all in turn (browsers cap live WebGL contexts), and pictures are
 * cached by spec so they're drawn once per session.
 */

const W = 300;
const H = 200;
const cache = new Map<string, string>();
let stage: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null;
let failed = false;

function getStage() {
  if (stage || failed) return stage;
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(2);
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0);
    configureRenderer(renderer);
    const { scene } = createStage(renderer);
    stage = { renderer, scene, camera: new THREE.PerspectiveCamera(30, W / H, 0.1, 1000) };
  } catch {
    failed = true;
  }
  return stage;
}

/** PNG data URL of the club head, or null if this computer can't render 3D. */
export function renderThumb(spec: ClubSpec): string | null {
  const key = specKey(spec);
  const hit = cache.get(key);
  if (hit) return hit;
  const s = getStage();
  if (!s) return null;
  const club = buildClub(spec, 14);
  const shadow = contactShadow(spec.kind === 'driver' ? 22 : 16);
  s.scene.add(club.root, shadow);
  const center = frame(s.camera, club.head, 'hero', 0.98, spec.leftHanded);
  shadow.position.x = center.x;
  shadow.position.z = center.z;
  s.renderer.render(s.scene, s.camera);
  const url = s.renderer.domElement.toDataURL('image/png');
  s.scene.remove(club.root, shadow);
  club.dispose();
  shadow.geometry.dispose();
  (shadow.material as THREE.MeshBasicMaterial).map?.dispose();
  (shadow.material as THREE.Material).dispose();
  cache.set(key, url);
  return url;
}

/** The thumbnail for a spec; draws after first paint so the page appears straight away. */
export function useClubThumb(spec: ClubSpec): string | null | undefined {
  const key = specKey(spec);
  const [state, setState] = useState<{ key: string; url: string | null } | null>(() => (cache.has(key) ? { key, url: cache.get(key) ?? null } : null));
  useEffect(() => {
    if (state?.key === key) return;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      if (!cancelled) setState({ key, url: renderThumb(spec) });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
    // spec is captured through key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state?.key === key ? state.url : undefined;
}
