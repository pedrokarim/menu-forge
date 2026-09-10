package dev.menuforge.pack;

import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Map;
import java.util.TreeMap;

/**
 * Ensemble de fichiers virtuels d’un resource pack : chemin relatif à la
 * racine du pack ({@code assets/…}, séparateur {@code /}) → contenu. Facile à
 * injecter dans un pipeline de pack existant, ou à écrire sur disque avec
 * {@link PackWriter}.
 */
public final class GeneratedPack {

  private final Map<String, byte[]> files;

  public GeneratedPack(final Map<String, byte[]> files) {
    this.files = Collections.unmodifiableMap(new TreeMap<>(files));
  }

  /** Pack vide. */
  public static GeneratedPack empty() {
    return new GeneratedPack(Map.of());
  }

  /** Fichiers, triés par chemin. Les tableaux ne doivent pas être modifiés. */
  public Map<String, byte[]> files() {
    return files;
  }

  /** Contenu d’un fichier, ou {@code null}. */
  public byte[] file(final String path) {
    return files.get(path);
  }

  /** Contenu texte (UTF-8) d’un fichier, ou {@code null}. */
  public String text(final String path) {
    final byte[] bytes = files.get(path);
    return bytes == null ? null : new String(bytes, StandardCharsets.UTF_8);
  }

  /** Nouveau pack : ces fichiers, puis ceux de {@code other} (qui gagnent en cas de conflit). */
  public GeneratedPack merge(final GeneratedPack other) {
    final Map<String, byte[]> merged = new TreeMap<>(files);
    merged.putAll(other.files);
    return new GeneratedPack(merged);
  }

  /** Nombre de fichiers. */
  public int size() {
    return files.size();
  }
}
