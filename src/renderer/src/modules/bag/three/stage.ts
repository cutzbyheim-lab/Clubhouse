import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** A studio scene for club heads: soft room reflections plus a key light. */
export function createStage(renderer: THREE.WebGLRenderer): { scene: THREE.Scene; dispose(): void } {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.03).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.95;
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(20, 40, 30);
  const rim = new THREE.DirectionalLight(0xbfd8c6, 0.7);
  rim.position.set(-30, 15, -25);
  scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.15));
  return {
    scene,
    dispose() {
      env.dispose();
      pmrem.dispose();
      room.dispose();
    },
  };
}

export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.localClippingEnabled = true; // wood crowns are split from the body with clipping planes
}

export type View = 'address' | 'loft' | 'top' | 'hero';

/** Where the camera sits, as a direction from the head's centre. */
const VIEW_DIR: Record<View, THREE.Vector3> = {
  hero: new THREE.Vector3(0.55, 0.42, 1),
  address: new THREE.Vector3(0.0, 0.18, 1),
  loft: new THREE.Vector3(1, 0.06, 0.0001),
  top: new THREE.Vector3(0.0001, 1, 0.35),
};

/** Points the camera at the head from a view, at a distance that fits it. */
export function frame(camera: THREE.PerspectiveCamera, head: THREE.Object3D, view: View, fill = 1.0, mirrored = false): THREE.Vector3 {
  const box = new THREE.Box3().setFromObject(head);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dir = VIEW_DIR[view].clone();
  if (mirrored) dir.x *= -1;
  dir.normalize();
  const dist = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * (1.02 / fill);
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  camera.near = dist / 50;
  camera.far = dist * 50;
  camera.lookAt(sphere.center);
  camera.updateProjectionMatrix();
  return sphere.center;
}
