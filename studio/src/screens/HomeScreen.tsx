import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { textureUrl } from '../lib/api';
import type { WorkspaceSnapshot } from '../lib/api';
import type { RecentDocument, WorkspaceSummary } from '../lib/appApi';
import { textRect } from '../canvas/menuRects';
import { NBSP, formatDate, formatRelative, plural } from '../lib/format';
import { usePreviewFont } from '../lib/previewFont';
import { WINDOW_WIDTH, windowHeight } from '../model/geometry';
import type { MenuDefinition } from '../model/menu';
import { DEFAULT_PREVIEW, buildPreviewContext, interpolate } from '../model/preview';
import { resolveMenu } from '../model/resolve';
import { Notice, ScreenFrame } from '../shell/ScreenFrame';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { ShortcutKeys } from '../ui/Keys';
import { Tooltip } from '../ui/Tooltip';
import { useContextMenu } from '../ui/menuContext';
import type { MenuEntry } from '../ui/menuContext';

export type QuickAction = 'new-menu' | 'generate-menu' | 'new-asset' | 'new-pixel' | 'import-font' | 'open-workspace';
/** Gestion d’un document récent depuis l’accueil. */
export type DocumentAction = 'rename' | 'duplicate' | 'trash';

const QUICK_ACTIONS: ReadonlyArray<{ kind: QuickAction; icon: IconName; title: string; text: string; shortcut?: string }> = [
  { kind: 'new-menu', icon: 'chest', title: 'Nouveau menu', text: 'Vierge ou à partir d’un gabarit : coffre, modale, liste paginée…' },
  {
    kind: 'generate-menu',
    icon: 'sparkles',
    title: 'Générer une interface',
    text: `Boutique, grille, modale, liste ou onglets${NBSP}: un menu complet, en style Deepslate, mc-rs ou sombre à accent.`,
  },
  { kind: 'new-asset', icon: 'image', title: 'Nouvel asset', text: 'Composition libre (boîtes, images, texte) exportée en PNG et en glyphe.' },
  {
    kind: 'new-pixel',
    icon: 'pencil',
    title: 'Nouvelle image',
    text: `Dessin au pixel près${NBSP}: calques, symétrie, sélection, exportée en PNG.`,
  },
  { kind: 'import-font', icon: 'library', title: 'Importer un écran', text: 'Un menu entier, reconstruit depuis une police d’un pack branché.' },
  { kind: 'open-workspace', icon: 'folder', title: 'Ouvrir un espace', text: 'Changer de dossier de travail ou en ajouter un.', shortcut: 'Ctrl+O' },
];

/** Nombre de documents récents affichés. */
const RECENT_LIMIT = 12;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(url));
    image.src = url;
  });
}

/** Vignette d’un menu : ses couches et ses textes toujours visibles (héritage compris), à l’échelle 1. */
function MenuThumbnail({ menu, menus, version }: { menu: MenuDefinition; menus: MenuDefinition[]; version: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewFont = usePreviewFont();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const byId = new Map(menus.map((candidate) => [candidate.id, candidate]));
    const resolved = resolveMenu(menu, (id) => byId.get(id)).menu;
    const layers = resolved.layers.filter((layer) => !layer.visibleWhen);
    const texts = (resolved.texts ?? []).filter((text) => !text.visibleWhen);
    const preview = buildPreviewContext(resolved, DEFAULT_PREVIEW);
    const font = previewFont?.font ?? null;
    let cancelled = false;
    void Promise.all(layers.map((layer) => loadImage(textureUrl(layer.texture, version)).catch(() => null))).then((images) => {
      const context = canvas.getContext('2d');
      if (cancelled || !context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;
      images.forEach((image, index) => {
        if (image) context.drawImage(image, layers[index].x, layers[index].y);
      });
      for (const text of texts) {
        const rect = textRect(text, preview);
        font?.draw(context, interpolate(text.value, preview.variables), rect.x, rect.y, { color: text.color ?? '#404040' });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [menu, menus, version, previewFont]);
  return <canvas ref={canvasRef} width={WINDOW_WIDTH} height={windowHeight(menu.container.rows)} aria-hidden="true" />;
}

/** Vignette d’une image de pixels : agrandie d’un nombre entier de fois (une icône de 16 px reste lisible et nette). */
function PixelThumbnail({ src }: { src: string }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const scale = size ? Math.max(1, Math.floor(Math.min(160 / size.width, 112 / size.height))) : 1;
  return (
    <img
      src={src}
      alt=""
      style={size ? { width: size.width * scale, height: size.height * scale } : undefined}
      onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
    />
  );
}

function DocumentThumbnail({ document, snapshot }: { document: RecentDocument; snapshot: WorkspaceSnapshot | null }) {
  const version = Date.parse(document.modified) || 0;
  if (document.type === 'pixel') {
    if (document.texture && snapshot?.textures.includes(document.texture)) return <PixelThumbnail src={textureUrl(document.texture, version)} />;
    return <Icon name="pencil" size={36} />;
  }
  if (document.type === 'asset') {
    const png = `assets/${document.id}.png`;
    if (snapshot?.textures.includes(png)) return <img src={textureUrl(png, version)} alt="" />;
    return <Icon name="image" size={36} />;
  }
  const menu = snapshot?.menus.find((candidate) => candidate.id === document.id);
  if (!menu) return <Icon name="chest" size={36} />;
  return <MenuThumbnail menu={menu} menus={snapshot?.menus ?? []} version={version} />;
}

interface HomeScreenProps {
  pill: ReactNode;
  workspace: WorkspaceSummary | null;
  /** `null` pendant le chargement. */
  recent: RecentDocument[] | null;
  snapshot: WorkspaceSnapshot | null;
  workspaces: WorkspaceSummary[];
  onQuickAction: (action: QuickAction) => void;
  onOpenDocument: (document: RecentDocument) => void;
  /** Renommer, dupliquer ou mettre à la corbeille un document récent (une erreur s’affiche sous la liste). */
  onDocumentAction: (document: RecentDocument, action: DocumentAction) => Promise<void>;
  onSwitchWorkspace: (path: string) => Promise<void>;
}

/** Accueil : actions rapides, documents récents de l’espace actif, espaces récents. */
export function HomeScreen({
  pill,
  workspace,
  recent,
  snapshot,
  workspaces,
  onQuickAction,
  onOpenDocument,
  onDocumentAction,
  onSwitchWorkspace,
}: HomeScreenProps) {
  const [notice, setNotice] = useState<{ kind: 'error'; text: string } | null>(null);
  const [documentNotice, setDocumentNotice] = useState<{ kind: 'error'; text: string } | null>(null);
  const openContextMenu = useContextMenu();

  const act = (document: RecentDocument, action: DocumentAction) => {
    setDocumentNotice(null);
    void onDocumentAction(document, action).catch((error: unknown) =>
      setDocumentNotice({ kind: 'error', text: `Action impossible sur « ${document.name} »${NBSP}: ${errorMessage(error)}` }),
    );
  };

  /** Actions d’un document récent (clic droit sur sa carte, ou bouton « … »). */
  const documentMenu = (document: RecentDocument): MenuEntry[] => [
    { heading: `${document.type === 'menu' ? 'Menu' : document.type === 'asset' ? 'Asset' : 'Image'} « ${document.name} »` },
    { label: 'Ouvrir', icon: 'open', onSelect: () => onOpenDocument(document) },
    { label: 'Renommer…', icon: 'pencil', onSelect: () => act(document, 'rename') },
    { label: 'Dupliquer', icon: 'copy', onSelect: () => act(document, 'duplicate') },
    { separator: true },
    { label: 'Mettre à la corbeille', icon: 'trash', danger: true, onSelect: () => act(document, 'trash') },
  ];
  const others = workspaces.filter((candidate) => !candidate.active).slice(0, 5);
  const documents = (recent ?? []).slice(0, RECENT_LIMIT);

  const switchTo = async (path: string) => {
    try {
      setNotice(null);
      await onSwitchWorkspace(path);
    } catch (error) {
      setNotice({ kind: 'error', text: `Impossible d’ouvrir cet espace${NBSP}: ${errorMessage(error)}` });
    }
  };

  return (
    <ScreenFrame title="Accueil" icon="home" pill={pill}>
      <div className="home-hero">
        <img src="/brand/logo.svg" alt="" width={64} height={64} />
        <div>
          <p className="home-title">Menu Forge</p>
          <p className="muted">
            Studio d’inventaires Minecraft à base de glyphes · espace <strong>{workspace?.name ?? '…'}</strong>
          </p>
        </div>
      </div>

      <section className="screen-section" aria-labelledby="home-actions">
        <h2 id="home-actions" className="screen-section-title">
          Actions rapides
        </h2>
        <div className="quick-actions">
          {QUICK_ACTIONS.map((action) => (
            <button key={action.kind} type="button" className="quick-action" onClick={() => onQuickAction(action.kind)}>
              <span className="quick-action-icon">
                <Icon name={action.icon} size={24} />
              </span>
              <strong>{action.title}</strong>
              <span className="quick-action-text">{action.text}</span>
              {action.shortcut && <ShortcutKeys shortcut={action.shortcut} />}
            </button>
          ))}
        </div>
      </section>

      <section className="screen-section" aria-labelledby="home-recent">
        <div className="screen-section-head">
          <h2 id="home-recent" className="screen-section-title">
            Documents récents
          </h2>
          {recent && recent.length > 0 && <span className="count">{plural(recent.length, 'document')}</span>}
        </div>
        {recent === null ? (
          <p className="muted">Chargement…</p>
        ) : documents.length === 0 ? (
          <div className="empty-state">
            <Icon name="chest" size={48} />
            <h2>Aucun document</h2>
            <p className="muted">Commence par un gabarit : un coffre, une modale ou une liste paginée prêts à modifier.</p>
            <button type="button" className="primary" onClick={() => onQuickAction('new-menu')}>
              <Icon name="plus" />
              Nouveau menu
            </button>
          </div>
        ) : (
          <div className="doc-grid">
            {documents.map((document) => (
              <div key={`${document.type}-${document.id}`} className="doc-card-wrap">
              <button
                type="button"
                className="doc-card"
                onClick={() => onOpenDocument(document)}
                onContextMenu={(event) => openContextMenu(event, documentMenu(document))}
              >
                <span className="doc-thumb">
                  <DocumentThumbnail document={document} snapshot={snapshot} />
                </span>
                <span className="doc-meta">
                  <span className="doc-name">{document.name}</span>
                  <span className="doc-sub">
                    <span className={`kind-dot doc-kind-${document.type}`} aria-hidden="true" />
                    {document.type === 'menu' ? 'Menu' : document.type === 'asset' ? 'Asset' : 'Image'} ·{' '}
                    <span className="mono">{document.id}</span>
                  </span>
                  <span className="doc-sub" title={formatDate(document.modified)}>
                    <Icon name="clock" />
                    {formatRelative(document.modified)}
                  </span>
                </span>
              </button>
              <Tooltip label="Actions du document" hint="Renommer, dupliquer, mettre à la corbeille">
                <button
                  type="button"
                  className="doc-card-more icon-only icon-sm"
                  aria-label={`Actions de « ${document.name} »`}
                  onClick={(event) => openContextMenu(event, documentMenu(document))}
                >
                  <Icon name="more" />
                </button>
              </Tooltip>
              </div>
            ))}
          </div>
        )}
        <Notice notice={documentNotice} />
      </section>

      {others.length > 0 && (
        <section className="screen-section" aria-labelledby="home-workspaces">
          <h2 id="home-workspaces" className="screen-section-title">
            Espaces récents
          </h2>
          <Notice notice={notice} />
          <div className="row-list">
            {others.map((candidate) => (
              <button
                key={candidate.path}
                type="button"
                className={candidate.exists ? 'row-card' : 'row-card is-missing'}
                disabled={!candidate.exists}
                onClick={() => void switchTo(candidate.path)}
              >
                <span className="row-icon">
                  <Icon name="folder" size={24} />
                </span>
                <span className="row-main">
                  <span className="row-title">
                    <span className="row-title-text">{candidate.name}</span>
                    {!candidate.exists && <span className="badge badge-missing">dossier introuvable</span>}
                  </span>
                  <span className="row-path">{candidate.path}</span>
                </span>
                <span className="row-meta">
                  {plural(candidate.menus, 'menu')} · {plural(candidate.assets, 'asset')} · {formatRelative(candidate.lastOpened)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </ScreenFrame>
  );
}
