import { Quaternion, Vector3, type Object3D } from 'three';
import type { Path } from '../core/Path';
import type { LoopMode } from '../core/PathCursor';
import { PathFollower, type PathFollowerOptions } from '../runtime/PathFollower';

export interface PathPreviewOptions extends Partial<Omit<PathFollowerOptions, 'object' | 'path'>> {
  /** Restore the object's original position/rotation on detach. Default true. */
  restoreOnDetach?: boolean;
}

/**
 * Editor-side preview: plays any Object3D along a path with play/pause/reset.
 * Wraps a PathFollower and remembers the object's original transform so the
 * game object is left untouched after the preview ends.
 */
export class PathPreview {
  readonly object: Object3D;
  readonly follower: PathFollower;
  private readonly restoreOnDetach: boolean;
  private readonly savedPosition: Vector3;
  private readonly savedQuaternion: Quaternion;
  private detached = false;

  constructor(object: Object3D, path: Path, options: PathPreviewOptions = {}) {
    this.object = object;
    this.restoreOnDetach = options.restoreOnDetach ?? true;
    this.savedPosition = object.position.clone();
    this.savedQuaternion = object.quaternion.clone();
    this.follower = new PathFollower({
      loop: 'loop',
      // Default: traverse the path in ~10 s regardless of world scale.
      speed: path.length > 0 ? path.length / 10 : 1,
      ...options,
      object,
      path,
    });
    this.follower.apply();
  }

  get path(): Path {
    return this.follower.path;
  }
  get isPlaying(): boolean {
    return this.follower.isPlaying;
  }
  get speed(): number {
    return this.follower.speed;
  }
  set speed(value: number) {
    this.follower.speed = value;
  }
  get loop(): LoopMode {
    return this.follower.loop;
  }
  set loop(value: LoopMode) {
    this.follower.loop = value;
  }
  get progress(): number {
    return this.follower.progress;
  }

  play(): this {
    this.follower.play();
    return this;
  }
  pause(): this {
    this.follower.pause();
    return this;
  }
  toggle(): this {
    return this.isPlaying ? this.pause() : this.play();
  }
  reset(): this {
    this.follower.reset();
    return this;
  }
  setProgress(progress: number): this {
    this.follower.setProgress(progress);
    return this;
  }
  setPath(path: Path): this {
    this.follower.setPath(path);
    return this;
  }
  update(dt: number): void {
    if (!this.detached) this.follower.update(dt);
  }

  /** Stops the preview and (by default) restores the object's original transform. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.follower.dispose();
    if (this.restoreOnDetach) {
      this.object.position.copy(this.savedPosition);
      this.object.quaternion.copy(this.savedQuaternion);
    }
  }
}
