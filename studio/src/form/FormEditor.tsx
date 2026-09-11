import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { isEditableTarget } from '../canvas/viewport';
import { Field, FieldError } from '../components/fields';
import { PreviewPanel } from '../components/PreviewPanel';
import { ActionListEditor } from '../components/visual/ActionListEditor';
import { ConditionEditor } from '../components/visual/ConditionEditor';
import { moveItem, useDragReorder } from '../components/visual/reorder';
import { StateEditor } from '../components/visual/StateEditor';
import { TryJournal, TrySessionPanel } from '../components/visual/TryPanel';
import { textureUrl } from '../lib/api';
import { plural } from '../lib/format';
import { stripLegacy } from '../lib/legacyText';
import type { ActionContext } from '../model/actions';
import { FORM_LAYOUTS, formButtonText, formLayout, formWireTitle, isFormLayout, visibleFormButtons } from '../model/bedrockForm';
import { uniqueId } from '../model/menu';
import type { BedrockForm, FormButton, FormButtonRole, FormIcon, MenuDefinition } from '../model/menu';
import { DEFAULT_PREVIEW, buildPreviewContext, interpolate } from '../model/preview';
import type { PreviewValues } from '../model/preview';
import { clearLog, clickFormButton, goBack, reopen, setFrameValues, startSession } from '../model/simulate';
import type { TrySession } from '../model/simulate';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { useContextMenu } from '../ui/menuContext';
import type { MenuEntry } from '../ui/menuContext';
import { overlayOpen } from '../ui/overlay';
import { FormPreview } from './FormPreview';
import type { PreviewEntry, PreviewScreen } from './FormPreview';
import { IconPicker } from './IconPicker';
import './form.css';

type Recipe = (draft: MenuDefinition) => void;

export interface FormEditorProps {
  /** Formulaire édité (`menu.form` présent). */
  menu: MenuDefinition;
  /** Écran de l’éditeur affiché : sinon, aucun raccourci. */
  active: boolean;
  /** `record: false` : changement continu (saisie), précédé d’un `onCheckpoint`. */
  onChange: (recipe: Recipe, record?: boolean) => void;
  onCheckpoint: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  textures: readonly string[];
  textureVersions: Record<string, number>;
  actionContext: ActionContext;
  flags: readonly string[];
  errors: string[];
  /** Menus résolus de l’espace (mode « Essayer » : `open` vers un autre menu). */
  lookup: (id: string) => MenuDefinition | undefined;
  onOpenMenu: (id: string) => void;
  onDrawIcon: (buttonId: string) => void;
  onImportIcon: (file: File) => Promise<string>;
  /** Bibliothèque des packs branchés, réglée pour choisir une icône. */
  librarySlot: ReactNode;
  /** Texture choisie dans la bibliothèque : devient l’icône du bouton sélectionné. */
  iconRequest: { texture: string; nonce: number } | null;
}

const SCREENS: ReadonlyArray<{ id: string; label: string; screen: PreviewScreen }> = [
  { id: 'pc', label: 'PC · 480 × 270', screen: { width: 480, height: 270 } },
  { id: 'large', label: 'Grand écran · 640 × 360', screen: { width: 640, height: 360 } },
  { id: 'small', label: 'Petit écran · 427 × 240', screen: { width: 427, height: 240 } },
];

const ROLE_LABELS: Record<FormButtonRole | 'button', string> = { button: 'Bouton', banner: 'Bannière', special: 'Spécial' };
const BUTTON_ID = /^[A-Za-z0-9_.-]+$/u;

/** Champ texte appliqué à chaque frappe ; une seule entrée d’historique par passage dans le champ. */
function LiveText({
  label,
  value,
  hint,
  multiline = false,
  onFocus,
  onChange,
}: {
  label: string;
  value: string;
  hint?: string;
  multiline?: boolean;
  onFocus: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      {multiline ? (
        <textarea rows={3} value={value} spellCheck={false} onFocus={onFocus} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input value={value} spellCheck={false} onFocus={onFocus} onChange={(event) => onChange(event.target.value)} />
      )}
    </Field>
  );
}

/** Identifiant d’un bouton, validé à la sortie du champ. */
function ButtonIdField({ value, taken, onCommit }: { value: string; taken: readonly string[]; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value);
  const [base, setBase] = useState(value);
  const [error, setError] = useState<string | null>(null);
  if (base !== value) {
    setBase(value);
    setText(value);
    setError(null);
  }
  const commit = () => {
    if (text === value) return;
    const problem = !BUTTON_ID.test(text) ? 'Lettres, chiffres, « _ », « . » et « - » uniquement' : taken.includes(text) ? 'Un autre bouton porte cet identifiant' : null;
    setError(problem);
    if (!problem) onCommit(text);
  };
  return (
    <Field label="Identifiant">
      <input
        className="mono"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setText(value);
        }}
      />
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

/** Éditeur d’un formulaire Bedrock : disposition, boutons, aperçu fidèle au pack `mcrs_ui`, essai simulé. */
export function FormEditor(props: FormEditorProps) {
  const { menu, active, onChange, onCheckpoint, lookup, textureVersions } = props;
  const form = menu.form as BedrockForm;
  const info = formLayout(form.layout);
  const openContextMenu = useContextMenu();
  const [selectedId, setSelectedId] = useState<string | null>(() => form.buttons[0]?.id ?? null);
  const [leftTab, setLeftTab] = useState<'buttons' | 'library'>('buttons');
  const [values, setValues] = useState<PreviewValues>(DEFAULT_PREVIEW);
  const [trySession, setTrySession] = useState<TrySession | null>(null);
  const [screenId, setScreenId] = useState(SCREENS[0].id);
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null);
  const [notice, setNotice] = useState('');

  const screen = (SCREENS.find((candidate) => candidate.id === screenId) ?? SCREENS[0]).screen;
  const selected = form.buttons.find((button) => button.id === selectedId) ?? null;
  const ids = form.buttons.map((button) => button.id);

  /* Modifications */

  const updateForm = useCallback(
    (recipe: (draft: BedrockForm) => void, record = true) =>
      onChange((draft) => {
        if (draft.form) recipe(draft.form);
      }, record),
    [onChange],
  );
  const updateButton = useCallback(
    (id: string, recipe: (button: FormButton) => void, record = true) =>
      updateForm((draft) => {
        const button = draft.buttons.find((candidate) => candidate.id === id);
        if (button) recipe(button);
      }, record),
    [updateForm],
  );

  const addButton = (role?: FormButtonRole) => {
    const id = uniqueId(role === 'banner' ? 'banner' : 'button', ids);
    const index = selected ? form.buttons.indexOf(selected) + 1 : form.buttons.length;
    updateForm((draft) => {
      const button: FormButton = { id, text: role === 'banner' ? 'Bannière' : 'Bouton' };
      if (role) button.role = role;
      draft.buttons.splice(index, 0, button);
    });
    setSelectedId(id);
  };
  const duplicateButton = (id: string) => {
    const source = form.buttons.find((button) => button.id === id);
    if (!source) return;
    const copy = { ...structuredClone(source), id: uniqueId(id, ids) };
    updateForm((draft) => draft.buttons.splice(draft.buttons.findIndex((button) => button.id === id) + 1, 0, copy));
    setSelectedId(copy.id);
  };
  const removeButton = (id: string) => {
    const index = ids.indexOf(id);
    updateForm((draft) => {
      draft.buttons = draft.buttons.filter((button) => button.id !== id);
    });
    setSelectedId(ids[index + 1] ?? ids[index - 1] ?? null);
  };
  const moveButton = (from: number, to: number) => {
    if (to < 0 || to >= form.buttons.length || from === to) return;
    updateForm((draft) => {
      draft.buttons = moveItem(draft.buttons, from, to);
    });
  };
  const reorder = useDragReorder(moveButton);

  /* Aperçu et essai */

  const frame = trySession && !trySession.closed ? (trySession.stack.at(-1) ?? null) : null;
  const shownMenu = trySession ? (frame ? lookup(frame.menuId) : undefined) : menu;
  const shownValues = frame ? frame.values : values;
  const preview = useMemo(() => {
    if (!shownMenu?.form) return null;
    const context = buildPreviewContext(shownMenu, shownValues);
    const variables = context.variables;
    const entries: PreviewEntry[] = visibleFormButtons(shownMenu.form, context).map((button) => ({
      id: button.id,
      text: interpolate(formButtonText(button), variables),
      icon: button.icon,
    }));
    return {
      layout: shownMenu.form.layout,
      title: formWireTitle(shownMenu.form.layout, interpolate(shownMenu.form.title, variables)),
      content: interpolate(shownMenu.form.content ?? '', variables),
      entries,
    };
  }, [shownMenu, shownValues]);

  const resolveIcon = useCallback(
    (icon: FormIcon) => ('texture' in icon ? textureUrl(icon.texture, textureVersions[icon.texture] ?? 0) : 'url' in icon ? icon.url : null),
    [textureVersions],
  );

  const startTry = () => setTrySession(startSession(menu.id, values));
  const press = (id: string) => {
    if (trySession) setTrySession((session) => session && clickFormButton(session, lookup, id));
    else setSelectedId(id);
  };

  // Plus grand zoom (par demi-pas) où l’écran simulé tient dans la zone.
  const observeStage = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
      setStageSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const fit = stageSize ? Math.min((stageSize.width - 48) / screen.width, (stageSize.height - 48) / screen.height) : 2;
  const zoom = Math.max(1, Math.min(6, Math.floor(fit * 2) / 2));

  /* Bibliothèque : la texture choisie devient l’icône du bouton sélectionné */

  const handledIcon = useRef(props.iconRequest?.nonce ?? 0);
  useEffect(() => {
    const request = props.iconRequest;
    if (!request || request.nonce === handledIcon.current) return;
    handledIcon.current = request.nonce;
    if (!selectedId) {
      // oxlint-disable-next-line react/set-state-in-effect
      setNotice('Choisis d’abord un bouton : la texture choisie devient son icône.');
      return;
    }
    updateButton(selectedId, (button) => {
      button.icon = { texture: request.texture };
    });
    setNotice(`Icône de « ${selectedId} » : textures/${request.texture}`);
  }, [props.iconRequest, selectedId, updateButton]);

  /* Clavier : E essaie, Échap revient, Suppr retire le bouton, Alt+↑/↓ le déplace */

  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    if (!active || event.defaultPrevented || overlayOpen() || isEditableTarget(event.target) || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (trySession) {
      if (!event.altKey && (key === 'escape' || key === 'e')) {
        event.preventDefault();
        setTrySession(null);
      } else if (key === 'backspace') {
        event.preventDefault();
        setTrySession((session) => session && goBack(session, lookup));
      }
      return;
    }
    if (key === 'e' && !event.altKey) {
      event.preventDefault();
      startTry();
    } else if (key === 'escape') setSelectedId(null);
    else if ((key === 'delete' || key === 'backspace') && selected) {
      event.preventDefault();
      removeButton(selected.id);
    } else if (event.altKey && (key === 'arrowup' || key === 'arrowdown') && selected) {
      event.preventDefault();
      const index = form.buttons.indexOf(selected);
      moveButton(index, index + (key === 'arrowup' ? -1 : 1));
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  /* Menus contextuels */

  const addEntries = (): MenuEntry[] => [
    { heading: 'Ajouter' },
    { label: 'Bouton', icon: 'plus', onSelect: () => addButton() },
    ...(info.banner !== null ? [{ label: 'Bannière', icon: 'image' as const, onSelect: () => addButton('banner') }] : []),
    ...(info.special ? [{ label: 'Bouton spécial (violet)', icon: 'sparkles' as const, onSelect: () => addButton('special') }] : []),
  ];
  const rowEntries = (index: number): MenuEntry[] => {
    const button = form.buttons[index];
    return [
      { heading: `Bouton « ${button.id} »` },
      { label: 'Dupliquer', icon: 'copy', onSelect: () => duplicateButton(button.id) },
      { separator: true },
      { label: 'Monter', icon: 'chevron-up', shortcut: 'Alt+↑', disabled: index === 0, onSelect: () => moveButton(index, index - 1) },
      { label: 'Descendre', icon: 'chevron-down', shortcut: 'Alt+↓', disabled: index === form.buttons.length - 1, onSelect: () => moveButton(index, index + 1) },
      { separator: true },
      { label: 'Supprimer', icon: 'trash', danger: true, shortcut: 'Suppr', onSelect: () => removeButton(button.id) },
    ];
  };

  const visibleCount = preview && !trySession ? preview.entries.length : form.buttons.length;

  return (
    <main className="workspace form-editor">
      <aside className="sidebar">
        <div className="sidebar-tabs" role="tablist" aria-label="Colonne de gauche" hidden={trySession !== null}>
          <button type="button" role="tab" aria-selected={leftTab === 'buttons'} className={leftTab === 'buttons' ? 'active' : ''} onClick={() => setLeftTab('buttons')}>
            <Icon name="list" />
            Boutons
          </button>
          <button type="button" role="tab" aria-selected={leftTab === 'library'} className={leftTab === 'library' ? 'active' : ''} onClick={() => setLeftTab('library')}>
            <Icon name="library" />
            Bibliothèque
          </button>
        </div>
        <div hidden={leftTab !== 'library' || trySession !== null}>
          <p className="field-hint form-library-hint">
            {selected ? `Un clic sur une texture en fait l’icône de « ${selected.id} ».` : 'Choisis d’abord un bouton : la texture choisie devient son icône.'}
          </p>
          {props.librarySlot}
        </div>
        {trySession && <TryJournal session={trySession} onClear={() => setTrySession((session) => session && clearLog(session))} />}
        {leftTab === 'buttons' && !trySession && (
          <>
            <section className="panel-section">
              <header className="section-header">
                <h3>Formulaire Bedrock</h3>
                <span className="pill">
                  <Icon name="grid" />
                  {info.flag}
                </span>
              </header>
              <Field label="Disposition" hint={info.description}>
                <select
                  value={form.layout}
                  onChange={(event) => {
                    const layout = event.target.value;
                    if (isFormLayout(layout)) updateForm((draft) => void (draft.layout = layout));
                  }}
                >
                  {FORM_LAYOUTS.map((candidate) => (
                    <option key={candidate.layout} value={candidate.layout}>
                      {candidate.label} ({candidate.layout})
                    </option>
                  ))}
                </select>
              </Field>
              <LiveText
                label="Titre"
                value={form.title}
                hint="Codes § et variables {…} ; le drapeau de la disposition est ajouté devant à l’envoi."
                onFocus={onCheckpoint}
                onChange={(value) => updateForm((draft) => void (draft.title = value), false)}
              />
              <LiveText
                label="Contenu"
                value={form.content ?? ''}
                hint={info.content ?? 'Cette disposition n’affiche pas le contenu.'}
                multiline
                onFocus={onCheckpoint}
                onChange={(value) =>
                  updateForm((draft) => {
                    if (value === '') delete draft.content;
                    else draft.content = value;
                  }, false)
                }
              />
            </section>
            <section className="panel-section">
              <header className="section-header">
                <h3>Boutons</h3>
                <span className="count">{form.buttons.length}</span>
                <Tooltip label="Ajouter un bouton" hint="Après le bouton sélectionné">
                  <button type="button" className="sm" onClick={(event) => openContextMenu(event, addEntries())}>
                    <Icon name="plus" />
                    Ajouter
                  </button>
                </Tooltip>
              </header>
              {form.buttons.length === 0 ? (
                <p className="empty-hint">
                  <Icon name="info" />
                  <span>Aucun bouton : le formulaire n’affiche que son titre et son contenu.</span>
                </p>
              ) : (
                <ol className="form-button-list">
                  {form.buttons.map((button, index) => {
                    const src = button.icon ? resolveIcon(button.icon) : null;
                    return (
                      <li
                        key={button.id}
                        className={`form-button-row${button.id === selectedId ? ' is-selected' : ''}${reorder.over === index ? ' is-drop-target' : ''}`}
                        {...reorder.rowProps(index)}
                        onClick={() => setSelectedId(button.id)}
                        onContextMenu={(event) => {
                          setSelectedId(button.id);
                          openContextMenu(event, rowEntries(index));
                        }}
                      >
                        <span className="drag-grip" aria-hidden="true" {...reorder.handleProps(index)}>
                          <Icon name="drag" />
                        </span>
                        <span className="form-button-thumb">{src ? <img src={src} alt="" /> : <Icon name={button.icon ? 'image' : 'box'} />}</span>
                        <span className="form-button-text">
                          <span>{stripLegacy(button.text).trim() || button.id}</span>
                          <span className="muted small mono">{button.id}</span>
                        </span>
                        {button.role && <span className={`pill form-role role-${button.role}`}>{ROLE_LABELS[button.role]}</span>}
                        {button.visibleWhen && <Icon name="eye" />}
                        {(button.onClick ?? []).length > 0 && <span className="count">{(button.onClick ?? []).length}</span>}
                      </li>
                    );
                  })}
                </ol>
              )}
              <p className="field-hint">Glisser pour réordonner, clic droit pour les actions. L’index d’un clic est le rang parmi les boutons envoyés.</p>
            </section>
          </>
        )}
      </aside>

      <section className="stage-area">
        <div className="stage-toolbar" role="toolbar" aria-label="Aperçu du formulaire">
          <div className="segmented" role="group" aria-label="Mode">
            <Tooltip label="Édition" hint="Un clic sur un bouton de l’aperçu le sélectionne">
              <button type="button" className={trySession ? '' : 'active'} aria-pressed={!trySession} onClick={() => setTrySession(null)}>
                <Icon name="cursor" />
                <span className="tool-label">Édition</span>
              </button>
            </Tooltip>
            <Tooltip label="Essayer" hint="Un clic exécute les actions du bouton, comme le serveur ; Échap pour revenir" shortcut="E">
              <button type="button" className={trySession ? 'active' : ''} aria-pressed={trySession !== null} onClick={() => (trySession ? setTrySession(null) : startTry())}>
                <Icon name="play" />
                <span className="tool-label">Essayer</span>
                <kbd aria-hidden="true">E</kbd>
              </button>
            </Tooltip>
          </div>
          <div className="toolbar-group">
            <IconButton icon="undo" label="Annuler" shortcut="Ctrl+Z" size={24} disabled={!props.canUndo} onClick={props.onUndo} />
            <IconButton icon="redo" label="Rétablir" shortcut="Ctrl+Y" size={24} disabled={!props.canRedo} onClick={props.onRedo} />
          </div>
          <span className="tb-sep" aria-hidden="true" />
          <select className="background-picker" value={screenId} onChange={(event) => setScreenId(event.target.value)} aria-label="Taille de l’écran simulé">
            {SCREENS.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
          <span className="stage-toolbar-end muted small">
            {info.label} · {plural(visibleCount, 'bouton envoyé', 'boutons envoyés')} · ×{zoom}
          </span>
        </div>
        <div className="stage form-stage" ref={observeStage} onClick={() => !trySession && setSelectedId(null)}>
          {preview ? (
            <FormPreview
              layout={preview.layout}
              title={preview.title}
              content={preview.content}
              entries={preview.entries}
              screen={screen}
              zoom={zoom}
              selectedId={trySession ? null : selectedId}
              onPress={press}
              resolveIcon={resolveIcon}
            />
          ) : (
            <div className="empty-state">
              <Icon name={trySession?.closed ? 'close' : 'chest'} size={48} />
              {trySession?.closed ? (
                <>
                  <h2>Formulaire fermé</h2>
                  <p className="muted">Action « close », ou « back » sans menu précédent : le client n’affiche plus rien.</p>
                  <button type="button" className="primary" onClick={() => setTrySession((session) => session && reopen(session))}>
                    <Icon name="reload" />
                    Rouvrir
                  </button>
                </>
              ) : (
                <>
                  <h2>{shownMenu ? `Menu coffre « ${shownMenu.name} »` : 'Menu introuvable'}</h2>
                  <p className="muted">Le bouton a ouvert un menu coffre : il s’essaie dans son propre éditeur. Retour arrière revient au formulaire.</p>
                  <div className="button-row">
                    <button type="button" onClick={() => setTrySession((session) => session && goBack(session, lookup))}>
                      <Icon name="back" />
                      Retour
                    </button>
                    {shownMenu && (
                      <button type="button" className="primary" onClick={() => props.onOpenMenu(shownMenu.id)}>
                        <Icon name="open" />
                        Ouvrir dans l’éditeur
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      <aside className="sidebar">
        {trySession && (
          <TrySessionPanel
            session={trySession}
            lookup={lookup}
            onBack={() => setTrySession((session) => session && goBack(session, lookup))}
            onReopen={() => setTrySession((session) => session && reopen(session))}
            onRestart={startTry}
            onExit={() => setTrySession(null)}
          />
        )}
        {!trySession && selected && (
          <section className="panel-section inspector">
            <header className="section-header">
              <h3>Bouton</h3>
              <div className="section-actions">
                <IconButton icon="copy" label="Dupliquer" variant="ghost" onClick={() => duplicateButton(selected.id)} />
                <IconButton icon="trash" label="Supprimer" shortcut="Suppr" variant="danger" onClick={() => removeButton(selected.id)} />
              </div>
            </header>
            <ButtonIdField
              value={selected.id}
              taken={ids.filter((id) => id !== selected.id)}
              onCommit={(id) => {
                updateButton(selected.id, (button) => void (button.id = id));
                setSelectedId(id);
              }}
            />
            <LiveText
              label="Texte"
              value={selected.text}
              hint="Codes § et variables {…}."
              onFocus={onCheckpoint}
              onChange={(value) => updateButton(selected.id, (button) => void (button.text = value), false)}
            />
            <LiveText
              label="Sous-titre"
              value={selected.subtitle ?? ''}
              hint={`Envoyé après une tabulation. ${info.subtitle ?? 'Cette disposition le colle au titre.'}`}
              onFocus={onCheckpoint}
              onChange={(value) =>
                updateButton(
                  selected.id,
                  (button) => {
                    if (value === '') delete button.subtitle;
                    else button.subtitle = value;
                  },
                  false,
                )
              }
            />
            <Field label="Rôle" hint={selected.role === 'banner' ? (info.banner ?? 'Sans effet dans cette disposition.') : selected.role === 'special' ? (info.special ? 'Bouton violet.' : 'Sans effet dans cette disposition.') : 'Bouton ordinaire.'}>
              <select
                value={selected.role ?? ''}
                onChange={(event) =>
                  updateButton(selected.id, (button) => {
                    const role = event.target.value;
                    if (role === 'banner' || role === 'special') button.role = role;
                    else delete button.role;
                  })
                }
              >
                <option value="">Bouton</option>
                <option value="banner">Bannière (§m§a){info.banner === null ? ' · sans effet ici' : ''}</option>
                <option value="special">Bouton spécial (§m§b){info.special ? '' : ' · sans effet ici'}</option>
              </select>
            </Field>
            <IconPicker
              key={selected.id}
              icon={selected.icon}
              onChange={(icon) =>
                updateButton(selected.id, (button) => {
                  if (icon) button.icon = icon;
                  else delete button.icon;
                })
              }
              textures={props.textures}
              textureVersions={textureVersions}
              onDraw={() => props.onDrawIcon(selected.id)}
              onImport={props.onImportIcon}
              onShowLibrary={() => setLeftTab('library')}
            />
            {info.icon && <p className="field-hint">Image affichée : {info.icon}</p>}
            <ConditionEditor
              label="Envoyé si"
              value={selected.visibleWhen}
              states={menu.state ?? {}}
              flags={props.flags}
              hint="le bouton n’est pas envoyé si la condition est fausse"
              onCommit={(condition) =>
                updateButton(selected.id, (button) => {
                  if (condition) button.visibleWhen = condition;
                  else delete button.visibleWhen;
                })
              }
            />
            <ActionListEditor
              actions={selected.onClick}
              context={props.actionContext}
              menuId={menu.id}
              onOpenMenu={props.onOpenMenu}
              onChange={(actions) =>
                updateButton(selected.id, (button) => {
                  if (actions) button.onClick = actions;
                  else delete button.onClick;
                })
              }
            />
          </section>
        )}
        {!trySession && !selected && (
          <section className="panel-section">
            <header className="section-header">
              <h3>Formulaire</h3>
            </header>
            <p className="muted small">Sélectionne un bouton (dans la liste ou sur l’aperçu) pour modifier son texte, son icône et ses actions.</p>
          </section>
        )}
        {!trySession && (
          <section className="panel-section">
            <header className="section-header">
              <h3>État</h3>
            </header>
            <StateEditor menu={menu} resolvedStates={menu.state ?? {}} lists={[]} onChange={(recipe) => onChange(recipe)} />
          </section>
        )}
        {shownMenu && (
          <PreviewPanel
            menu={shownMenu}
            values={shownValues}
            onChange={trySession ? (next) => setTrySession((session) => session && setFrameValues(session, next)) : setValues}
            composition={null}
            errors={trySession ? [] : props.errors}
          />
        )}
        <section className="panel-section">
          <p className="warning">
            <Icon name="info" />
            <span>Formulaire Bedrock : pas de rendu Java. La lib Java l’ignore ; seul l’export «&nbsp;Bedrock&nbsp;» l’emporte.</span>
          </p>
          {notice && <p className="muted small">{notice}</p>}
        </section>
      </aside>
    </main>
  );
}
