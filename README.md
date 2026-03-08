# Mario Kart Game Like

Ce repo contient maintenant une base de vrai multijoueur reseau :

- serveur WebSocket dans `server/src/index.ts`
- protocole partage client/serveur dans `shared/multiplayerProtocol.ts`
- client WebSocket navigateur dans `src/state/multiplayerClient.ts`
- menu online avec creation, liste, code de lobby et sortie propre

## Scripts utiles

```bash
npm run dev
npm run dev:host
npm run build
npm run typecheck
npm run typecheck:server
npm run server:dev
npm run server:start
```

## Variables d'environnement

Exemples fournis :

- `/.env.example`
- `/server/.env.example`

Variables front :

- `VITE_MULTIPLAYER_WS_URL`
  - optionnelle
  - si absente, le client utilise automatiquement `ws://<host-du-front>:8787/ws` en dev

Variables serveur :

- `MULTIPLAYER_HOST`
- `MULTIPLAYER_PORT`
- `MULTIPLAYER_WS_PATH`
- `MULTIPLAYER_MAX_WS_PAYLOAD_BYTES`
- `MULTIPLAYER_ALLOWED_ORIGINS`

`MULTIPLAYER_ALLOWED_ORIGINS` permet de fermer immediatement les connexions venant d'origines non autorisees.

## Lancer le multi sur plusieurs PC du meme reseau

1. Sur le PC serveur, recuperer l'IP locale, par exemple `192.168.1.50`.
2. Ouvrir le port `8787` dans le firewall Windows.
3. Ouvrir aussi le port du front si tu sers le jeu depuis ce PC, par exemple `5173`.
4. Lancer le serveur :

```powershell
$env:MULTIPLAYER_HOST="0.0.0.0"
$env:MULTIPLAYER_PORT="8787"
$env:MULTIPLAYER_ALLOWED_ORIGINS="http://192.168.1.50:5173,http://localhost:5173"
npm run server:start
```

5. Lancer le front pour le reseau local :

```powershell
$env:VITE_MULTIPLAYER_WS_URL="ws://192.168.1.50:8787/ws"
npm run dev:host
```

6. Depuis les autres PC, ouvrir `http://192.168.1.50:5173`.
7. Creer un lobby puis rejoindre avec le code a 6 caracteres ou via la liste.

## Mise en production sur Internet

1. Acheter ou configurer un domaine.
2. Servir le front en HTTPS.
3. Exposer le serveur WebSocket derriere un reverse proxy en WSS.
4. Pointer `VITE_MULTIPLAYER_WS_URL` vers `wss://ton-domaine/ws`.
5. Lancer le serveur Node sur une machine publique ou un VPS.
6. Configurer le reverse proxy pour transmettre `/ws` vers le process Node sur `8787`.
7. Limiter `MULTIPLAYER_ALLOWED_ORIGINS` au domaine public du jeu.
8. Ajouter un process manager (`pm2`, service systemd, Docker) pour redemarrer le serveur.
9. Ajouter des logs, de la supervision et une rotation des logs.

Exemple de flux prod :

- front statique via Nginx, Vercel, Netlify ou autre
- serveur WebSocket sur un VPS
- proxy TLS vers `ws://127.0.0.1:8787/ws`

## Integrer le jeu dans un portfolio avec iframe

Cas de ton portfolio :

- page portfolio publiee sur `https://florian-glay.github.io/portfolio/...`
- iframe qui charge `/games/<slug>/index.html`
- serveur multiplayer deploie sur un autre domaine public

Points importants :

1. GitHub Pages sert uniquement le front statique. Le serveur WebSocket Node ne peut pas tourner dessus.
2. Comme le portfolio est en `https`, le serveur multiplayer doit etre expose en `wss://...`.
3. `VITE_MULTIPLAYER_WS_URL` est injecte au build : il faut rebuild le jeu pour la prod, pas reutiliser un build local configure en `localhost`.
4. Le build produit aussi `models/`, `ui/` et autres assets : il faut copier tout le contenu de `dist/`, pas seulement `index.html`.

Exemple de build pour un jeu integre dans `/portfolio/games/marioKartDeluxe/` :

```powershell
$env:MARIOKART_BASE="./"
$env:VITE_MULTIPLAYER_WS_URL="wss://ton-serveur-multiplayer/ws"
npm run build
```

Puis copier le contenu de `dist/` dans :

```text
portfolio/public/games/marioKartDeluxe/
```

Ensuite, dans le portfolio, l'iframe peut continuer a charger :

```text
/portfolio/games/marioKartDeluxe/index.html
```

Et sur le serveur multiplayer, autoriser l'origine du site public :

```text
MULTIPLAYER_ALLOWED_ORIGINS=https://florian-glay.github.io
```

Important :

- mettre uniquement l'origine, sans `/portfolio/fr`
- si le jeu est heberge sur un autre domaine que le portfolio, il faut autoriser l'origine de ce domaine-la

## Ce que le serveur gere deja

- session de reconnexion avec `resumeToken`
- creation et sortie de lobby
- rejoindre un lobby par id ou par code
- host du lobby
- auto-start quand le lobby atteint `12/12`
- etat du lobby et de la course via snapshots
- attente que tous les joueurs aient charge la scene avant le compte a rebours
- synchronisation des poses des joueurs
- synchronisation des joueurs connectes/deconnectes
- synchronisation des caisses, pieces et objets jetables partages
- fin de course reseau quand tous les participants encore presents ont fini

## Limites actuelles

- etat en memoire uniquement : si le serveur redemarre, les lobbies et courses sont perdus
- pas d'authentification compte joueur
- pas d'anti-cheat
- attribution des objets encore pilotee par le client
- progression multi-course du Grand Prix cote serveur a completer
- pas de persistance Redis/Postgres
- pas de matchmaking global

## Pour aller vers un vrai multi robuste

Priorite recommandee :

1. Rendre le serveur autoritaire pour les objets, collisions et classements.
2. Ajouter la progression de toutes les courses du Grand Prix cote serveur.
3. Sortir l'etat des lobbies/races de la memoire vers Redis ou Postgres.
4. Ajouter authentification, moderation et rate limiting.
5. Ajouter tests d'integration client/serveur.
6. Ajouter monitoring et deploiement automatise.


## Test sur machine pour double écran à partie différente
  1. Console 1 :
    npm run server:start

  2. Console 2 :
    PowerShell :
    $env:VITE_MULTIPLAYER_WS_URL="ws://localhost:8787/ws"
    npm run dev

    cmd.exe :
    set VITE_MULTIPLAYER_WS_URL=ws://localhost:8787/ws
    npm run dev
