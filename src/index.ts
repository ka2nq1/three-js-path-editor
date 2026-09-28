/**
 * three-path-editor — runtime entry.
 *
 * Contains everything a production game needs (Path, PathFollower, JSON
 * loading). The visual editor lives in `three-path-editor/editor` and is never
 * pulled in by this entry.
 */
export * from './core';
export * from './runtime';
