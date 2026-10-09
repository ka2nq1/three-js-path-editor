---
name: three-path-editor-visuals
description: Set up the three-path-editor Visuals tab — author which meshes of a model are drawn (character outfits, vehicle parts, prop variants), save them to a visuals JSON file and apply that file at runtime. Use when the editor's Visuals tab reports that visuals are not set up, or when a Three.js project needs to pick between interchangeable meshes a GLB carries.
---

# three-path-editor visuals skill

A model often carries more than it wears: one character rig with four head
covers and three jackets, one car with three bumpers. **Mesh sets** are those
pieces — one named mesh each — and a **visuals file** records which of them
each object draws.

This skill wires that up in a project that already has the editor running.
If the editor is not integrated yet, do the [three-path-editor](../SKILL.md)
skill first: the Visuals tab is a tab of its panel.

| Piece | Import | Ship in production? |
| --- | --- | --- |
| `meshSetsOf`, `applyVisuals` | `three-path-editor` | Yes — the game dresses its objects with these |
| `readVisualsFile`, `wornOf`, `serializeVisuals` | `three-path-editor/core` | Yes |
| `VisualsEditor`, `VisualsPanel` | `three-path-editor/editor` | **No.** Dev only |
| `visualsSavePlugin` | `three-path-editor/vite` | Dev server only |

---

## 1. Find the model and its mesh sets

The sets are named meshes inside one model file. List them without opening
Blender:

```bash
npx path-editor meshes src/assets/Characters.glb
npx path-editor meshes src/assets/Characters.glb --json
```

Names are reported the way `GLTFLoader` will hold them (dots stripped:
`Mayor.001` → `Mayor001`), which is what the file must use.

Read the list before writing anything. Props that belong to a single
animation (a rope posed for one clip), muzzle flashes and weapons attached to
a socket are usually driven by the game, not worn — leave those to the host
and keep them out of the subjects' wardrobes if the host already owns them.

If the project has no such model, say so and stop: there is nothing to dress.

## 2. Decide the subjects

A **subject** is an object in the scene plus the id the file addresses it by.
Use the ids the project already has for those objects (a role, a unit name, a
prop id) — never an index.

```ts
const subjects = () => cast.map((unit) => ({ id: unit.role, object: unit.root }));
```

Pass a **function** when the objects are built after the editor is created.
`VisualsEditor.refresh()` re-reads it.

Ask the user which objects should be dressable if it is not obvious. Don't
guess at gameplay structure.

## 3. Create the visuals file

Put it next to the routes file (`src/visuals/<name>.visuals.json`, or
alongside `src/paths/`). An empty, valid file is enough — the editor fills it:

```json
{
  "version": 1,
  "source": "Characters.glb",
  "subjects": []
}
```

`source` is the model the sets come from. The editor names it when something
does not line up, so keep it accurate.

## 4. Point the tab at those objects

The Visuals tab already exists — `PathEditorPanel` carries it unless the host
passed `visuals: false`, which is why it could tell you to run this skill.
Until it is configured it guesses subjects from the scene. Configure it where
the panel is created:

```ts
import { PathEditorPanel, saveToDevServer } from 'three-path-editor/editor';
import { DEFAULT_VISUALS_SAVE_ENDPOINT } from 'three-path-editor/vite';
import visualsFile from '../visuals/characters.visuals.json';

const panel = new PathEditorPanel(editor, {
  // …the options already there
  visuals: {
    subjects: () => cast.map((unit) => ({ id: unit.role, object: unit.root })),
    data: visualsFile,                                // null / undefined is fine
    file: 'src/visuals/characters.visuals.json',
    source: 'Characters.glb',
    exclusive: [['Helm001', 'Bandana', 'Bandana_2']], // at most one head cover
    onSave: (json) => saveToDevServer(json, { endpoint: DEFAULT_VISUALS_SAVE_ENDPOINT }),
  },
});
```

`panel.visuals` is the `VisualsEditor` behind the tab; call `refresh()` on it
once the objects exist if they are built after the panel.

`exclusive` groups are optional: ticking one set in a group unticks the
others, which is how a head wears one cover at a time.

Nothing here throws. A missing file, a cast that is not built yet, a file
written against an older model — each is reported inside the tab, and the
editor keeps working.

## 5. Save back into the project

`vite.config.ts`, dev server only:

```ts
import { visualsSavePlugin } from 'three-path-editor/vite';

plugins: [visualsSavePlugin({ file: 'src/visuals/characters.visuals.json' })];
```

The plugin validates the body with the same parser the game uses and
overwrites the file; Vite reloads the page because the file changed.

For a project whose dressing lives somewhere else (a TypeScript config, a
database), skip the plugin and give `onSave` your own writer — it receives the
visuals JSON as a string.

## 6. Apply the file at runtime

Where the game builds those objects:

```ts
import { applyVisuals, readVisualsFile, wornOf } from 'three-path-editor';
import data from '../visuals/characters.visuals.json';

const file = readVisualsFile(data);
applyVisuals(unit.root, wornOf(file, unit.role) ?? []);
```

`applyVisuals` draws what is listed, hides every other named mesh on that
object and returns the names it could not find — log those, don't throw.

## Troubleshooting

The tab reports what it found. Each line maps to one thing to fix:

| In the tab | Cause | Fix |
| --- | --- | --- |
| `No visuals file at …` | the file does not exist, or the host passed nothing as `data` | step 3, then pass it as `data` |
| `Invalid JSON …` / `"subjects" must be …` | the file is hand-edited or from another format | fix the file, or delete it and let the editor write a fresh one |
| `No objects were handed to the Visuals tab` | `subjects` is empty, or the cast is built after the editor | pass a function, call `refresh()` once the objects exist |
| `"X" carries no named meshes` | the model has not loaded, or its meshes are unnamed | wait for the loader; name the meshes in the model |
| `"X" has no mesh set "Y"` | the file is older than the model | untick what is gone and save; `npx path-editor meshes` shows the current names |
| `The file dresses "X", which is not in the scene` | a renamed or removed object | rename the entry, or drop it and save |

Keep the message in the tab. It is the only place a developer looks when the
wardrobe is empty, and it already names the skill, the model and the file.
