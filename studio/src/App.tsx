import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { GeneratorDialog } from './components/GeneratorDialog';
import type { GeneratorResult } from './components/GeneratorDialog';
import { Inspector } from './components/Inspector';
import { MenuCanvas } from './components/MenuCanvas';
import type { BackgroundMode, CanvasTool } from './components/MenuCanvas';
import { NewMenuDialog } from './components/NewMenuDialog';
import type { NewMenuInput } from './components/NewMenuDialog';
import { OutlinePanel } from './components/OutlinePanel';
import { PreviewPanel } from './components/PreviewPanel';
import { fetchWorkspace, saveMenu, uploadTexture } from './lib/api';
import type { WorkspaceSnapshot } from './lib/api';
import { useTextures } from './lib/textures';
import { composeTitle } from './model/compose';
import { GENERATOR_PRESETS, canvasToBlob, renderGenerator } from './model/generator';
import { GRID_COLUMNS, SLOT_SIZE } from './model/geometry';
import type { Point } from './model/geometry';
import { createEmptyMenu, sanitizeId, uniqueId } from './model/menu';
import type { GeneratorSpec, MenuDefinition, SlotArea } from './model/menu';
import { DEFAULT_PREVIEW, buildPreviewContext } from './model/preview';
import type { PreviewValues } from './model/preview';
import { resolveMenu } from './model/resolve';
import { INITIAL_EDITOR, editorReducer } from './state/editor';
import type { Selection } from './state/editor';

type DialogState =
  | { kind: 'new-menu' }
  | { kind: 'generator'; mode: 'create' }
  | { kind: 'generator'; mode: 'edit'; layerId: string }
  | null;

type Recipe = (draft: MenuDefinition) => void;

const ZOOM_LEVELS = [2, 3, 4, 5, 6];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function generatedTexturePath(menuId: string, layerId: string): string {
  return `generated/${menuId}/${layerId}.png`;
}

function removeElement(draft: MenuDefinition, target: Selection) {
  if (target.kind === 'layer') draft.layers = draft.layers.filter((layer) => layer.id !== target.id);
  else if (target.kind === 'text') draft.texts = (draft.texts ?? []).filter((text) => text.id !== target.id);
  else draft.slots = (draft.slots ?? []).filter((slot) => slot.id !== target.id);
}

/** Copie un gabarit sous un nouvel identifiant ; ses textures générées sont rattachées au nouveau menu. */
function instantiateTemplate(template: MenuDefinition, id: string, name: string): MenuDefinition {
  const copy = structuredClone(template);
  copy.id = id;
  copy.name = name;
  copy.layers = copy.layers.map((layer) =>
    layer.generator ? { ...layer, texture: generatedTexturePath(id, layer.id) } : layer,
  );
  return copy;
}

async function bakeTexture(path: string, spec: GeneratorSpec, origin: Point) {
  await uploadTexture(path, await canvasToBlob(renderGenerator(spec, origin)));
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, dispatch] = useReducer(editorReducer, INITIAL_EDITOR);
  const [textureVersions, setTextureVersions] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<PreviewValues>(DEFAULT_PREVIEW);
  const [zoom, setZoom] = useState(3);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [background, setBackground] = useState<BackgroundMode>('slots-only');
  const [showSlots, setShowSlots] = useState(true);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [status, setStatus] = useState('');

  const menu = editor.menu;
  const dirty = menu !== null && JSON.stringify(menu) !== editor.savedJson;

  const refreshWorkspace = useCallback(async () => {
    try {
      const snapshot = await fetchWorkspace();
      setWorkspace(snapshot);
      setLoadError(null);
      return snapshot;
    } catch (error) {
      setLoadError(errorMessage(error));
      return null;
    }
  }, []);

  useEffect(() => {
    // Chargement initial : les setState ont lieu après l’await du fetch, pas pendant l’effet.
    // oxlint-disable-next-line react/set-state-in-effect
    void refreshWorkspace().then((snapshot) => {
      const first = snapshot?.menus.find((candidate) => !candidate.template) ?? snapshot?.menus[0];
      if (first) dispatch({ type: 'load', menu: first });
    });
  }, [refreshWorkspace]);

  const bumpTextures = useCallback((paths: string[]) => {
    setTextureVersions((previous) => {
      const next = { ...previous };
      for (const path of paths) next[path] = (next[path] ?? 0) + 1;
      return next;
    });
  }, []);

  const resolved = useMemo(() => {
    if (!menu) return null;
    const menusById = new Map((workspace?.menus ?? []).map((candidate) => [candidate.id, candidate]));
    menusById.set(menu.id, menu);
    return resolveMenu(menu, (id) => menusById.get(id));
  }, [menu, workspace]);

  const context = useMemo(() => (resolved ? buildPreviewContext(resolved.menu, preview) : null), [resolved, preview]);

  const texturePathsKey = resolved ? [...new Set(resolved.menu.layers.map((layer) => layer.texture))].join('\n') : '';
  const texturePaths = useMemo(() => (texturePathsKey ? texturePathsKey.split('\n') : []), [texturePathsKey]);
  const textures = useTextures(texturePaths, textureVersions);

  const composition = useMemo(() => {
    if (!resolved || !context) return null;
    return composeTitle(resolved.menu, context, (path) => {
      const texture = textures.get(path);
      if (texture === undefined) return undefined;
      return texture === null ? null : texture.bounds;
    });
  }, [resolved, context, textures]);

  const change = useCallback((recipe: Recipe, record = true) => dispatch({ type: 'change', recipe, record }), []);
  const select = useCallback((selection: Selection | null) => dispatch({ type: 'select', selection }), []);

  const save = useCallback(async () => {
    if (!menu) return;
    const json = JSON.stringify(menu);
    try {
      await saveMenu(menu);
      dispatch({ type: 'saved', json });
      setStatus(`« ${menu.id} » enregistré`);
      void refreshWorkspace();
    } catch (error) {
      setStatus(`Échec de l’enregistrement : ${errorMessage(error)}`);
    }
  }, [menu, refreshWorkspace]);

  const deleteElement = useCallback(
    (target: Selection) => {
      change((draft) => removeElement(draft, target));
      select(null);
    },
    [change, select],
  );

  const nudge = useCallback(
    (target: Selection, dx: number, dy: number) =>
      change((draft) => {
        if (target.kind === 'slot') {
          const slot = draft.slots?.find((candidate) => candidate.id === target.id);
          if (!slot) return;
          slot.area.col = clamp(slot.area.col + Math.sign(dx), 0, GRID_COLUMNS - 1);
          slot.area.row = clamp(slot.area.row + Math.sign(dy), 0, draft.container.rows - 1);
          return;
        }
        const element =
          target.kind === 'layer'
            ? draft.layers.find((candidate) => candidate.id === target.id)
            : draft.texts?.find((candidate) => candidate.id === target.id);
        if (element) {
          element.x += dx;
          element.y += dy;
        }
      }),
    [change],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const withModifier = event.ctrlKey || event.metaKey;
      if (withModifier && key === 's') {
        event.preventDefault();
        void save();
        return;
      }
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      if (withModifier && key === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (withModifier && key === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
        return;
      }
      if (withModifier) return;
      if (key === 'v') setTool('select');
      else if (key === 's') setTool('slot');
      else if (key === 'escape') select(null);
      else if ((key === 'delete' || key === 'backspace') && editor.selection) deleteElement(editor.selection);
      else if (key.startsWith('arrow') && editor.selection) {
        event.preventDefault();
        const step = event.shiftKey ? SLOT_SIZE : 1;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        nudge(editor.selection, dx, dy);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save, select, deleteElement, nudge, editor.selection]);

  const confirmDiscard = () =>
    !dirty || window.confirm('Des modifications ne sont pas enregistrées. Continuer quand même ?');

  const openMenu = (id: string) => {
    const target = workspace?.menus.find((candidate) => candidate.id === id);
    if (!target || !confirmDiscard()) return;
    dispatch({ type: 'load', menu: target });
    setPreview(DEFAULT_PREVIEW);
  };

  const handleCreateSlot = (area: SlotArea) => {
    if (!menu) return;
    const id = uniqueId('slot', (menu.slots ?? []).map((slot) => slot.id));
    change((draft) => {
      (draft.slots ??= []).push({ id, kind: 'button', area, item: { invisible: true, name: id } });
    });
    select({ kind: 'slot', id });
  };

  const handleAddText = () => {
    if (!menu) return;
    const id = uniqueId('text', (menu.texts ?? []).map((text) => text.id));
    change((draft) => {
      (draft.texts ??= []).push({ id, x: 8, y: 6, value: 'Texte', color: '#404040' });
    });
    select({ kind: 'text', id });
  };

  const handleReorderLayer = (id: string, direction: 1 | -1) =>
    change((draft) => {
      const from = draft.layers.findIndex((layer) => layer.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= draft.layers.length) return;
      [draft.layers[from], draft.layers[to]] = [draft.layers[to], draft.layers[from]];
    });

  const handleImport = async (file: File) => {
    if (!menu) return;
    const base = sanitizeId(file.name.replace(/\.png$/i, ''));
    const texture = `imported/${base}.png`;
    try {
      await uploadTexture(texture, file);
      bumpTextures([texture]);
      const id = uniqueId(base, menu.layers.map((layer) => layer.id));
      change((draft) => {
        draft.layers.push({ id, texture, x: 0, y: 0 });
      });
      select({ kind: 'layer', id });
      setStatus(`Texture importée : ${texture}`);
      void refreshWorkspace();
    } catch (error) {
      setStatus(`Échec de l’import : ${errorMessage(error)}`);
    }
  };

  const handleGenerator = async (result: GeneratorResult) => {
    if (!menu || dialog?.kind !== 'generator') return;
    const editing = dialog.mode === 'edit' ? menu.layers.find((layer) => layer.id === dialog.layerId) : undefined;
    const texture = editing?.texture ?? generatedTexturePath(menu.id, result.layerId);
    await bakeTexture(texture, result.spec, result);
    bumpTextures([texture]);
    if (editing) {
      change((draft) => {
        const layer = draft.layers.find((candidate) => candidate.id === editing.id);
        if (!layer) return;
        layer.x = result.x;
        layer.y = result.y;
        layer.generator = result.spec;
      });
    } else {
      change((draft) => {
        draft.layers.push({ id: result.layerId, texture, x: result.x, y: result.y, generator: result.spec });
      });
      select({ kind: 'layer', id: result.layerId });
    }
    setDialog(null);
    void refreshWorkspace();
  };

  const handleNewMenu = async ({ id, name, rows, template }: NewMenuInput) => {
    if (!confirmDiscard()) return;
    const created = template ? instantiateTemplate(template, id, name) : createEmptyMenu(id, name, rows);
    const baked: string[] = [];
    for (const layer of created.layers) {
      if (!layer.generator) continue;
      await bakeTexture(layer.texture, layer.generator, layer);
      baked.push(layer.texture);
    }
    await saveMenu(created);
    bumpTextures(baked);
    await refreshWorkspace();
    dispatch({ type: 'load', menu: created });
    setPreview(DEFAULT_PREVIEW);
    setDialog(null);
    setStatus(`Menu « ${id} » créé`);
  };

  const generatorInitial = ((): GeneratorResult | null => {
    if (dialog?.kind !== 'generator' || !menu) return null;
    if (dialog.mode === 'edit') {
      const layer = menu.layers.find((candidate) => candidate.id === dialog.layerId);
      return layer?.generator ? { layerId: layer.id, x: layer.x, y: layer.y, spec: layer.generator } : null;
    }
    return {
      layerId: uniqueId('panel', menu.layers.map((layer) => layer.id)),
      x: 0,
      y: 0,
      spec: structuredClone(GENERATOR_PRESETS[0].spec),
    };
  })();

  const knownMenus = workspace?.menus ?? [];
  const menuIsOnDisk = menu !== null && knownMenus.some((candidate) => candidate.id === menu.id);

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark">▦</span> menu-forge <span className="brand-sub">studio</span>
        </div>
        <div className="toolbar-group">
          <select
            className="menu-picker"
            value={menu?.id ?? ''}
            onChange={(event) => openMenu(event.target.value)}
            disabled={knownMenus.length === 0}
            aria-label="Menu ouvert"
          >
            {!menu && <option value="">Aucun menu</option>}
            {menu && !menuIsOnDisk && <option value={menu.id}>{menu.name} (non enregistré)</option>}
            {knownMenus.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} ({candidate.id}){candidate.template ? ' · gabarit' : ''}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setDialog({ kind: 'new-menu' })}>
            Nouveau
          </button>
          <button type="button" className="primary" onClick={() => void save()} disabled={!menu || !dirty}>
            {dirty ? 'Enregistrer •' : 'Enregistré'}
          </button>
        </div>
        <div className="toolbar-group">
          <button type="button" onClick={() => dispatch({ type: 'undo' })} disabled={editor.past.length === 0} title="Annuler (Ctrl+Z)">
            ↶
          </button>
          <button type="button" onClick={() => dispatch({ type: 'redo' })} disabled={editor.future.length === 0} title="Rétablir (Ctrl+Y)">
            ↷
          </button>
        </div>
        <div className="toolbar-group segmented">
          <button type="button" className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')} title="Sélection (V)">
            Sélection
          </button>
          <button type="button" className={tool === 'slot' ? 'active' : ''} onClick={() => setTool('slot')} title="Dessiner une zone de slots (S)">
            Slots
          </button>
        </div>
        <div className="toolbar-group">
          <select value={background} onChange={(event) => setBackground(event.target.value as BackgroundMode)} aria-label="Fond">
            <option value="slots-only">Fond : cases seules</option>
            <option value="vanilla">Fond : coffre vanilla</option>
            <option value="none">Fond : aucun</option>
          </select>
          <label className="checkbox">
            <input type="checkbox" checked={showSlots} onChange={(event) => setShowSlots(event.target.checked)} />
            Zones
          </label>
          <select value={zoom} onChange={(event) => setZoom(Number(event.target.value))} aria-label="Zoom">
            {ZOOM_LEVELS.map((level) => (
              <option key={level} value={level}>
                ×{level}
              </option>
            ))}
          </select>
        </div>
        <span className="status" role="status">
          {status}
        </span>
      </header>

      {loadError && (
        <div className="banner error">
          Impossible de lire l’espace de travail : {loadError}. Le studio doit être lancé avec <code>npm run dev</code>.
        </div>
      )}

      <main className="workspace">
        <aside className="sidebar">
          {resolved && context && (
            <OutlinePanel
              menu={resolved.menu}
              inherited={resolved.inherited}
              context={context}
              selection={editor.selection}
              onSelect={select}
              onReorderLayer={handleReorderLayer}
              onDelete={deleteElement}
              onAddText={handleAddText}
              onOpenGenerator={() => setDialog({ kind: 'generator', mode: 'create' })}
              onImport={(file) => void handleImport(file)}
            />
          )}
        </aside>

        <section className="stage">
          {resolved && context ? (
            <MenuCanvas
              menu={resolved.menu}
              inherited={resolved.inherited}
              context={context}
              textures={textures}
              zoom={zoom}
              tool={tool}
              background={background}
              showSlots={showSlots}
              selection={editor.selection}
              onSelect={select}
              onBeginMove={() => dispatch({ type: 'checkpoint' })}
              onMove={(target, x, y) =>
                change((draft) => {
                  const element =
                    target.kind === 'layer'
                      ? draft.layers.find((candidate) => candidate.id === target.id)
                      : draft.texts?.find((candidate) => candidate.id === target.id);
                  if (element) {
                    element.x = x;
                    element.y = y;
                  }
                }, false)
              }
              onCreateSlot={handleCreateSlot}
            />
          ) : (
            <div className="empty-state">
              <h2>Aucun menu ouvert</h2>
              <p className="muted">Crée un menu vierge ou pars d’un gabarit (coffre, modale, liste paginée…).</p>
              <button type="button" className="primary" onClick={() => setDialog({ kind: 'new-menu' })}>
                Nouveau menu
              </button>
            </div>
          )}
        </section>

        <aside className="sidebar">
          {menu && resolved && (
            <Inspector
              menu={menu}
              states={resolved.menu.state ?? {}}
              selection={editor.selection}
              textures={workspace?.textures ?? []}
              onChange={change}
              onSelect={select}
              onEditGenerator={(layerId) => setDialog({ kind: 'generator', mode: 'edit', layerId })}
            />
          )}
          {resolved && (
            <PreviewPanel
              menu={resolved.menu}
              values={preview}
              onChange={setPreview}
              composition={composition}
              errors={resolved.errors}
            />
          )}
        </aside>
      </main>

      <footer className="statusbar">
        Espace de travail : <code>{workspace?.root ?? '…'}</code>
      </footer>

      {dialog?.kind === 'new-menu' && (
        <NewMenuDialog
          templates={workspace?.templates ?? []}
          existingIds={knownMenus.map((candidate) => candidate.id)}
          onCancel={() => setDialog(null)}
          onCreate={handleNewMenu}
        />
      )}
      {dialog?.kind === 'generator' && menu && generatorInitial && (
        <GeneratorDialog
          mode={dialog.mode}
          initial={generatorInitial}
          rows={menu.container.rows}
          takenIds={menu.layers.map((layer) => layer.id)}
          onCancel={() => setDialog(null)}
          onConfirm={handleGenerator}
        />
      )}
    </div>
  );
}
