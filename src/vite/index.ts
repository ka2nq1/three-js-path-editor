import { readPathFile } from '../core/serialization';
import { readVisualsFile } from '../core/visuals';

/** Default endpoint shared by the plugin and `saveToDevServer`. */
export const DEFAULT_SAVE_ENDPOINT = '/__path-editor/save';
/** Default endpoint of the Visuals tab's save. */
export const DEFAULT_VISUALS_SAVE_ENDPOINT = '/__path-editor/save-visuals';

export interface PathEditorSavePluginOptions {
  /** Path file to overwrite. Relative paths resolve against the directory Vite was started from. */
  file: string;
  /** URL the editor POSTs to. Default `/__path-editor/save`. */
  endpoint?: string;
  /** JSON indentation of the written file. Default 2. */
  indent?: number;
  /** Largest accepted request body in bytes. Default 10 MB. */
  maxBytes?: number;
  /** Replace how the file is written (custom storage, tests). Receives the resolved path. */
  writeFile?: (file: string, contents: string) => Promise<void>;
}

interface RequestLike {
  method?: string;
  on(event: 'data', listener: (chunk: Uint8Array | string) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

interface ResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

type Middleware = (req: RequestLike, res: ResponseLike, next: () => void) => void;

/** The subset of Vite's plugin/dev-server API this plugin uses (no `vite` import needed). */
export interface PathEditorSavePlugin {
  name: string;
  apply: 'serve';
  configureServer(server: { middlewares: { use(path: string, handler: Middleware): unknown } }): void;
}

/**
 * Vite dev-server plugin that lets the in-game editor write a path file back
 * into the project: the editor POSTs the exported JSON (see
 * `saveToDevServer`), the plugin validates it with the same parser the game
 * uses and overwrites `file`. Vite then reloads the page on its own because
 * the file changed. Only active in `vite serve`, never in builds.
 *
 * ```ts
 * // vite.config.ts
 * import { pathEditorSavePlugin } from 'three-path-editor/vite';
 * export default { plugins: [pathEditorSavePlugin({ file: 'src/paths/level1.paths.json' })] };
 * ```
 */
export function pathEditorSavePlugin(options: PathEditorSavePluginOptions): PathEditorSavePlugin {
  return savePlugin('three-path-editor:save', options.endpoint ?? DEFAULT_SAVE_ENDPOINT, options, readPathFile);
}

/**
 * The same, for the editor's Visuals tab: the picked mesh sets are POSTed as
 * a visuals file, validated with the parser the game uses and written to
 * `file`.
 *
 * ```ts
 * visualsSavePlugin({ file: 'src/visuals/characters.visuals.json' });
 * ```
 */
export function visualsSavePlugin(options: PathEditorSavePluginOptions): PathEditorSavePlugin {
  return savePlugin(
    'three-path-editor:save-visuals',
    options.endpoint ?? DEFAULT_VISUALS_SAVE_ENDPOINT,
    options,
    readVisualsFile,
  );
}

function savePlugin(
  name: string,
  endpoint: string,
  options: PathEditorSavePluginOptions,
  validate: (parsed: unknown) => unknown,
): PathEditorSavePlugin {
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  return {
    name,
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(endpoint, (req, res) => {
        if (req.method !== 'POST') return reply(res, 405, 'Use POST.');
        let body = '';
        let size = 0;
        let aborted = false;
        req.on('data', (chunk) => {
          if (aborted) return;
          const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
          size += text.length;
          if (size > maxBytes) {
            aborted = true;
            reply(res, 413, `File larger than ${maxBytes} bytes.`);
            return;
          }
          body += text;
        });
        req.on('error', (error) => {
          if (!aborted) reply(res, 400, error.message);
          aborted = true;
        });
        req.on('end', () => {
          if (aborted) return;
          saveFile(body, options, validate).then(
            (file) => reply(res, 200, JSON.stringify({ file })),
            (error: unknown) => reply(res, 400, error instanceof Error ? error.message : String(error)),
          );
        });
      });
    },
  };
}

async function saveFile(
  body: string,
  options: PathEditorSavePluginOptions,
  validate: (parsed: unknown) => unknown,
): Promise<string> {
  const parsed: unknown = JSON.parse(body);
  validate(parsed);
  const contents = JSON.stringify(parsed, null, options.indent ?? 2) + '\n';
  const file = await resolveFile(options.file);
  const write = options.writeFile ?? writeWithNode;
  await write(file, contents);
  return file;
}

async function resolveFile(file: string): Promise<string> {
  const path = (await importNode('node:path')) as { resolve(...parts: string[]): string };
  return path.resolve(file);
}

async function writeWithNode(file: string, contents: string): Promise<void> {
  const fs = (await importNode('node:fs/promises')) as {
    writeFile(file: string, data: string, encoding: string): Promise<void>;
  };
  await fs.writeFile(file, contents, 'utf8');
}

/** Non-literal specifier keeps node built-ins out of the type graph and of any bundle. */
function importNode(specifier: string): Promise<unknown> {
  return import(/* @vite-ignore */ specifier);
}

function reply(res: ResponseLike, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', status === 200 ? 'application/json' : 'text/plain; charset=utf-8');
  res.end(body);
}
