import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { HoleTrack } from '@shared/dto';
import type { HoleGeometry } from '@shared/schemas';
import { Segmented } from '@/design/controls';
import { buildHoleScene, type SceneHandles } from './holeScene';

type View = 'tee' | 'overhead' | 'green';

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Owns the WebGL renderer, camera and controls. The scene is rebuilt when the
 * hole or the visible tracks change; GPU resources are disposed every time.
 */
export function HoleViewer({
  geometry,
  holeNumber,
  tracks,
  markers,
}: {
  geometry: HoleGeometry;
  holeNumber: number;
  tracks: { track: HoleTrack; color: string }[];
  markers: { m: number; label: string }[];
}) {
  const mount = useRef<HTMLDivElement>(null);
  const engine = useRef<{ renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; controls: OrbitControls } | null>(null);
  const handles = useRef<SceneHandles | null>(null);
  const tween = useRef<{ from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t0: number } | null>(null);
  const [view, setView] = useState<View>('tee');
  const [failed, setFailed] = useState<string | null>(null);

  // Renderer lifecycle: once per mount.
  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch {
      setFailed('3D needs graphics acceleration, which isn\'t available on this computer right now.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '3D view of the hole. Drag to orbit, scroll to zoom.');
    renderer.domElement.setAttribute('role', 'img');

    const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 4000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 8;
    controls.maxDistance = 1400;
    engine.current = { renderer, camera, controls };

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const tw = tween.current;
      if (tw) {
        const k = Math.min(1, (now - tw.t0) / 900);
        const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
        camera.position.lerpVectors(tw.from[0], tw.to[0], e);
        controls.target.lerpVectors(tw.from[1], tw.to[1], e);
        if (k >= 1) tween.current = null;
      }
      controls.update();
      if (handles.current) renderer.render(handles.current.scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      handles.current?.dispose();
      handles.current = null;
      renderer.dispose();
      renderer.domElement.remove();
      engine.current = null;
    };
  }, []);

  // Scene: rebuilt for each hole / track selection.
  useEffect(() => {
    const eng = engine.current;
    if (!eng) return;
    handles.current?.dispose();
    const h = buildHoleScene({ geometry, holeNumber, tracks, markers });
    handles.current = h;
    const v = h.views[view];
    eng.camera.position.copy(v.pos);
    eng.controls.target.copy(v.target);
    eng.controls.update();
    // `view` is applied by the effect below; the scene shouldn't rebuild on view change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, holeNumber, tracks, markers]);

  const goTo = (next: View) => {
    setView(next);
    const eng = engine.current;
    const h = handles.current;
    if (!eng || !h) return;
    const target = h.views[next];
    if (prefersReducedMotion()) {
      eng.camera.position.copy(target.pos);
      eng.controls.target.copy(target.target);
      return;
    }
    tween.current = {
      from: [eng.camera.position.clone(), eng.controls.target.clone()],
      to: [target.pos.clone(), target.target.clone()],
      t0: performance.now(),
    };
  };

  if (failed) {
    return <div className="flex h-full items-center justify-center p-8 text-center text-sm text-ink-muted">{failed}</div>;
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-panel">
      <div ref={mount} className="absolute inset-0" />
      <div className="absolute top-3 right-3">
        <Segmented
          label="Camera"
          value={view}
          options={[
            { value: 'tee', label: 'From the tee' },
            { value: 'overhead', label: 'Overhead' },
            { value: 'green', label: 'Green' },
          ]}
          onChange={goTo}
        />
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-control bg-ground/80 px-2.5 py-1.5 text-xs text-ink-muted">
        Drag to orbit · right-drag to pan · scroll to zoom
      </div>
    </div>
  );
}
