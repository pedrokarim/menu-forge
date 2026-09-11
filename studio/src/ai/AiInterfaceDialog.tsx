import { useEffect, useMemo, useRef, useState } from 'react';
import { Field, FieldError, Modal, NumberField } from '../components/fields';
import { textureUrl } from '../lib/api';
import { NBSP, plural } from '../lib/format';
import { imageToCanvas, renderGeneratorImage } from '../model/textureRender';
import { MAX_ROWS, WINDOW_WIDTH, areaRect, windowHeight } from '../model/geometry';
import { ID_PATTERN, sanitizeId, uniqueId } from '../model/menu';
import type { MenuDefinition } from '../model/menu';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import { fetchProviders, generateText, isAbort } from './api';
import type { AiProvider } from './api';
import { DEFAULT_ATTEMPTS, MAX_ATTEMPTS_LIMIT, generateWithCorrections } from './correction';
import { checkMenu } from './menuCheck';
import type { MenuCheckContext } from './menuCheck';
import { interfaceRequest, interfaceSystemPrompt } from './prompts';
import { interfaceHistory, nextGenerationId, rememberInterface } from './session';
import type { InterfaceGeneration } from './session';
import './ai.css';

interface AiInterfaceDialogProps {
  /** Menus de l’espace (identifiants pris, cibles d’`open`). */
  menus: MenuDefinition[];
  /** Textures de l’espace (chemins relatifs à `textures/`). */
  textures: string[];
  initialRows?: number;
  onCancel: () => void;
  onOpenSettings: () => void;
  /** Ouvre le menu dans l’éditeur, à relire avant enregistrement. */
  onOpen: (menu: MenuDefinition) => Promise<void>;
}

interface LogLine {
  attempt: number;
  errors: string[];
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
      for (const text of menu.texts ?? []) {
        context.fillStyle = text.color ?? '#404040';
        context.textAlign = text.align ?? 'left';
        context.fillText(text.value, text.x, text.y);
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
 */
export function AiInterfaceDialog({ menus, textures, initialRows = 6, onCancel, onOpenSettings, onOpen }: AiInterfaceDialogProps) {
  const existingIds = useMemo(() => menus.map((menu) => menu.id), [menus]);
  const [providers, setProviders] = useState<AiProvider[] | null>(null);
  const [providerId, setProviderId] = useState('');
  const [description, setDescription] = useState('');
  const [name, setName] = useState('Menu généré');
  const [id, setId] = useState(() => uniqueId('menu_genere', existingIds));
  const [idTouched, setIdTouched] = useState(false);
  const [rows, setRows] = useState(initialRows);
  const [attempts, setAttempts] = useState(DEFAULT_ATTEMPTS);
  const [allowGenerated, setAllowGenerated] = useState(true);
  const [log, setLog] = useState<LogLine[]>([]);
  const [result, setResult] = useState<InterfaceGeneration | null>(null);
  const [busy, setBusy] = useState<'generate' | 'open' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setHistoryVersion] = useState(0);
  const controller = useRef<AbortController | null>(null);

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
      controller.current?.abort();
    };
  }, []);

  const provider = providers?.find((candidate) => candidate.id === providerId) ?? null;
  const ready = providers?.filter((candidate) => candidate.ready) ?? [];
  let idError: string | null = null;
  if (!ID_PATTERN.test(id)) idError = 'Lettres minuscules, chiffres et _ uniquement';
  else if (existingIds.includes(id)) idError = 'Un menu porte déjà cet identifiant';

  const generate = async () => {
    if (!provider?.ready || !description.trim() || idError || busy) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy('generate');
    setError(null);
    setLog([]);
    setResult(null);
    try {
      const schemaText = (await import('../../../docs/menu.schema.json?raw')).default;
      const context: MenuCheckContext = {
        schema: JSON.parse(schemaText) as unknown,
        menuId: id,
        rows,
        textures: new Set(textures),
        menus,
        allowGenerated,
      };
      const system = interfaceSystemPrompt({
        schemaText,
        menuId: id,
        name: name.trim() || id,
        rows,
        textures: [...textures].sort(),
        menus: menus.filter((menu) => !menu.template && !menu.component).map((menu) => menu.id),
        allowGenerated,
      });
      let model = '';
      const outcome = await generateWithCorrections<MenuDefinition>({
        request: interfaceRequest(description),
        maxAttempts: attempts,
        signal: abort.signal,
        send: async (messages, signal) => {
          const reply = await generateText({ provider: provider.id, system, messages, json: true }, signal);
          model = reply.model;
          return reply.text;
        },
        validate: (value) => checkMenu(value, context),
        onAttempt: (attempt) => setLog((lines) => [...lines, { attempt: attempt.index, errors: attempt.errors }]),
      });
      const last = outcome.attempts.at(-1);
      const generation: InterfaceGeneration = {
        id: nextGenerationId(),
        at: Date.now(),
        provider: provider.id,
        providerName: provider.name,
        model,
        prompt: description.trim(),
        menu: outcome.value,
        attempts: outcome.attempts.length,
        errors: outcome.value ? [] : (last?.errors ?? []),
      };
      rememberInterface(generation);
      setHistoryVersion((version) => version + 1);
      setResult(generation);
      if (!outcome.value) {
        setError(`Aucun document valide après ${plural(outcome.attempts.length, 'essai')}${NBSP}: reformule la demande ou augmente le nombre d’essais`);
      }
    } catch (failure) {
      if (!isAbort(failure)) setError(errorMessage(failure));
    } finally {
      if (controller.current === abort) controller.current = null;
      setBusy(null);
    }
  };

  const stop = () => controller.current?.abort();

  const open = async () => {
    const menu = result?.menu;
    if (!menu) return;
    if (existingIds.includes(menu.id)) {
      setError(`Un menu «${NBSP}${menu.id}${NBSP}» existe déjà`);
      return;
    }
    setBusy('open');
    setError(null);
    try {
      await onOpen(menu);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(null);
    }
  };

  // Relu à chaque rendu : `setHistoryVersion` en provoque un après chaque génération.
  const history = [...interfaceHistory()];
  const menu = result?.menu ?? null;
  const generatedLayers = menu?.layers.filter((layer) => layer.generator).length ?? 0;

  return (
    <Modal
      title="Générer une interface par IA"
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
            <Tooltip label="Arrêter la génération" hint="Les essais en cours sont abandonnés">
              <button type="button" onClick={stop}>
                <Icon name="stop" />
                Arrêter
              </button>
            </Tooltip>
          ) : (
            <Tooltip label={menu ? 'Nouvelle proposition' : 'Lancer la génération'} shortcut="Ctrl+Entrée">
              <button
                type="button"
                className={menu ? undefined : 'primary'}
                disabled={!provider?.ready || !description.trim() || Boolean(idError) || busy !== null}
                onClick={() => void generate()}
              >
                <Icon name={menu ? 'reload' : 'sparkles'} />
                {menu ? 'Régénérer' : 'Générer'}
              </button>
            </Tooltip>
          )}
          <Tooltip label="Ouvrir dans l’éditeur" hint={`Non enregistré${NBSP}: relis-le, puis Ctrl+S`}>
            <button type="button" className={menu ? 'primary' : undefined} disabled={!menu || busy !== null} onClick={() => void open()}>
              <Icon name={busy === 'open' ? 'loader' : 'open'} />
              Ouvrir dans l’éditeur
            </button>
          </Tooltip>
        </>
      }
    >
      <div className="ai-grid">
        <div className="ai-form">
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
                  void generate();
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
              {idError && <FieldError>{idError}</FieldError>}
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
        </div>

        <div className="ai-side">
          <div className="ai-frame">
            <span className="ai-frame-label">Aperçu</span>
            {menu ? (
              <MenuSketch menu={menu} />
            ) : (
              <span className="ai-frame-empty">{busy === 'generate' ? <Icon name="loader" size={24} /> : 'Le menu validé apparaîtra ici'}</span>
            )}
          </div>
          {menu && (
            <p className="ai-meta">
              {plural(menu.layers.length, 'couche')} ({generatedLayers} dessinée{generatedLayers > 1 ? 's' : ''} par le studio) ·{' '}
              {plural((menu.texts ?? []).length, 'texte')} · {plural((menu.slots ?? []).length, 'slot')} · valide au{' '}
              {result?.attempts === 1 ? '1er essai' : `${result?.attempts}e essai`}
            </p>
          )}
          {log.length > 0 && (
            <ul className="ai-log" aria-label="Essais">
              {log.map((line) => (
                <li key={line.attempt} className={line.errors.length ? 'is-error' : 'is-ok'}>
                  Essai {line.attempt}
                  {NBSP}: {line.errors.length === 0 ? 'valide' : `${plural(line.errors.length, 'erreur')}, renvoyée${line.errors.length > 1 ? 's' : ''} au modèle`}
                  {line.errors.slice(0, 4).map((problem) => (
                    <div key={problem}>· {problem}</div>
                  ))}
                </li>
              ))}
            </ul>
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
                    onClick={() => {
                      setResult(entry);
                      setDescription(entry.prompt);
                      setLog([]);
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
