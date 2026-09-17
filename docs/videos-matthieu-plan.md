# 94.e — Une page privée pour Matthieu : plan

Petit chantier, ouvert le 2026-09-16 sur demande de Charles : « Ajoute une page
avec accès direct pour Matthieu où je dépose des vidéos qu'il pourra
télécharger. » Go de cadrage donné en conversation (« oui go »).

## Rappel du cadrage

Une page de chalou.link que Matthieu seul voit. Elle liste les vidéos que
Charles a déposées, chacune avec un bouton pour la télécharger. Matthieu ne peut
rien envoyer. La page n'est reliée nulle part sur le site public et n'est jamais
indexée.

Dehors : lecture en ligne, commentaires, formulaire d'envoi, comptes pour
d'autres personnes, sauvegarde des vidéos (les originaux restent sur la station
de Charles — hypothèse à confirmer par lui).

Amendement du cadrage d'origine du chantier 94 : `docs/site-chalou-cadrage.md`
dit « pas de zone privée ». Ce nœud y déroge ; une note datée y est ajoutée.

## Ce que l'étude de terrain a établi (agent planificateur, 2026-09-16)

- Le site est servi par nginx seul, depuis `/var/www/chalou.link/courant`, lien
  vers une version datée. Le service Node ne sert que `/api/`.
- `/var/www/chalou.link/` appartient à `charles` : un sous-dossier s'y crée et
  s'y remplit sans sudo, il hérite du contexte SELinux qu'exige nginx, et
  aucun mécanisme (mise en ligne, webhook FadeBeat, sauvegarde) n'y touche.
  C'est le précédent `fadebeat/`.
- 90 Go libres sur la seule partition, partagée avec la base Mongo.
- Aucun `auth_basic`, `autoindex`, `X-Robots-Tag` ni `robots.txt` aujourd'hui.
  Le vhost pose 4 en-têtes de sécurité au niveau `server` ; tout `location`
  qui ajoute un en-tête doit les réécrire (règle nginx, déjà fait pour
  `/apps/fadebeat/`). La CSP interdit style et script en ligne.
- `htpasswd` n'existe pas sur `hostinger` ; `openssl` oui.
- Les journaux nginx gardent l'adresse et l'identifiant du visiteur.
  *(Cette ligne disait aussi « la page Mentions promet le contraire ». Faux :
  Mentions ne promet ni de ne pas journaliser, ni que Charles ignore qui passe
  — elle parle d'audience, de mouchards et de tiers. Corrigé le 2026-09-17,
  voir la section Sécurité.)*
- fail2ban ne surveille que ssh : rien ne freine un essai de mot de passe.
- `.mkv` n'a pas de type MIME ; `.mp4`, `.mov`, `.webm` en ont un.
- Le site répond en HTTP/1.1 sous TLS ; `Accept-Ranges: bytes` est annoncé.
- Modèle de script de dépôt à imiter : `soleneceramic/selection-app/deploy.sh`
  (tar + ssh, puis contrôles automatiques, puis « Charles valide à l'écran »).

## Choix retenus

1. **Adresse** : `https://chalou.link/videos-<aléa>/` — un segment aléatoire
   de 16 caractères, tiré une fois, gardé dans le coffre. Pas le prénom de
   Matthieu dans l'adresse.
2. **Mot de passe** : Basic Auth nginx, un seul compte `matthieu`, empreinte
   fabriquée par `openssl passwd -apr1` sur la station (jamais le mot de passe
   en argument de commande : leçon du chantier 98 ; lecture depuis un fichier
   à `0600`), fichier `/etc/nginx/.htpasswd-videos` en `root:nginx 0640`.
   Le mot de passe et l'adresse vont dans le coffre ; Charles les transmet
   à Matthieu par un canal séparé.
3. **Dossier** : `/var/www/chalou.link/videos/`, frère de `fadebeat/`,
   propriété `charles`, servi par `alias`. Hors des versions datées.
4. **Liste** : une page `index.html` **générée par le script de dépôt**, dans
   la charte du site (feuille `site.css` déjà servie, donc CSP respectée),
   avec pour chaque vidéo son nom, sa taille lisible, et un lien portant
   l'attribut `download`. Pas d'`autoindex` : page nue sans charset,
   noms tronqués, rien de testable en local.
   Divergence relevée pour Charles : l'`autoindex` est auto-cohérent (la
   liste ne peut pas mentir), la page générée est lisible et testable.
   Reco : page générée, avec un contrôle post-dépôt qui prouve que chaque
   fichier listé répond.
5. **Dépôt** : `deploy/videos-deposer.sh <fichier…>` sur la station :
   copie par `rsync` vers le dossier (reprise possible pour un gros fichier),
   régénération de la page côté station à partir de la liste réelle du
   dossier serveur, envoi de la page, `restorecon`, puis contrôle : chaque
   fichier listé répond 200 avec le mot de passe et 401 sans. Le script
   refuse un fichier qui n'est pas une vidéo (`mp4 mov webm mkv m4v`).
   Le mot de passe de contrôle est lu dans un fichier local à `0600`.
   `videos-retirer.sh <nom>` fait l'inverse (suppression + régénération).
6. **nginx** : un `location /videos-<aléa>/` avec `alias`, `auth_basic`,
   `auth_basic_user_file`, les 4 en-têtes réécrits + `X-Robots-Tag: noindex,
   nofollow, noarchive` + `Cache-Control: private, no-store` +
   `Content-Disposition: attachment` sur les fichiers vidéo, `access_log off`
   et `error_log /dev/null crit` (moins de traces de l'adresse privée dans les
   journaux — voir la section Sécurité : moins, pas aucune), et
   `types { video/x-matroska mkv; }` pour combler le trou MIME. Modification appliquée par
   `nginx-recharger-sur`, qui compare les 4 sites avant/après.
7. **Redirection** : `location = /videos-<aléa>` → 301 vers la forme avec
   barre finale, comme pour `/apps/fadebeat`. Elle porte les mêmes en-têtes que
   le bloc principal : une 301 est cacheable et son `Location:` contient
   l'adresse privée (ajouté le 2026-09-17, après l'audit).

## Sécurité

- Un robot ou un lien qui fuit tombe sur un 401 avant tout contenu ; l'en-tête
  noindex couvre le cas d'un contenu servi.
- Forçage du mot de passe : non freiné par la machine. Remède retenu : deux
  secrets indépendants (segment d'adresse 16 caractères + mot de passe 20
  caractères), ce qui rend l'énumération vaine. Une prison fail2ban sur les
  401 est notée hors périmètre.
- Aucun exécutable sous `/var/www` (leçon payée trois fois sur cette machine) :
  les scripts vivent dans `deploy/` du dépôt et tournent depuis la station.
- Le vhost ne change que par un `location` ajouté ; les 4 en-têtes de
  sécurité y sont réécrits à l'identique.
- Espace disque : le script de dépôt refuse la copie si l'espace libre après
  copie descendrait sous 20 Go (la base Mongo partage la partition).
- **2026-09-17, après l'audit — ce que valent vraiment le segment et les
  journaux.** Ce plan a d'abord justifié `access_log off` par « la page Mentions
  promet que rien n'est gardé sur les visiteurs ». C'est une surinterprétation :
  Mentions dit « il ne mesure pas son audience, il ne dépose aucun mouchard,
  personne d'autre que moi ne sait que vous êtes passé » — **Charles, lui, sait**.
  Et la mesure de l'audit est nette : `access_log off` **réduit** les traces, il
  ne les supprime pas. L'adresse privée s'écrivait encore dans `error_log` (403
  et 404, avec l'IP), et toute requête mal formée — `TRACE`, `../`, un préfixe
  voisin — tombe hors du `location` et repart dans les journaux du `server`.
  S'ajoute l'historique du navigateur de Matthieu, que rien ne contrôle ici.
  **Le segment n'est donc pas un secret fort : c'est un frein à l'énumération.
  Le vrai secret est le mot de passe.** Remède posé le même jour :
  `error_log /dev/null crit;` dans le `location`, avec la limite écrite noir sur
  blanc dans le modèle — ce qui tombe hors du `location` reste journalisé.

## Phases

- [x] Phase 1 — scripts et page (local) : `deploy/videos-deposer.sh`,
  `deploy/videos-retirer.sh`, gabarit de la page, feuille de style si besoin.
  FAIT 2026-09-16 (agent Opus) : quatre scripts (`videos-commun.sh` partagé,
  `videos-page.sh`, `videos-deposer.sh`, `videos-retirer.sh`),
  `videos-nginx.conf.exemple`, `videos-matthieu.md` (procédure),
  `public/styles/videos.css`, `.gitignore`. Captures lues en largeur bureau,
  téléphone et dossier vide. Trois défauts trouvés et corrigés en chemin
  (échappement HTML cassé par bash 5.2, cartes trop hautes au téléphone,
  `index.html` compté comme vidéo).
- [x] Phase 2 — épreuve indépendante (règle zéro, agent épreuvier) sur ce qui
  est scriptable : génération de la page (espaces, accents, apostrophes,
  chevrons dans un nom, dossier vide, fichier non vidéo refusé, taille lisible),
  refus du secret en argument, refus sous le seuil d'espace. Vue échouer avant.
  FAIT 2026-09-16 : `epreuve/epreuve-videos-matthieu.test.js`, 75 cas, banc
  sans réseau. VUE ÉCHOUER : 11 cas rouges sur une seule cause réelle — le
  dépôt s'arrêtait sur un échec de `restorecon` AVANT le contrôle HTTP, avec
  un message rassurant (faute silencieuse). Corrigé dans les trois scripts :
  le contrôle a toujours lieu dès que quelque chose est publié, 15 prime
  sur 14, `restorecon` absent distingué de `restorecon` en échec. Rejeu :
  **75 cas verts sur 75**, aucun vert perdu ; `npm run epreuve` 192/192.
  (Cette ligne a d'abord dit « 85/85 » : c'était le nombre de LIGNES de verdict
  de `node --test`, soit 75 cas plus les 10 suites qui les contiennent. Compté
  et corrigé le 2026-09-17, après l'audit.)
- [x] Phase 3 — production : secrets tirés et mis au coffre, fichier de mots
  de passe posé, dossier créé, `location` ajouté, `nginx-recharger-sur`.
  PORTE : action distante, OK séparé de Charles.
  FAITE le 2026-09-17 vers 04 h 40, par Charles en console (script
  `phase3.sh`, trois passages). Sortie du dernier passage : fichier de mots
  de passe `root:nginx 640`, 1 ligne ; dossier `httpd_sys_content_t` ; map et
  bloc en place ; `nginx-recharger-sur` : les 4 sites 200 avant et après ;
  401 sans mot de passe, 200 avec, 301 sans barre, en-têtes robots,
  no-store et les 4 de sécurité, aucun `Content-Disposition` sur la page,
  un seul `auth_basic` dans nginx, aucune page publique ne nomme l'adresse,
  journal d'accès inchangé ; témoins `.mp4` et `.mkv` déposés par
  `videos-deposer.sh` (401/200/206, `video/mp4`, `attachment`,
  `video/x-matroska`) puis retirés par `videos-retirer.sh` (404) ;
  `systemctl --failed` vide. Deux défauts trouvés PAR LES CONTRÔLES et
  corrigés en chemin : (1) la redirection sans barre finale laissait une
  ligne au journal avec l'adresse secrète → `access_log off` ajouté au
  `location =`, dans le vhost et dans le modèle ; (2) `rsync --archive`
  recopiait des droits 600 et nginx répondait 403 sur la page et les vidéos
  → `--chmod=D755,F644` dans `videos-commun.sh`, épreuve rejouée 75/75.
  Le fichier de mots de passe avait deux lignes au premier passage (ligne
  vide hachée en trop, sans doute) : réduit à la seule ligne `matthieu:`.
- [ ] Phase 4 — premier dépôt réel d'une vidéo de Charles, contrôle au
  navigateur (401 sans mot de passe, liste avec mot de passe, téléchargement
  qui aboutit, reprise `Range`), les 4 autres sites inchangés.
  Chemin complet déjà exercé avec deux témoins en phase 3 ; reste une vraie
  vidéo de Charles et le regard au navigateur.
- [ ] Phase 5 — audit indépendant (l'objet garde quelque chose), puis doc :
  PASSATION, note dans le cadrage 94, `deploy/` documenté, mémoire.

## Critères de recette

1. Sans mot de passe, l'adresse privée répond 401 ; avec, 200 et la liste.
2. Aucune page publique ne contient de lien vers l'adresse privée
   (`grep` sur `public/` et sur la version en ligne).
3. La réponse privée porte `X-Robots-Tag` noindex et `Cache-Control: no-store`.
4. Un fichier nommé avec espace, accent et apostrophe est listé et se
   télécharge (200, taille exacte, somme de contrôle identique à l'original).
5. Une requête `Range` sur une vidéo rend 206.
6. `curl` sur `chalou.link`, `tonik.ink`, `axelise.fr`, `usa.chalou.link`
   rend les mêmes codes avant et après (sortie de `nginx-recharger-sur`).
7. Le script refuse un fichier `.txt`, refuse le mot de passe en argument,
   refuse si l'espace libre passerait sous 20 Go — chacun vu mordre.
8. Après `videos-retirer.sh`, le fichier répond 404 et n'est plus listé.
9. Le journal d'accès nginx ne contient aucune ligne pour l'adresse privée
   après un téléchargement.
10. Le script de dépôt s'exécute en moins de 10 s hors temps de transfert.

## Ce que chaque remède peut casser ou ouvrir

- `location` ajouté : un `alias` mal terminé sert le mauvais dossier ou expose
  `/var/www/chalou.link/` entier → critère 1 et 6, et `nginx -t`.
- `add_header` dans le `location` : efface les 4 en-têtes hérités → réécrits,
  vérifiés par l'audit.
- `access_log off` (+ `error_log /dev/null crit`) : un abus sur cette adresse
  devient invisible → accepté. Ce n'est PAS « aucune trace » : les requêtes qui
  tombent hors du `location` restent journalisées par le `server`, adresse
  comprise (mesuré le 2026-09-17). Ce n'est pas non plus une promesse de la
  page Mentions, qui ne parle que de mesure d'audience et de mouchards.
- Page générée : peut mentir si une copie échoue → le contrôle post-dépôt
  compare liste et réponses HTTP.
- `Content-Disposition: attachment` : empêche toute lecture en ligne, voulu.
- Espace disque : seuil de 20 Go ; au-delà, refus explicite, pas silencieux.

## Coût attendu

Un dépôt = durée du transfert + quelques secondes. Aucune charge sur le service
Node ni sur la base.

## Portes

- Phase 3 (action distante) : OK de Charles.
- Commit, push : OK séparés.

## Amendements en cours de chantier

- 2026-09-17 — **Phase 3 coupée en deux, et faite par Charles en console.**
  Les secrets (§3.1, §3.2 de `deploy/videos-matthieu.md`) ont été tirés par
  Charles lui-même dans Konsole (script `secrets-matthieu.sh` puis reprise,
  après une commande `guichet envoyer` écrite sans le `--` obligatoire) : la
  porte de la station refuse toute ligne `openssl passwd`, même sans secret.
  La partie serveur a été tentée par trois agents et par la session : le mur
  (`~/.claude/hooks/mur.py`) refuse en mode auto toute écriture vers un
  serveur, « sans témoin, la demande vaut refus » ; en mode manuel, chaque
  écriture demande un oui, que Charles refuse d'enchaîner. Aucune écriture
  n'a eu lieu sur le serveur ce jour. Livré à la place : un script unique
  pour Konsole (`scratchpad/p3/phase3.sh`, précédé de `prep.sh` déjà passé)
  qui fait les six écritures, le rechargement par `nginx-recharger-sur`,
  les contrôles des critères 1, 3, 5, 6, 9 et le premier passage réel des
  scripts de dépôt et de retrait sur deux témoins. À lancer par Charles.
  Trouvaille de l'agent : `public/styles/videos.css` n'est pas en ligne tant
  qu'une version du site n'est pas mise en ligne (PASSATION §2) — la page
  s'affiche avec `site.css` et `tokens.css` seulement, à traiter avec le
  commit. Forme d'appel du rechargeur vérifiée sur la machine : nu, sans nom
  de site.

- 2026-09-17 — **Ce que la phase 3 a laissé dans les journaux du serveur, et
  qu'on ne nettoie pas.** Avant que `access_log off` ne soit posé sur la
  redirection, un 301 est passé : **une ligne** porte l'adresse privée dans
  `/var/log/nginx/access.log` (datée 02:31:56 UTC). **Neuf lignes** la portent
  aussi dans `/var/log/nginx/error.log` (403 et 404 d'avant les correctifs, avec
  l'IP). On ne modifie pas un journal à la main : un journal retouché ne vaut
  plus rien comme preuve, et ces lignes partiront d'elles-mêmes avec la
  rotation. Rien à faire, donc — mais c'est écrit, pour que personne ne
  s'étonne de les trouver ni ne croie l'adresse restée hors des journaux.

- 2026-09-17 — **Audit indépendant : sept écarts, corrigés en local le même
  jour.** Le grave : `videos-deposer.sh` pouvait déclarer « ✓ Déposé » un
  fichier jamais arrivé sur le serveur (un lien symbolique passait le test
  `-f -r`, rsync le recopiait comme lien, `find -type f` ne le voyait pas, la
  page ne le listait pas, plus rien à contrôler). Corrigé sur trois fronts :
  refus du lien symbolique avant tout contact réseau (code 4), `--no-links`
  dans le rsync par défaut, et surtout **contrôle de chaque nom qu'on vient de
  déposer contre la liste RÉELLE du dossier distant** — un manquant sort en 15.
  Les autres : `index.html` sortait en 5 au lieu du 6 promis par la table des
  codes ; royaume `auth_basic` réécrit en ASCII ; en-têtes ajoutés au `location`
  de la redirection ; « 85/85 » corrigé en 75 cas ; `.gitignore` resserré sur
  quatre dossiers au lieu de cinq motifs d'extension globaux ; textes sur les
  journaux remis d'aplomb (voir la section Sécurité). Ce qui reste à faire sur
  le serveur : `deploy/videos-matthieu.md`, § « Ce qui reste à faire côté
  serveur ».
