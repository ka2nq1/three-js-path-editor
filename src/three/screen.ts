import { Vector3, type Camera, type OrthographicCamera, type PerspectiveCamera } from 'three';

const _v = new Vector3();

/** World units covered by one screen pixel at `position` (for constant on-screen sizes). */
export function worldUnitsPerPixel(camera: Camera, position: Vector3, viewportHeight: number): number {
  const h = Math.max(1, viewportHeight);
  if ((camera as OrthographicCamera).isOrthographicCamera) {
    const c = camera as OrthographicCamera;
    return (c.top - c.bottom) / c.zoom / h;
  }
  const c = camera as PerspectiveCamera;
  const fov = typeof c.fov === 'number' ? c.fov : 50;
  const dist = Math.max(1e-6, _v.setFromMatrixPosition(camera.matrixWorld).distanceTo(position));
  return (2 * dist * Math.tan((fov * Math.PI) / 360)) / (c.zoom || 1) / h;
}
