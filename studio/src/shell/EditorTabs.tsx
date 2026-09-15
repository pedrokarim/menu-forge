import { useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import type { EditorSession } from '../screens/EditorScreen';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { useContextMenu } from '../ui/menuContext';
import type { MenuEntry } from '../ui/menuContext';
import { Tooltip } from '../ui/Tooltip';
import type { EditorMode } from './router';
import { tabLabel } from './tabs';
import type { EditorTab, NewDocumentKind } from './tabs';

const MODE_ICONS: Record<EditorMode, IconName> = { menus: 'chest', assets: 'image', pixels: 'pencil' };
const MODE_NOUNS: Record<EditorMode, string> = { menus: 'Menu', assets: 'Asset', pixels: 'Image' };

interface EditorTabsProps {
  tabs: readonly EditorTab[];
  active: string | null;
  sessions: Readonly<Record<string, EditorSession>>;
  onActivate: (key: string) => void;
  onClose: (keys: string[]) => void;
  onSave: (key: string) => void;
  onMove: (key: string, index: number) => void;
  onNew: (kind: NewDocumentKind) => void;
}

/**
 * Barre d’onglets de l’éditeur : un onglet par document ouvert, marqué d’un point tant qu’il a des
 * modifications non enregistrées. Clic du milieu ou croix : fermer ; clic droit : enregistrer, fermer
 * les autres, fermer à droite, fermer les onglets enregistrés, tout fermer ; glisser : réordonner.
 */
export function EditorTabs({ tabs, active, sessions, onActivate, onClose, onSave, onMove, onNew }: EditorTabsProps) {
  const openContextMenu = useContextMenu();
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const tabMenu = (tab: EditorTab, index: number): MenuEntry[] => {
    const session = sessions[tab.key];
    const others = tabs.filter((candidate) => candidate.key !== tab.key).map((candidate) => candidate.key);
    const right = tabs.slice(index + 1).map((candidate) => candidate.key);
    const saved = tabs.filter((candidate) => !sessions[candidate.key]?.dirty).map((candidate) => candidate.key);
    return [
      { heading: `${MODE_NOUNS[tab.mode]} « ${tabLabel(tab, session?.name)} »` },
      { label: 'Enregistrer', icon: 'save', shortcut: 'Ctrl+S', disabled: !session?.dirty, onSelect: () => onSave(tab.key) },
      { separator: true },
      { label: 'Fermer', icon: 'close', shortcut: 'Ctrl+W', onSelect: () => onClose([tab.key]) },
      { label: 'Fermer les autres onglets', disabled: others.length === 0, onSelect: () => onClose(others) },
      { label: 'Fermer les onglets à droite', disabled: right.length === 0, onSelect: () => onClose(right) },
      { label: 'Fermer les onglets enregistrés', disabled: saved.length === 0, onSelect: () => onClose(saved) },
      { separator: true },
      { label: 'Tout fermer', danger: true, onSelect: () => onClose(tabs.map((candidate) => candidate.key)) },
    ];
  };

  const newMenu = (event: MouseEvent): void =>
    openContextMenu(event, [
      { heading: 'Nouveau document' },
      { label: 'Nouveau menu…', icon: 'chest', onSelect: () => onNew('new-menu') },
      { label: 'Nouvel asset…', icon: 'image', onSelect: () => onNew('new-asset') },
      { label: 'Nouvelle image…', icon: 'pencil', onSelect: () => onNew('new-pixel') },
    ]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Flèches entre les onglets (motif « tablist »), Suppr ferme l’onglet focalisé.
    const index = tabs.findIndex((tab) => tab.key === active);
    if (index < 0) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      onActivate(next.key);
      requestAnimationFrame(() => document.getElementById(`editor-tab-${next.key}`)?.focus());
    } else if (event.key === 'Delete') {
      event.preventDefault();
      onClose([tabs[index].key]);
    }
  };

  const dropAt = (event: DragEvent, index: number) => {
    if (!dragged) return;
    event.preventDefault();
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setDropIndex(event.clientX > box.left + box.width / 2 ? index + 1 : index);
  };

  const finishDrop = () => {
    if (dragged && dropIndex !== null) {
      const from = tabs.findIndex((tab) => tab.key === dragged);
      onMove(dragged, from < dropIndex ? dropIndex - 1 : dropIndex);
    }
    setDragged(null);
    setDropIndex(null);
  };

  return (
    <div className="editor-tabs">
      <div className="editor-tabs-list" role="tablist" aria-label="Documents ouverts" onKeyDown={onKeyDown}>
        {tabs.map((tab, index) => {
          const session = sessions[tab.key];
          const label = tabLabel(tab, session?.name);
          const selected = tab.key === active;
          const classes = ['editor-tab'];
          if (selected) classes.push('active');
          if (session?.dirty) classes.push('dirty');
          if (dragged === tab.key) classes.push('dragged');
          if (dropIndex === index) classes.push('drop-before');
          if (dropIndex === index + 1 && index === tabs.length - 1) classes.push('drop-after');
          const hint = [tab.id && tab.id !== label ? tab.id : null, session?.dirty ? 'modifications non enregistrées' : null]
            .filter(Boolean)
            .join(' · ');
          return (
            <div
              key={tab.key}
              className={classes.join(' ')}
              draggable
              onDragStart={(event) => {
                setDragged(tab.key);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => dropAt(event, index)}
              onDrop={(event) => {
                event.preventDefault();
                finishDrop();
              }}
              onDragEnd={finishDrop}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onClose([tab.key]);
                }
              }}
              onContextMenu={(event) => openContextMenu(event, tabMenu(tab, index))}
            >
              <Tooltip label={`${MODE_NOUNS[tab.mode]} « ${label} »`} hint={hint || undefined}>
                <button
                  type="button"
                  role="tab"
                  id={`editor-tab-${tab.key}`}
                  className="editor-tab-button"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onMouseDown={(event) => {
                    if (event.button === 1) event.preventDefault();
                  }}
                  onClick={() => onActivate(tab.key)}
                >
                  <Icon name={MODE_ICONS[tab.mode]} />
                  <span className="editor-tab-label" data-audit-ellipsis data-tooltip-text={label}>
                    {label}
                  </span>
                </button>
              </Tooltip>
              <button
                type="button"
                className="editor-tab-close"
                aria-label={session?.dirty ? `Fermer « ${label} » (non enregistré)` : `Fermer « ${label} »`}
                tabIndex={-1}
                onClick={() => onClose([tab.key])}
              >
                <span className="editor-tab-dot" aria-hidden="true" />
                <Icon name="close" size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <Tooltip label="Nouveau document" hint="Menu, asset ou image, dans un nouvel onglet">
        <button type="button" className="editor-tabs-new" aria-label="Nouveau document" onClick={newMenu}>
          <Icon name="plus" />
        </button>
      </Tooltip>
    </div>
  );
}
