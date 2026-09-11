# Rich Presence Discord

Le studio peut afficher sur le profil Discord ce que l’on y fait (« Joue à
menu-forge », document ouvert, espace de travail, temps écoulé). C’est le
backend qui parle au client Discord, par son canal IPC local
(`studio/backend/src/presence.rs`) : cela marche dans l’appli Tauri comme en
mode navigateur, et une requête HTTP n’attend jamais Discord.

Maquette de la carte de profil, avec toutes les images et la marche à suivre :
[`studio/public/brand/discord/maquette.html`](../studio/public/brand/discord/maquette.html)
(à ouvrir dans un navigateur, aucune ressource réseau).

## Réglages

Dans le studio, **Paramètres → Discord** (section `discord` du fichier de
réglages) :

| Réglage | Rôle |
|---|---|
| `enabled` | active la présence (vrai par défaut) |
| `clientId` | *Application ID* d’une autre application Discord (17 à 20 chiffres) ; `null` (défaut) = l’application officielle **menu-forge**, `1370756359037124698` |
| `showDocument` | affiche le nom du document ouvert ; sinon un texte générique (« Édite un menu ») |

Côté Discord, il faut aussi que **Paramètres utilisateur → Confidentialité de
l’activité → Partager mon activité** soit activé.

## Mise en place dans le portail développeur

L’application officielle **menu-forge** (`1370756359037124698`, constante
`DEFAULT_CLIENT_ID` de `presence.rs`) est utilisée par défaut par l’appli et
par `npm run dev` : sans réglage, la présence marche dès que ses images sont
téléversées. Les tests d’intégration ne la reçoivent pas, et
`studio-api --no-discord` s’en passe (tests de bout en bout) : les tests ne
touchent jamais au vrai profil Discord. Pour une autre application :

1. Sur <https://discord.com/developers/applications>, créer une application
   (son nom est celui que Discord affiche après « Joue à »).
2. *General Information* : copier l’**Application ID** et le coller dans
   Paramètres → Discord → Identifiant d’application.
3. *Rich Presence → Art Assets* : téléverser les huit images de
   `studio/public/brand/discord/`, chacune sous sa **clé exacte** (le nom du
   fichier sans extension, en minuscules), puis enregistrer.
4. Patienter : Discord met quelques minutes à diffuser les nouvelles images.
   En attendant, la carte montre un emplacement vide.

## Clés d’images

Toutes les images sont générées par `studio/scripts/discord_assets.py`
(`python scripts/discord_assets.py` depuis `studio/`, Pillow requis), en pixel
art agrandi au plus proche voisin.

| Clé | Fichier | Taille | Usage |
|---|---|---|---|
| `logo` | `logo.png` | 1024 × 1024 | grande image, toujours envoyée (survol : « menu-forge ») |
| `menu` | `menu.png` | 512 × 512 | petite image : coffre, or – édition d’un menu |
| `asset` | `asset.png` | 512 × 512 | petite image : tableau, bleu – composition d’un asset |
| `home` | `home.png` | 512 × 512 | petite image : maison, vert – accueil |
| `library` | `library.png` | 512 × 512 | petite image : bibliothèque, violet – bibliothèques |
| `settings` | `settings.png` | 512 × 512 | petite image : curseurs, argent – paramètres |
| `workspace` | `workspace.png` | 512 × 512 | petite image : dossier, orange – espaces de travail |
| `about` | `about.png` | 512 × 512 | petite image : information, turquoise – page À propos |

Le backend refuse toute autre clé de petite image (liste `SMALL_IMAGES` de
`presence.rs`) : une clé absente du portail ferait afficher un trou.

## Ce que l’interface envoie : `PUT /presence`

```json
{
  "details": "Édite le menu « Profil »",
  "state": "Espace « enderium »",
  "genericDetails": "Édite un menu",
  "smallImage": "menu",
  "smallText": "Menu"
}
```

| Champ | Type | Rôle |
|---|---|---|
| `details` | texte, obligatoire | première ligne |
| `state` | texte ou `null` | seconde ligne |
| `genericDetails` | texte ou `null` | remplace `details` quand `showDocument` est faux |
| `smallImage` | clé ou `null` | petite image, parmi `menu`, `asset`, `home`, `library`, `settings`, `workspace`, `about` |
| `smallText` | texte ou `null` | texte au survol de la petite image |

Les textes sont nettoyés de la même façon : espaces de bord retirés, texte vide
équivalent à `null`, complétés à 2 caractères, tronqués avec « … » au-delà de
128 (unités UTF-16). Réponse `204` ; `400` pour un champ inconnu, un `details`
manquant, un type inattendu ou une clé d’image inconnue. L’activité est
retenue même si Discord n’est pas lancé, et appliquée à la connexion.

`smallText` doit rester générique (« Menu », « Asset »…) : il n’est pas
remplacé quand `showDocument` est faux.

## Ce que le backend envoie à Discord

```json
{
  "details": "Édite le menu « Profil »",
  "state": "Espace « enderium »",
  "timestamps": { "start": 1789000000 },
  "assets": {
    "large_image": "logo",
    "large_text": "menu-forge",
    "small_image": "menu",
    "small_text": "Menu"
  }
}
```

`timestamps.start` est l’heure de démarrage du backend (Discord en déduit le
temps écoulé). `small_image` n’est présent que si l’interface en a choisi une,
et `small_text` seulement avec elle (Discord n’affiche pas de survol sans
image). Sans activité reçue, `details` vaut « Crée des menus ».

État de la connexion : `GET /presence` → `{ enabled, configured, connected, error }`.
