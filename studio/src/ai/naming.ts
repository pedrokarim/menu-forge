/** Longueur maximale, en caractères, d’un nom d’image tiré d’une description. */
export const PROMPT_NAME_LIMIT = 40;

/** Ponctuation qui ne peut pas finir un nom : virgule, deux-points, tirets, guillemet ouvrant… */
const DANGLING_END = /[\s,;:.…!?\-–—/(«"'’]+$/u;

/**
 * Nom d’image proposé à partir d’une description : espaces ramenés à un
 * seul, coupé au dernier mot entier qui tient dans `limit` caractères, sans
 * ponctuation pendante à la fin et sans « … » (c’est un nom, pas un aperçu).
 * Un premier mot plus long que la limite est coupé net : rien de mieux à
 * proposer. Renvoie une chaîne vide si la description ne contient aucun mot.
 */
export function nameFromPrompt(prompt: string, limit = PROMPT_NAME_LIMIT): string {
  const text = prompt.trim().replace(/\s+/g, ' ');
  let name = text;
  if (text.length > limit) {
    // Le caractère qui suit la limite compte : une espace à cet endroit garde le dernier mot entier.
    const space = text.slice(0, limit + 1).lastIndexOf(' ');
    name = space > 0 ? text.slice(0, space) : text.slice(0, limit);
  }
  return name.replace(DANGLING_END, '');
}
