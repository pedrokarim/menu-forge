import { NBSP, plural } from '../lib/format';
import type { MenuDefinition } from '../model/menu';
import { generateText } from './api';
import type { AiProvider } from './api';
import { MAX_ATTEMPTS_LIMIT, generateWithCorrections } from './correction';
import { startJob } from './jobs';
import { checkMenu } from './menuCheck';
import type { MenuCheckContext } from './menuCheck';
import { interfaceRequest, interfaceSystemPrompt } from './prompts';
import { nextGenerationId, rememberInterface } from './session';
import type { InterfaceGeneration } from './session';
// Import statique : ce module n’est chargé qu’avec le dialogue (à la demande), et un `import()`
// dynamique échouait quand Vite réoptimisait ses dépendances en cours de session.
import schemaText from '../../../docs/menu.schema.json?raw';

/** Valeurs du formulaire « Générer une interface », gardées avec la tâche. */
export interface InterfaceJobParams {
  providerId: string;
  description: string;
  name: string;
  id: string;
  rows: number;
  attempts: number;
  allowGenerated: boolean;
}

/** Contexte de l’espace de travail au lancement. */
export interface InterfaceWorkspace {
  menus: MenuDefinition[];
  textures: string[];
}

/**
 * Lance la génération d’une interface en tâche de fond : le modèle reçoit le
 * schéma et le contexte de l’espace ; chaque réponse est validée, et corrigée
 * en boucle bornée. Résultat : une `InterfaceGeneration` (menu valide, ou
 * `null` et les dernières erreurs).
 */
export function startInterfaceJob(params: InterfaceJobParams, provider: AiProvider, workspace: InterfaceWorkspace): string {
  const maxAttempts = Math.min(MAX_ATTEMPTS_LIMIT, Math.max(1, Math.round(params.attempts)));
  const prompt = params.description.trim();
  return startJob(
    { kind: 'interface', providerId: provider.id, providerName: provider.name, providerKind: provider.kind, prompt, maxAttempts, params },
    async (control) => {
      const context: MenuCheckContext = {
        schema: JSON.parse(schemaText) as unknown,
        menuId: params.id,
        rows: params.rows,
        textures: new Set(workspace.textures),
        menus: workspace.menus,
        allowGenerated: params.allowGenerated,
      };
      const system = interfaceSystemPrompt({
        schemaText,
        menuId: params.id,
        name: params.name.trim() || params.id,
        rows: params.rows,
        textures: [...workspace.textures].sort(),
        menus: workspace.menus.filter((menu) => !menu.template && !menu.component).map((menu) => menu.id),
        allowGenerated: params.allowGenerated,
      });
      let model = '';
      const outcome = await generateWithCorrections<MenuDefinition>({
        request: interfaceRequest(params.description),
        maxAttempts,
        signal: control.signal,
        send: async (messages, signal) => {
          // Un message de l’utilisateur par essai : la demande, puis chaque correction.
          control.attemptStarted(messages.filter((message) => message.role === 'user').length);
          const reply = await generateText({ provider: provider.id, system, messages, json: true }, signal, control.remote);
          model = reply.model;
          control.phase('checking');
          return reply.text;
        },
        validate: (value) => checkMenu(value, context),
        onAttempt: (attempt) => control.attemptFinished(attempt.errors),
      });
      control.phase('rendering');
      const last = outcome.attempts.at(-1);
      const generation: InterfaceGeneration = {
        id: nextGenerationId(),
        at: Date.now(),
        provider: provider.id,
        providerName: provider.name,
        model,
        prompt,
        menu: outcome.value,
        attempts: outcome.attempts.length,
        errors: outcome.value ? [] : (last?.errors ?? []),
      };
      rememberInterface(generation);
      return {
        value: generation,
        failure: outcome.value
          ? null
          : `Aucun document valide après ${plural(outcome.attempts.length, 'essai')}${NBSP}: reformule la demande ou augmente le nombre d’essais`,
      };
    },
  );
}
