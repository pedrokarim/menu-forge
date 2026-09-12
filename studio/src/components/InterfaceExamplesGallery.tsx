import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { NBSP, plural } from '../lib/format';
import { WINDOW_WIDTH, windowHeight } from '../model/geometry';
import { FAMILY_ORDER, FAMILY_SHORT_LABELS, exampleOptions, filterExamples } from '../model/interfaceExamples';
import type { InterfaceExample } from '../model/interfaceExamples';
import { INTERFACE_KINDS, INTERFACE_KIND_ORDER, LAYOUT_LABELS, generateInterface } from '../model/interfaceGenerator';
import type { InterfaceKind, StyleFamily } from '../model/interfaceGenerator';
import { DEFAULT_PREVIEW } from '../model/preview';
import { drawInterfacePreview } from './interfacePreview';
import type { TextureCache } from './interfacePreview';

/** Mot compté par le réglage « boutons » d’un type (singulier, pluriel). */
const BUTTON_WORDS: Record<InterfaceKind, [string, string]> = {
  shop: ['bouton', 'boutons'],
  grid: ['bouton', 'boutons'],
  confirm: ['choix', 'choix'],
  list: ['bouton', 'boutons'],
  tabs: ['onglet', 'onglets'],
};

/** Réglages d’un exemple en une ligne : lignes, boutons, disposition. */
function settingsLine(entry: InterfaceExample): string {
  const [singular, pluralForm] = BUTTON_WORDS[entry.kind];
  const parts = [plural(entry.rows, 'ligne')];
  if (entry.buttons === 0) parts.push(`aucun ${singular}`);
  else parts.push(plural(entry.buttons, singular, pluralForm), LAYOUT_LABELS[entry.layout].toLowerCase());
  return parts.join(' · ');
}

/**
 * Vignette d’un exemple, rendue par la fonction de l’aperçu du dialogue à
 * l’échelle 1 (pixelisée à l’affichage), et seulement une fois visible.
 */
function ExampleThumbnail({ entry, root, textures }: { entry: InterfaceExample; root: RefObject<HTMLDivElement | null>; textures: TextureCache }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || visible) return;
    // Un onglet masqué (`hidden`) ne croise rien : ses vignettes attendent qu’on l’affiche.
    const observer = new IntersectionObserver(
      (records) => {
        if (!records.some((record) => record.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      { root: root.current, rootMargin: '160px 0px' },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [visible, root]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!visible || !canvas) return;
    // Une vignette par image : l’ouverture et le défilement restent fluides.
    const frame = requestAnimationFrame(() => {
      drawInterfacePreview(canvas, generateInterface(exampleOptions(entry, 'exemple')), DEFAULT_PREVIEW, { scale: 1, showSlots: false, textures });
      setDrawn(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, entry, textures]);

  return (
    <canvas
      ref={canvasRef}
      className="example-canvas"
      width={WINDOW_WIDTH}
      height={windowHeight(entry.rows)}
      data-drawn={drawn ? 'true' : undefined}
      aria-hidden="true"
    />
  );
}

interface FilterOption<T> {
  value: T | null;
  label: string;
}

/** Filtre : libellé dans la colonne commune, options à côté (elles passent à la ligne sous elles-mêmes). */
function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: FilterOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  return (
    <div className="example-filter" role="group" aria-label={label}>
      <span className="example-filter-label" aria-hidden="true">
        {label}
      </span>
      <span className="example-filter-options">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value ?? 'all'}
              type="button"
              aria-pressed={active}
              className={`example-filter-option ${active ? 'active' : ''}`}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </span>
    </div>
  );
}

const KIND_FILTERS: FilterOption<InterfaceKind>[] = [
  { value: null, label: 'Tous' },
  ...INTERFACE_KIND_ORDER.map((kind) => ({ value: kind, label: INTERFACE_KINDS[kind].label })),
];
const FAMILY_FILTERS: FilterOption<StyleFamily>[] = [
  { value: null, label: 'Toutes' },
  ...FAMILY_ORDER.map((family) => ({ value: family, label: FAMILY_SHORT_LABELS[family] })),
];

interface InterfaceExamplesGalleryProps {
  selectedKey: string | null;
  /** Clic : les réglages de l’exemple remplissent le formulaire. */
  onSelect: (entry: InterfaceExample) => void;
  /** Double-clic : le menu est créé directement. */
  onUse: (entry: InterfaceExample) => void;
}

/** Galerie des exemples du générateur : filtres par type et par famille, vignettes rendues en direct. */
export function InterfaceExamplesGallery({ selectedKey, onSelect, onUse }: InterfaceExamplesGalleryProps) {
  const [kind, setKind] = useState<InterfaceKind | null>(null);
  const [family, setFamily] = useState<StyleFamily | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [textures] = useState<TextureCache>(() => new Map());
  const entries = filterExamples(kind, family);

  return (
    <div className="interface-examples">
      <div className="example-filters">
        <FilterGroup label="Type" options={KIND_FILTERS} value={kind} onChange={setKind} />
        <FilterGroup label="Famille" options={FAMILY_FILTERS} value={family} onChange={setFamily} />
      </div>
      <p className="muted example-hint">
        {plural(entries.length, 'exemple')} · Clic{NBSP}: charger ses réglages · Double-clic{NBSP}: créer le menu
      </p>
      <div ref={scrollerRef} className="example-grid" role="radiogroup" aria-label="Exemples d’interfaces">
        {entries.length === 0 && <p className="muted">Aucun exemple pour ce type dans cette famille.</p>}
        {entries.map((entry) => {
          const selected = entry.key === selectedKey;
          const kindLabel = INTERFACE_KINDS[entry.kind].label;
          const familyLabel = FAMILY_SHORT_LABELS[entry.family];
          return (
            <button
              key={entry.key}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${entry.name}, ${kindLabel}, ${familyLabel}, ${entry.accentLabel}`}
              data-example={entry.key}
              className={`example-card ${selected ? 'selected' : ''}`}
              onClick={() => onSelect(entry)}
              onDoubleClick={() => onUse(entry)}
            >
              <span className="example-thumb">
                <ExampleThumbnail entry={entry} root={scrollerRef} textures={textures} />
              </span>
              {/* Nom en haut, pied (type, famille, accent ; réglages) en bas : les pieds d’une rangée s’alignent. */}
              <span className="example-caption">
                <strong className="example-name">{entry.name}</strong>
                <span className="example-footer">
                  <span className="example-line">
                    {kindLabel} · {familyLabel} ·{' '}
                    <span className="example-accent">
                      <span className="example-swatch" style={{ background: entry.accent }} aria-hidden="true" />
                      {entry.accentLabel}
                    </span>
                  </span>
                  <span className="example-line">{settingsLine(entry)}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
