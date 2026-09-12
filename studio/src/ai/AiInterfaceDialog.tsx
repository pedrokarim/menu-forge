import { useEffect, useMemo, useRef, useState } from 'react';
import { Field, FieldError, Modal, NumberField } from '../components/fields';
import { textureUrl } from '../lib/api';
import { NBSP, plural } from '../lib/format';
import { imageToCanvas, renderGeneratorImage } from '../model/textureRender';
import { DEFAULT_PREVIEW, buildPreviewContext, interpolate } from '../model/preview';
import { MAX_ROWS, WINDOW_WIDTH, areaRect, windowHeight } from '../model/geometry';
import { ID_PATTERN, sanitizeId, uniqueId } from '../model/menu';
import type { MenuDefinition } from '../model/menu';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import { fetchProviders } from './api';
import type { AiProvider } from './api';
import { DEFAULT_ATTEMPTS, MAX_ATTEMPTS_LIMIT } from './correction';
import { startInterfaceJob } from './interfaceJob';
import type { InterfaceJobParams } from './interfaceJob';
import { cancelJob, consumeJob, getJob, isRunning, latestJob, useJob, useWatchJob } from './jobs';
import { JobPanel } from './JobPanel';
import { interfaceHistory } from './session';
import type { InterfaceGeneration } from './session';
import './ai.css';

interface AiInterfaceDialogProps {
  /** Menus de l’espace (identifiants pris, cibles d’`open`). */
  menus: MenuDefinition[];
  /** Textures de l’espace (chemins relatifs à `textures/`). */
  textures: string[];
  initialRows?: number;
  /** Tâche à montrer (notification, indicateur) ; sinon la dernière en cours ou non consultée. */
  jobId?: string | null;
  /** Ferme le dialogue ; une génération en cours continue en arrière-plan. */
  onCancel: () => void;
  onOpenSettings: () => void;
  /** Ouvre le menu dans l’éditeur, à relire avant enregistrement. */
  onOpen: (menu: MenuDefinition) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** Aperçu rapide : couches (textures de l’espace, ou dessinées par le studio), zones de slots, textes. */
function MenuSketch({ menu }: { menu: MenuDefinition }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    let cancelled = false;
    void Promise.all(
      menu.layers.map((layer) => (layer.generator ? Promise.resolve(imageToCanvas(renderGeneratorImage(layer.generator, layer))) : loadImage(textureUrl(layer.texture, 0)))),
    ).then((images) => {
      if (cancelled) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;
      images.forEach((image, index) => {
        if (image) context.drawImage(image, menu.layers[index].x, menu.layers[index].y);
      });
      context.strokeStyle = 'rgba(242, 201, 76, 0.85)';
      for (const slot of menu.slots ?? []) {
        const rect = areaRect(slot.area);
        context.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
      }
      context.font = '8px monospace';
      context.textBaseline = 'top';
      // Variables remplacées comme dans l'éditeur (« {page.number} » devient « 1 »).
      const preview = buildPreviewContext(menu, DEFAULT_PREVIEW);
      for (const text of menu.texts ?? []) {
        context.fillStyle = text.color ?? '#404040';
        context.textAlign = text.align ?? 'left';
        context.fillText(interpolate(text.value, preview.variables), text.x, text.y);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [menu]);
  const height = windowHeight(menu.container.rows);
  const scale = Math.max(1, Math.floor(Math.min(2, 330 / WINDOW_WIDTH, 230 / height)));
  return (
    <canvas
      ref={ref}
      width={WINDOW_WIDTH}
      height={height}
      role="img"
      aria-label="Aperçu du menu généré"
      style={{ width: WINDOW_WIDTH * scale, height: height * scale }}
    />
  );
}

/**
 * « Générer une interface… » : description, fournisseur de texte, taille du
 * coffre ; le modèle reçoit le schéma exact et le contexte de l’espace, sa
 * réponse est validée (schéma, règles de la lib) et corrigée en boucle
 * bornée, puis le menu s’ouvre dans l’éditeur, **non enregistré**.
 *
 * La génération est une tâche de fond (`jobs.ts`) : fermer le dialogue ne
 * l’arrête pas, le rouvrir la montre en direct ; seul « Annuler la
 * génération » l’arrête.
 */
export function AiInterfaceDialog({ menus, textures, initialRows = 6, jobId: requestedJob = null, onCancel, onOpenSettings, onOpen }: AiInterfaceDialogProps) {
  const existingIds = useMemo(() => menus.map((menu) => menu.id), [menus]);
  // Tâche montrée à l’ouverture, et ses valeurs pour préremplir le formulaire.
  const [initialJob] = useState(() => getJob(requestedJob) ?? latestJob('interface'));
  const initial = initialJob?.params as InterfaceJobParams | undefined;
  const [jobId, setJobId] = useState<string | null>(initialJob?.id ?? null);
  const job = useJob(jobId);
  useWatchJob(jobId);
  const running = job !== null && isRunning(job);

  const [providers, setProviders] = useState<AiProvider[] | null>(null);
  const [providerId, setProviderId] = useState(initial?.providerId ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [name, setName] = useState(initial?.name ?? 'Menu généré');
  const [id, setId] = useState(() => initial?.id ?? uniqueId('menu_genere', existingIds));
  const [idTouched, setIdTouched] = useState(Boolean(initial));
  const [rows, setRows] = useState(initial?.rows ?? initialRows);
  const [attempts, setAttempts] = useState(initial?.attempts ?? DEFAULT_ATTEMPTS);
  const [allowGenerated, setAllowGenerated] = useState(initial?.allowGenerated ?? true);
  /** Génération reprise de l’historique de la session (hors tâche). */
  const [picked, setPicked] = useState<InterfaceGeneration | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchProviders().then(
      (list) => {
        if (cancelled) return;
        const texts = list.providers.filter((provider) => provider.text);
        setProviders(texts);
        setProviderId((current) => current || (texts.find((provider) => provider.ready)?.id ?? ''));
      },
      (failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const provider = providers?.find((candidate) => candidate.id === providerId) ?? null;
  const ready = providers?.filter((candidate) => candidate.ready) ?? [];
  let idError: string | null = null;
  if (!ID_PATTERN.test(id)) idError = 'Lettres minuscules, chiffres et _ uniquement';
  else if (existingIds.includes(id)) idError = 'Un menu porte déjà cet identifiant';

  const result = (job?.result as InterfaceGeneration | null | undefined) ?? picked;
  const menu = result?.menu ?? null;
  const canGenerate = Boolean(provider?.ready && description.trim()) && !idError && !running && !opening;

  const generate = () => {
    if (!provider || !canGenerate) return;
    setError(null);
    setPicked(null);
    // Une nouvelle proposition remplace le résultat affiché (il reste dans les générations de la session).
    if (job) consumeJob(job.id);
    const params: InterfaceJobParams = { providerId: provider.id, description, name, id, rows, attempts, allowGenerated };
    setJobId(startInterfaceJob(params, provider, { menus, textures }));
  };

  /** Pendant une génération : formulaire libéré pour une autre demande (la première continue). */
  const newRequest = () => {
    setJobId(null);
    setPicked(null);
    setError(null);
    setId(uniqueId(sanitizeId(name) || 'menu_genere', [...existingIds, id]));
  };

  const reject = () => {
    if (job) consumeJob(job.id);
    setJobId(null);
    setError(null);
  };

  const open = async () => {
    if (!menu) return;
    if (existingIds.includes(menu.id)) {
      setError(`Un menu «${NBSP}${menu.id}${NBSP}» existe déjà`);
      return;
    }
    setOpening(true);
    setError(null);
    try {
      await onOpen(menu);
      if (job) consumeJob(job.id);
    } catch (failure) {
      setError(errorMessage(failure));
      setOpening(false);
    }
  };

  const history = [...interfaceHistory()];
  const generatedLayers = menu?.layers.filter((layer) => layer.generator).length ?? 0;

  return (
    <Modal
      title="Générer une interface par IA"
      onClose={onCancel}
      footer={
        running ? (
          <>
            <Tooltip label="Annuler la génération" hint={`Arrête vraiment la tâche${NBSP}: rien n’est créé`}>
              <button type="button" onClick={() => cancelJob(job.id)}>
                <Icon name="stop" />
                Annuler la génération
              </button>
            </Tooltip>
            <Tooltip label="Continuer en arrière-plan" hint="Une notification prévient à la fin" shortcut="Échap">
              <button type="button" className="primary" onClick={onCancel}>
                <Icon name="chevron-down" />
                Continuer en arrière-plan
              </button>
            </Tooltip>
          </>
        ) : (
          <>
            {error && <FieldError>{error}</FieldError>}
            <button type="button" onClick={onCancel}>
              {result ? 'Fermer' : 'Annuler'}
            </button>
            {job && !job.consumed && job.phase !== 'cancelled' && (
              <Tooltip label="Rejeter ce résultat" hint="Il reste dans les générations de la session">
                <button type="button" onClick={reject}>
                  <Icon name="trash" />
                  Rejeter
                </button>
              </Tooltip>
            )}
            <Tooltip label={result ? 'Nouvelle proposition' : 'Lancer la génération'} shortcut="Ctrl+Entrée">
              <button type="button" className={menu ? undefined : 'primary'} disabled={!canGenerate} onClick={generate}>
                <Icon name={result ? 'reload' : 'sparkles'} />
                {result ? 'Régénérer' : 'Générer'}
              </button>
            </Tooltip>
            <Tooltip label="Ouvrir dans l’éditeur" hint={`Non enregistré${NBSP}: relis-le, puis Ctrl+S`}>
              <button type="button" className={menu ? 'primary' : undefined} disabled={!menu || opening} onClick={() => void open()}>
                <Icon name={opening ? 'loader' : 'open'} />
                Ouvrir dans l’éditeur
              </button>
            </Tooltip>
          </>
        )
      }
    >
      <div className="ai-grid">
        <fieldset className="ai-form" disabled={running}>
          {providers && ready.length === 0 ? (
            <p className="empty-hint">
              <Icon name="info" />
              <span>
                Aucun fournisseur de texte prêt.{' '}
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
                    {candidate.ready ? ` · ${candidate.textModel ?? 'modèle par défaut'}` : ` (${candidate.issue ?? 'indisponible'})`}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Description" hint="Type d’écran, boutons, listes, onglets, textes…">
            <textarea
              className="ai-prompt"
              value={description}
              placeholder="Boutique à deux onglets (armes, armures), grille paginée de 7 × 3, boutons page précédente / suivante et fermer"
              onChange={(event) => setDescription(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  generate();
                }
              }}
            />
          </Field>
          <div className="field-row">
            <Field label="Nom">
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!idTouched) setId(uniqueId(sanitizeId(event.target.value), existingIds));
                }}
              />
            </Field>
            <Field label="Identifiant">
              <input
                className="mono"
                value={id}
                onChange={(event) => {
                  setIdTouched(true);
                  setId(event.target.value);
                }}
              />
              {idError && !running && <FieldError>{idError}</FieldError>}
            </Field>
          </div>
          <div className="field-row">
            <NumberField label="Lignes du coffre" value={rows} min={1} max={MAX_ROWS} onChange={(value) => setRows(Math.min(MAX_ROWS, Math.max(1, value)))} />
            <NumberField
              label="Essais au plus"
              value={attempts}
              min={1}
              max={MAX_ATTEMPTS_LIMIT}
              onChange={(value) => setAttempts(Math.min(MAX_ATTEMPTS_LIMIT, Math.max(1, value)))}
            />
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={allowGenerated} onChange={(event) => setAllowGenerated(event.target.checked)} />
            Textures dessinées par le studio (panneaux, boutons)
          </label>
          <p className="muted small">
            {plural(textures.length, 'texture')} de l’espace et {plural(existingIds.length, 'menu')} sont proposés au modèle (noms seulement).
          </p>
        </fieldset>

        <div className="ai-side">
          {job && <JobPanel job={job} onNewRequest={running ? newRequest : undefined} />}
          <div className="ai-frame">
            <span className="ai-frame-label">Aperçu</span>
            {menu ? (
              <MenuSketch menu={menu} />
            ) : (
              <span className="ai-frame-empty">{running ? 'Le menu apparaîtra ici dès qu’un essai sera valide' : 'Le menu validé apparaîtra ici'}</span>
            )}
          </div>
          {menu && (
            <p className="ai-meta">
              {plural(menu.layers.length, 'couche')} ({generatedLayers} dessinée{generatedLayers > 1 ? 's' : ''} par le studio) ·{' '}
              {plural((menu.texts ?? []).length, 'texte')} · {plural((menu.slots ?? []).length, 'slot')} · valide au{' '}
              {result?.attempts === 1 ? '1er essai' : `${result?.attempts}e essai`}
            </p>
          )}
          {menu && (
            <details>
              <summary className="muted small">Document JSON</summary>
              <pre className="ai-json code">{JSON.stringify(menu, null, 2)}</pre>
            </details>
          )}
          {history.length > 0 && (
            <div>
              <p className="muted small">Générations de la session</p>
              <div className="ai-history-list" role="list">
                {history.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="listitem"
                    className="ai-history-row"
                    disabled={running}
                    onClick={() => {
                      setJobId(null);
                      setPicked(entry);
                      setDescription(entry.prompt);
                    }}
                  >
                    <Icon name={entry.menu ? 'check' : 'alert'} />
                    <span>{entry.prompt}</span>
                    <span className="muted small">{new Date(entry.at).toLocaleTimeString('fr')}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
