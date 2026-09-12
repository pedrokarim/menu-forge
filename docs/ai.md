# Génération par IA (textures et interfaces)

Menu Forge peut demander à une IA une **texture** (pixel art d’interface) ou
une **interface complète** (un `*.menu.json`). Le studio ne fait confiance à
aucun modèle : la texture est ramenée sur la grille des pixels et la palette,
le menu est validé par le même code que les gabarits et les fixtures, et le
résultat s’ouvre dans l’éditeur pour être relu et retouché.

Plusieurs fournisseurs sont gérés, en ligne et locaux ; aucun n’est contacté
tant qu’il n’a pas été **activé** dans Paramètres, section IA.

## Fournisseurs

| Fournisseur | Type | Images | Texte | Modèles par défaut (modifiables) | Clé |
|---|---|---|---|---|---|
| OpenAI | en ligne | oui | oui | `gpt-image-2.5-flare`, `gpt-5.6-luna` | platform.openai.com/api-keys |
| Google Gemini | en ligne | oui | oui | `gemini-3.1-flash-image`, `gemini-3.8-flash` | aistudio.google.com/apikey |
| Anthropic | en ligne | non | oui | `claude-sonnet-5` | platform.claude.com/settings/keys |
| Mistral | en ligne | non | oui | `mistral-large-latest` | console.mistral.ai/api-keys |
| Stability AI | en ligne | oui | non | `core` (ou `ultra`, `sd3`) | platform.stability.ai/account/keys |
| fal | en ligne | oui | non | `fal-ai/flux/schnell` | fal.ai/dashboard/keys |
| Replicate | en ligne | oui | non | `black-forest-labs/flux-schnell` | replicate.com/account/api-tokens |
| ComfyUI | sur ce poste | oui | non | checkpoint `sd_xl_base_1.0.safetensors` | aucune |
| Automatic1111 | sur ce poste | oui | non | checkpoint chargé | aucune |
| Ollama | sur ce poste | non | oui | `llama3.2` | aucune |
| Codex CLI | ligne de commande | oui | oui | celui de Codex | aucune (`codex login`) |

Détail des appels (un fournisseur = un module de `studio/backend/src/ai/providers/`) :

| Fournisseur | Images | Texte | Test de connexion |
|---|---|---|---|
| OpenAI | `POST /v1/images/generations` (`background: transparent`, `output_format: png`, base64) | `POST /v1/chat/completions`, `response_format: json_object` | `GET /v1/models` |
| Google | `POST /v1beta/models/<modèle>:generateContent` (`responseModalities` : texte et image), en-tête `x-goog-api-key` ; modèles `imagen-…` par `:predict` | même route, `responseMimeType: application/json` | `GET /v1beta/models` |
| Anthropic | – | `POST /v1/messages` (`x-api-key`, `anthropic-version: 2023-06-01`) | `GET /v1/models` |
| Mistral | – | `POST /v1/chat/completions`, `json_object` | `GET /v1/models` |
| Stability | `POST /v2beta/stable-image/generate/<service>` en `multipart/form-data`, `Accept: image/*` | – | `GET /v1/user/balance` |
| fal | `POST https://fal.run/<modèle>` (`Authorization: Key …`, `sync_mode`) | – | aucun (pas de vérification gratuite) |
| Replicate | `POST /v1/models/<propriétaire>/<nom>/predictions` (`Prefer: wait`), relue chaque seconde si besoin | – | `GET /v1/account` |
| ComfyUI | flux « texte vers image » envoyé à `POST /prompt`, `GET /history/<id>`, `GET /view` | – | `GET /system_stats` |
| Automatic1111 | `POST /sdapi/v1/txt2img` (WebUI lancé avec `--api`) | – | `GET /sdapi/v1/sd-models` |
| Ollama | – | `POST /api/chat`, `format: json`, `stream: false` | `GET /api/tags` (modèle installé ?) |
| Codex CLI | `codex exec --json` : l’image est prise dans `~/.codex/generated_images` | `codex exec --json -o <fichier>` (évènements JSONL lus pour la progression) | `codex --version` |

**Vérifié** : la forme de chaque requête et la lecture de chaque réponse, par
des fournisseurs factices (serveur HTTP local, `backend/tests/ai.rs`).
**Reste à vérifier avec une vraie clé** : les identifiants de modèles par
défaut (les catalogues changent souvent), la transparence réelle des modèles
d’images, les refus de contenu, la génération d’images de Codex (qui dépend
du compte) et les délais.

## Configuration

Paramètres, section **IA** : une fiche par fournisseur, repliée.

- **Activer** : sans cette case, aucune requête ne part vers ce fournisseur.
- **Clé d’API** (services en ligne) : collée puis rangée dans le trousseau du
  système ; l’interface n’affiche ensuite que « configurée » ou « absente ».
- **Modèle d’image**, **modèle de texte** : vides, les valeurs par défaut.
- **Adresse de l’API** : pour ComfyUI, Automatic1111 et Ollama, l’adresse du
  serveur local (`http://127.0.0.1:8188`, `:7860`, `:11434` par défaut) ; pour
  un service en ligne, un relais éventuel. **Programme** pour Codex : cherché
  dans le `PATH` puis dans `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`.
- **Tester la connexion** : un appel sans génération (liste des modèles…).

Réglages non secrets écrits dans le fichier de réglages, section `ai` (voir
`backend/src/ai/config.rs`) :

```json
"ai": { "providers": { "ollama": { "enabled": true, "imageModel": null, "textModel": "qwen3", "endpoint": null } } }
```

## Où sont les clés

Dans le **trousseau du système**, jamais ailleurs :

- Windows : Gestionnaire d’identifiants (Identifiants Windows), service
  `menu-forge`, compte `ai-<fournisseur>` (`ai-openai`…) ;
- macOS : trousseau de session ; Linux : keyutils.

Jamais dans `settings.json`, jamais dans git, jamais dans les journaux, jamais
renvoyées à l’interface. Une clé que le fournisseur recopierait dans un
message d’erreur est masquée (`••••`). Les tests automatiques et l’option
`--ephemeral-secrets` de `studio-api` gardent les clés en mémoire seulement.

## Ce qui est envoyé

À un fournisseur activé, et seulement quand tu cliques sur **Générer** :

- **Texture** : ta description, les consignes de style (pixel art d’interface
  Minecraft, taille visée, fond transparent), la palette imposée (liste de
  couleurs) et, si le service l’accepte, une liste de défauts à éviter.
- **Interface** : ta description, le schéma `docs/menu.schema.json`, la
  géométrie du coffre (lignes, grille des cases), les **noms** des textures et
  des menus de l’espace (150 textures au plus), un exemple de menu ; puis,
  à chaque correction, la réponse précédente du modèle et la liste des
  erreurs.

Jamais envoyé : les fichiers de l’espace (images, menus, assets), les
réglages, les chemins de ton disque, les clés des autres fournisseurs.
Rien ne part au démarrage du studio.

## Coûts

Les services en ligne facturent chaque génération (images surtout ; une
interface peut demander jusqu’à 5 essais, donc 5 requêtes). Le test de
connexion n’en coûte pas, sauf chez fal, qui n’en a pas (rien n’est envoyé).
ComfyUI, Automatic1111 et Ollama tournent sur ton poste : gratuits, mais
lents sans carte graphique. Codex CLI consomme le quota de ton compte.

## Contraintes : textures

« Générer une texture par IA… » : barre d’outils de l’éditeur de pixels, état
vide du mode Pixels, bibliothèque (bouton de l’en-tête ; menu d’une vignette pour
reprendre sa taille et sa palette).

1. Le modèle reçoit le style imposé (`src/ai/prompts.ts`) et la palette.
2. L’image reçue passe par la chaîne de `src/ai/constrain.ts`, sans canvas
   (aucune prémultiplication) :
   - **fond détouré** : couleur dominante des bords, propagée depuis le
     pourtour (un « trou » fermé de même couleur reste) ; sauté si le modèle a
     rendu une vraie transparence ;
   - **alpha nettoyé** : transparent ou opaque, sans halo ;
   - **recadrage sur le sujet** et placement centré, proportions gardées ;
   - **réduction au plus proche voisin** vers la taille visée (échantillon
     au centre de chaque case : les aplats restent des aplats) ;
   - **palette imposée** : Menu Forge (29 couleurs distinctes), celle de la texture de
     référence, automatique réduite (coupe médiane) ou libre.
3. Aperçu avant et après, réglages modifiables sans nouvelle requête,
   historique des générations de la session.
4. **Ouvrir dans l’éditeur de pixels** crée une image de pixels
   (`pixels/<id>.pixel.json`, PNG exporté dans `textures/pixels/`) à retoucher.

## Contraintes : interfaces

« Générer une interface par IA… » : accueil (en tête des actions rapides),
barre d’outils et menu contextuel de la toile des menus, dialogue « Nouveau
menu » (« Générer par IA… »), état vide. À ne pas confondre avec le
[générateur d’interfaces](generator.md), procédural.

1. Le modèle reçoit le schéma exact, la géométrie, les textures et les menus
   de l’espace. Il peut demander des textures **dessinées par le studio**
   (clé `generator` : panneau, bouton, case, voile, aplat).
2. Sa réponse est lue (JSON brut ou en bloc de code), puis validée
   (`src/ai/menuCheck.ts`) :
   - par le schéma, avec le validateur partagé avec les tests
     (`src/lib/jsonSchema.ts`) ;
   - par les règles de la lib (`MenuValidator`) et de l’éditeur :
     identifiants uniques, texte en `y ≥ 5`, zones dans le coffre, états cités
     par les conditions et les actions, pagination, menus ouverts existants ;
   - par les règles de la génération : identifiant et taille imposés, menu
     autonome (sans `extends` ni `includes`), textures existantes ou générées
     (256 px au plus).
3. En cas d’erreurs, elles sont renvoyées au modèle, avec leur chemin JSON,
   pour correction : **5 essais au plus** (3 par défaut), jamais de boucle.
4. **Ouvrir dans l’éditeur** : les textures générées sont écrites sous
   `textures/generated/<menu>/`, le menu s’ouvre **non enregistré** ; on le
   relit, on le retouche, puis `Ctrl+S`.

## Tâches de fond, progression et annulation

Une génération est une **tâche de fond** (`src/ai/jobs.ts`), tenue au niveau
de l’application, pas par son dialogue :

- **Fermer le dialogue** (croix, Échap ou « Continuer en arrière-plan ») ne
  l’arrête pas, changer d’écran non plus. Plusieurs tâches tournent à la fois
  (une texture et une interface, ou une seconde interface par « Nouvelle
  demande ») : le backend les sert en parallèle.
- **Rouvrir le dialogue** la montre en direct : la phase en clair (« Codex lit
  la demande… », « Codex réfléchit… », « Vérification du menu par le
  schéma… », « Essai 2 sur 3 : correction de 4 erreurs… »), un chronomètre,
  une barre par étapes (Demande, Envoi, Réponse, Schéma, Rendu) dont l’étape
  en cours défile au pixel, et le journal des essais : les erreurs du schéma
  de chaque essai, repliables, puis l’essai en cours. Le formulaire est figé
  pendant ce temps.
- Finie, la tâche garde son **résultat** (ou son échec et son journal) jusqu’à
  ce qu’on l’ouvre dans l’éditeur ou qu’on le **rejette** : le dialogue rouvert
  le remontre. Les générations restent aussi dans l’historique de la session.
- **Annuler la génération** est le seul moyen de l’arrêter : l’interface
  abandonne sa requête et prévient le backend (`POST /api/ai/cancel`), qui
  rend la main aussitôt ; un programme Codex en cours est tué. Rien n’est créé.

**Progression réelle** : pendant l’attente, l’interface lit chaque seconde
`GET /api/ai/progress/<requestId>` (`backend/src/ai/progress.rs`) : une phase
(`queued`, `starting`, `waiting`, `thinking`, `tool`, `writing`, `image`,
`receiving`), le nombre d’évènements reçus et le temps écoulé. Pour un service
HTTP : requête partie, puis réponse en cours de réception. Pour Codex CLI,
lancé avec `--json`, chaque évènement JSONL (`turn.started`, `reasoning`,
`command_execution`, `agent_message`…) fait avancer la phase. Rien de la
demande ni de la réponse n’y passe. La dernière erreur signalée par Codex
devient le message d’échec, et son dernier message sert de repli si `-o` n’a
rien écrit.

Sans animation (`prefers-reduced-motion`) : mêmes informations, picto et
barre immobiles.

## Notifications

Les notifications sont celles de tout le studio (pile en bas à droite,
durées, repli : [Écrans du studio](screens.md#fenêtre-colonnes-et-notifications)).

Une génération en produit :

- au départ, une **progression** « Génération lancée avec Codex CLI… » qui
  suit la phase, avec son chronomètre et « Voir » ;
- à chaque essai refusé, « Essai 1 sur 3 refusé : 5 erreurs, correction en
  cours… » ;
- à la fin, « Interface prête » ou « Texture prête » avec **Ouvrir** (le
  dialogue, sur le résultat), ou un échec en une phrase, sans jargon, avec
  **Voir le détail** ;
- à l’annulation, « Génération annulée ».

Les notifications d’essai et de fin sont omises quand le dialogue de la tâche
est ouvert : il les montre déjà.

**Indicateur** : tant qu’une tâche tourne, le bas du rail montre un picto
animé et le nombre de tâches (« 1 génération en cours » au survol). Un clic
rouvre le dialogue de la tâche, ou propose de choisir s’il y en a plusieurs.

## Délais et erreurs

- Délais : 5 min pour une image, 4 min pour un texte, 10 min pour Codex, 25 s
  pour un test. Aucune nouvelle tentative automatique (un seul repli : sans
  fond transparent si le modèle d’OpenAI le refuse).
- Erreurs en français, avec le statut et un extrait de la réponse, en entier
  dans le dialogue : clé refusée, crédit épuisé, limite de débit, modèle
  introuvable, service injoignable… La notification n’en garde qu’une phrase.

## API locale

Routes du backend (en-tête `X-Menu-Forge: 1` exigé pour tout ce qui n’est pas
une lecture), détaillées en tête de `backend/src/ai/mod.rs` :
`GET /api/ai/providers`, `PUT /api/ai/providers/:id`, `PUT|DELETE /api/ai/keys/:id`,
`POST /api/ai/test/:id`, `POST /api/ai/image`, `POST /api/ai/text`,
`POST /api/ai/cancel`, `GET /api/ai/progress/:requestId`.

## Tests

- `cd studio/backend && cargo test` : fournisseurs factices (un serveur HTTP
  local joue chaque API), clés en mémoire, refus sans envoi, erreurs,
  annulation, progression pendant une génération, lecture des évènements
  JSONL de Codex, persistance des réglages.
- `npm test` : chaîne de contrainte (`tests/ai-constrain.test.ts`),
  validation et boucle de correction bornée (`tests/ai-correction.test.ts`),
  avec un modèle factice ; tâches de fond et notifications
  (`tests/ai-jobs.test.ts`) : phases, essais refusés, fin, annulation, échec.
- `npm run e2e` : scénario `13-ai-jobs.mjs`, avec des fournisseurs simulés
  lents (`e2e/lib/fakeAi.mjs` : un faux Ollama et un faux Automatic1111 dont
  le test libère chaque réponse) : phases, dialogue fermé en cours de route,
  indicateur, notifications, « Ouvrir », « Annuler », deux tâches à la fois,
  et l’audit de mise en page de chaque état à 1024 × 600, 1280 × 800 et
  1600 × 900.

Aucun test n’appelle un vrai fournisseur ni n’utilise une vraie clé.

## Limites

- ComfyUI : un seul flux intégré (checkpoint réglable), pas de flux personnalisé.
- Codex CLI : la génération d’images dépend de ton compte ; le studio prend
  l’image la plus récente de `generated_images` créée pendant l’exécution.
- Pas de retouche guidée (image vers image) ni de génération de plusieurs
  variantes à la fois.
- Une interface générée ne peut ni hériter d’un gabarit ni inclure un
  composant : ajoute-les ensuite dans l’éditeur.
- Les tâches de fond vivent en mémoire : recharger la page ou fermer le
  studio les perd. Le backend, lui, ne voit pas que l’interface est partie :
  une génération en cours (un programme Codex compris) va jusqu’à sa réponse
  ou son échéance.
