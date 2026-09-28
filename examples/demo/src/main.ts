import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PathFollower, parsePathFile, type Path } from 'three-path-editor';
import { PathEditor, PathEditorPanel } from 'three-path-editor/editor';

// ---------------------------------------------------------------------------
// 1. A stand-in "existing game": scene, camera, renderer, loop. The package
//    never creates any of these — it plugs into them.
// ---------------------------------------------------------------------------
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(app.clientWidth, app.clientHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);
scene.fog = new THREE.Fog(0x0e1116, 120, 260);

const camera = new THREE.PerspectiveCamera(55, app.clientWidth / app.clientHeight, 0.1, 1000);
camera.position.set(55, 55, 70);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 5, 0);
orbit.update();

scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x303030, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(40, 80, 20);
scene.add(sun);

// Simple "map": ground, grid and a few buildings.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x1f2a22 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
scene.add(new THREE.GridHelper(200, 40, 0x3d4d40, 0x2a352c));
const buildingMat = new THREE.MeshStandardMaterial({ color: 0x5b6472 });
for (let i = 0; i < 14; i++) {
  const h = 4 + Math.random() * 14;
  const b = new THREE.Mesh(new THREE.BoxGeometry(6, h, 6), buildingMat);
  b.position.set((Math.random() - 0.5) * 120, h / 2, (Math.random() - 0.5) * 120);
  if (b.position.length() > 30) scene.add(b);
}

// Game objects. Note: the helicopter model faces -Z, the car faces +X, to
// show how orientation settings compensate for model conventions.
function makeHelicopter(): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.2, 3, 4, 8), new THREE.MeshStandardMaterial({ color: 0xd9a640 }));
  body.rotation.x = Math.PI / 2;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 4), body.material);
  tail.position.z = 3.5; // tail at +Z, so the nose points -Z
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.1, 0.4), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  rotor.position.y = 1.6;
  rotor.name = 'rotor';
  g.add(body, tail, rotor);
  return g;
}
function makeCar(): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(4, 1.2, 2), new THREE.MeshStandardMaterial({ color: 0x3f7fff }));
  body.position.y = 0.8;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 1.8), new THREE.MeshStandardMaterial({ color: 0xa8c4ff }));
  cabin.position.set(-0.3, 1.8, 0); // cabin towards -X, so the car faces +X
  g.add(body, cabin);
  return g;
}
const helicopter = makeHelicopter();
helicopter.position.set(0, 10, 0);
const car = makeCar();
scene.add(helicopter, car);

// ---------------------------------------------------------------------------
// 2. The editor, attached to the existing scene/camera/renderer.
// ---------------------------------------------------------------------------
const editor = new PathEditor({
  scene,
  camera,
  renderer,
  cameraControls: orbit, // disabled automatically while dragging a gizmo
  view: { grid: false, labels: true },
});
editor.enable();
const panel = new PathEditorPanel(editor, { container: app });
// Exposed for poking around in devtools.
Object.assign(window, { demo: { editor, scene, camera, renderer, THREE } });

// ---------------------------------------------------------------------------
// 3. Runtime usage (what a production build would ship): a PathFollower.
// ---------------------------------------------------------------------------
let carFollower: PathFollower | null = null;
function attachGameplay(paths: Path[]) {
  carFollower?.dispose();
  carFollower = null;
  const loop = paths.find((p) => p.id === 'ground-loop');
  if (loop) {
    carFollower = new PathFollower({
      object: car,
      path: loop,
      speed: 12,
      loop: true,
      orientation: { forward: [1, 0, 0], yawOnly: true, smoothing: 10 },
    });
  }
  const route = paths.find((p) => p.id === 'helicopter-route');
  if (route) {
    // Preview the real game object with its -Z forward axis.
    editor.attachPreview(helicopter, route, { speed: 15, orientation: { forward: [0, 0, -1], smoothing: 6 } });
  }
}

async function loadDemoJson() {
  const response = await fetch('/paths/demo.paths.json');
  const paths = editor.import(await response.json());
  attachGameplay(paths);
}

const STORAGE_KEY = 'three-path-editor-demo';
document.getElementById('save')!.onclick = () => {
  localStorage.setItem(STORAGE_KEY, editor.exportString());
};
document.getElementById('load')!.onclick = () => {
  const json = localStorage.getItem(STORAGE_KEY);
  if (json) attachGameplay(editor.import(json));
};
document.getElementById('reload')!.onclick = () => void loadDemoJson();
const toggle = () => {
  editor.toggle();
  panel.refresh();
};
document.getElementById('toggle')!.onclick = toggle;
addEventListener('keydown', (e) => {
  if (e.code === 'KeyE' && !(e.target instanceof HTMLInputElement)) toggle();
});

// Show that the runtime API needs nothing from the editor.
console.log('Runtime-only parse check:', parsePathFile({ version: 1, paths: [] }));

// ---------------------------------------------------------------------------
// 4. The host's own loop — the package only gets `update(dt)` calls.
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  helicopter.getObjectByName('rotor')!.rotation.y += dt * 20;
  carFollower?.update(dt);
  editor.update(dt);
  orbit.update();
  renderer.render(scene, camera);
});

addEventListener('resize', () => {
  camera.aspect = app.clientWidth / app.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(app.clientWidth, app.clientHeight);
});

void loadDemoJson();
