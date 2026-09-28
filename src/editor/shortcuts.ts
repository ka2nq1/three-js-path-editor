/**
 * Optional keyboard shortcuts for the editor. Kept separate so projects can
 * disable them (e.g. when they clash with game controls) or bind their own.
 *
 *   Delete / Backspace   delete selected waypoint
 *   Escape               clear waypoint selection
 *   + / = / Insert       add waypoint after selection
 *   [ / ]                select previous / next waypoint
 *   Alt + [ / ]          move selected waypoint earlier / later
 *   G                    toggle gizmos
 *   Cmd/Ctrl + Z         undo
 *   Cmd/Ctrl + Shift + Z redo (also Ctrl + Y)
 *
 * Keys are matched by physical position (`event.code`), so they work with any
 * keyboard layout (e.g. Ukrainian).
 */
export interface ShortcutTarget {
  deleteSelectedWaypoint(): void;
  clearWaypointSelection(): void;
  addWaypoint(): unknown;
  selectAdjacentWaypoint(delta: -1 | 1): void;
  shiftSelectedWaypoint(delta: -1 | 1): void;
  toggleView(key: 'gizmos'): unknown;
  undo(): unknown;
  redo(): unknown;
}

export function bindShortcuts(target: ShortcutTarget, element: Window | HTMLElement = window): () => void {
  const onKeyDown = (event: Event) => {
    const e = event as KeyboardEvent;
    // Inside text fields keep the browser's own editing and undo.
    if (e.defaultPrevented || isTyping(e.target)) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.altKey) return;
      if (e.code === 'KeyZ') {
        if (e.shiftKey) target.redo();
        else target.undo();
      } else if (e.code === 'KeyY' && e.ctrlKey) {
        target.redo();
      } else {
        return;
      }
      e.preventDefault();
      return;
    }
    let handled = true;
    switch (e.code) {
      case 'Delete':
      case 'Backspace':
        target.deleteSelectedWaypoint();
        break;
      case 'Escape':
        target.clearWaypointSelection();
        break;
      case 'Insert':
      case 'Equal':
      case 'NumpadAdd':
        target.addWaypoint();
        break;
      case 'BracketLeft':
      case 'BracketRight': {
        const delta = e.code === 'BracketLeft' ? -1 : 1;
        if (e.altKey) target.shiftSelectedWaypoint(delta);
        else target.selectAdjacentWaypoint(delta);
        break;
      }
      case 'KeyG':
        target.toggleView('gizmos');
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };
  element.addEventListener('keydown', onKeyDown);
  return () => element.removeEventListener('keydown', onKeyDown);
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}
