import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';

interface WorkspacePillProps {
  name: string;
  path: string;
  onClick: () => void;
}

/** Pastille de l’espace de travail actif, en tête de chaque écran ; ouvre la sélection d’espace. */
export function WorkspacePill({ name, path, onClick }: WorkspacePillProps) {
  return (
    <Tooltip label="Changer d’espace de travail" hint={path || undefined} shortcut="Ctrl+O">
      <button type="button" className="workspace-pill" aria-label={`Espace de travail ${name}, changer`} onClick={onClick}>
        <Icon name="folder" />
        <span className="workspace-pill-name">{name}</span>
        <Icon name="chevron-down" />
      </button>
    </Tooltip>
  );
}
