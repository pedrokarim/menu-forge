import { bytesToBitmap } from '../pixel/io';
import { base64ToBytes, generateImage } from './api';
import type { AiProvider } from './api';
import type { Rgb } from './constrain';
import { startJob } from './jobs';
import { TEXTURE_NEGATIVE, textureSystemPrompt } from './prompts';
import { nextGenerationId, rememberTexture } from './session';
import type { TextureGeneration } from './session';

/** Valeurs du formulaire « Générer une texture », gardées avec la tâche. */
export interface TextureJobParams {
  providerId: string;
  prompt: string;
  width: number;
  height: number;
  paletteMode: string;
  autoCount: number;
  removeBackground: boolean;
  tolerance: number;
  cropToSubject: boolean;
  hardAlpha: boolean;
}

/**
 * Lance la génération d’une texture en tâche de fond : une image demandée au
 * fournisseur, puis décodée. La mise aux contraintes (grille, palette,
 * transparence) se fait dans le dialogue, réglable sans nouvelle requête.
 */
export function startTextureJob(params: TextureJobParams, provider: AiProvider, palette: Rgb[]): string {
  const prompt = params.prompt.trim();
  return startJob(
    { kind: 'texture', providerId: provider.id, providerName: provider.name, providerKind: provider.kind, prompt, maxAttempts: 1, params },
    async (control) => {
      control.attemptStarted(1);
      const reply = await generateImage(
        {
          provider: provider.id,
          prompt,
          system: textureSystemPrompt({ width: params.width, height: params.height, palette }),
          negativePrompt: TEXTURE_NEGATIVE,
          width: params.width,
          height: params.height,
        },
        control.signal,
        control.remote,
      );
      control.phase('checking');
      const raw = await bytesToBitmap(base64ToBytes(reply.data), reply.mime);
      control.attemptFinished([]);
      control.phase('rendering');
      const generation: TextureGeneration = {
        id: nextGenerationId(),
        at: Date.now(),
        provider: provider.id,
        providerName: provider.name,
        model: reply.model,
        prompt,
        raw,
        width: params.width,
        height: params.height,
      };
      rememberTexture(generation);
      return { value: generation };
    },
  );
}
