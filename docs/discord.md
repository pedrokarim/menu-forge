# Rich Presence Discord

Le studio peut afficher sur le profil Discord ce que l’on y fait (« Joue à
Menu Forge », document ouvert, espace de travail, temps écoulé). C’est le
backend qui parle au client Discord, par son canal IPC local
(`studio/backend/src/presence.rs`) : cela marche dans l’appli Tauri comme en
mode navigateur, et une requête HTTP n’attend jamais Discord.

Maquette de la carte de profil, avec toutes les images et la marche à suivre :
[`studio/public/brand/discord/maquette.html`](../studio/public/brand/discord/maquette.html)
(à ouvrir dans un navigateur, aucune ressource réseau).

## Réglages

Dans le studio, **Paramètres → Discord** (section `discord` du fichier de
réglages) :

| Réglage | Rôle |
|---|---|
| `enabled` | active la présence (vrai par défaut) |
| `clientId` | *Application ID* d’une autre application Discord (17 à 20 chiffres) ; `null` (défaut) = l’application officielle **Menu Forge**, `1370756359037124698` |
| `showDocument` | affiche le nom du document ouvert et l’espace de travail ; sinon un texte générique (« Édite un menu ») et **aucune** seconde ligne |

Une section `discord` invalide dans le fichier de réglages est ignorée seule
(valeurs par défaut, message dans les journaux) : le reste des réglages est
conservé.

Côté Discord, il faut aussi que **Paramètres utilisateur → Confidentialité de
l’activité → Partager mon activité** soit activé.

## Qui fournit l’application, et comment tout couper

`BackendConfig` porte deux champs :

| Champ | `studio-api` | Appli Tauri | Tests d’intégration |
|---|---|---|---|
| `presence` | vrai, faux avec `--no-discord` (ou `MENU_FORGE_NO_DISCORD`) | vrai | vrai ou faux |
| `discord_client_id` (repli) | application officielle | application officielle | `None` |

`BackendConfig::defaults()` renvoie `presence: true` et
`discord_client_id: None` : c’est l’hôte (`studio-api`, l’appli) qui fournit
l’application officielle. Avec `presence` à faux, le backend ne se connecte
**jamais** à Discord, même avec un `clientId` réglé, et `GET /presence`
renvoie `enabled: false`. Les tests de bout en bout lancent `studio-api
--no-discord` : les tests ne touchent jamais au vrai profil Discord.

## Mise en place dans le portail développeur

L’application officielle **Menu Forge** (`1370756359037124698`, constante
`DEFAULT_CLIENT_ID` de `presence.rs`) est utilisée par défaut par l’appli et
par `npm run dev` : sans réglage, la présence marche dès que ses images sont
téléversées. Pour une autre application :

1. Sur <https://discord.com/developers/applications>, créer une application
   (son nom est celui que Discord affiche après « Joue à »).
2. *General Information* : copier l’**Application ID** et le coller dans
   Paramètres → Discord → Identifiant d’application.
3. *Rich Presence → Art Assets* : téléverser les huit images de
   `studio/public/brand/discord/`, chacune sous sa **clé exacte** (le nom du
   fichier sans extension, en minuscules), puis enregistrer.
4. Patienter : Discord met quelques minutes à diffuser les nouvelles images.
   En attendant, la carte montre un emplacement vide.

## Clés d’images

Toutes les images sont générées par `studio/scripts/discord_assets.py`
(`python scripts/discord_assets.py` depuis `studio/`, Pillow requis), en pixel
art agrandi au plus proche voisin.

| Clé | Fichier | Taille | Usage |
|---|---|---|---|
| `logo` | `logo.png` | 1024 × 1024 | grande image, toujours envoyée (survol : « Menu Forge ») |
| `menu` | `menu.png` | 512 × 512 | petite image : coffre, or – édition d’un menu |
| `asset` | `asset.png` | 512 × 512 | petite image : tableau, bleu – composition d’un asset |
| `home` | `home.png` | 512 × 512 | petite image : maison, vert – accueil |
| `library` | `library.png` | 512 × 512 | petite image : bibliothèque, violet – bibliothèques |
| `settings` | `settings.png` | 512 × 512 | petite image : curseurs, argent – paramètres |
| `workspace` | `workspace.png` | 512 × 512 | petite image : dossier, orange – espaces de travail |
| `about` | `about.png` | 512 × 512 | petite image : information, turquoise – page À propos |

**Image de couverture** : `cover.png` (1024 × 576, 16:9), à téléverser dans
*Rich Presence → Image d’invitation Rich Presence → Image de couverture*. Elle
n’a pas de clé : c’est l’image par défaut des invitations. Logo, mot-symbole
« Menu Forge » et rangée des médaillons, sans petit texte (l’invitation la
montre en réduction).

Le backend refuse toute autre clé de petite image (liste `SMALL_IMAGES` de
`presence.rs`) : une clé absente du portail ferait afficher un trou.

## Ce que l’interface doit faire

Toutes les requêtes autres que GET/HEAD vers `/api` portent l’en-tête
**`X-Menu-Forge: 1`** (sinon `403` « En-tête X-Menu-Forge manquant », voir
plus bas).

1. **Envoyer l’activité** (`PUT /presence`) à chaque changement d’écran ou de
   document.
2. **Battement de cœur** : la renvoyer, même inchangée, **toutes les 30 s**.
   Un envoi identique ne réveille pas Discord (rien n’est renvoyé) mais
   repousse l’expiration. Sans envoi depuis **90 s** (`ACTIVITY_TTL`),
   l’activité expire : elle est effacée côté Discord.
3. **À la fermeture de l’onglet** (`pagehide`), appeler `DELETE /presence`
   (par exemple `fetch(…, { method: 'DELETE', keepalive: true, headers: {
   'X-Menu-Forge': '1' } })`) : l’activité est effacée tout de suite. Si cet
   appel se perd, l’expiration prend le relais.

Tant qu’aucun `PUT /presence` n’est arrivé, rien n’est publié (pas
d’activité générique au démarrage du backend).

### `PUT /presence`

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
| `state` | texte ou `null` | seconde ligne (en général l’espace de travail) ; **non envoyée** quand `showDocument` est faux |
| `genericDetails` | texte ou `null` | remplace `details` quand `showDocument` est faux (à défaut : « Crée des menus ») |
| `smallImage` | clé ou `null` | petite image, parmi `menu`, `asset`, `home`, `library`, `settings`, `workspace`, `about` |
| `smallText` | texte ou `null` | texte au survol de la petite image |

Les textes sont nettoyés de la même façon : espaces de bord retirés, texte vide
équivalent à `null`, complétés à 2 caractères, tronqués avec « … » au-delà de
128 (unités UTF-16). Réponse `204` ; `400` pour un champ inconnu, un `details`
manquant, un type inattendu ou une clé d’image inconnue. L’activité est
retenue même si Discord n’est pas lancé, et appliquée à la connexion.

`smallText` doit rester générique (« Menu », « Asset »…) : il n’est pas
remplacé quand `showDocument` est faux.

### `DELETE /presence`

Efface l’activité tout de suite → `204` (même s’il n’y en avait pas). Le
`PUT` suivant ouvre une nouvelle session : son chronomètre repart de zéro.

### `GET /presence`

`{ enabled, configured, connected, error }` : `enabled` est faux si la
présence est désactivée dans les réglages **ou** coupée par `--no-discord` ;
`error` explique pourquoi elle n’est pas connectée (« Discord n’est pas
lancé », canal occupé, « Discord ne répond pas », « Une autre instance de
Menu Forge affiche déjà la présence Discord »…), ou vaut `null`.

## Ce que le backend envoie à Discord

```json
{
  "details": "Édite le menu « Profil »",
  "state": "Espace « enderium »",
  "timestamps": { "start": 1789000000 },
  "assets": {
    "large_image": "logo",
    "large_text": "Menu Forge",
    "small_image": "menu",
    "small_text": "Menu"
  }
}
```

- `timestamps.start` est le début de la **session d’interface** (premier
  `PUT` après le démarrage, une expiration ou un `DELETE`) : Discord en déduit
  le temps écoulé.
- `small_image` n’est présent que si l’interface en a choisi une, et
  `small_text` seulement avec elle (Discord n’affiche pas de survol sans
  image).
- Confidentialité : avec `showDocument` faux, ni `details` d’origine ni
  `state` ne quittent le backend.

## Comportement du fil de présence

| Règle | Valeur |
|---|---|
| Expiration sans battement de cœur | 90 s : activité effacée, connexion fermée, verrou relâché |
| Intervalle minimal entre deux `SET_ACTIVITY` | 4 s (la dernière activité reçue gagne) |
| Renvoi de l’activité inchangée | toutes les 15 s (vérifie que Discord répond) |
| Nouvel essai de connexion | toutes les 15 s ; tout de suite après un changement de réglages |
| Attente maximale d’une réponse de Discord | 5 s, puis connexion abandonnée (« Discord ne répond pas ») et nouvel essai |
| Arrêt (sortie de l’appli, Ctrl+C de `studio-api` sous Windows) | activité effacée et connexion fermée, 2 s au plus |

Les échanges IPC (bloquants dans la crate `discord-rich-presence`) ont lieu
dans un fil d’E/S propre à chaque connexion : un Discord figé ne bloque ni
les requêtes HTTP ni l’arrêt de l’appli. Si le processus est tué, Discord
efface lui-même l’activité à la fermeture du canal IPC.

### Une seule instance à la fois

Plusieurs processus de Menu Forge peuvent tourner (appli, `npm run dev`,
tests…) : un seul pilote Discord. Avant de se connecter, le backend prend un
verrou exclusif sur `menu-forge-discord.lock` dans le dossier temporaire du
système (`std::env::temp_dir()`). Le verrou est gardé tant que la connexion
est ouverte, relâché à la déconnexion (expiration, `DELETE`, désactivation,
arrêt), et libéré par le système si le processus meurt. Une instance sans
verrou ne se connecte pas, réessaie toutes les 15 s et le signale dans
`GET /presence` ; quand la première s’arrête, elle prend le relais.

## Protection contre les requêtes intersites

Le serveur local (`studio/backend/src/server.rs`) refuse en `403` :

- un en-tête `Host` non local ;
- un en-tête `Origin` non local, y compris `Origin: null` ;
- toute requête autre que GET/HEAD vers `/api` sans `X-Menu-Forge: 1`.
