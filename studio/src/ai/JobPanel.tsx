import { formatClock, formatSpan, useNow } from '../lib/clock';
import { NBSP, plural } from '../lib/format';
import { Icon } from '../ui/Icon';
import { PixelSpinner } from '../ui/PixelSpinner';
import { Tooltip } from '../ui/Tooltip';
import { describeJob, elapsedOf, isRunning, jobSteps } from './jobs';
import type { AiJob } from './jobs';

/**
 * Tâche montrée en direct dans son dialogue : picto animé, phase en clair,
 * chronomètre, barre d’avancement par étapes (dont l’étape en cours défile
 * au pixel) et, pour une interface, le journal des essais.
 */
export function JobPanel({ job, onNewRequest }: { job: AiJob; onNewRequest?: () => void }) {
  const running = isRunning(job);
  const now = useNow(running);
  const { title, detail } = describeJob(job);
  const { steps, current } = jobSteps(job);
  const elapsed = elapsedOf(job, now);
  const done = job.phase === 'done';
  // Étapes franchies ; l’étape en cours est la zone qui défile.
  const filled = done ? steps.length : Math.max(0, current);
  const icon = done ? 'check' : job.phase === 'cancelled' ? 'stop' : 'alert';
  return (
    <section className={`ai-job is-${job.phase}`} aria-label="Génération en cours">
      <div className="ai-job-head">
        <span className="ai-job-icon">{running ? <PixelSpinner /> : <Icon name={icon} size={24} />}</span>
        <div className="ai-job-text" role="status" aria-live="polite">
          <p className="ai-job-title">{title}</p>
          {detail && <p className="ai-job-detail">{detail}</p>}
        </div>
        <span className="ai-job-clock" title={`Temps écoulé${NBSP}: ${formatSpan(elapsed)}`}>
          {formatClock(elapsed)}
        </span>
      </div>
      <div
        className="ai-job-bar"
        role="progressbar"
        aria-label="Avancement"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={filled}
        aria-valuetext={title}
      >
        <span className="ai-job-bar-fill" style={{ width: `${(filled / steps.length) * 100}%` }} />
        {running && current >= 0 && (
          <span className="ai-job-bar-run" style={{ left: `${(current / steps.length) * 100}%`, width: `${100 / steps.length}%` }} />
        )}
      </div>
      <ol className="ai-job-steps" aria-label="Étapes" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, index) => (
          <li key={step} className={index < filled ? 'is-done' : index === current && running ? 'is-current' : undefined}>
            {step}
          </li>
        ))}
      </ol>
      {job.phase === 'failed' && job.error && <p className="ai-job-error">{job.error}</p>}
      {running && onNewRequest && (
        <Tooltip label="Nouvelle demande" hint="Celle-ci continue en arrière-plan">
          <button type="button" className="sm ai-job-new" onClick={onNewRequest}>
            <Icon name="plus" />
            Nouvelle demande
          </button>
        </Tooltip>
      )}
      <AttemptLog job={job} now={now} />
    </section>
  );
}

/** Journal des essais d’une interface : les erreurs du schéma par essai, repliables ; l’essai en cours en direct. */
function AttemptLog({ job, now }: { job: AiJob; now: number }) {
  const running = isRunning(job);
  const live = running && job.attempt > job.attempts.length;
  if (job.kind !== 'interface' || (job.attempts.length === 0 && !live)) return null;
  const last = job.attempts.at(-1)?.index;
  return (
    <ol className="ai-attempts" aria-label="Journal des essais">
      {job.attempts.map((attempt) =>
        attempt.errors.length === 0 ? (
          <li key={attempt.index} className="is-ok">
            <p className="ai-attempt-row">
              <Icon name="check" />
              <span>
                Essai {attempt.index}
                {NBSP}: valide
              </span>
              <span className="ai-attempt-time">{formatSpan(attempt.elapsedMs)}</span>
            </p>
          </li>
        ) : (
          <li key={attempt.index} className="is-error">
            <details open={attempt.index === last}>
              <summary className="ai-attempt-row">
                <Icon name="alert" />
                <span>
                  Essai {attempt.index}
                  {NBSP}: {plural(attempt.errors.length, 'erreur')}
                  {attempt.index < job.maxAttempts && (running || attempt.index < (last ?? 0))
                    ? `, renvoyée${attempt.errors.length > 1 ? 's' : ''} au modèle`
                    : ''}
                </span>
                <span className="ai-attempt-time">{formatSpan(attempt.elapsedMs)}</span>
                <Icon name="chevron-down" className="ai-attempt-chevron" />
              </summary>
              <ul className="ai-attempt-errors">
                {attempt.errors.map((problem, index) => (
                  <li key={index}>{problem}</li>
                ))}
              </ul>
            </details>
          </li>
        ),
      )}
      {live && (
        <li className="is-live">
          <p className="ai-attempt-row">
            <PixelSpinner size={12} />
            <span>
              Essai {job.attempt}
              {NBSP}: en cours…
            </span>
            <span className="ai-attempt-time">{formatClock(now - job.attemptStartedAt)}</span>
          </p>
        </li>
      )}
    </ol>
  );
}
