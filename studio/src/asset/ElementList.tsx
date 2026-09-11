import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { isAdditiveClick } from '../lib/shortcuts';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import type { ElementFlag } from './assetEdit';
import { canMoveBlock, groupLabel, groupMemberIds } from './groups';
import type { AssetDefinition, AssetElement, AssetGroup } from './model';
import { BOX_PRESETS } from './presets';

interface ElementListProps {
  asset: AssetDefinition;
  selectedIds: string[];
  /** Groupes repliés (affichage seulement). */
  collapsed: ReadonlySet<string>;
  onToggleCollapsed: (groupId: string) => void;
  onSelect: (ids: string[]) => void;
  /** Monte (1) ou descend (−1) un élément, ou un groupe entier. */
  onReorder: (ids: string[], direction: 1 | -1) => void;
  onToggleFlag: (ids: string[], flag: ElementFlag) => void;
  onDelete: (ids: string[]) => void;
  onUngroup: (groupId: string) => void;
  onAddBox: (presetId: string) => void;
  onAddText: () => void;
  /** Clic droit sur un élément ou un groupe (il rejoint d’abord la sélection s’il n’y était pas). */
  onItemContextMenu?: (ids: string[], event: MouseEvent) => void;
}

function stop(action: () => void) {
  return (event: MouseEvent) => {
    event.stopPropagation();
    action();
  };
}

function describe(element: AssetElement): string {
  switch (element.type) {
    case 'box':
      return `${element.width} × ${element.height}${element.style.kind === 'slice' ? ' · nine-slice' : ''}`;
    case 'image':
      return element.texture.split('/').pop() ?? element.texture;
    case 'text': {
      const firstLine = element.text.split('\n')[0].replace(/§./gu, '');
      return `« ${firstLine} »`;
    }
  }
}

/** Ligne de la liste : un élément, ou l’en-tête d’un groupe. */
type Row = { kind: 'element'; element: AssetElement; member: boolean } | { kind: 'group'; group: AssetGroup; members: AssetElement[] };

/** Lignes dans l’ordre d’affichage : du dessus (en haut) vers le dessous ; un groupe replié cache ses membres. */
function buildRows(asset: AssetDefinition, collapsed: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  const done = new Set<string>();
  for (const element of [...asset.elements].reverse()) {
    const group = element.group ? asset.groups?.find((candidate) => candidate.id === element.group) : undefined;
    if (!group) {
      rows.push({ kind: 'element', element, member: false });
      continue;
    }
    if (done.has(group.id)) continue;
    done.add(group.id);
    const members = [...asset.elements].reverse().filter((candidate) => candidate.group === group.id);
    rows.push({ kind: 'group', group, members });
    if (!collapsed.has(group.id)) for (const member of members) rows.push({ kind: 'element', element: member, member: true });
  }
  return rows;
}

/** Liste des éléments et des groupes, du dessus vers le dessous : ordre, visibilité, verrou, suppression. */
export function ElementList(props: ElementListProps) {
  const { asset, selectedIds, collapsed } = props;
  const rows = buildRows(asset, collapsed);
  const visibleIds = rows.flatMap((row) => (row.kind === 'element' ? [row.element.id] : []));

  /** Clic sur une ligne : seule, ajoutée / retirée (Ctrl), ou plage des lignes visibles (Maj). */
  const choose = (ids: string[], event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    const anchor = selectedIds.at(-1);
    if (event.shiftKey && anchor && ids.length === 1 && visibleIds.includes(anchor)) {
      const [from, to] = [visibleIds.indexOf(anchor), visibleIds.indexOf(ids[0])].sort((a, b) => a - b);
      const range = visibleIds.slice(from, to + 1);
      props.onSelect([...selectedIds.filter((id) => !range.includes(id)), ...range]);
      return;
    }
    if (isAdditiveClick(event)) {
      const all = ids.every((id) => selectedIds.includes(id));
      props.onSelect(all ? selectedIds.filter((id) => !ids.includes(id)) : [...selectedIds, ...ids.filter((id) => !selectedIds.includes(id))]);
      return;
    }
    props.onSelect(ids);
  };

  const flagButtons = (ids: string[], hidden: boolean, locked: boolean) => (
    <>
      <IconButton
        icon={hidden ? 'eye-off' : 'eye'}
        label={hidden ? 'Afficher' : 'Masquer'}
        hint={hidden ? 'Masqué : ni affiché ni exporté' : 'Ni affiché ni exporté une fois masqué'}
        variant="ghost"
        pressed={hidden}
        onClick={stop(() => props.onToggleFlag(ids, 'hidden'))}
      />
      <IconButton
        icon={locked ? 'lock' : 'unlock'}
        label={locked ? 'Déverrouiller' : 'Verrouiller'}
        hint="Verrouillé : ne se sélectionne plus sur la toile"
        variant="ghost"
        pressed={locked}
        onClick={stop(() => props.onToggleFlag(ids, 'locked'))}
      />
    </>
  );

  const moveButtons = (ids: string[]) => (
    <>
      <IconButton
        icon="chevron-up"
        label="Monter"
        hint="Dessiner au-dessus"
        variant="ghost"
        disabled={!canMoveBlock(asset, ids, 1)}
        onClick={stop(() => props.onReorder(ids, 1))}
      />
      <IconButton
        icon="chevron-down"
        label="Descendre"
        hint="Dessiner en dessous"
        variant="ghost"
        disabled={!canMoveBlock(asset, ids, -1)}
        onClick={stop(() => props.onReorder(ids, -1))}
      />
    </>
  );

  const row = (
    key: string,
    ids: string[],
    classes: string[],
    label: ReactNode,
    flags: { hidden: boolean; locked: boolean },
    actions: ReactNode,
    meta?: ReactNode,
  ) => {
    const isSelected = ids.length > 0 && ids.every((id) => selectedIds.includes(id));
    if (isSelected) classes.push('selected');
    if (flags.hidden) classes.push('hidden-by-state');
    return (
      <li
        key={key}
        className={classes.join(' ')}
        tabIndex={0}
        aria-current={isSelected || undefined}
        onClick={(event: MouseEvent) => choose(ids, event)}
        onContextMenu={(event: MouseEvent) => {
          if (!props.onItemContextMenu) return;
          if (!isSelected) props.onSelect(ids);
          props.onItemContextMenu(ids, event);
        }}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          choose(ids, event);
        }}
      >
        <span className="outline-label">{label}</span>
        {(flags.hidden || flags.locked) && (
          <span className="outline-flags" aria-hidden="true">
            {flags.hidden && <Icon name="eye-off" />}
            {flags.locked && <Icon name="lock" />}
          </span>
        )}
        {meta !== undefined && <span className="outline-meta">{meta}</span>}
        <span className="outline-actions">{actions}</span>
      </li>
    );
  };

  return (
    <section className="panel-section">
      <header className="section-header">
        <h3>Éléments</h3>
        <div className="section-actions">
          <Tooltip label="Ajouter une box" hint="Au centre de l’asset, avec le préréglage choisi ; outil Box : B">
            <select
              className="asset-add-select"
              value=""
              aria-label="Ajouter une box"
              onChange={(event) => {
                if (event.target.value) props.onAddBox(event.target.value);
              }}
            >
              <option value="">Box…</option>
              {BOX_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </Tooltip>
          <Tooltip label="Ajouter un texte" hint="Posé en haut à gauche ; outil Texte : T">
            <button type="button" className="sm" onClick={props.onAddText}>
              <Icon name="plus" />
              Texte
            </button>
          </Tooltip>
        </div>
      </header>
      {asset.elements.length === 0 && (
        <p className="empty-hint">
          <Icon name="info" />
          <span>
            Aucun élément. Dessine une box (outil Box, <kbd>B</kbd>), pose un texte (<kbd>T</kbd>) ou une image (<kbd>I</kbd>),
            glisse un PNG sur la toile, ou insère une texture depuis la bibliothèque.
          </span>
        </p>
      )}
      <ul className="outline-list">
        {rows.map((entry) => {
          if (entry.kind === 'group') {
            const ids = groupMemberIds(asset, entry.group.id);
            const hidden = entry.members.every((member) => member.hidden);
            const locked = entry.members.every((member) => member.locked);
            const open = !collapsed.has(entry.group.id);
            return row(
              `group:${entry.group.id}`,
              ids,
              ['outline-item', 'group-row'],
              <>
                <button
                  type="button"
                  className="group-toggle"
                  aria-expanded={open}
                  aria-label={open ? 'Replier le groupe' : 'Déplier le groupe'}
                  onClick={stop(() => props.onToggleCollapsed(entry.group.id))}
                >
                  <Icon name={open ? 'chevron-down' : 'chevron-right'} />
                </button>
                <Icon name="group" />
                <span className="outline-name">{groupLabel(entry.group)}</span>
              </>,
              { hidden, locked },
              <>
                {flagButtons(ids, hidden, locked)}
                {moveButtons(ids)}
                <IconButton
                  icon="ungroup"
                  label="Dégrouper"
                  shortcut="Ctrl+Maj+G"
                  variant="ghost"
                  onClick={stop(() => props.onUngroup(entry.group.id))}
                />
                <IconButton
                  icon="trash"
                  label="Supprimer le groupe"
                  hint="Et tous ses éléments"
                  variant="danger"
                  onClick={stop(() => props.onDelete(ids))}
                />
              </>,
              `${entry.members.length}`,
            );
          }
          const { element, member } = entry;
          const classes = ['outline-item'];
          if (member) classes.push('group-member');
          return row(
            element.id,
            [element.id],
            classes,
            <>
              <span className={`kind-dot asset-kind-${element.type}`} />
              <span className="outline-name">{element.id}</span>
              <span className="muted">{describe(element)}</span>
            </>,
            { hidden: Boolean(element.hidden), locked: Boolean(element.locked) },
            <>
              {flagButtons([element.id], Boolean(element.hidden), Boolean(element.locked))}
              {moveButtons([element.id])}
              <IconButton
                icon="trash"
                label="Supprimer"
                shortcut="Suppr"
                variant="danger"
                onClick={stop(() => props.onDelete([element.id]))}
              />
            </>,
          );
        })}
      </ul>
    </section>
  );
}
