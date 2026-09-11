import { Fragment } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { parseLegacyText, stripLegacy } from '../lib/legacyText';
import { BANNER_FLAG, SPECIAL_FLAG, SUBTITLE_SEPARATOR, TITLE_CUT, hasFlag, leading, motdBannerHeight, splitAtCut, storeCategoryCount, without } from '../model/bedrockForm';
import type { FormIcon, FormLayout } from '../model/menu';

/**
 * Aperçu d’un formulaire Bedrock dans sa disposition `mcrs_ui` : géométrie
 * reprise des fichiers `ui/mcrs/server_form/*.json` du pack (tailles,
 * décalages, grilles, liaisons qui découpent le texte des boutons), allure
 * reproduite en CSS (les textures du pack ne sont pas copiées). Unité : le
 * pixel d’interface de Bedrock, agrandi par `zoom`.
 */

/** Bouton envoyé : texte réel (préfixes, tabulation, variables interpolées) et icône. */
export interface PreviewEntry {
  id: string;
  text: string;
  icon?: FormIcon;
}

export interface PreviewScreen {
  width: number;
  height: number;
}

export interface FormPreviewProps {
  layout: FormLayout;
  /** Titre envoyé (`#title_text`), drapeau compris. */
  title: string;
  content: string;
  entries: PreviewEntry[];
  screen: PreviewScreen;
  zoom: number;
  selectedId: string | null;
  onPress: (id: string) => void;
  /** Adresse affichable d’une icône ; `null` : texture Bedrock absente du studio (vignette de remplacement). */
  resolveIcon: (icon: FormIcon) => string | null;
}

/** Tailles des polices à l’échelle 1 (police par défaut, MinecraftTen). */
const FONT = 8;
const TEN = 10;
const LIGHT_BLUE = '#5cc0ff';
const GOLD_TEXT = '#ffdb00';

interface RenderContext {
  selectedId: string | null;
  onPress: (id: string) => void;
  resolveIcon: (icon: FormIcon) => string | null;
}

interface LayoutProps {
  title: string;
  content: string;
  entries: PreviewEntry[];
  screen: PreviewScreen;
  ctx: RenderContext;
}

const isBanner = (entry: PreviewEntry) => hasFlag(entry.text, BANNER_FLAG);

/** Texte à codes `§` : les couleurs d’un segment l’emportent sur la couleur du contrôle, comme en jeu. */
function LegacyText({
  text,
  color = '#ffffff',
  size = FONT,
  ten = false,
  shadow = false,
  className = '',
  style,
}: {
  text: string;
  color?: string;
  size?: number;
  ten?: boolean;
  shadow?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const classes = ['bf-text', ten ? 'bf-ten' : '', shadow ? 'bf-shadow' : '', className].filter(Boolean).join(' ');
  return (
    <span className={classes} style={{ color, fontSize: size, lineHeight: `${Math.round(size * 1.25)}px`, ...style }}>
      {parseLegacyText(text.replaceAll(SUBTITLE_SEPARATOR, ' ')).map((segment, index) => (
        <span
          key={index}
          style={{ color: segment.color ?? undefined, fontWeight: segment.bold ? 700 : undefined, fontStyle: segment.italic ? 'italic' : undefined }}
        >
          {segment.text.split('\n').map((line, lineIndex) => (
            <Fragment key={lineIndex}>
              {lineIndex > 0 && <br />}
              {line}
            </Fragment>
          ))}
        </span>
      ))}
    </span>
  );
}

/** Image d’un bouton ; une texture Bedrock que le studio n’a pas s’affiche en vignette nommée. */
function FormImage({ icon, ctx, fit, style }: { icon?: FormIcon; ctx: RenderContext; fit: 'contain' | 'fill'; style?: CSSProperties }) {
  if (!icon) return null;
  const src = ctx.resolveIcon(icon);
  if (src) {
    return (
      <img
        className="bf-image"
        src={src}
        alt=""
        draggable={false}
        style={{ objectFit: fit, ...style }}
        onError={(event) => event.currentTarget.classList.add('is-broken')}
      />
    );
  }
  const path = 'path' in icon ? icon.path : '';
  return (
    <span className="bf-image-placeholder" style={style} title={path}>
      <span>{path.split('/').pop()}</span>
    </span>
  );
}

function CloseButton({ style }: { style?: CSSProperties }) {
  return (
    <span className="bf-close" style={style} aria-hidden="true">
      ×
    </span>
  );
}

/** Bouton cliquable de l’aperçu (sélection en édition, clic simulé en essai). */
function press(ctx: RenderContext, entry: PreviewEntry, className: string, style: CSSProperties | undefined, children: ReactNode) {
  return (
    <div
      key={entry.id}
      role="button"
      tabIndex={0}
      title={entry.id}
      className={`bf-press ${className}`}
      data-selected={entry.id === ctx.selectedId || undefined}
      style={style}
      onClick={(event) => {
        event.stopPropagation();
        ctx.onPress(entry.id);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        ctx.onPress(entry.id);
      }}
    >
      {children}
    </div>
  );
}

/** Cadre des dispositions « modales » : 400 px de large, titre, liseré doré, panneau sombre. */
function ModalFrame({ screen, title, children }: { screen: PreviewScreen; title: string; children: ReactNode }) {
  const width = Math.min(400, screen.width);
  return (
    <div className="bf-modal" style={{ left: (screen.width - width) / 2, top: 20, width }}>
      <div className="bf-title-row" style={{ height: 21 }}>
        <LegacyText text={title} ten size={TEN * 2} className="bf-title bf-nowrap" />
        <LegacyText text={title} ten size={TEN * 2} color="#000000" className="bf-title bf-title-shadow bf-nowrap" />
        <CloseButton />
      </div>
      <div style={{ height: 5 }} />
      <div className="bf-gold-bar" />
      <div className="bf-panel-dark" style={{ height: Math.max(0, screen.height - 70) }}>
        {children}
      </div>
    </div>
  );
}

function Description({ content }: { content: string }) {
  if (content === '') return null;
  return (
    <div className="bf-description">
      <LegacyText text={content} color={LIGHT_BLUE} shadow style={{ lineHeight: '12px' }} />
    </div>
  );
}

function GridLayout({ screen, title, content, entries, ctx }: LayoutProps) {
  const inner = Math.min(375, Math.min(400, screen.width) - 25);
  const columns = Math.max(1, Math.floor(inner / 125));
  return (
    <ModalFrame screen={screen} title={title}>
      <div className="bf-scroll">
        <div className="bf-grid-wrapper" style={{ width: inner }}>
          <Description content={content} />
          <div className="bf-cells" style={{ gridTemplateColumns: `repeat(${columns}, 125px)` }}>
            {entries.map((entry) => {
              const { head, rest } = splitAtCut(entry.text);
              return (
                <div key={entry.id} className="bf-cell" style={{ width: 125, height: 100 }}>
                  {press(
                    ctx,
                    entry,
                    'bf-grid-button',
                    { position: 'absolute', left: 2.5, top: 2.5, width: 120, height: 95 },
                    <>
                      <span className="bf-fill bf-rounded" style={{ background: 'rgba(0, 0, 0, 0.5)' }} />
                      <span className="bf-hover-purple" />
                      <span className="bf-grid-stack">
                        {entry.icon ? (
                          <FormImage icon={entry.icon} ctx={ctx} fit="contain" style={{ width: '100%', height: 58, flex: 'none' }} />
                        ) : (
                          <span style={{ height: 28.8, flex: 'none' }} />
                        )}
                        <span className="bf-grid-labels">
                          <LegacyText text={head} ten size={TEN * 1.25} className="bf-grid-title" />
                          {rest !== '' && <LegacyText text={rest} color={GOLD_TEXT} className="bf-grid-subtitle" />}
                        </span>
                      </span>
                    </>,
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <span className="bf-fake-scroll" />
    </ModalFrame>
  );
}

function ImageGridLayout({ screen, title, content, entries, ctx }: LayoutProps) {
  const inner = Math.min(375, Math.min(400, screen.width) - 25);
  const columns = Math.max(1, Math.floor(inner / 125));
  return (
    <ModalFrame screen={screen} title={title}>
      <div className="bf-scroll">
        <div className="bf-grid-wrapper" style={{ width: inner }}>
          <Description content={content} />
          <div className="bf-cells" style={{ gridTemplateColumns: `repeat(${columns}, 125px)` }}>
            {entries.map((entry) => {
              const { head, rest } = splitAtCut(entry.text);
              return (
                <div key={entry.id} className="bf-cell" style={{ width: 125, height: 107.5 }}>
                  {press(
                    ctx,
                    entry,
                    'bf-image-button',
                    { position: 'absolute', left: 2.5, top: 2.5, width: 120, height: 105 },
                    <>
                      <span className="bf-image-frame">
                        <FormImage icon={entry.icon} ctx={ctx} fit="fill" style={{ position: 'absolute', left: 4, top: 4, width: 112, height: 92 }} />
                        {rest !== '' && (
                          <span className="bf-image-tag">
                            <LegacyText text={rest} ten size={TEN * 0.75} color="#f2f500" className="bf-nowrap" />
                          </span>
                        )}
                        <span className="bf-image-shade">
                          <LegacyText text={head} ten size={TEN * 1.2} className="bf-image-title" />
                        </span>
                      </span>
                    </>,
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <span className="bf-fake-scroll" />
    </ModalFrame>
  );
}

/** Boutons en liste (normal ou spécial) des dispositions `left_button` et `bottom_button`. */
function ListButtons({ entries, ctx }: { entries: PreviewEntry[]; ctx: RenderContext }) {
  return (
    <div className="bf-list">
      {entries
        .filter((entry) => !isBanner(entry))
        .map((entry) =>
          press(
            ctx,
            entry,
            hasFlag(entry.text, SPECIAL_FLAG) ? 'bf-list-button is-special' : 'bf-list-button',
            undefined,
            <LegacyText text={entry.text} shadow className="bf-list-label" />,
          ),
        )}
    </div>
  );
}

/** Vignette d’une bannière : image encadrée, étiquette dorée à cheval sur le bord haut. */
function BannerTile({ entry, ctx, style }: { entry: PreviewEntry; ctx: RenderContext; style: CSSProperties }) {
  return press(
    ctx,
    entry,
    'bf-banner',
    style,
    <>
      <span className="bf-banner-box">
        <FormImage icon={entry.icon} ctx={ctx} fit="fill" style={{ position: 'absolute', left: 2, top: 2, width: 'calc(100% - 4px)', height: 'calc(100% - 4px)' }} />
      </span>
      <span className="bf-featured">
        <LegacyText text={entry.text} ten color={GOLD_TEXT} className="bf-nowrap" />
      </span>
    </>,
  );
}

function ContentPanel({ content, padding }: { content: string; padding: string }) {
  return (
    <div className="bf-scroll" style={{ padding }}>
      <LegacyText text={content} color={LIGHT_BLUE} shadow />
    </div>
  );
}

function LeftButtonLayout({ screen, title, content, entries, ctx }: LayoutProps) {
  return (
    <ModalFrame screen={screen} title={title}>
      <div className="bf-split">
        <div className="bf-list-panel" style={{ width: '60%' }}>
          <div className="bf-scroll" style={{ padding: '5px 3px 10px 5px' }}>
            <ListButtons entries={entries} ctx={ctx} />
          </div>
        </div>
        <div style={{ width: 10, flex: 'none' }} />
        <div className="bf-column" style={{ flex: 1, minWidth: 0 }}>
          <div className="bf-rounded-panel" style={{ flex: 1, minHeight: 0 }}>
            <ContentPanel content={content} padding="10px 2px 20px 10px" />
          </div>
          {entries.filter(isBanner).map((entry) => (
            <div key={entry.id} style={{ height: 90, flex: 'none', position: 'relative' }}>
              <BannerTile entry={entry} ctx={ctx} style={{ position: 'absolute', left: 0, right: 0, top: 5, bottom: 5 }} />
            </div>
          ))}
        </div>
      </div>
    </ModalFrame>
  );
}

function BottomButtonLayout({ screen, title, content, entries, ctx }: LayoutProps) {
  const top = Math.round((Math.min(400, screen.width) - 20) * 0.2);
  return (
    <ModalFrame screen={screen} title={title}>
      <div className="bf-split is-vertical">
        <div style={{ height: 5, flex: 'none' }} />
        <div style={{ height: top, flex: 'none', display: 'flex' }}>
          <div className="bf-column" style={{ width: top, flex: 'none' }}>
            {entries.filter(isBanner).map((entry) => (
              <div key={entry.id} style={{ height: top, flex: 'none', position: 'relative' }}>
                <BannerTile entry={entry} ctx={ctx} style={{ position: 'absolute', inset: 0 }} />
              </div>
            ))}
          </div>
          <div style={{ width: 10, flex: 'none' }} />
          <div className="bf-rounded-panel" style={{ flex: 1, minWidth: 0 }}>
            <ContentPanel content={content} padding="10px 2px 10px 10px" />
          </div>
        </div>
        <div style={{ height: 10, flex: 'none' }} />
        <div className="bf-list-panel" style={{ flex: 1, minHeight: 0 }}>
          <div className="bf-scroll" style={{ padding: '5px 3px 10px 5px' }}>
            <ListButtons entries={entries} ctx={ctx} />
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}

function SquareImageLayout({ screen, title, content, entries, ctx }: LayoutProps) {
  const side = Math.max(0, screen.height - 30);
  return (
    <>
      <span className="bf-veil" />
      <div className="bf-layer" style={{ left: 10, top: 0, width: screen.width - 20, height: screen.height - 10 }}>
        {/* Titre au-dessus de l’image carrée (couche 53 du pack, l’image en couche 2). */}
        <div className="bf-layer" style={{ left: 0, top: 0, width: '100%', height: 20, zIndex: 5 }}>
          <LegacyText text={title} ten size={TEN * 1.5} className="bf-centered-title bf-nowrap" style={{ top: 5 }} />
          <CloseButton />
        </div>
        <div className="bf-square-stack">
          {entries.filter(isBanner).map((entry) =>
            press(ctx, entry, 'bf-square', { width: side, height: side }, <FormImage icon={entry.icon} ctx={ctx} fit="contain" style={{ position: 'absolute', inset: 2 }} />),
          )}
        </div>
        <div className="bf-rounded-panel bf-square-description">
          <LegacyText text={content} color={LIGHT_BLUE} shadow />
        </div>
      </div>
    </>
  );
}

function MotdLayout({ screen, title, content, entries, ctx }: LayoutProps) {
  return (
    <>
      <span className="bf-veil" />
      <div className="bf-layer bf-motd" style={{ left: (screen.width - 200) / 2, top: 0, width: 200, height: screen.height }}>
        <div style={{ height: 20, flex: 'none', position: 'relative' }}>
          <LegacyText text={title} ten size={TEN * 1.5} className="bf-motd-title bf-nowrap" />
          <CloseButton />
        </div>
        <div style={{ height: 4, flex: 'none' }} />
        {entries.filter(isBanner).map((entry) =>
          press(
            ctx,
            entry,
            'bf-motd-banner',
            { height: motdBannerHeight(entry.text), flex: 'none' },
            <FormImage icon={entry.icon} ctx={ctx} fit="contain" style={{ position: 'absolute', inset: 2 }} />,
          ),
        )}
        <div style={{ height: 2, flex: 'none' }} />
        <div className="bf-rounded-panel" style={{ height: 60, flex: 'none' }}>
          <ContentPanel content={content} padding="5px 5px 10px" />
        </div>
        <div style={{ height: 2, flex: 'none' }} />
        <div style={{ display: 'flex', justifyContent: 'center', flex: 'none' }}>
          <div className="bf-rounded-panel bf-button-row">
            {entries
              .filter((entry) => !isBanner(entry))
              .map((entry) => press(ctx, entry, 'bf-green-button', undefined, <LegacyText text={entry.text} ten className="bf-nowrap bf-green-label" />))}
          </div>
        </div>
      </div>
    </>
  );
}

function StoreLayout({ screen, title, content, entries, ctx }: LayoutProps) {
  const categories = entries.filter(isBanner);
  // La grille affiche les premières entrées : autant que d’entrées moins le nombre d’onglets lu dans le contenu.
  const products = entries.slice(0, Math.max(0, entries.length - storeCategoryCount(content)));
  const width = screen.width - 25;
  const columns = Math.max(1, Math.floor(width / 150));
  return (
    <>
      <span className="bf-store-bg" />
      <div className="bf-layer bf-store" style={{ left: 0, top: 5, width: '100%', height: screen.height - 5 }}>
        <div style={{ height: 24, flex: 'none', position: 'relative' }}>
          <LegacyText text={stripLegacy(title)} ten size={TEN * 1.2} color="#000000" className="bf-store-title is-shadow bf-nowrap" />
          <LegacyText text={title} ten size={TEN * 1.2} color="#ffd200" className="bf-store-title bf-nowrap" />
          <CloseButton style={{ right: 5, top: 0 }} />
        </div>
        {categories.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', flex: 'none' }}>
            <div className="bf-store-tabs">
              {categories.map((entry) => press(ctx, entry, 'bf-green-button is-tab', undefined, <LegacyText text={entry.text} ten className="bf-nowrap bf-green-label" />))}
            </div>
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <div className="bf-scroll" style={{ position: 'absolute', left: 0, right: 0, top: 10, bottom: 20, height: 'auto' }}>
            <div className="bf-products" style={{ width, gridTemplateColumns: `repeat(${columns}, 150px)` }}>
              {products.map((entry) => {
                const head = splitAtCut(entry.text).head;
                const afterTitle = [...entry.text].slice(TITLE_CUT).join('');
                const price = without(leading(afterTitle, TITLE_CUT), SUBTITLE_SEPARATOR);
                const tag = [...entry.text].slice(TITLE_CUT * 2).join('');
                return (
                  <div key={entry.id} style={{ width: 150, height: 120, position: 'relative' }}>
                    {press(
                      ctx,
                      entry,
                      'bf-product',
                      { position: 'absolute', left: 4, top: 0, width: 140, height: 110 },
                      <>
                        <span className="bf-fill bf-rounded" style={{ background: 'rgba(0, 0, 0, 0.7)' }} />
                        <FormImage icon={entry.icon} ctx={ctx} fit="fill" style={{ position: 'absolute', left: 2, top: 2, width: 136, height: 76 }} />
                        <LegacyText text={head} className="bf-product-name bf-nowrap" color="#ffcc00" />
                        <LegacyText text={price} size={FONT * 0.8} color="#c6c6c6" className="bf-product-price bf-nowrap" />
                        {tag !== '' && (
                          <span className="bf-product-tag">
                            <LegacyText text={tag} ten className="bf-nowrap" />
                          </span>
                        )}
                        <span className="bf-product-border" />
                      </>,
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <span className="bf-fake-scroll" style={{ right: 15, top: 10, height: '80%', bottom: 'auto' }} />
        </div>
      </div>
    </>
  );
}

function WrappedLayout({ screen, title, content, entries, ctx }: LayoutProps) {
  const width = Math.min(screen.width - 30, 500);
  const buttons = entries.filter((entry) => !isBanner(entry));
  return (
    <>
      <span className="bf-veil" />
      <div className="bf-layer bf-column" style={{ left: (screen.width - width) / 2, top: 0, width, height: screen.height - 40 }}>
        <div style={{ height: 25, flex: 'none', position: 'relative' }}>
          <LegacyText text={title} ten size={TEN * 1.5} color="#000000" className="bf-centered-title bf-nowrap" style={{ top: 6, marginLeft: 1, opacity: 0.4 }} />
          <LegacyText text={title} ten size={TEN * 1.5} className="bf-centered-title bf-nowrap" style={{ top: 5 }} />
          <CloseButton />
        </div>
        <div style={{ height: 5, flex: 'none' }} />
        {content !== '' && (
          <div className="bf-rounded-panel bf-wrapped-link">
            <LegacyText text={content} color={LIGHT_BLUE} size={FONT * 0.9} shadow />
          </div>
        )}
        <div className="bf-scroll" style={{ flex: 1, minHeight: 0, height: 'auto' }}>
          {entries.filter(isBanner).map((entry) =>
            press(
              ctx,
              entry,
              'bf-wrapped-image',
              { height: width * 1.42 },
              entry.icon ? (
                <FormImage icon={entry.icon} ctx={ctx} fit="contain" style={{ position: 'absolute', inset: 2 }} />
              ) : (
                <span className="bf-loading">Loading...</span>
              ),
            ),
          )}
        </div>
        <div style={{ height: 5, flex: 'none' }} />
        <div style={{ height: 40, flex: 'none', position: 'relative' }}>
          {buttons.map((entry, index) =>
            press(
              ctx,
              entry,
              'bf-list-button is-special bf-wrapped-button',
              { position: 'absolute', left: '25%', width: '50%', top: index * 40, height: 40 },
              <LegacyText text={entry.text} shadow className="bf-list-label" />,
            ),
          )}
        </div>
      </div>
    </>
  );
}

const LAYOUTS: Record<FormLayout, (props: LayoutProps) => ReactNode> = {
  grid: GridLayout,
  image_grid: ImageGridLayout,
  square_image: SquareImageLayout,
  store: StoreLayout,
  left_button: LeftButtonLayout,
  bottom_button: BottomButtonLayout,
  motd: MotdLayout,
  wrapped: WrappedLayout,
};

/** Écran Bedrock simulé : la disposition choisie par le drapeau du titre, dessinée au pixel d’interface. */
export function FormPreview({ layout, title, content, entries, screen, zoom, selectedId, onPress, resolveIcon }: FormPreviewProps) {
  const Layout = LAYOUTS[layout];
  return (
    <div className="bf-screen" style={{ width: screen.width, height: screen.height, zoom }}>
      <Layout title={title} content={content} entries={entries} screen={screen} ctx={{ selectedId, onPress, resolveIcon }} />
    </div>
  );
}
