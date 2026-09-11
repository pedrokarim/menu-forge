import { Suspense, lazy, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchPresence } from '../lib/appApi';
import type { AppInfo, DiscordSettings, LibraryCounts, PresenceStatus, SettingsPatch, StudioSettings, WorkspaceSummary } from '../lib/appApi';
import { NBSP, plural } from '../lib/format';
import { isTauri, pickFolder, revealInExplorer } from '../lib/native';
import { Notice, ScreenFrame } from '../shell/ScreenFrame';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';

/** Section « IA » (fournisseurs, clés, modèles), chargée à la demande : son code n’alourdit pas le démarrage. */
const AiSettingsSection = lazy(() => import('../ai/AiSettingsSection').then((module) => ({ default: module.AiSettingsSection })));

/** Zooms proposés à l’ouverture (0 = « Ajuster »). */
const ZOOM_CHOICES = [0, 1, 2, 3, 4, 5, 6, 8];

/** `pack_format` des versions visées par la lib. */
const PACK_FORMATS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 32, label: '32 · Minecraft 1.20.5 et 1.20.6' },
  { value: 34, label: '34 · Minecraft 1.21 et 1.21.1' },
  { value: 46, label: '46 · Minecraft 1.21.4' },
];

const DEFAULT_DISCORD: DiscordSettings = { enabled: true, clientId: null, showDocument: true };

/** Application Discord « Menu Forge », utilisée tant qu’aucun autre identifiant n’est saisi (même valeur que le backend). */
const MENU_FORGE_CLIENT_ID = '1370756359037124698';

/** Pastille d’état de la connexion à Discord. */
function presenceBadge(discord: DiscordSettings, status: PresenceStatus | null): { label: string; className: string } {
  if (!discord.enabled) return { label: 'désactivée', className: 'badge' };
  if (!status) return { label: 'état inconnu', className: 'badge' };
  if (status.connected) return { label: 'connectée', className: 'badge badge-clean' };
  return { label: 'Discord introuvable', className: 'badge badge-missing' };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Champ texte enregistré à la sortie du champ ou sur Entrée (Échap rétablit la valeur). */
function CommitInput({
  value,
  onCommit,
  label,
  placeholder,
  mono = false,
}: {
  value: string;
  onCommit: (value: string) => void;
  label: string;
  placeholder?: string;
  mono?: boolean;
}) {
  const [text, setText] = useState(value);
  const [base, setBase] = useState(value);
  if (base !== value) {
    setBase(value);
    setText(value);
  }
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <input
      className={mono ? 'mono grow' : 'grow'}
      aria-label={label}
      value={text}
      placeholder={placeholder}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setText(value);
      }}
    />
  );
}

function SettingRow({ title, text, children }: { title: string; text?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <strong>{title}</strong>
        {text && <span>{text}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

/** Chemin réglé, répété en entier sous l’explication : le champ n’en montre qu’une partie. */
function PathEcho({ path }: { path: string | null }) {
  if (!path) return null;
  return (
    <span className="setting-path mono" style={{ display: 'block', marginTop: 4, overflowWrap: 'anywhere' }}>
      {path}
    </span>
  );
}

interface SettingsScreenProps {
  pill: ReactNode;
  app: AppInfo | null;
  settings: StudioSettings | null;
  activeWorkspace: WorkspaceSummary | null;
  onPatch: (patch: SettingsPatch) => Promise<void>;
  onReindexAll: () => Promise<LibraryCounts[]>;
  onBrowseWorkspaces: () => void;
}

/** Paramètres : espace de travail, éditeur, export vers le plugin, avancé. Enregistrés aussitôt. */
export function SettingsScreen({ pill, app, settings, activeWorkspace, onPatch, onReindexAll, onBrowseWorkspaces }: SettingsScreenProps) {
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [presence, setPresence] = useState<PresenceStatus | null>(null);

  // État de la connexion à Discord, relu régulièrement tant que l’écran est ouvert.
  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      fetchPresence().then(
        (status) => {
          if (!cancelled) setPresence(status);
        },
        () => {
          if (!cancelled) setPresence(null);
        },
      );
    void poll();
    // Fenêtre cachée ou réduite : pas de requête inutile.
    const timer = window.setInterval(() => {
      if (!document.hidden) void poll();
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const save = async (patch: SettingsPatch, label: string) => {
    setNotice(null);
    try {
      await onPatch(patch);
      setNotice({ kind: 'ok', text: `${label}${NBSP}: enregistré` });
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) });
    }
  };

  const reindexAll = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const results = await onReindexAll();
      const textures = results.reduce((sum, result) => sum + result.textures, 0);
      const fonts = results.reduce((sum, result) => sum + result.fonts, 0);
      setNotice({
        kind: 'ok',
        text: `${plural(results.length, 'bibliothèque réindexée', 'bibliothèques réindexées')} (${plural(textures, 'texture')}, ${plural(fonts, 'police')})`,
      });
    } catch (error) {
      setNotice({ kind: 'error', text: `Réindexation interrompue${NBSP}: ${errorMessage(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const browseResources = async () => {
    const chosen = await pickFolder('Dossier des ressources d’enderium-core', settings?.export.enderiumResources ?? undefined);
    if (chosen) await save({ export: { enderiumResources: chosen } }, 'Dossier des ressources');
  };

  const browseBedrock = async () => {
    const chosen = await pickFolder('Dossier d’export Bedrock', settings?.export.bedrockDirectory ?? undefined);
    if (chosen) await save({ export: { bedrockDirectory: chosen } }, 'Dossier d’export Bedrock');
  };

  if (!settings) {
    return (
      <ScreenFrame title="Paramètres" icon="sliders" pill={pill}>
        <p className="muted">Chargement…</p>
      </ScreenFrame>
    );
  }
  const { ui, export: exportSettings } = settings;
  const discord = settings.discord ?? DEFAULT_DISCORD;
  const badge = presenceBadge(discord, presence);
  const packFormats = PACK_FORMATS.some((format) => format.value === exportSettings.packFormat)
    ? PACK_FORMATS
    : [...PACK_FORMATS, { value: exportSettings.packFormat, label: `${exportSettings.packFormat} · valeur personnalisée` }];

  return (
    <ScreenFrame title="Paramètres" icon="sliders" pill={pill}>
      <Notice notice={notice} />

      <section className="screen-section" aria-labelledby="settings-workspace">
        <h2 id="settings-workspace" className="screen-section-title">
          Espace de travail
        </h2>
        <div className="card setting-list">
          <SettingRow title="Espace ouvert au démarrage" text="Le studio rouvre le dernier espace utilisé.">
            <span className="setting-value">
              <strong>{activeWorkspace?.name ?? '…'}</strong>
              <span className="row-path">{settings.activeWorkspace}</span>
            </span>
            <button type="button" onClick={onBrowseWorkspaces}>
              <Icon name="folder" />
              Changer…
            </button>
          </SettingRow>
        </div>
      </section>

      <section className="screen-section" aria-labelledby="settings-editor">
        <h2 id="settings-editor" className="screen-section-title">
          Éditeur
        </h2>
        <div className="card setting-list">
          <SettingRow title="Zoom à l’ouverture" text="« Ajuster » : le plus grand palier où tout tient dans la zone.">
            <select
              aria-label="Zoom à l’ouverture"
              value={ui.defaultZoom}
              onChange={(event) => void save({ ui: { defaultZoom: Number(event.target.value) } }, 'Zoom à l’ouverture')}
            >
              {ZOOM_CHOICES.map((level) => (
                <option key={level} value={level}>
                  {level === 0 ? 'Ajuster' : `×${level}`}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow title="Grille de pixels" text="Affichée par défaut dans l’éditeur d’assets (à partir de ×6).">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={ui.showGrid}
                onChange={(event) => void save({ ui: { showGrid: event.target.checked } }, 'Grille de pixels')}
              />
              Afficher la grille
            </label>
          </SettingRow>
          <SettingRow title="Confirmations">
            <span className="setting-checks">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={ui.confirmations.discardChanges}
                  onChange={(event) =>
                    void save({ ui: { confirmations: { discardChanges: event.target.checked } } }, 'Confirmations')
                  }
                />
                Avant d’abandonner des modifications non enregistrées
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={ui.confirmations.delete}
                  onChange={(event) => void save({ ui: { confirmations: { delete: event.target.checked } } }, 'Confirmations')}
                />
                Avant de retirer un espace ou une bibliothèque
              </label>
            </span>
          </SettingRow>
        </div>
      </section>

      <section className="screen-section" aria-labelledby="settings-export">
        <h2 id="settings-export" className="screen-section-title">
          Export vers le plugin
        </h2>
        <div className="card setting-list">
          <SettingRow title="Ressources d’enderium-core" text={
              <>
                Le dossier <code>core/src/main/resources</code> du plugin.
                <PathEcho path={exportSettings.enderiumResources} />
              </>
            }
          >
            <CommitInput
              mono
              label="Ressources d’enderium-core"
              value={exportSettings.enderiumResources ?? ''}
              placeholder="Non défini"
              onCommit={(value) =>
                void save({ export: { enderiumResources: value.trim() === '' ? null : value.trim() } }, 'Dossier des ressources')
              }
            />
            {isTauri && (
              <button type="button" onClick={() => void browseResources()}>
                <Icon name="folder" />
                Parcourir…
              </button>
            )}
          </SettingRow>
          <SettingRow title="Espace de noms" text="Namespace des polices générées (minuscules, chiffres, « _ », « . », « - »).">
            <CommitInput
              mono
              label="Espace de noms"
              value={exportSettings.namespace}
              onCommit={(value) => void save({ export: { namespace: value.trim() } }, 'Espace de noms')}
            />
          </SettingRow>
          <SettingRow title="pack_format" text="Version du resource pack produit.">
            <select
              aria-label="pack_format"
              value={exportSettings.packFormat}
              onChange={(event) => void save({ export: { packFormat: Number(event.target.value) } }, 'pack_format')}
            >
              {packFormats.map((format) => (
                <option key={format.value} value={format.value}>
                  {format.label}
                </option>
              ))}
            </select>
          </SettingRow>
        </div>
      </section>

      <section className="screen-section" aria-labelledby="settings-bedrock">
        <h2 id="settings-bedrock" className="screen-section-title">
          Export pour Bedrock
        </h2>
        <div className="card setting-list">
          <SettingRow
            title="Dossier du serveur Bedrock"
            text={
              <>
                Reçoit le pack (<code>pack/</code>) et le descripteur d’exécution (<code>runtime.json</code>)&nbsp;; pour
                mc-rs, le dossier <code>menu_forge/export</code>.
                <PathEcho path={exportSettings.bedrockDirectory} />
              </>
            }
          >
            <CommitInput
              mono
              label="Dossier d’export Bedrock"
              value={exportSettings.bedrockDirectory ?? ''}
              placeholder="Non défini"
              onCommit={(value) =>
                void save({ export: { bedrockDirectory: value.trim() === '' ? null : value.trim() } }, 'Dossier d’export Bedrock')
              }
            />
            {isTauri && (
              <button type="button" onClick={() => void browseBedrock()}>
                <Icon name="folder" />
                Parcourir…
              </button>
            )}
          </SettingRow>
        </div>
      </section>

      <section className="screen-section" aria-labelledby="settings-discord">
        <h2 id="settings-discord" className="screen-section-title">
          Discord
        </h2>
        <div className="card setting-list">
          <SettingRow title="Rich Presence" text="Affiche sur ton profil Discord ce que tu fais dans le studio.">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={discord.enabled}
                onChange={(event) => void save({ discord: { enabled: event.target.checked } }, 'Rich Presence')}
              />
              Afficher mon activité
            </label>
            <span className={badge.className}>{badge.label}</span>
          </SettingRow>
          <SettingRow
            title="Identifiant d’application"
            text={
              <>
                Vide : l’application Menu Forge (<code>{MENU_FORGE_CLIENT_ID}</code>). Pour utiliser la tienne : portail
                développeur Discord, <em>Application ID</em>.
              </>
            }
          >
            <CommitInput
              mono
              label="Identifiant d’application Discord"
              value={discord.clientId ?? ''}
              placeholder={`${MENU_FORGE_CLIENT_ID} (Menu Forge)`}
              onCommit={(value) => void save({ discord: { clientId: value.trim() === '' ? null : value.trim() } }, 'Identifiant Discord')}
            />
          </SettingRow>
          <SettingRow title="Nom du document" text="Sinon, Discord affiche seulement « Édite un menu ».">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={discord.showDocument}
                onChange={(event) => void save({ discord: { showDocument: event.target.checked } }, 'Nom du document')}
              />
              Afficher le nom du document ouvert
            </label>
          </SettingRow>
        </div>
      </section>

      <Suspense fallback={<p className="muted">Chargement de la section IA…</p>}>
        <AiSettingsSection />
      </Suspense>

      <section className="screen-section" aria-labelledby="settings-advanced">
        <h2 id="settings-advanced" className="screen-section-title">
          Avancé
        </h2>
        <div className="card setting-list">
          <SettingRow title="Fichier de réglages">
            <span className="row-path grow">{app?.settingsPath ?? '…'}</span>
            {isTauri && app && (
              <IconButton
                icon="open"
                label="Afficher dans l’explorateur"
                size={24}
                onClick={() => void revealInExplorer(app.settingsPath)}
              />
            )}
          </SettingRow>
          {app?.settingsReadOnly && (
            <SettingRow title="Enregistrement impossible">
              <span className="muted" role="alert">
                Fichier illisible, laissé intact : les changements valent pour cette session et seront perdus à la fermeture.
              </span>
            </SettingRow>
          )}
          {app && app.overrides.length > 0 && (
            <SettingRow title="Imposés pour la session">
              <span className="muted">
                {app.overrides.map((key) => (key === 'activeWorkspace' ? 'espace de travail' : 'bibliothèques')).join(', ')} (ligne de
                commande), non enregistrés.
              </span>
            </SettingRow>
          )}
          <SettingRow title="Caches d’index" text="Relit tous les packs branchés en ignorant les caches.">
            <button type="button" disabled={busy || settings.libraries.length === 0} onClick={() => void reindexAll()}>
              <Icon name={busy ? 'loader' : 'reload'} />
              Réindexer toutes les bibliothèques
            </button>
          </SettingRow>
        </div>
      </section>
    </ScreenFrame>
  );
}
