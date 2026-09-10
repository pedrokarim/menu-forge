import type { ReactNode } from 'react';
import type { AppInfo } from '../lib/appApi';
import { ScreenFrame } from '../shell/ScreenFrame';

const LICENSES: ReadonlyArray<{ name: string; role: string; license: string }> = [
  { name: 'Pixelarticons', role: 'Icônes', license: 'MIT' },
  { name: 'Pixelify Sans', role: 'Titres', license: 'SIL Open Font License 1.1' },
  { name: 'Atkinson Hyperlegible', role: 'Texte', license: 'SIL Open Font License 1.1' },
  { name: 'JetBrains Mono', role: 'Code et chemins', license: 'SIL Open Font License 1.1' },
  { name: 'React', role: 'Interface', license: 'MIT' },
  { name: 'Tauri', role: 'Application de bureau', license: 'MIT ou Apache 2.0' },
];

const PLATFORMS: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

/** À propos : version, mode, licences et mentions. */
export function AboutScreen({ pill, app }: { pill: ReactNode; app: AppInfo | null }) {
  return (
    <ScreenFrame title="À propos" icon="info" pill={pill}>
      <div className="about-hero">
        <img src="/brand/logo.svg" alt="" width={96} height={96} />
        <div>
          <p className="about-name">menu-forge</p>
          <p className="muted">Studio d’inventaires Minecraft à base de glyphes de police.</p>
        </div>
      </div>

      <section className="screen-section" aria-labelledby="about-version">
        <h2 id="about-version" className="screen-section-title">
          Version
        </h2>
        <div className="card">
          <table className="info-table">
            <tbody>
              <tr>
                <th scope="row">Version</th>
                <td className="mono">{app?.version ?? '…'}</td>
              </tr>
              <tr>
                <th scope="row">Mode</th>
                <td>{app ? (app.mode === 'tauri' ? 'Application de bureau (Tauri)' : 'Navigateur (serveur local)') : '…'}</td>
              </tr>
              <tr>
                <th scope="row">Plateforme</th>
                <td>{app ? (PLATFORMS[app.platform] ?? app.platform) : '…'}</td>
              </tr>
              <tr>
                <th scope="row">Réglages</th>
                <td className="mono break">{app?.settingsPath ?? '…'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="screen-section" aria-labelledby="about-licenses">
        <h2 id="about-licenses" className="screen-section-title">
          Licences
        </h2>
        <div className="card">
          <table className="info-table">
            <thead>
              <tr>
                <th scope="col">Composant</th>
                <th scope="col">Usage</th>
                <th scope="col">Licence</th>
              </tr>
            </thead>
            <tbody>
              {LICENSES.map((entry) => (
                <tr key={entry.name}>
                  <td>{entry.name}</td>
                  <td className="muted">{entry.role}</td>
                  <td>{entry.license}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="legal">
        menu-forge n’est ni affilié à Mojang ni approuvé par Mojang&nbsp;; Minecraft est une marque de Mojang AB. Les assets de
        packs tiers affichés dans la bibliothèque restent la propriété de leurs auteurs.
      </p>
    </ScreenFrame>
  );
}
