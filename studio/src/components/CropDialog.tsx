import { useEffect, useRef, useState } from 'react';
import { RegionPicker } from '../asset/RegionPicker';
import type { Region } from '../asset/model';
import { plural } from '../lib/format';
import { loadTexture } from '../lib/textures';
import type { LoadedTexture } from '../lib/textures';
import { Icon } from '../ui/Icon';
import { FieldError, Modal } from './fields';

export interface CropAction {
  label: string;
  run: (region: Region) => Promise<void>;
}

interface CropDialogProps {
  title: string;
  /** Adresse de l’image à découper (bibliothèque ou espace de travail). */
  url: string;
  /** Action principale : appliquée, puis le dialogue se ferme. */
  primary: CropAction;
  /** Action répétable : appliquée, le dialogue reste ouvert pour la zone suivante (plusieurs sprites d’un atlas). */
  secondary?: CropAction;
  onClose: () => void;
}

const noop = () => undefined;

/** Plus grand agrandissement entier (×8 au plus) qui fait tenir la découpe dans l’aperçu. */
function previewScale(region: Region): number {
  return Math.max(1, Math.min(8, Math.floor(180 / Math.max(region.width, region.height, 1))));
}

/**
 * Rognage : choisir une partie d’une image (sprite d’un atlas, case d’une
 * grille, zone tracée), avec l’aperçu de la découpe.
 */
export function CropDialog({ title, url, primary, secondary, onClose }: CropDialogProps) {
  const [texture, setTexture] = useState<LoadedTexture | null | undefined>(undefined);
  const [region, setRegion] = useState<Region | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const previewRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadTexture(url).then(
      (loaded) => {
        if (!cancelled) setTexture(loaded);
      },
      () => {
        if (!cancelled) setTexture(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Aperçu de la découpe, agrandi au pixel près.
  useEffect(() => {
    const canvas = previewRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !texture || !region) return;
    const scale = previewScale(region);
    canvas.width = region.width * scale;
    canvas.height = region.height * scale;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(texture.image, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
  }, [texture, region]);

  const apply = async (action: CropAction, close: boolean) => {
    if (!region) return;
    setBusy(true);
    setError(null);
    try {
      await action.run(region);
      if (close) onClose();
      else setDone((count) => count + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      wide
      onClose={onClose}
      footer={
        <>
          {error && <FieldError>{error}</FieldError>}
          <button type="button" onClick={onClose}>
            {done > 0 ? 'Fermer' : 'Annuler'}
          </button>
          {secondary && (
            <button type="button" disabled={busy || !region} onClick={() => void apply(secondary, false)}>
              <Icon name="plus" />
              {secondary.label}
            </button>
          )}
          <button type="button" className="primary" disabled={busy || !region} onClick={() => void apply(primary, true)}>
            <Icon name={busy ? 'loader' : 'crop'} />
            {primary.label}
          </button>
        </>
      }
    >
      <div className="crop-dialog">
        <RegionPicker texture={texture} region={region} fitSize={520} onBeginEdit={noop} onRegionChange={(next) => setRegion(next)} />
        <aside className="crop-side">
          <h3>Découpe</h3>
          <div className="crop-preview">
            {region ? (
              <canvas ref={previewRef} aria-label="Aperçu de la découpe" />
            ) : (
              <p className="muted small">Trace une zone, clique une case de la grille ou un sprite.</p>
            )}
          </div>
          {region && (
            <p className="small mono">
              {region.width} × {region.height} px · depuis {region.x}, {region.y}
            </p>
          )}
          {done > 0 && (
            <p className="notice is-ok">
              <Icon name="check" />
              {plural(done, 'zone ajoutée', 'zones ajoutées')}
            </p>
          )}
        </aside>
      </div>
    </Modal>
  );
}
