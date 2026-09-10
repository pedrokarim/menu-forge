package dev.menuforge;

/**
 * Exception de base de menu-forge. Toutes les erreurs du noyau en héritent, ce
 * qui permet à un consommateur de les attraper d’un bloc (par exemple pour
 * ignorer un menu invalide sans arrêter le chargement des autres).
 */
public class MenuForgeException extends RuntimeException {

  public MenuForgeException(final String message) {
    super(message);
  }

  public MenuForgeException(final String message, final Throwable cause) {
    super(message, cause);
  }
}
