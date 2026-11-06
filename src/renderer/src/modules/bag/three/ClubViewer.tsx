import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Segmented } from '@/design/controls';
import { buildClub, contactShadow, specKey, type BuiltClub, type ClubSpec } from './clubModel';
import { configureRenderer, createStage, frame, type View } from './stage';

const VIEWS: Array<{ value: View; label: string }> = [
  { value: 'hero', label: '3/4' },
  { value: 'address', label: 'Face' },
  { value: 'loft', label: 'Loft' },
  { value: 'top', label: 'Top' },
];

/**
 * An interactive 3D club head at its real loft and lie. Drag to turn it,
 * scroll to zoom; it slowly turns by itself until touched.
 */
export function ClubViewer({ spec, height = 240, caption }: { spec: ClubSpec; height?: number; caption?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ show(spec: ClubSpec, view: View): void } | null>(null);
  const [view, setView] = useState<View>('hero');
  const [failed, setFailed] = useState(false);
  const key = specKey(spec);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    configureRenderer(renderer);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    const stage = createStage(renderer);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.1;
    const stop = () => (controls.autoRotate = false);
    controls.addEventListener('start', stop);

    let club: BuiltClub | null = null;
    const shadow = contactShadow(20);
    stage.scene.add(shadow);

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    api.current = {
      show(next, v) {
        if (club) {
          stage.scene.remove(club.root);
          club.dispose();
        }
        club = buildClub(next, 34);
        stage.scene.add(club.root);
        const center = frame(camera, club.head, v, 0.9, next.leftHanded);
        controls.target.copy(center);
        controls.minDistance = camera.position.distanceTo(center) * 0.45;
        controls.maxDistance = camera.position.distanceTo(center) * 2.5;
        shadow.position.set(center.x, -0.01, center.z);
        controls.update();
      },
    };

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      controls.update();
      renderer.render(stage.scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.removeEventListener('start', stop);
      controls.dispose();
      club?.dispose();
      shadow.geometry.dispose();
      (shadow.material as THREE.MeshBasicMaterial).map?.dispose();
      (shadow.material as THREE.Material).dispose();
      stage.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    api.current?.show(spec, view);
    // spec is captured through key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, view]);

  if (failed) {
    return <div className="flex items-center justify-center rounded-panel bg-sunken text-sm text-ink-faint" style={{ height }}>3D view isn’t available on this computer</div>;
  }

  return (
    <figure className="relative overflow-hidden rounded-panel border border-rule bg-[radial-gradient(ellipse_at_50%_35%,#26302a_0%,#161a17_70%)]">
      <div ref={host} style={{ height }} className="cursor-grab active:cursor-grabbing" aria-label="3D club head. Drag to turn it." role="img" />
      <div className="absolute left-3 top-3">
        <Segmented label="Camera" value={view} onChange={setView} options={VIEWS} />
      </div>
      <figcaption className="figures pointer-events-none absolute bottom-2.5 left-3 right-3 flex justify-between text-xs text-ink-muted">
        <span>
          Loft <span className="text-ink">{spec.loftDeg.toFixed(1)}°</span> · Lie <span className="text-ink">{spec.lieDeg.toFixed(1)}°</span>
        </span>
        {caption && <span>{caption}</span>}
      </figcaption>
    </figure>
  );
}
