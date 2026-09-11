// Chargé par `npm test` (`node --import`) : Node exécute le TypeScript du
// studio en retirant les types, mais ses imports n’ont pas d’extension (mode
// « bundler ») ; ce crochet essaie `<chemin>.ts` quand la résolution échoue.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../');
      if (relative && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});
