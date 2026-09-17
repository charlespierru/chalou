# La page privée de Matthieu — mise en place et usage

Une adresse de `chalou.link` que Matthieu seul voit. Elle liste les vidéos que
Charles y dépose, chacune avec un bouton pour la télécharger. Matthieu ne peut
rien envoyer. Elle n'est reliée à aucune page publique et n'est jamais indexée.

Chantier **94.e**, plan : `docs/videos-matthieu-plan.md`.

---

## 1. Les pièces

| Quoi | Où |
|---|---|
| Fabrique la page HTML depuis un dossier | `deploy/videos-page.sh` |
| Dépose une ou des vidéos, puis contrôle | `deploy/videos-deposer.sh` |
| Retire une vidéo, puis contrôle | `deploy/videos-retirer.sh` |
| Fonctions communes aux trois | `deploy/videos-commun.sh` (lu par `source`) |
| Mise en forme de la liste | `public/styles/videos.css` (servie par le site) |
| Bloc nginx à recopier | `deploy/videos-nginx.conf.exemple` |
| Les vidéos, sur le serveur | `/var/www/chalou.link/videos/` |
| Le fichier de mots de passe | serveur : `/etc/nginx/.htpasswd-videos` (`root:nginx 0640`) |
| Les secrets, sur la station | `~/.config/chalou/videos-matthieu.env` (0600) |
| Les secrets, au coffre | `videos-matthieu/segment`, `videos-matthieu/mot-de-passe` |

**Aucun exécutable ne vit sous `/var/www`.** Les trois scripts restent dans ce
dépôt et tournent depuis la station. Cette machine a déjà payé trois pannes de
cette famille : un déploiement par archive recrée les fichiers, et le fichier
neuf hérite de l'étiquette de son dossier — du contenu web, que systemd refuse
d'exécuter.

---

## 2. Le fichier de secrets

Trois lignes, sur la station, en droits **0600** — les scripts refusent de
travailler si les droits sont plus larges.

    VIDEOS_SEGMENT=<16 caractères tirés au hasard>
    VIDEOS_UTILISATEUR=matthieu
    VIDEOS_MOT_DE_PASSE=<20 caractères tirés au hasard>

Chemin par défaut : `~/.config/chalou/videos-matthieu.env`. Un autre chemin se
donne par la variable d'environnement `VIDEOS_SECRETS` — jamais en argument.

Le fichier est **lu, pas exécuté** : les scripts l'analysent ligne à ligne. Un
`source` ferait tourner ce qu'il contient, et un mot de passe qui porterait par
accident `$(` deviendrait une commande.

Le segment ne doit contenir que des lettres, des chiffres, `-` et `_` : il
devient un morceau d'adresse. L'identifiant et le mot de passe ne doivent pas
contenir d'espace : ils passent par un fichier `netrc`, dont les champs sont
séparés par des espaces.

---

## 3. Phase 3 — la mise en place, une seule fois

> **Porte** : tout ce qui suit touche le serveur. OK explicite de Charles avant
> de commencer.

### 3.1 Tirer les deux secrets

Deux secrets indépendants, et c'est voulu : rien ne freine un essai de mot de
passe sur cette machine (fail2ban ne surveille que ssh). Un attaquant doit
donc d'abord deviner l'adresse — 16 caractères — avant même de pouvoir essayer
un mot de passe.

Par le coffre, qui est la maison de ces valeurs :

    guichet ranger videos-matthieu/segment      --longueur 16 --forme hex
    guichet ranger videos-matthieu/mot-de-passe --longueur 20 --forme urlsafe
    guichet controler videos-matthieu/segment          # vérifie la longueur obtenue

Puis les poser dans le fichier de la station, sans jamais les afficher :

    umask 077
    install -d -m 700 ~/.config/chalou
    guichet poser videos-matthieu/segment      ~/.config/chalou/.seg \
            --gabarit 'VIDEOS_SEGMENT={}'
    guichet poser videos-matthieu/mot-de-passe ~/.config/chalou/.mdp \
            --gabarit 'VIDEOS_MOT_DE_PASSE={}'
    { cat ~/.config/chalou/.seg
      echo 'VIDEOS_UTILISATEUR=matthieu'
      cat ~/.config/chalou/.mdp
    } > ~/.config/chalou/videos-matthieu.env
    chmod 600 ~/.config/chalou/videos-matthieu.env
    shred -u ~/.config/chalou/.seg ~/.config/chalou/.mdp

> **Non vérifié à l'écriture de ce document** : la longueur exacte que rend
> `guichet ranger --longueur 16 --forme hex` (16 caractères, ou 16 octets donc
> 32 caractères ?), et le fait que `guichet poser --gabarit` termine le fichier
> par un saut de ligne. L'essayer aurait écrit dans le coffre réel. À contrôler
> à l'œil au premier passage : le fichier doit faire exactement trois lignes.

### 3.2 Fabriquer l'empreinte du mot de passe

`htpasswd` n'existe pas sur le serveur ; `openssl` oui. L'empreinte se fabrique
donc **sur la station**, et le mot de passe n'entre jamais dans une ligne de
commande — le guichet le donne à `openssl` par l'entrée standard :

    umask 077
    guichet envoyer videos-matthieu/mot-de-passe -- openssl passwd -apr1 -stdin \
      > ~/.config/chalou/.empreinte

(Le `--` est obligatoire : sans lui, le guichet prend `-apr1 -stdin` pour ses
propres options et refuse — mesuré au premier passage, le 2026-09-17. Même
passage : `--longueur 20 --forme urlsafe` rend 27 caractères, la longueur
compte des octets avant encodage ; c'est plus long que prévu, pas moins.)
    printf 'matthieu:%s\n' "$(cat ~/.config/chalou/.empreinte)" \
      > ~/.config/chalou/htpasswd-videos

(`openssl passwd` accepte `-stdin` et `-apr1` : vérifié dans le manuel installé,
`man 1 openssl-passwd`.)

### 3.3 Poser le fichier de mots de passe sur le serveur

    scp ~/.config/chalou/htpasswd-videos hostinger:/home/charles/htpasswd-videos
    ssh hostinger 'sudo install -o root -g nginx -m 0640 \
        /home/charles/htpasswd-videos /etc/nginx/.htpasswd-videos \
      && shred -u /home/charles/htpasswd-videos \
      && ls -lZ /etc/nginx/.htpasswd-videos'
    shred -u ~/.config/chalou/htpasswd-videos ~/.config/chalou/.empreinte

Attendu : `-rw-r----- root nginx`. Ni plus large, ni ailleurs.

### 3.4 Créer le dossier des vidéos

    ssh hostinger 'mkdir -p /var/www/chalou.link/videos \
      && chmod 755 /var/www/chalou.link/videos \
      && ls -ldZ /var/www/chalou.link/videos'

`/var/www/chalou.link/` appartient à `charles` : le dossier se crée et se
remplit **sans sudo**, et il hérite du contexte SELinux qu'exige nginx. C'est
le précédent de `fadebeat/`. Il est frère des versions datées du site, jamais
dedans : une mise en ligne ne doit pas emporter les vidéos.

### 3.5 Poser la configuration nginx

Recopier les deux morceaux de `deploy/videos-nginx.conf.exemple` en remplaçant
**partout** `SEGMENT` par la valeur tirée :

1. la `map` dans un fichier neuf, `/etc/nginx/conf.d/videos-matthieu-map.conf` ;
2. les deux `location` dans le bloc `server` de
   `/etc/nginx/conf.d/chalou.link.conf`, entre le bloc
   `location ^~ /apps/fadebeat/` et celui du formulaire de contact.

**Où exactement, et le piège.** Le repère n'est pas `location /api/` : c'est la
**ligne de commentaire qui le précède**, « Le formulaire de contact : seul
morceau qui parle au service… ». Insérer juste avant `location /api/` glisse le
bloc des vidéos ENTRE ce commentaire et le `location` qu'il explique — le
commentaire se met alors à décrire le mauvais bloc, et le prochain lecteur
croira ce qu'il lit. **On insère donc avant la ligne de commentaire**, pas
avant le `location`.

> **Sur le serveur, le bloc posé le 2026-09-17 est à ce mauvais endroit** :
> il a été inséré avant `location /api/`, donc après le commentaire du
> formulaire. nginx s'en moque — l'ordre des `location` ne change rien ici, et
> le site marche. C'est un défaut de lisibilité, pas de fonctionnement : à
> remettre en place lors du prochain passage serveur (voir le § « Ce qui reste
> à faire côté serveur »).

Sauvegarder le vhost avant de l'ouvrir :

    ssh hostinger 'sudo cp -a /etc/nginx/conf.d/chalou.link.conf \
        /root/sauvegardes-chalou/chalou.link.conf.avant-videos.$(date +%Y%m%d-%H%M%S)'

### 3.6 Recharger — et seulement par le script de la maison

    ssh hostinger 'sudo /usr/local/sbin/nginx-recharger-sur'

Il teste la configuration, recharge sans redémarrer, et **compare la réponse
des quatre sites avant et après** ; si le test échoue, il restaure le vhost et
ne touche pas à nginx. Exigence de Charles : « le moindre changement sur un
site n'a aucune répercussion sur les autres ». Ne jamais faire
`systemctl reload nginx` à la main à la place.

> Lire l'en-tête du script sur le serveur pour la forme exacte de l'appel
> (avec ou sans nom de site en argument) : elle n'a pas pu être vérifiée
> depuis la station.

### 3.7 Contrôler à la main ce que les scripts ne contrôlent pas

Les scripts vérifient les codes 401 / 200 / 206 / 404. Trois choses restent à
regarder une fois, à l'œil :

    # a) l'en-tête Content-Disposition tombe sur la vidéo, PAS sur la page
    curl -sI --netrc-file <netrc> https://chalou.link/videos-SEGMENT/          | grep -i disposition   # rien
    curl -sI --netrc-file <netrc> https://chalou.link/videos-SEGMENT/x.mp4     | grep -i disposition   # attachment

    # b) les six en-têtes de la réponse privée
    curl -sI --netrc-file <netrc> https://chalou.link/videos-SEGMENT/ \
      | grep -iE 'content-security|x-content-type|x-frame|referrer|x-robots|cache-control'

    # c) le type MIME d'un .mkv et d'un .css n'ont pas été perdus par le bloc `types`
    curl -sI --netrc-file <netrc> https://chalou.link/videos-SEGMENT/x.mkv | grep -i content-type
    curl -sI                      https://chalou.link/styles/site.css      | grep -i content-type

Et les journaux, qui ne doivent porter **aucune ligne neuve** pour l'adresse
privée après un téléchargement :

    ssh hostinger "sudo grep -c videos-SEGMENT /var/log/nginx/*access*.log"   # 0
    ssh hostinger "sudo grep -c videos-SEGMENT /var/log/nginx/error.log"      # 0

> Les lignes écrites **avant** les correctifs du 2026-09-17 sont encore là :
> une dans `access.log` (le 301 d'avant `access_log off`), neuf dans
> `error.log`. On ne retouche pas un journal à la main ; elles partiront avec
> la rotation. Un compte non nul sur une machine qui n'a pas encore tourné ses
> journaux n'est donc pas forcément une fuite neuve : regarder les dates.

---

## 4. Au quotidien

### Déposer

    ./deploy/videos-deposer.sh ~/Vidéos/répétition.mp4 ~/Vidéos/final.mkv

Une seule commande. Le script refuse d'abord (sans toucher au réseau) ce qui
n'est pas une vidéo, ce qui n'existe pas, **un lien symbolique** (donne le
fichier réel : un lien serait recopié comme lien et n'arriverait jamais), toute
option, et un fichier de secrets absent ou trop ouvert. Puis il mesure l'espace libre du serveur et
**refuse si l'espace restant passerait sous 20 Go** — la base Mongo partage la
partition. Puis il copie par `rsync` (reprise possible sur un gros fichier),
refait la page à partir de la liste RÉELLE du dossier serveur, l'envoie, repose
le contexte SELinux, et contrôle : chaque fichier listé doit rendre 401 sans
mot de passe, 200 avec, 206 sur une requête de plage.

**Ce qu'on vient de déposer est recompté dans le relevé du serveur.** Chaque nom
donné en argument doit figurer dans la liste RÉELLE du dossier distant, sinon le
script sort en 15 en le nommant. Sans ce contrôle, un fichier qui n'arrive
jamais ne serait listé nulle part, n'aurait rien à contrôler en HTTP — et le
script sortirait en 0 avec « ✓ Déposé » (défaut relevé le 2026-09-17).

**Le contrôle a lieu dès que quelque chose est publié**, même si `restorecon`
a refusé : une page en ligne dont personne n'a vérifié ce qu'elle sert est
exactement ce qu'on veut éviter. Si le contrôle rate, le script sort en 15 ;
si seul `restorecon` a raté, il sort en 14 et dit ce qui a été vérifié et ce
qui reste à faire à la main.

Il termine en affichant l'adresse à donner à Matthieu. **Le mot de passe n'est
jamais affiché** : il se transmet par un autre canal que l'adresse.

Extensions acceptées : `mp4 mov webm mkv m4v`.

### Retirer

    ./deploy/videos-retirer.sh 'répétition du 12.mp4'

Le nom, tel qu'il apparaît dans la page — pas un chemin. Le script vérifie que
le fichier est bien là, le supprime, refait et renvoie la page, et contrôle que
l'ancienne adresse rend **404**.

### Quand quelque chose refuse

Chaque refus a son propre code de sortie ; la table complète est en tête de
`deploy/videos-commun.sh`. Les plus courants :

| Code | Ce qui s'est passé |
|---|---|
| 3 | une option a été passée — aucune n'est acceptée, jamais de secret en argument |
| 4 | fichier introuvable, pas un fichier ordinaire lisible, ou **lien symbolique** |
| 5 | ce n'est pas une vidéo (extension) |
| 6 | nom refusé : barre oblique, `..`, caractère de contrôle, ou `index.html` |
| 8 | le fichier de secrets n'est pas en 0600 |
| 10 | il ne resterait pas 20 Go sur le serveur |
| 14 | `restorecon` a refusé, mais le contrôle HTTP a bien eu lieu et il est passé : la page est en ligne et vérifiée, le geste est à refaire à la main |
| 15 | le contrôle HTTP a trouvé une réponse inattendue : la page pourrait mentir. Ce code prime sur le 14 |

---

## 5. Ce qu'il faut savoir

**Les quatre en-têtes de sécurité sont réécrits dans le `location`.** Règle
nginx : un `location` qui pose un seul `add_header` n'hérite plus d'aucun
`add_header` du niveau au-dessus. Si l'un des quatre change dans le bloc
`server`, il faut le changer aussi dans le bloc des vidéos.

**Un bloc `types` dans un `location` remplace la table héritée.** D'où le
`include /etc/nginx/mime.types;` avant le `types { video/x-matroska mkv; }` :
deux blocs `types` dans le même contexte s'additionnent, mais le premier doit
recharger la table standard, sinon la page elle-même part sans `text/html`.

**`Content-Disposition` vide = en-tête non émis.** C'est sur quoi repose la
`map` : la page s'affiche, les vidéos se téléchargent. Ce comportement est
dans le code de nginx, pas dans sa documentation — d'où le contrôle manuel
3.7 a).

**`access_log off` et `error_log /dev/null crit` : moins de traces, pas aucune.**
Ce n'est pas une promesse de la page « Mentions » : elle dit que le site ne
mesure pas son audience, ne dépose aucun mouchard, et que personne d'autre que
Charles ne sait que vous êtes passé — Charles, lui, sait. Ce que l'audit du
2026-09-17 a mesuré, et qui reste vrai :

- une requête qui tombe **hors** de ce `location` — `TRACE`, un chemin avec
  `../`, un préfixe voisin de l'adresse — est journalisée par le bloc `server`,
  avec l'adresse et l'IP ;
- l'historique du navigateur de Matthieu porte l'adresse en clair ;
- les lignes déjà écrites avant les correctifs restent jusqu'à la rotation.

**Le segment n'est donc pas un secret fort : c'est un frein à l'énumération.
Le vrai secret, c'est le mot de passe.** Conséquence assumée des deux
directives : un forçage de mot de passe sur cette adresse est invisible.

**La date affichée est la date du dépôt**, pas celle du fichier d'origine : le
script date les fichiers qu'il vient de déposer. Redéposer exactement le même
fichier fait donc retravailler `rsync`.

**Le tri de la liste est un tri par octets, insensible à la casse.** Un nom qui
commence par un accent se range après les autres. C'est le prix d'une page
identique sur toute machine, donc testable.

---

## 5bis. Ce qui reste à faire côté serveur

L'audit du 2026-09-17 a fait corriger le modèle `deploy/videos-nginx.conf.exemple`
**après** que le vhost a été posé sur la machine. Le site marche, rien n'est
cassé — mais le vhost installé n'est plus le modèle. Quatre écarts, à reprendre
en un seul passage serveur (sauvegarde du vhost, édition,
`nginx-recharger-sur`, puis les contrôles de 3.7) :

| À changer dans `/etc/nginx/conf.d/chalou.link.conf` | Pourquoi |
|---|---|
| `auth_basic "Vidéos de Charles"` → `"Videos de Charles"` | un en-tête HTTP est de l'ASCII ; l'accent y part brut |
| Ajouter les 6 `add_header` au `location = /videos-<segment>` | une 301 est cacheable et son `Location:` porte l'adresse ; un `add_header` dans un `location` annule l'héritage, il faut donc aussi y recopier les 4 de sécurité |
| Ajouter `error_log /dev/null crit;` au `location ^~ /videos-<segment>/` | les 403 et 404 y écrivaient l'adresse privée et l'IP |
| Déplacer le bloc des vidéos **avant** le commentaire du formulaire de contact | il est aujourd'hui inséré entre ce commentaire et son `location /api/` (voir 3.5) |

Aucun de ces quatre points n'empêche la page de servir : ce sont une fuite de
journal, un cache de redirection, un accent dans une fenêtre de mot de passe et
un commentaire qui décrit le mauvais bloc. À faire au prochain passage, pas en
urgence.

---

## 6. Ce qui n'y est pas, volontairement

- **Pas de prison `fail2ban` sur les 401** de cette adresse. Noté hors
  périmètre par le plan ; le remède retenu est la double barrière (adresse
  aléatoire + mot de passe).
- **Pas de `limit_except GET`** dans le bloc nginx. Le module de fichiers
  statiques ne sert de toute façon que `GET` et `HEAD`. À ajouter si un jour
  quelque chose d'autre est servi depuis ce dossier.
- **Pas de sauvegarde des vidéos.** Les originaux restent sur la station de
  Charles — c'est l'hypothèse du cadrage, à confirmer par lui. Le dossier
  `videos/` du serveur n'est dans aucune sauvegarde.
- **Pas de lecture en ligne** : `Content-Disposition: attachment` force le
  téléchargement. Voulu.
