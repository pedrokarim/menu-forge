import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { SHADER_EXAMPLES, exampleFiles } from '../shader/examples';
import type { ShaderExample } from '../shader/examples';
import { programsIn } from '../shader/glsl';
import type { ShaderFile } from '../shader/glsl';
import { ShaderRenderer } from '../shader/renderer';
import type { RenderResult } from '../shader/renderer';
import { CHART_SIZES, CHART_STYLES, CHART_STYLE_LABELS, DEFAULT_INPUTS, SCENES } from '../shader/scenes';
import type { ChartSizeId, ChartStyleId, SceneBitmap, SceneId, SceneInputs } from '../shader/scenes';
import { NBSP } from '../lib/format';
import { ScreenFrame } from '../shell/ScreenFrame';
import { askUnsaved } from '../ui/dialogs';
import { useContextMenu } from '../ui/menuContext';
import type { MenuEntry } from '../ui/menuContext';
import { Icon } from '../ui/Icon';
import './shaderlab.css';

const SHADER_FILE = /\.(vsh|fsh|glsl)$/i;
const SCALES = [2, 3, 4, 6];

/** Ce qui est chargé : un exemple intégré ou un dossier du disque. */
type Source = { kind: 'example'; example: ShaderExample } | { kind: 'folder'; name: string };

/** Chemin d’un fichier chargé, à partir du dossier `shaders/` s’il apparaît (`core/item.fsh`). */
function shaderPath(relative: string): string {
  const normalized = relative.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/shaders/');
  if (index >= 0) return normalized.slice(index + '/shaders/'.length);
  const parts = normalized.split('/');
  return parts.length > 2 ? parts.slice(-2).join('/') : normalized;
}

async function readBitmap(file: File): Promise<SceneBitmap> {
  const image = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  return { width: image.width, height: image.height, data };
}

function hexToColor(hex: string): [number, number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, 1];
}

function colorToHex(color: [number, number, number, number]): string {
  return `#${color
    .slice(0, 3)
    .map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Un onglet du visualiseur : un exemple ou un dossier ouvert, avec ses brouillons et sa scène. */
interface ShaderSession {
  key: string;
  source: Source;
  files: ShaderFile[];
  /** Fichiers tels qu’ils ont été ouverts (pour savoir s’il y a des modifications et revenir en arrière). */
  original: ShaderFile[];
  program: string;
  sceneId: SceneId;
  inputs: SceneInputs;
  editing: string | null;
  animate: boolean;
}

let sessionCounter = 0;

function exampleSession(example: ShaderExample): ShaderSession {
  const files = exampleFiles(example.folder ?? example.id);
  sessionCounter += 1;
  return {
    key: `shader-${sessionCounter}`,
    source: { kind: 'example', example },
    files,
    original: files,
    program: example.program,
    sceneId: example.scene,
    inputs: { ...DEFAULT_INPUTS, color: example.color ?? DEFAULT_INPUTS.color, ...example.inputs },
    editing: example.open,
    animate: example.animate ?? false,
  };
}

const sessionTitle = (session: ShaderSession) => (session.source.kind === 'example' ? session.source.example.title : session.source.name);
const isModified = (session: ShaderSession) => JSON.stringify(session.files) !== JSON.stringify(session.original);

/**
 * Visualiseur de shaders : exécute les shaders « core » d’un pack (ou un exemple intégré) en WebGL2, avec
 * des includes du jeu minimaux, sur une scène d’essai (courbe, portrait, quad libre). Chaque modification
 * d’un fichier recompile et redessine aussitôt. Chaque exemple ou dossier ouvert a son onglet et garde ses
 * brouillons ; fermer un onglet modifié demande confirmation.
 */
export function ShaderLabScreen({ pill, active = true }: { pill: ReactNode; active?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const openContextMenu = useContextMenu();
  const rendererRef = useRef<ShaderRenderer | null>(null);
  const [sessions, setSessions] = useState<ShaderSession[]>(() => [exampleSession(SHADER_EXAMPLES[0])]);
  const [activeKey, setActiveKey] = useState<string | null>(() => sessions[0]?.key ?? null);
  const [scale, setScale] = useState(4);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const current = sessions.find((session) => session.key === activeKey) ?? null;
  const source = current?.source ?? null;
  const files = useMemo(() => current?.files ?? [], [current]);
  const program = current?.program ?? '';
  const sceneId = current?.sceneId ?? 'free';
  const inputs = current?.inputs ?? DEFAULT_INPUTS;
  const editing = current?.editing ?? null;
  const animate = current?.animate ?? false;

  /** Modifie l’onglet affiché. */
  const patch = (change: (session: ShaderSession) => Partial<ShaderSession>) =>
    setSessions((list) => list.map((session) => (session.key === activeKey ? { ...session, ...change(session) } : session)));
  const setProgram = (value: string) => patch(() => ({ program: value }));
  const setEditing = (value: string) => patch(() => ({ editing: value }));
  const setAnimate = (value: boolean) => patch(() => ({ animate: value }));
  const setInputs = (change: (value: SceneInputs) => SceneInputs) => patch((session) => ({ inputs: change(session.inputs) }));

  const scene = SCENES.find((candidate) => candidate.id === sceneId) ?? SCENES[0];
  const programs = useMemo(() => programsIn(files), [files]);
  const geometry = useMemo(() => scene.build(inputs), [scene, inputs]);
  const editedFile = files.find((file) => file.path === editing) ?? null;
  const example = source?.kind === 'example' ? source.example : null;
  const modified = current !== null && isModified(current);

  useEffect(() => {
    if (!canvasRef.current || rendererRef.current) return;
    try {
      rendererRef.current = new ShaderRenderer(canvasRef.current);
    } catch (error) {
      // oxlint-disable-next-line react/set-state-in-effect
      setSetupError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  // Rendu (et animation de GameTime si demandée), léger différé pendant la frappe ; rien quand l’écran est caché.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !program || !active) return;
    let frame = 0;
    const started = performance.now();
    const draw = () => {
      const time = animate ? ((performance.now() - started) / 1000 / 1200) % 1 : 0;
      setResult(renderer.render(program, files, geometry, scale, time));
      if (animate) frame = requestAnimationFrame(draw);
    };
    const timer = window.setTimeout(draw, 120);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [program, files, geometry, scale, animate, active]);

  /** Ouvre un exemple : l’onglet qui le montre déjà, sinon un nouvel onglet. */
  const loadExample = (next: ShaderExample) => {
    const existing = sessions.find((session) => session.source.kind === 'example' && session.source.example.id === next.id);
    if (existing) {
      setActiveKey(existing.key);
      return;
    }
    const created = exampleSession(next);
    setSessions((list) => [...list, created]);
    setActiveKey(created.key);
  };

  const loadFolder = async (event: ChangeEvent<HTMLInputElement>) => {
    const list = [...(event.target.files ?? [])].filter((file) => SHADER_FILE.test(file.name));
    event.target.value = '';
    if (list.length === 0) return;
    const loaded = await Promise.all(list.map(async (file) => ({ path: shaderPath(file.webkitRelativePath || file.name), source: await file.text() })));
    loaded.sort((a, b) => a.path.localeCompare(b.path));
    const found = programsIn(loaded);
    const preferred = found.includes(scene.program) ? scene.program : found[0] ?? '';
    sessionCounter += 1;
    const created: ShaderSession = {
      key: `shader-${sessionCounter}`,
      source: { kind: 'folder', name: (list[0].webkitRelativePath || list[0].name).split('/')[0] },
      files: loaded,
      original: loaded,
      program: preferred,
      sceneId,
      inputs,
      editing: loaded.find((file) => file.path === `${preferred}.fsh`)?.path ?? loaded[0].path,
      animate: false,
    };
    setSessions((previous) => [...previous, created]);
    setActiveKey(created.key);
  };

  /** Ferme des onglets ; ceux qui ont des brouillons demandent confirmation (rien ne s’enregistre sur le disque). */
  const closeSessions = async (keys: string[]) => {
    const touched = sessions.filter((session) => keys.includes(session.key) && isModified(session));
    if (touched.length > 0) {
      const action = keys.length === 1 ? `Fermer «${NBSP}${sessionTitle(touched[0])}${NBSP}»` : `Fermer ${keys.length} onglets`;
      const choice = await askUnsaved(touched.map(sessionTitle), action, { discardOnly: true });
      if (choice === 'cancel') return;
    }
    const remaining = sessions.filter((session) => !keys.includes(session.key));
    setSessions(remaining);
    if (activeKey && keys.includes(activeKey)) {
      const index = sessions.findIndex((session) => session.key === activeKey);
      setActiveKey(remaining[Math.min(index, remaining.length - 1)]?.key ?? null);
    }
  };

  const revert = () => patch((session) => ({ files: session.original }));

  const changeScene = (id: SceneId) => {
    const next = SCENES.find((candidate) => candidate.id === id);
    patch(() =>
      next && programs.includes(next.program) ? { sceneId: id, program: next.program, editing: `${next.program}.fsh` } : { sceneId: id },
    );
  };

  const editSource = (value: string) => {
    if (!editing) return;
    patch((session) => ({ files: session.files.map((file) => (file.path === editing ? { ...file, source: value } : file)) }));
  };

  const loadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const image = await readBitmap(file);
    setInputs((value) => ({ ...value, image }));
  };

  const tabMenu = (session: ShaderSession): MenuEntry[] => [
    { heading: sessionTitle(session) },
    { label: 'Revenir à l’original', icon: 'undo', disabled: !isModified(session), onSelect: () => {
      setSessions((list) => list.map((candidate) => (candidate.key === session.key ? { ...candidate, files: candidate.original } : candidate)));
    } },
    { separator: true },
    { label: 'Fermer', icon: 'close', onSelect: () => void closeSessions([session.key]) },
    { label: 'Fermer les autres onglets', disabled: sessions.length < 2, onSelect: () => void closeSessions(sessions.filter((other) => other.key !== session.key).map((other) => other.key)) },
    { label: 'Tout fermer', danger: true, onSelect: () => void closeSessions(sessions.map((other) => other.key)) },
  ];

  return (
    <ScreenFrame
      title="Shaders"
      icon="code"
      pill={pill}
      bar={
        sessions.length > 0 ? (
          <div className="editor-tabs shaderlab-tabs">
            <div className="editor-tabs-list" role="tablist" aria-label="Shaders ouverts">
              {sessions.map((session) => {
                const touched = isModified(session);
                const selected = session.key === activeKey;
                const title = sessionTitle(session);
                return (
                  <div
                    key={session.key}
                    className={['editor-tab', selected ? 'active' : '', touched ? 'dirty' : ''].filter(Boolean).join(' ')}
                    onAuxClick={(event) => {
                      if (event.button === 1) void closeSessions([session.key]);
                    }}
                    onContextMenu={(event) => openContextMenu(event, tabMenu(session))}
                  >
                    <button type="button" role="tab" aria-selected={selected} className="editor-tab-button" title={touched ? `${title} (modifié)` : title} onClick={() => setActiveKey(session.key)}>
                      <Icon name={session.source.kind === 'example' ? 'code' : 'folder'} />
                      <span className="editor-tab-label" data-audit-ellipsis>{title}</span>
                    </button>
                    <button type="button" className="editor-tab-close" aria-label={`Fermer « ${title} »`} tabIndex={-1} onClick={() => void closeSessions([session.key])}>
                      <span className="editor-tab-dot" aria-hidden="true" />
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : undefined
      }
    >
      <div className="shaderlab">
        <aside className="shaderlab-side">
          <section className="card shaderlab-examples">
            <h3>Exemples</h3>
            <ul>
              {SHADER_EXAMPLES.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    className={example?.id === candidate.id ? 'active' : undefined}
                    aria-pressed={example?.id === candidate.id}
                    title="Ouvre l’exemple dans son onglet"
                    onClick={() => loadExample(candidate)}
                  >
                    <strong>{candidate.title}</strong>
                    <span className="muted">{candidate.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
            <label className="shaderlab-folder">
              <input
                type="file"
                multiple
                onChange={(event) => void loadFolder(event)}
                {...{ webkitdirectory: '', directory: '' }}
              />
              <span className="shaderlab-folder-button">
                <Icon name="folder" />
                Ouvrir les shaders d’un pack…
              </span>
            </label>
            {source?.kind === 'folder' && (
              <p className="muted shaderlab-note">
                Dossier <span className="mono">{source.name}</span> chargé. Choisissez le dossier{' '}
                <span className="mono">shaders/</span> d’un pack (ou un parent) ; les includes du jeu absents sont
                remplacés par des versions minimales.
              </p>
            )}
          </section>

          <section className="card" hidden={!current}>
            <div className="field">
              <span className="field-label">Programme</span>
              <select aria-label="Programme" value={program} onChange={(event) => setProgram(event.target.value)}>
                {programs.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span className="field-label">Fichiers ({files.length})</span>
              <ul className="shaderlab-files">
                {files.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      className={file.path === editing ? 'active' : undefined}
                      onClick={() => setEditing(file.path)}
                    >
                      <span className="mono shaderlab-file-name" title={file.path}>{file.path}</span>
                      {current && current.original.find((initial) => initial.path === file.path)?.source !== file.source && (
                        <span className="dirty-mark" title="Modifié" aria-label="modifié" />
                      )}
                      {result?.errors.some((error) => error.file === file.path) && <Icon name="warning" />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="card shaderlab-help">
            <h3>Comment ça marche</h3>
            <p>
              Minecraft dessine chaque élément avec deux petits programmes : le <strong>vertex shader</strong>{' '}
              (<span className="mono">.vsh</span>) place les coins, le <strong>fragment shader</strong>{' '}
              (<span className="mono">.fsh</span>) choisit la couleur de chaque pixel. Un resource pack peut les
              remplacer.
            </p>
            <p>
              Ici, le studio imite ce que le jeu envoie (la <strong>scène</strong>) et exécute les shaders : modifiez
              le code en bas, le rendu suit.
            </p>
          </section>
        </aside>

        <section className="shaderlab-main">
          {!current && (
            <div className="card shaderlab-intro">
              <h3>Aucun shader ouvert</h3>
              <p>Choisissez un exemple dans la liste, ou ouvrez les shaders d’un pack : chacun s’ouvre dans son onglet.</p>
            </div>
          )}
          {example && (
            <div className="card shaderlab-intro">
              <h3>{example.title}</h3>
              <p>{example.summary}</p>
              <p>
                <strong>À essayer :</strong> {example.tryThis}
              </p>
            </div>
          )}

          <div className="card shaderlab-scene" hidden={!current}>
            <div className="field">
              <span className="field-label">Scène : ce que le jeu envoie au shader</span>
              <div className="segmented" role="group" aria-label="Scène">
                {SCENES.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    className={candidate.id === sceneId ? 'active' : undefined}
                    onClick={() => changeScene(candidate.id)}
                  >
                    {candidate.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="muted shaderlab-note">{scene.hint}</p>
            <div className="shaderlab-inputs">
              {scene.id === 'chart' && (
                <>
                  <label className="field shaderlab-values">
                    <span className="field-label">Valeurs</span>
                    <textarea
                      rows={2}
                      value={inputs.values}
                      onChange={(event) => setInputs((current) => ({ ...current, values: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Colonnes</span>
                    <input
                      type="number"
                      min={1}
                      max={64}
                      value={inputs.columns}
                      onChange={(event) => setInputs((current) => ({ ...current, columns: Number(event.target.value) || 1 }))}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Style</span>
                    <select
                      aria-label="Style de courbe"
                      value={inputs.chartStyle}
                      onChange={(event) => setInputs((current) => ({ ...current, chartStyle: event.target.value as ChartStyleId }))}
                    >
                      {CHART_STYLES.map((style) => (
                        <option key={style} value={style}>
                          {CHART_STYLE_LABELS[style]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">Taille</span>
                    <select
                      aria-label="Taille du graphe"
                      value={inputs.chartSize}
                      onChange={(event) => setInputs((current) => ({ ...current, chartSize: event.target.value as ChartSizeId }))}
                    >
                      {(Object.keys(CHART_SIZES) as ChartSizeId[]).map((size) => (
                        <option key={size} value={size}>
                          {CHART_SIZES[size].label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {scene.id !== 'chart' && (
                <div className="field">
                  <span className="field-label">{scene.id === 'portrait' ? 'Skin (64 × 64)' : 'Texture'}</span>
                  <label className="shaderlab-folder">
                    <input type="file" accept="image/png" onChange={(event) => void loadImage(event)} />
                    <span className="shaderlab-folder-button">
                      <Icon name="upload" />
                      {inputs.image ? `Image ${inputs.image.width} × ${inputs.image.height}` : 'Choisir une image…'}
                    </span>
                  </label>
                </div>
              )}
              {scene.id === 'free' && (
                <label className="field">
                  <span className="field-label">Couleur de sommet</span>
                  <input
                    type="color"
                    value={colorToHex(inputs.color)}
                    onChange={(event) => setInputs((current) => ({ ...current, color: hexToColor(event.target.value) }))}
                  />
                </label>
              )}
              <label className="field">
                <span className="field-label">Échelle d’interface</span>
                <select aria-label="Échelle d’interface" value={scale} onChange={(event) => setScale(Number(event.target.value))}>
                  {SCALES.map((value) => (
                    <option key={value} value={value}>
                      ×{value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={animate} onChange={(event) => setAnimate(event.target.checked)} />
                Animer <span className="mono">GameTime</span>
              </label>
            </div>
          </div>

          <div className="card shaderlab-preview" hidden={!current}>
            {setupError && <p className="field-error">{setupError}</p>}
            <canvas ref={canvasRef} className="shaderlab-canvas" />
            {result && (
              <p className="muted shaderlab-status">
                {result.errors.length === 0
                  ? `Compilé et dessiné en ${result.milliseconds.toFixed(1)} ms`
                  : `${result.errors.length} erreur${result.errors.length > 1 ? 's' : ''} : voir sous le code`}
                {result.missing.length > 0 && ` · includes absents : ${result.missing.join(', ')}`}
              </p>
            )}
          </div>

          {editedFile && (
            <div className="card shaderlab-editor">
              <div className="shaderlab-editor-head">
                <span className="mono">{editedFile.path}</span>
                <span className="shaderlab-editor-actions">
                  <span className="muted">Modifications gardées dans le studio seulement.</span>
                  {modified && (
                    <button type="button" onClick={revert}>
                      <Icon name="undo" />
                      Revenir à l’original
                    </button>
                  )}
                </span>
              </div>
              <textarea
                className="mono shaderlab-code"
                spellCheck={false}
                aria-label={`Code de ${editedFile.path}`}
                value={editedFile.source}
                onChange={(event) => editSource(event.target.value)}
              />
              {result && result.errors.length > 0 && (
                <ul className="shaderlab-errors">
                  {result.errors.map((error, index) => (
                    <li key={index} className="mono">
                      <button type="button" className="ghost" onClick={() => error.file && files.some((file) => file.path === error.file) && setEditing(error.file)}>
                        {error.file ? `${error.file}:${error.line}` : 'programme'}
                      </button>{' '}
                      {error.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </ScreenFrame>
  );
}
