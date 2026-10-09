export const VISUALS_FORMAT_VERSION = 1;

export class VisualsFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisualsFormatError';
  }
}

/** What one object wears: the mesh sets drawn on it, by name. */
export interface SubjectVisualsData {
  id: string;
  worn: string[];
  /** Unknown keys are preserved on read and write. */
  [extra: string]: unknown;
}

export interface VisualsFileData {
  version: number;
  /**
   * The model file the mesh sets come from (e.g. `Characters.glb`). Carried so
   * tooling and the editor can name it when something does not line up.
   */
  source?: string;
  subjects: SubjectVisualsData[];
  [extra: string]: unknown;
}

export interface VisualsFile {
  version: number;
  source: string | null;
  subjects: SubjectVisualsData[];
  /** Unknown top-level keys, preserved by `serializeVisuals(…, { extras })`. */
  extras: Record<string, unknown>;
}

export interface SerializeVisualsOptions {
  source?: string | null;
  extras?: Record<string, unknown>;
}

/** Serializes a dressing into the versioned JSON format. */
export function serializeVisuals(
  subjects: Iterable<SubjectVisualsData>,
  options: SerializeVisualsOptions = {},
): VisualsFileData {
  const file: VisualsFileData = {
    ...clone(options.extras ?? {}),
    version: VISUALS_FORMAT_VERSION,
    subjects: [...subjects].map((subject) => ({ ...clone(subject), id: subject.id, worn: [...subject.worn] })),
  };
  if (options.source) file.source = options.source;
  return file;
}

export function stringifyVisuals(
  subjects: Iterable<SubjectVisualsData>,
  indent = 2,
  options?: SerializeVisualsOptions,
): string {
  return JSON.stringify(serializeVisuals(subjects, options), null, indent) + '\n';
}

/**
 * Parses a visuals file (object or JSON string). Throws `VisualsFormatError`
 * on invalid input — the editor catches it and reports it in its panel rather
 * than letting a stale or hand-edited file take the tab down.
 */
export function readVisualsFile(input: unknown): VisualsFile {
  let raw = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (err) {
      throw new VisualsFormatError(`Invalid JSON: ${(err as Error).message}`);
    }
  }
  if (!isObject(raw)) throw new VisualsFormatError('A visuals file must be an object.');

  const { version, source, subjects, ...extras } = migrate(raw);
  if (!Array.isArray(subjects)) throw new VisualsFormatError('"subjects" must be an array.');
  if (source !== undefined && typeof source !== 'string') {
    throw new VisualsFormatError('"source" must be a string.');
  }

  const seen = new Set<string>();
  const parsed = subjects.map((subject, index) => {
    const where = `subjects[${index}]`;
    if (!isObject(subject)) throw new VisualsFormatError(`${where} must be an object.`);
    const { id, worn } = subject;
    if (typeof id !== 'string' || id === '') throw new VisualsFormatError(`${where}.id must be a non-empty string.`);
    if (seen.has(id)) throw new VisualsFormatError(`Duplicate subject id "${id}".`);
    seen.add(id);
    if (!Array.isArray(worn) || worn.some((name) => typeof name !== 'string')) {
      throw new VisualsFormatError(`${where}.worn must be an array of mesh set names.`);
    }
    return { ...clone(subject), id, worn: [...(worn as string[])] } as SubjectVisualsData;
  });

  return {
    version: typeof version === 'number' ? version : VISUALS_FORMAT_VERSION,
    source: typeof source === 'string' ? source : null,
    subjects: parsed,
    extras: clone(extras),
  };
}

/** The mesh sets `id` wears, or `null` when the file says nothing about it. */
export function wornOf(file: VisualsFile, id: string): string[] | null {
  return file.subjects.find((subject) => subject.id === id)?.worn ?? null;
}

export function emptyVisualsFile(source?: string): VisualsFileData {
  return serializeVisuals([], { source });
}

/** Older files are brought up to the current version here. */
function migrate(file: Record<string, unknown>): Record<string, unknown> {
  const version = typeof file.version === 'number' ? file.version : VISUALS_FORMAT_VERSION;
  if (version > VISUALS_FORMAT_VERSION) {
    throw new VisualsFormatError(
      `Visuals file version ${version} is newer than this package supports (${VISUALS_FORMAT_VERSION}).`,
    );
  }
  return file;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}
