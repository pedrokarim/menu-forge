import { useEffect, useRef, useState } from 'react';
import { NumberField } from '../components/fields';
import { drawScaled } from './canvasUtils';
import type { AssetDefinition } from './model';
import { glyphUsage, glyphYaml } from './presets';

interface ExportPanelProps {
  asset: AssetDefinition;
  /** Rendu exact de l’export (échelle 1, sans repères). */
  exportCanvas: HTMLCanvasElement;
  dirty: boolean;
  saving: boolean;
  missingTextures: readonly string[];
  fontError: string | null;
  onSave: () => void;
  onAscentChange: (ascent: number) => void;
}

/** Colonne d’export : enregistrement, `ascent`, aperçus ×1 et ×2, extraits prêts à copier. */
export function ExportPanel(props: ExportPanelProps) {
  const { asset, exportCanvas, dirty, saving, missingTextures, fontError } = props;
  const scale1Ref = useRef<HTMLCanvasElement>(null);
  const scale2Ref = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (scale1Ref.current) drawScaled(scale1Ref.current, exportCanvas, 1);
    if (scale2Ref.current) drawScaled(scale2Ref.current, exportCanvas, 2);
  }, [exportCanvas]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text).then(
      () => setCopied(key),
      () => setCopied(null),
    );
  };

  const yaml = glyphYaml(asset);
  const usage = glyphUsage(asset);
  const ascent = asset.export.ascent;

  return (
    <section className="panel-section">
      <header className="section-header">
        <h3>Export</h3>
        <span className="badge">{dirty ? 'modifié' : 'à jour'}</span>
      </header>
      <button type="button" className="primary" disabled={saving} onClick={props.onSave} title="Ctrl+S">
        {saving ? 'Export en cours…' : dirty ? 'Enregistrer et exporter •' : 'Enregistrer et exporter'}
      </button>
      <p className="muted small">
        PNG à l’échelle 1 : <code>textures/assets/{asset.id}.png</code>
      </p>
      {missingTextures.length > 0 && (
        <p className="warning">
          Texture(s) introuvable(s), absente(s) de l’export : {missingTextures.join(', ')}
        </p>
      )}
      {fontError && (
        <p className="warning">Police du jeu indisponible (bibliothèque vanilla) : le texte est rendu de façon approximative.</p>
      )}

      <NumberField label="Ascent" value={ascent} min={-512} max={512} onChange={props.onAscentChange} />
      <p className="field-hint">
        7 = haut de l’image aligné sur le haut des lettres ; plus grand = plus haut (le haut de l’image est à 7 − ascent px
        sous le haut de la ligne).
      </p>
      {ascent > asset.size.height && (
        <p className="warning">L’ascent ne peut pas dépasser la hauteur ({asset.size.height} px) : le jeu refuserait le glyphe.</p>
      )}

      <div className="asset-preview">
        <figure>
          <canvas ref={scale1Ref} />
          <figcaption>Échelle 1 (taille réelle)</figcaption>
        </figure>
        <figure>
          <canvas ref={scale2Ref} />
          <figcaption>×2</figcaption>
        </figure>
      </div>

      <div className="asset-snippet-block">
        <div className="section-header">
          <span className="field-label">Glyphe Enderium (glyphs/*.yml)</span>
          <button type="button" className="asset-copy" onClick={() => copy('yaml', yaml)}>
            {copied === 'yaml' ? 'Copié' : 'Copier'}
          </button>
        </div>
        <pre className="asset-snippet">{yaml}</pre>
      </div>
      <div className="asset-snippet-block">
        <div className="section-header">
          <span className="field-label">Usage dans un texte</span>
          <button type="button" className="asset-copy" onClick={() => copy('usage', usage)}>
            {copied === 'usage' ? 'Copié' : 'Copier'}
          </button>
        </div>
        <pre className="asset-snippet">{usage}</pre>
        <p className="field-hint">À placer avec des &lt;shift:…&gt; si besoin.</p>
      </div>
    </section>
  );
}
