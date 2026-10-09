import { Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Path, PathFollower } from '../src';

const named = () =>
  new Path({
    curve: 'linear',
    points: [
      { position: [0, 0, 0], metadata: { name: 'start' } },
      { position: [10, 0, 0], metadata: { name: 'gate' } },
      { position: [20, 0, 0], metadata: { name: 'stairs' } },
      { position: [30, 0, 0] },
    ],
  });

const follower = (path = named()) => new PathFollower({ object: new Object3D(), path, speed: 5 });

describe('waypoint lookup', () => {
  it('finds a waypoint by name, index and predicate', () => {
    const path = named();
    expect(path.indexOfWaypoint('stairs')).toBe(2);
    expect(path.indexOfWaypoint('nowhere')).toBe(-1);
    expect(path.indexOfWaypoint((w) => w.position[0] === 30)).toBe(3);
    expect(path.distanceOfWaypoint('gate')).toBeCloseTo(10);
    expect(path.distanceOfWaypoint(2)).toBeCloseTo(20);
    expect(path.distanceOfWaypoint('nowhere')).toBeUndefined();
  });
});

describe('waypoint events', () => {
  it('carries the waypoint and its distance', () => {
    const onWaypoint = vi.fn();
    const f = follower();
    f.on('waypoint', onWaypoint);
    f.update(3);
    expect(onWaypoint).toHaveBeenCalledTimes(1);
    const event = onWaypoint.mock.calls[0][0];
    expect(event.index).toBe(1);
    expect(event.waypoint.metadata.name).toBe('gate');
    expect(event.distance).toBeCloseTo(10);
  });

  it('once with a filter waits for a named point and then unsubscribes', () => {
    const reached = vi.fn();
    const f = follower();
    f.once('waypoint', reached, (e) => e.waypoint.metadata.name === 'stairs');
    f.update(3);
    expect(reached).not.toHaveBeenCalled();
    f.update(3);
    expect(reached).toHaveBeenCalledTimes(1);
    f.update(3);
    expect(reached).toHaveBeenCalledTimes(1);
  });
});

describe('seeking', () => {
  it('jumps to a waypoint by name or index', () => {
    const f = follower();
    expect(f.setWaypoint('stairs')).toBe(true);
    expect(f.distance).toBeCloseTo(20);
    expect(f.object.position.x).toBeCloseTo(20);
    expect(f.setWaypoint(1)).toBe(true);
    expect(f.distance).toBeCloseTo(10);
    expect(f.setWaypoint('nowhere')).toBe(false);
    expect(f.distance).toBeCloseTo(10);
  });

  it('stays quiet about skipped waypoints by default', () => {
    const onWaypoint = vi.fn();
    const f = follower();
    f.on('waypoint', onWaypoint);
    f.setWaypoint('stairs');
    expect(onWaypoint).not.toHaveBeenCalled();
  });

  it('emits the skipped waypoints in travel order when asked', () => {
    const seen: number[] = [];
    const f = follower();
    f.on('waypoint', (e) => seen.push(e.index));
    f.setWaypoint('stairs', { emitWaypoints: true });
    expect(seen).toEqual([1, 2]);
    seen.length = 0;
    f.setDistance(0, { emitWaypoints: true });
    expect(seen).toEqual([1, 0]);
    seen.length = 0;
    f.setProgress(1, { emitWaypoints: true });
    expect(seen).toEqual([1, 2, 3]);
  });

  it('reports whether a waypoint is behind the cursor', () => {
    const f = follower();
    expect(f.hasPassed('start')).toBe(true);
    expect(f.hasPassed('gate')).toBe(false);
    f.setWaypoint('gate');
    expect(f.hasPassed('gate')).toBe(true);
    expect(f.hasPassed('stairs')).toBe(false);
    expect(f.hasPassed('nowhere')).toBe(false);
  });

  it('reads backwards travel the other way round', () => {
    const f = new PathFollower({ object: new Object3D(), path: named(), speed: 5, direction: -1 });
    expect(f.hasPassed(3)).toBe(true);
    expect(f.hasPassed('stairs')).toBe(false);
    f.setWaypoint('gate');
    expect(f.hasPassed('stairs')).toBe(true);
    expect(f.hasPassed('start')).toBe(false);
  });
});
