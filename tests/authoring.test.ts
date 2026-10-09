import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Path, PathFollower } from '../src';

const timedLine = () =>
  new Path({
    curve: 'linear',
    points: [
      { position: [0, 0, 0], time: 0 },
      { position: [10, 0, 0] },
      { position: [20, 0, 0], time: 4 },
    ],
  });

describe('waypoint yaw and time', () => {
  it('are stored, cleared and round-trip through JSON', () => {
    const path = new Path({ curve: 'linear', points: [[0, 0, 0], [10, 0, 0]] });
    path.setWaypointProperties(0, { yaw: -135.5, time: 2.5 });
    expect(path.waypoints[0].yaw).toBe(-135.5);
    expect(path.waypoints[0].time).toBe(2.5);
    const copy = Path.fromJSON(path.toJSON());
    expect(copy.waypoints[0].yaw).toBe(-135.5);
    expect(copy.waypoints[0].time).toBe(2.5);
    copy.setWaypointProperties(0, { yaw: null });
    expect(copy.waypoints[0].yaw).toBeUndefined();
    expect(copy.waypoints[0].time).toBe(2.5);
    expect(copy.toJSON().points[0].yaw).toBeUndefined();
  });

  it('leave untouched waypoints alone', () => {
    const path = new Path({ curve: 'linear', points: [[0, 0, 0], [10, 0, 0]] });
    path.setWaypointProperties(0, { yaw: 90 });
    expect(path.waypoints[1].yaw).toBeUndefined();
    expect(path.toJSON().points[1]).toEqual({ position: [10, 0, 0] });
  });
});

describe('authored timeline', () => {
  it('maps time to distance between the timed waypoints', () => {
    const path = timedLine();
    expect(path.timeRange).toEqual({ start: 0, end: 4 });
    expect(path.duration).toBe(4);
    expect(path.distanceAtTime(0)).toBeCloseTo(0);
    expect(path.distanceAtTime(2)).toBeCloseTo(10);
    expect(path.distanceAtTime(4)).toBeCloseTo(20);
    expect(path.timeAtDistance(15)).toBeCloseTo(3);
    expect(path.getPointAtTime(1)[0]).toBeCloseTo(5);
  });

  it('clamps outside the authored span', () => {
    const path = timedLine();
    expect(path.distanceAtTime(-10)).toBeCloseTo(0);
    expect(path.distanceAtTime(99)).toBeCloseTo(20);
  });

  it('has no timeline with fewer than two timed waypoints', () => {
    const path = new Path({ curve: 'linear', points: [{ position: [0, 0, 0], time: 1 }, { position: [10, 0, 0] }] });
    expect(path.timeRange).toBe(null);
    expect(path.duration).toBe(0);
    expect(path.distanceAtTime(1)).toBe(0);
  });

  it('holds a time authored out of order at its predecessor', () => {
    const path = new Path({
      curve: 'linear',
      points: [
        { position: [0, 0, 0], time: 0 },
        { position: [10, 0, 0], time: 5 },
        { position: [20, 0, 0], time: 2 },
      ],
    });
    expect(path.timeRange).toEqual({ start: 0, end: 5 });
    expect(path.distanceAtTime(5)).toBeCloseTo(20);
  });

  it('keeps two paths in step when both carry the same times', () => {
    const camera = timedLine();
    const target = new Path({
      curve: 'linear',
      points: [
        { position: [0, 0, 50], time: 0 },
        { position: [0, 0, 150], time: 4 },
      ],
    });
    for (const time of [0, 1, 2.5, 4]) {
      expect(camera.timeAtDistance(camera.distanceAtTime(time))).toBeCloseTo(time, 6);
      expect(target.getPointAtTime(time)[2]).toBeCloseTo(50 + (time / 4) * 100, 6);
    }
  });

  it('a follower can seek by authored time', () => {
    const follower = new PathFollower({ object: new Object3D(), path: timedLine(), speed: 5 });
    expect(follower.setTime(3)).toBe(true);
    expect(follower.distance).toBeCloseTo(15);
    expect(follower.time).toBeCloseTo(3);
    expect(follower.object.position.x).toBeCloseTo(15);
    const untimed = new PathFollower({ object: new Object3D(), path: new Path({ curve: 'linear', points: [[0, 0, 0], [5, 0, 0]] }) });
    expect(untimed.setTime(1)).toBe(false);
  });
});

describe('markers', () => {
  it('are paths with one point, no curve settings', () => {
    const marker = new Path({ kind: 'marker', points: [{ position: [1, 2, 3], yaw: 45 }] });
    expect(marker.isMarker).toBe(true);
    expect(marker.toJSON().kind).toBe('marker');
    const copy = Path.fromJSON(marker.toJSON());
    expect(copy.isMarker).toBe(true);
    expect(copy.waypoints[0].yaw).toBe(45);
  });

  it('are ordinary paths unless asked otherwise', () => {
    const path = new Path({ points: [[0, 0, 0]] });
    expect(path.isMarker).toBe(false);
    expect(path.toJSON().kind).toBeUndefined();
  });

  it('keep their kind through setData (undo/redo)', () => {
    const marker = new Path({ kind: 'marker', points: [[0, 0, 0]] });
    const route = new Path({ points: [[0, 0, 0], [1, 0, 0]] });
    route.setData(marker.toJSON());
    expect(route.isMarker).toBe(true);
    marker.setData(new Path({ points: [[0, 0, 0]] }).toJSON());
    expect(marker.isMarker).toBe(false);
  });
});
