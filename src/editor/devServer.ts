import type { PathFileData } from '../core/types';

/** Must match `DEFAULT_SAVE_ENDPOINT` in `three-path-editor/vite`. */
const DEFAULT_ENDPOINT = '/__path-editor/save';

export interface SaveToDevServerOptions {
  /** Endpoint of `pathEditorSavePlugin`. Default `/__path-editor/save`. */
  endpoint?: string;
  /** Custom fetch (tests, auth headers...). Default `globalThis.fetch`. */
  fetch?: typeof fetch;
}

/**
 * POSTs a path file (e.g. `editor.exportString()`) to a dev-server endpoint
 * such as `pathEditorSavePlugin` from `three-path-editor/vite`, which writes
 * it into the project. Any server that accepts the JSON body works. Rejects
 * with the server's message when it refuses the file.
 */
export async function saveToDevServer(
  file: string | PathFileData,
  options: SaveToDevServerOptions = {},
): Promise<void> {
  const doFetch = options.fetch ?? globalThis.fetch;
  if (!doFetch) throw new Error('saveToDevServer: fetch is not available.');
  const response = await doFetch(options.endpoint ?? DEFAULT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof file === 'string' ? file : JSON.stringify(file),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `Saving failed with HTTP ${response.status}.`);
  }
}
