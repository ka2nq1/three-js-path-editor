import { Mesh, type Object3D } from 'three';

/**
 * A **mesh set** is one named mesh on an object. A model that carries several
 * interchangeable pieces — a rig with four head covers, a car with three
 * bumpers — is dressed by drawing some of its meshes and hiding the rest; the
 * visuals file records which, and the editor's Visuals tab authors it.
 *
 * Only names are used, never indices, so adding or reordering meshes in the
 * model does not move anyone's clothes.
 */
export function meshSetsOf(object: Object3D): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  forEachSetMesh(object, (mesh) => {
    if (seen.has(mesh.name)) return;
    seen.add(mesh.name);
    names.push(mesh.name);
  });
  return names;
}

export interface ApplyVisualsResult {
  /** Sets that were drawn. */
  applied: string[];
  /** Names the dressing asked for that this object does not carry. */
  missing: string[];
}

/**
 * Draws `worn` on `object` and hides every other mesh set it carries. Names
 * the object does not have are reported rather than thrown, so a dressing
 * written against an older model still puts on everything it can.
 */
export function applyVisuals(object: Object3D, worn: Iterable<string>): ApplyVisualsResult {
  const wanted = new Set(worn);
  const applied = new Set<string>();
  forEachSetMesh(object, (mesh) => {
    const visible = wanted.has(mesh.name);
    mesh.visible = visible;
    if (visible) applied.add(mesh.name);
  });
  return {
    applied: [...applied],
    missing: [...wanted].filter((name) => !applied.has(name)),
  };
}

/** Every mesh of `object` the visuals system owns, in traversal order. */
export function forEachSetMesh(object: Object3D, visit: (mesh: Mesh) => void): void {
  object.traverse((child) => {
    // Unnamed meshes cannot be addressed by a file, and the editor's own
    // objects are never part of a host model's wardrobe.
    if (child instanceof Mesh && child.name !== '' && child.userData.pathEditor !== true) visit(child);
  });
}
