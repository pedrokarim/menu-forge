import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { NBSP } from '../lib/format';
import { Notice } from '../shell/ScreenFrame';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { configureProvider, deleteProviderKey, fetchProviders, saveProviderKey, testProvider } from './api';
import type { AiProvider, AiProviderList, ProviderKind, ProviderPatch } from './api';
import './ai.css';

const KIND_LABELS: Record<ProviderKind, string> = {
  cloud: 'en ligne',
  local: 'sur ce poste',
  cli: 'ligne de commande',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Champ enregistré à la sortie ou sur Entrée (Échap rétablit la valeur). */
function CommitText({
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
    if (text.trim() !== value) onCommit(text.trim());
  };
  return (
    <input
      className={mono ? 'mono grow' : 'grow'}
      aria-label={label}
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setText(value);
      }}
    />
  );
}

function Row({ title, text, children }: { title: string; text?: ReactNode; children: ReactNode }) {
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

function statusBadge(provider: AiProvider): { label: string; className: string } {
  if (provider.ready) return { label: 'prêt', className: 'badge badge-clean' };
  if (!provider.enabled) return { label: 'désactivé', className: 'badge' };
  return { label: provider.issue ?? 'incomplet', className: 'badge badge-missing' };
}

interface CardProps {
  provider: AiProvider;
  secretStore: string;
  onUpdate: (provider: AiProvider) => void;
}

/** Fiche d’un fournisseur : activation, clé, modèles, adresse, test. */
function ProviderCard({ provider, secretStore, onUpdate }: CardProps) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'key' | 'test' | 'save' | null>(null);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const run = async (kind: 'key' | 'test' | 'save', action: () => Promise<void>) => {
    setBusy(kind);
    setResult(null);
    try {
      await action();
    } catch (error) {
      setResult({ kind: 'error', text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };
  const patch = (value: ProviderPatch) =>
    void run('save', async () => {
      // La case « Utiliser » suit le clic tout de suite ; elle est rétablie si l’enregistrement échoue.
      if (value.enabled !== undefined) onUpdate({ ...provider, enabled: value.enabled });
      try {
        onUpdate(await configureProvider(provider.id, value));
      } catch (error) {
        onUpdate(provider);
        throw error;
      }
    });
  const storeKey = () =>
    void run('key', async () => {
      onUpdate(await saveProviderKey(provider.id, key));
      setKey('');
      setResult({ kind: 'ok', text: `Clé enregistrée (${secretStore})` });
    });
  const removeKey = () =>
    void run('key', async () => {
      onUpdate(await deleteProviderKey(provider.id));
      setResult({ kind: 'ok', text: 'Clé retirée' });
    });
  const test = () =>
    void run('test', async () => {
      const outcome = await testProvider(provider.id);
      setResult({ kind: 'ok', text: outcome.message });
    });

  const badge = statusBadge(provider);
  const isCli = provider.kind === 'cli';
  return (
    <details className="card ai-provider" data-provider={provider.id}>
      <summary className="ai-provider-head">
        <Icon name="chevron-right" className="ai-provider-chevron" />
        <strong>{provider.name}</strong>
        <span className="muted small">{KIND_LABELS[provider.kind]}</span>
        <span className="ai-provider-caps">
          {provider.image && <span className="badge">images</span>}
          {provider.text && <span className="badge">texte</span>}
        </span>
        <span className={badge.className}>{badge.label}</span>
      </summary>
      <div className="setting-list">
        <Row
          title="Activer"
          text={
            provider.kind === 'cloud'
              ? `Service en ligne payant à l’usage${NBSP}: rien ne lui est envoyé tant qu’il n’est pas activé.`
              : provider.kind === 'local'
                ? 'Serveur sur ce poste ou sur le réseau local, sans clé.'
                : 'Programme installé, qui gère sa propre connexion (codex login).'
          }
        >
          <label className="checkbox">
            <input
              type="checkbox"
              checked={provider.enabled}
              disabled={busy !== null}
              onChange={(event) => patch({ enabled: event.target.checked })}
            />
            Utiliser {provider.name}
          </label>
        </Row>
        {provider.keyRequired && (
          <Row
            title="Clé d’API"
            text={
              provider.keyError ??
              (provider.keyConfigured ? `Configurée${NBSP}: ${secretStore}.` : `Absente. Où la créer${NBSP}: ${provider.helpUrl}`)
            }
          >
            <input
              className="mono grow"
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={`Clé d’API ${provider.name}`}
              placeholder={provider.keyConfigured ? '•••••••• (coller pour remplacer)' : 'Coller la clé'}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && key.trim()) storeKey();
              }}
            />
            <Tooltip label="Enregistrer la clé" hint="Dans le trousseau du système, jamais dans les réglages">
              <button type="button" disabled={busy !== null || key.trim().length === 0} onClick={storeKey}>
                <Icon name={busy === 'key' ? 'loader' : 'lock'} />
                Enregistrer
              </button>
            </Tooltip>
            {provider.keyConfigured && (
              <IconButton icon="trash" label="Retirer la clé" hint="La supprime du trousseau du système" variant="danger" onClick={removeKey} />
            )}
          </Row>
        )}
        {provider.image && (
          <Row title="Modèle d’image" text={provider.defaults.imageModel ? `Par défaut${NBSP}: ${provider.defaults.imageModel}` : `Vide${NBSP}: celui du service.`}>
            <CommitText
              mono
              label={`Modèle d’image ${provider.name}`}
              value={provider.custom.imageModel ?? ''}
              placeholder={provider.defaults.imageModel ?? 'modèle par défaut'}
              onCommit={(value) => patch({ imageModel: value || null })}
            />
          </Row>
        )}
        {provider.text && (
          <Row title="Modèle de texte" text={provider.defaults.textModel ? `Par défaut${NBSP}: ${provider.defaults.textModel}` : `Vide${NBSP}: celui du service.`}>
            <CommitText
              mono
              label={`Modèle de texte ${provider.name}`}
              value={provider.custom.textModel ?? ''}
              placeholder={provider.defaults.textModel ?? 'modèle par défaut'}
              onCommit={(value) => patch({ textModel: value || null })}
            />
          </Row>
        )}
        <Row
          title={isCli ? 'Programme' : 'Adresse de l’API'}
          text={
            isCli
              ? provider.endpoint
                ? `Trouvé${NBSP}: ${provider.endpoint}`
                : `Introuvable${NBSP}: indique le chemin absolu de codex.exe.`
              : `Par défaut${NBSP}: ${provider.defaults.endpoint ?? ''}`
          }
        >
          <CommitText
            mono
            label={isCli ? 'Chemin du programme Codex' : `Adresse de l’API ${provider.name}`}
            value={provider.custom.endpoint ?? ''}
            placeholder={isCli ? 'recherche automatique' : (provider.defaults.endpoint ?? '')}
            onCommit={(value) => patch({ endpoint: value || null })}
          />
        </Row>
        <Row title="Connexion" text={provider.ready ? undefined : 'Active le fournisseur (et sa clé) pour le tester.'}>
          <button type="button" disabled={!provider.ready || busy !== null} onClick={test}>
            <Icon name={busy === 'test' ? 'loader' : 'zap'} />
            Tester la connexion
          </button>
        </Row>
        {result && (
          <div className="ai-provider-result">
            <Notice notice={result} />
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * Section « IA » des paramètres : fournisseurs d’images et de texte, clés
 * (dans le trousseau du système), modèles, adresses locales, test de
 * connexion. Chargée à la demande.
 */
export function AiSettingsSection() {
  const [list, setList] = useState<AiProviderList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchProviders().then(
      (next) => {
        if (!cancelled) setList(next);
      },
      (failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (provider: AiProvider) =>
    setList((current) => current && { ...current, providers: current.providers.map((candidate) => (candidate.id === provider.id ? provider : candidate)) });

  const ready = list?.providers.filter((provider) => provider.ready).length ?? 0;
  return (
    <section className="screen-section" aria-labelledby="settings-ai">
      <div className="screen-section-head">
        <h2 id="settings-ai" className="screen-section-title">
          IA
        </h2>
        {list && <span className="count">{ready} prêt{ready > 1 ? 's' : ''}</span>}
      </div>
      <div className="card ai-privacy">
        <Icon name="info" />
        <p className="muted small">
          Rien ne part vers un fournisseur tant que tu ne l’as pas activé, ni au démarrage. À chaque génération, le studio envoie
          ta description et ses consignes (style pixel art, taille, palette){NBSP}; pour une interface, aussi le schéma du format,
          la taille du coffre et les noms des textures et des menus de l’espace, jamais leurs fichiers. Les clés d’API ne vont
          jamais dans les réglages{NBSP}; elles sont rangées à part{NBSP}: {list?.secretStore ?? 'trousseau du système'}. Les
          services en ligne facturent chaque génération.
        </p>
      </div>
      {error && <Notice notice={{ kind: 'error', text: `Fournisseurs d’IA illisibles${NBSP}: ${error}` }} />}
      {!list && !error && <p className="muted">Chargement…</p>}
      <div className="ai-providers">
        {list?.providers.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} secretStore={list.secretStore} onUpdate={update} />
        ))}
      </div>
    </section>
  );
}
