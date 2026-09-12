import { useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, TextareaHTMLAttributes } from 'react';

type GrowingTextInputProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'rows' | 'value'> & {
  value: string;
  /** Texte saisi, sauts de ligne remplacés par des espaces (un nom tient sur une seule ligne logique). */
  onChange: (value: string) => void;
};

/** `field-sizing: content` connu du moteur (Chromium 123 et plus, donc WebView2 à jour). */
const FIELD_SIZING = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

/**
 * Champ texte d’une ligne qui passe à la ligne : une zone de texte à une rangée
 * qui grandit avec son contenu, pour les noms et libellés qui peuvent être
 * longs (un `<input>` n’en montrerait qu’un morceau). Entrée ne crée pas de
 * saut de ligne : elle est transmise à `onKeyDown` comme dans un `<input>`
 * (validation), et un saut de ligne collé devient une espace.
 */
export function GrowingTextInput({ value, onChange, onKeyDown, className, ...rest }: GrowingTextInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Repli sans `field-sizing` : hauteur recalculée à chaque changement de texte ou de largeur.
  useLayoutEffect(() => {
    const node = ref.current;
    if (FIELD_SIZING || !node) return;
    const fit = () => {
      node.style.height = 'auto';
      const borders = node.offsetHeight - node.clientHeight;
      node.style.height = `${node.scrollHeight + borders}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [value]);

  return (
    <textarea
      {...rest}
      ref={ref}
      rows={1}
      className={className ? `growing-text ${className}` : 'growing-text'}
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\r?\n/g, ' '))}
      onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter') event.preventDefault();
        onKeyDown?.(event);
      }}
    />
  );
}
