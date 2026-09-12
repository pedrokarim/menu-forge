import { formatClock, useNow } from '../lib/clock';
import { plural } from '../lib/format';
import { PixelSpinner } from '../ui/PixelSpinner';
import { Tooltip } from '../ui/Tooltip';
import { useContextMenu } from '../ui/menuContext';
import { describeJob, elapsedOf, isRunning, openJob, summarize, useJobs } from './jobs';

/**
 * Indicateur des générations en cours, dans le rail (visible sur tous les
 * écrans) : picto animé et nombre de tâches. Un clic rouvre le dialogue de la
 * tâche ; s’il y en a plusieurs, un menu permet de choisir.
 */
export function JobIndicator() {
  const running = useJobs().filter(isRunning);
  const now = useNow(running.length > 0);
  const openMenu = useContextMenu();
  if (running.length === 0) return null;
  const label = `${plural(running.length, 'génération')} en cours`;
  const single = running.length === 1 ? running[0] : null;
  const hint = single ? `${describeJob(single).title} · ${formatClock(elapsedOf(single, now))}` : 'Clic : choisir la génération à afficher';
  return (
    <Tooltip label={label} hint={hint} placement="right">
      <button
        type="button"
        className="rail-button rail-jobs"
        aria-label={label}
        onClick={(event) => {
          if (single) {
            openJob(single.id);
            return;
          }
          openMenu(event, [
            { heading: label },
            ...running.map((job) => ({
              label: `${job.kind === 'interface' ? 'Interface' : 'Texture'} · ${summarize(job.prompt, 40)}`,
              icon: job.kind === 'interface' ? ('chest' as const) : ('image' as const),
              onSelect: () => openJob(job.id),
            })),
          ]);
        }}
      >
        <PixelSpinner />
        <span className="rail-jobs-count" aria-hidden="true">
          {running.length}
        </span>
      </button>
    </Tooltip>
  );
}
