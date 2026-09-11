import { useEffect, useMemo, useRef, useState } from 'react';
import { Field, FieldError, Modal, NumberField } from '../components/fields';
import { NBSP, plural } from '../lib/format';
import { ID_PATTERN, sanitizeId, uniqueId } from '../model/menu';
import { bytesToBitmap, loadBitmap } from '../pixel/io';
import { DEFAULT_PALETTE } from '../pixel/palette';
import type { Bitmap } from '../pixel/raster';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import { base64ToBytes, fetchProviders, generateImage, isAbort } from './api';
import type { AiProvider } from './api';
import { DEFAULT_CONSTRAINTS, constrainTexture, extractPalette, parsePalette } from './constrain';
import type { PaletteChoice, Rgb } from './constrain';
import { TEXTURE_NEGATIVE, textureSystemPrompt } from './prompts';
import { nextGenerationId, rememberTexture, textureHistory } from './session';
import type { TextureGeneration } from './session';
import './ai.css';

/** Côté maximal d’une texture générée (au-delà, l’éditeur de pixels reste la bonne voie). */
const MAX_SIDE = 256;

const SIZE_PRESETS: ReadonlyArray<{ label: string; width: number; height: number }> = [
  { label: 'Icône d’item', width: 16, height: 16 },
  { label: 'Case d’inventaire', width: 18, height: 18 },
  { label: 'Item détaillé', width: 32, height: 32 },
  { label: 'Bouton', width: 64, height: 20 },
  { label: 'Onglet', width: 28, height: 32 },
  { label: 'Fenêtre de coffre (3 lignes)', width: 176, height: 168 },
];

type PaletteMode = 'menu-forge' | 'reference' | 'auto' | 'free';

const MENU_FORGE_PALETTE: Rgb[] = parsePalette(DEFAULT_PALETTE.map((entry) => entry.hex));

export interface AiTextureResult {
  id: string;
  name: string;
  bitmap: Bitmap;
  prompt: string;
}

export interface AiTextureReference {
  url: string;
  name: string;
}

interface AiTextureDialogProps {
  /** Identifiants d’images de pixels déjà pris. */
  existingIds: string[];
  /** Texture dont on reprend la taille et la palette (bibliothèque, image ouverte). */
  reference: AiTextureReference | null;
  onCancel: () => void;
  onOpenSettings: () => void;
  /** Crée l’image de pixels et l’ouvre dans l’éditeur. */
  onCreate: (result: AiTextureResult) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const clampSide = (value: number) => Math.min(MAX_SIDE, Math.max(1, Math.round(value)));

/** Tampon RGBA affiché dans un canvas, agrandi (ou réduit) pour tenir dans `box` px. */
function BitmapView({ bitmap, box, label }: { bitmap: Bitmap; box: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    context.putImageData(new ImageData(new Uint8ClampedArray(bitmap.data), bitmap.width, bitmap.height), 0, 0);
  }, [bitmap]);
  const ratio = box / Math.max(bitmap.width, bitmap.height);
  const scale = ratio >= 1 ? Math.floor(ratio) : ratio;
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      style={{ width: Math.max(1, Math.round(bitmap.width * scale)), height: Math.max(1, Math.round(bitmap.height * scale)) }}
    />
  );
}

/**
 * « Générer une texture… » : prompt, fournisseur, taille, palette ; l’image
 * du modèle passe par la chaîne de contrainte (grille, palette, transparence)
 * avant de s’ouvrir dans l’éditeur de pixels pour retouche.
 */
export function AiTextureDialog({ existingIds, reference, onCancel, onOpenSettings, onCreate }: AiTextureDialogProps) {
  const [providers, setProviders] = useState<AiProvider[] | null>(null);
  const [providerId, setProviderId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [width, setWidth] = useState(16);
  const [height, setHeight] = useState(16);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('menu-forge');
  const [autoCount, setAutoCount] = useState(16);
  const [removeBackground, setRemoveBackground] = useState(DEFAULT_CONSTRAINTS.removeBackground);
  const [tolerance, setTolerance] = useState(DEFAULT_CONSTRAINTS.backgroundTolerance);
  const [cropToSubject, setCropToSubject] = useState(DEFAULT_CONSTRAINTS.cropToSubject);
  const [hardAlpha, setHardAlpha] = useState(true);
  const [referencePalette, setReferencePalette] = useState<Rgb[]>([]);
  const [generation, setGeneration] = useState<TextureGeneration | null>(null);
  const [name, setName] = useState('Texture IA');
  const [id, setId] = useState(() => uniqueId('texture_ia', existingIds));
  const [idTouched, setIdTouched] = useState(false);
  const [busy, setBusy] = useState<'generate' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setHistoryVersion] = useState(0);
  const controller = useRef<AbortController | null>(null);

  // Fournisseurs d’images activés, relus à l’ouverture (aucune requête vers un fournisseur ici).
  useEffect(() => {
    let cancelled = false;
    void fetchProviders().then(
      (list) => {
        if (cancelled) return;
        const images = list.providers.filter((provider) => provider.image);
        setProviders(images);
        setProviderId((current) => current || (images.find((provider) => provider.ready)?.id ?? ''));
      },
      (failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure));
      },
    );
    return () => {
      cancelled = true;
      controller.current?.abort();
    };
  }, []);

  // Texture de référence : sa taille et sa palette.
  useEffect(() => {
    if (!reference) return;
    let cancelled = false;
    void loadBitmap(reference.url).then(
      (bitmap) => {
        if (cancelled) return;
        setWidth(clampSide(bitmap.width));
        setHeight(clampSide(bitmap.height));
        const colors = extractPalette(bitmap, 32);
        setReferencePalette(colors);
        if (colors.length > 0) setPaletteMode('reference');
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [reference]);

  const palette: PaletteChoice =
    paletteMode === 'menu-forge'
      ? { kind: 'fixed', colors: MENU_FORGE_PALETTE }
      : paletteMode === 'reference' && referencePalette.length > 0
        ? { kind: 'fixed', colors: referencePalette }
        : paletteMode === 'auto'
          ? { kind: 'auto', count: autoCount }
          : { kind: 'free' };

  const constrained = useMemo(() => {
    if (!generation) return null;
    return constrainTexture(generation.raw, {
      width,
      height,
      removeBackground,
      backgroundTolerance: tolerance,
      cropToSubject,
      alphaThreshold: hardAlpha ? 128 : null,
      palette,
    });
    // `palette` est dérivée des états listés.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, width, height, removeBackground, tolerance, cropToSubject, hardAlpha, paletteMode, autoCount, referencePalette]);

  const provider = providers?.find((candidate) => candidate.id === providerId) ?? null;
  const ready = providers?.filter((candidate) => candidate.ready) ?? [];
  let idError: string | null = null;
  if (!ID_PATTERN.test(id)) idError = 'Lettres minuscules, chiffres et _ uniquement';
  else if (existingIds.includes(id)) idError = 'Une image porte déjà cet identifiant';

  const generate = async () => {
    if (!provider?.ready || !prompt.trim() || busy) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy('generate');
    setError(null);
    try {
      const fixedColors = palette.kind === 'fixed' ? palette.colors : [];
      const reply = await generateImage(
        {
          provider: provider.id,
          prompt: prompt.trim(),
          system: textureSystemPrompt({ width, height, palette: fixedColors }),
          negativePrompt: TEXTURE_NEGATIVE,
          width,
          height,
        },
        abort.signal,
      );
      const raw = await bytesToBitmap(base64ToBytes(reply.data), reply.mime);
      const next: TextureGeneration = {
        id: nextGenerationId(),
        at: Date.now(),
        provider: provider.id,
        providerName: provider.name,
        model: reply.model,
        prompt: prompt.trim(),
        raw,
        width,
        height,
      };
      rememberTexture(next);
      setHistoryVersion((version) => version + 1);
      setGeneration(next);
      if (!idTouched && name === 'Texture IA') {
        const suggested = prompt.trim().slice(0, 40);
        setName(suggested);
        setId(uniqueId(sanitizeId(suggested) || 'texture_ia', existingIds));
      }
    } catch (failure) {
      if (!isAbort(failure)) setError(errorMessage(failure));
    } finally {
      if (controller.current === abort) controller.current = null;
      setBusy(null);
    }
  };

  const stop = () => controller.current?.abort();

  const create = async () => {
    if (!constrained || idError || !name.trim()) return;
    setBusy('create');
    setError(null);
    try {
      await onCreate({ id, name: name.trim(), bitmap: constrained.bitmap, prompt: generation?.prompt ?? prompt });
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(null);
    }
  };

  // Relu à chaque rendu : `setHistoryVersion` en provoque un après chaque génération.
  const history = [...textureHistory()];
  const report = constrained?.report;

  return (
    <Modal
      title="Générer une texture"
      onClose={() => {
        stop();
        onCancel();
      }}
      footer={
        <>
          {error && <FieldError>{error}</FieldError>}
          <button type="button" onClick={onCancel}>
            Annuler
          </button>
          {busy === 'generate' ? (
            <Tooltip label="Arrêter la génération" hint={`La requête est abandonnée${NBSP}; rien n’est créé`}>
              <button type="button" onClick={stop}>
                <Icon name="stop" />
                Arrêter
              </button>
            </Tooltip>
          ) : (
            <Tooltip label={generation ? 'Nouvelle image' : 'Lancer la génération'} shortcut="Ctrl+Entrée">
              <button
                type="button"
                className={generation ? undefined : 'primary'}
                disabled={!provider?.ready || !prompt.trim() || busy !== null}
                onClick={() => void generate()}
              >
                <Icon name={generation ? 'reload' : 'sparkles'} />
                {generation ? 'Régénérer' : 'Générer'}
              </button>
            </Tooltip>
          )}
          <button
            type="button"
            className={generation ? 'primary' : undefined}
            disabled={!constrained || Boolean(idError) || !name.trim() || busy !== null}
            onClick={() => void create()}
          >
            <Icon name={busy === 'create' ? 'loader' : 'pencil'} />
            Ouvrir dans l’éditeur de pixels
          </button>
        </>
      }
    >
      <div className="ai-grid">
        <div className="ai-form">
          {providers && ready.length === 0 ? (
            <p className="empty-hint">
              <Icon name="info" />
              <span>
                Aucun fournisseur d’images prêt.{' '}
                <button type="button" className="link-button" onClick={onOpenSettings}>
                  Configurer l’IA…
                </button>
              </span>
            </p>
          ) : (
            <Field label="Fournisseur">
              <select value={providerId} onChange={(event) => setProviderId(event.target.value)} disabled={!providers}>
                {!providers && <option value="">Chargement…</option>}
                {providers?.map((candidate) => (
                  <option key={candidate.id} value={candidate.id} disabled={!candidate.ready}>
                    {candidate.name}
                    {candidate.ready ? ` · ${candidate.imageModel ?? 'modèle par défaut'}` : ` (${candidate.issue ?? 'indisponible'})`}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Description" hint={`En quelques mots${NBSP}: sujet, couleurs, usage (bouton, icône, cadre…)`}>
            <textarea
              className="ai-prompt"
              value={prompt}
              placeholder="Épée en diamant, lame cyan, garde dorée"
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void generate();
                }
              }}
            />
          </Field>
          <Field label="Taille type">
            <select
              value=""
              onChange={(event) => {
                const preset = SIZE_PRESETS[Number(event.target.value)];
                if (preset) {
                  setWidth(preset.width);
                  setHeight(preset.height);
                }
              }}
            >
              <option value="">
                {width} × {height} px
              </option>
              {SIZE_PRESETS.map((preset, index) => (
                <option key={preset.label} value={index}>
                  {preset.label} · {preset.width} × {preset.height}
                </option>
              ))}
            </select>
          </Field>
          <div className="field-row">
            <NumberField label="Largeur" value={width} min={1} max={MAX_SIDE} onChange={(value) => setWidth(clampSide(value))} />
            <NumberField label="Hauteur" value={height} min={1} max={MAX_SIDE} onChange={(value) => setHeight(clampSide(value))} />
          </div>
          <Field label="Palette imposée">
            <select value={paletteMode} onChange={(event) => setPaletteMode(event.target.value as PaletteMode)}>
              <option value="menu-forge">Menu Forge ({MENU_FORGE_PALETTE.length} couleurs)</option>
              {referencePalette.length > 0 && (
                <option value="reference">
                  De «{NBSP}{reference?.name}{NBSP}» ({referencePalette.length} couleurs)
                </option>
              )}
              <option value="auto">Automatique, réduite</option>
              <option value="free">Libre (aucune)</option>
            </select>
          </Field>
          {paletteMode === 'auto' && (
            <NumberField label="Couleurs au plus" value={autoCount} min={2} max={64} onChange={(value) => setAutoCount(Math.min(64, Math.max(2, value)))} />
          )}
          <label className="checkbox">
            <input type="checkbox" checked={removeBackground} onChange={(event) => setRemoveBackground(event.target.checked)} />
            Détourer le fond (couleur des bords)
          </label>
          {removeBackground && (
            <label className="ai-range">
              <span className="muted small">Tolérance</span>
              <input
                type="range"
                min={4}
                max={160}
                value={tolerance}
                aria-label="Tolérance du détourage"
                onChange={(event) => setTolerance(Number(event.target.value))}
              />
              <span className="mono small">{tolerance}</span>
            </label>
          )}
          <label className="checkbox">
            <input type="checkbox" checked={cropToSubject} onChange={(event) => setCropToSubject(event.target.checked)} />
            Recadrer sur le sujet
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={hardAlpha} onChange={(event) => setHardAlpha(event.target.checked)} />
            Transparence nette (sans pixels translucides)
          </label>
        </div>

        <div className="ai-side">
          <div className="ai-stage">
            <div className="ai-frame">
              <span className="ai-frame-label">Sortie du modèle</span>
              {generation ? (
                <BitmapView bitmap={generation.raw} box={150} label="Image renvoyée par le modèle" />
              ) : (
                <span className="ai-frame-empty">{busy === 'generate' ? 'Génération…' : 'Aucune image'}</span>
              )}
            </div>
            <div className="ai-frame">
              <span className="ai-frame-label">
                Texture {width} × {height}
              </span>
              {constrained ? (
                <BitmapView bitmap={constrained.bitmap} box={150} label="Texture contrainte" />
              ) : (
                <span className="ai-frame-empty">{busy === 'generate' ? <Icon name="loader" size={24} /> : 'Grille, palette et transparence appliquées ici'}</span>
              )}
            </div>
          </div>
          {generation && report && (
            <p className="ai-meta">
              {generation.providerName} · {generation.model || 'modèle par défaut'} · source {generation.raw.width} × {generation.raw.height}
              {' · '}
              {plural(report.colors, 'couleur')}
              {' · '}
              {report.sourceHadAlpha ? 'transparence du modèle gardée' : `fond détouré${NBSP}: ${Math.round(report.backgroundRemoved * 100)}${NBSP}%`}
            </p>
          )}
          <div className="field-row">
            <Field label="Nom de l’image">
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!idTouched) setId(uniqueId(sanitizeId(event.target.value) || 'texture_ia', existingIds));
                }}
              />
            </Field>
            <Field label="Identifiant" hint="pixels/<id>.pixel.json">
              <input
                className="mono"
                value={id}
                onChange={(event) => {
                  setIdTouched(true);
                  setId(event.target.value);
                }}
              />
              {idError && <FieldError>{idError}</FieldError>}
            </Field>
          </div>
          {history.length > 0 && (
            <div>
              <p className="muted small">Générations de la session</p>
              <div className="ai-history" role="list" aria-label="Générations de la session">
                {history.map((entry) => (
                  <Tooltip key={entry.id} label={entry.prompt} hint={`${entry.providerName} · ${new Date(entry.at).toLocaleTimeString('fr')}`}>
                    <button
                      type="button"
                      role="listitem"
                      className={entry.id === generation?.id ? 'ai-history-item active' : 'ai-history-item'}
                      aria-label={`Reprendre «${NBSP}${entry.prompt}${NBSP}»`}
                      onClick={() => {
                        setGeneration(entry);
                        setPrompt(entry.prompt);
                      }}
                    >
                      <BitmapView bitmap={entry.raw} box={36} label="" />
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
