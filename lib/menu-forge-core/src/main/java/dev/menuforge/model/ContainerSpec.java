package dev.menuforge.model;

import java.util.Objects;

/**
 * Conteneur vanilla qui porte le menu. Seul le coffre ({@code chest}) est pris
 * en charge pour l’instant.
 *
 * @param type type de conteneur ({@code "chest"})
 * @param rows nombre de lignes, de 1 à 6
 */
public record ContainerSpec(String type, int rows) {

  /** Type « coffre ». */
  public static final String CHEST = "chest";
  /** Nombre de colonnes d’un coffre. */
  public static final int COLUMNS = 9;

  public ContainerSpec {
    Objects.requireNonNull(type, "type");
    if (!CHEST.equals(type)) {
      throw new IllegalArgumentException("type de conteneur non pris en charge : " + type);
    }
    if (rows < 1 || rows > 6) {
      throw new IllegalArgumentException("un coffre doit avoir de 1 à 6 lignes (reçu : " + rows + ")");
    }
  }

  /** Un coffre de {@code rows} lignes. */
  public static ContainerSpec chest(final int rows) {
    return new ContainerSpec(CHEST, rows);
  }

  /** Nombre total de slots du conteneur. */
  public int size() {
    return rows * COLUMNS;
  }
}
