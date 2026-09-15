import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { SHADER_EXAMPLES, exampleFiles } from '../shader/examples';
import type { ShaderExample } from '../shader/examples';
import { programsIn } from '../shader/glsl';
import type { ShaderFile } from '../shader/glsl';
import { ShaderRenderer } from '../shader/renderer';
import type { RenderResult } from '../shader/renderer';
import { DEFAULT_INPUTS, SCENES } from '../shader/scenes';
import type { SceneBitmap, SceneId, SceneInputs } from '../shader/scenes';
import { ScreenFrame } from '../shell/ScreenFrame';
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

/**
 * Visualiseur de shaders : exécute les shaders « core » d’un pack (ou un exemple intégré) en WebGL2, avec
 * des includes du jeu minimaux, sur une scène d’essai (courbe, portrait, quad libre). Chaque modification
 * d’un fichier recompile et redessine aussitôt.
 */
export function ShaderLabScreen({ pill }: { pill: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ShaderRenderer | null>(null);
  const [source, setSource] = useState<Source>({ kind: 'example', example: SHADER_EXAMPLES[0] });
  const [files, setFiles] = useState<ShaderFile[]>(() => exampleFiles(SHADER_EXAMPLES[0].id));
  const [program, setProgram] = useState(SHADER_EXAMPLES[0].program);
  const [sceneId, setSceneId] = useState<SceneId>(SHADER_EXAMPLES[0].scene);
  const [inputs, setInputs] = useState<SceneInputs>(DEFAULT_INPUTS);
  const [editing, setEditing] = useState<string | null>(SHADER_EXAMPLES[0].open);
  const [scale, setScale] = useState(4);
  const [animate, setAnimate] = useState(false);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const scene = SCENES.find((candidate) => candidate.id === sceneId) ?? SCENES[0];
  const programs = useMemo(() => programsIn(files), [files]);
  const geometry = useMemo(() => scene.build(inputs), [scene, inputs]);
  const editedFile = files.find((file) => file.path === editing) ?? null;
  const example = source.kind === 'example' ? source.example : null;
  const modified = example !== null && JSON.stringify(files) !== JSON.stringify(exampleFiles(example.id));

  useEffect(() => {
    if (!canvasRef.current || rendererRef.current) return;
    try {
      rendererRef.current = new ShaderRenderer(canvasRef.current);
    } catch (error) {
      // oxlint-disable-next-line react/set-state-in-effect
      setSetupError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  // Rendu (et animation de GameTime si demandée), léger différé pendant la frappe
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !program) return;
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
  }, [program, files, geometry, scale, animate]);

  const loadExample = (next: ShaderExample) => {
    setSource({ kind: 'example', example: next });
    setFiles(exampleFiles(next.id));
    setProgram(next.program);
    setSceneId(next.scene);
    setEditing(next.open);
    setAnimate(next.animate ?? false);
    setInputs((current) => ({ ...current, color: next.color ?? DEFAULT_INPUTS.color }));
  };

  const loadFolder = async (event: ChangeEvent<HTMLInputElement>) => {
    const list = [...(event.target.files ?? [])].filter((file) => SHADER_FILE.test(file.name));
    event.target.value = '';
    if (list.length === 0) return;
    const loaded = await Promise.all(list.map(async (file) => ({ path: shaderPath(file.webkitRelativePath || file.name), source: await file.text() })));
    loaded.sort((a, b) => a.path.localeCompare(b.path));
    setFiles(loaded);
    setSource({ kind: 'folder', name: (list[0].webkitRelativePath || list[0].name).split('/')[0] });
    const found = programsIn(loaded);
    const preferred = found.includes(scene.program) ? scene.program : found[0] ?? '';
    setProgram(preferred);
    setEditing(loaded.find((file) => file.path === `${preferred}.fsh`)?.path ?? loaded[0].path);
  };

  const changeScene = (id: SceneId) => {
    setSceneId(id);
    const next = SCENES.find((candidate) => candidate.id === id);
    if (next && programs.includes(next.program)) {
      setProgram(next.program);
      setEditing(`${next.program}.fsh`);
    }
  };

  const editSource = (text: string) => {
    if (!editing) return;
    setFiles((current) => current.map((file) => (file.path === editing ? { ...file, source: text } : file)));
  };

  const loadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const image = await readBitmap(file);
    setInputs((current) => ({ ...current, image }));
  };

  return (
    <ScreenFrame title="Shaders" icon="code" pill={pill}>
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
            {source.kind === 'folder' && (
              <p className="muted shaderlab-note">
                Dossier <span className="mono">{source.name}</span> chargé. Choisissez le dossier{' '}
                <span className="mono">shaders/</span> d’un pack (ou un parent) ; les includes du jeu absents sont
                remplacés par des versions minimales.
              </p>
            )}
          </section>

          <section className="card">
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
          {example && (
            <div className="card shaderlab-intro">
              <h3>{example.title}</h3>
              <p>{example.summary}</p>
              <p>
                <strong>À essayer :</strong> {example.tryThis}
              </p>
            </div>
          )}

          <div className="card shaderlab-scene">
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

          <div className="card shaderlab-preview">
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
                  {modified && example && (
                    <button type="button" onClick={() => loadExample(example)}>
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
                      <button type="button" className="ghost" onClick={() => error.file && setEditing(error.file)}>
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
