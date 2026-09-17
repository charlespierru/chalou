# Site vitrine de Charles Pierru (chalou.link) — note de cadrage

Chantier #94 de l'arbre des plans. Étape 1 du protocole de chantier.
Cadrage mené en conversation avec Charles le 2026-09-07.

## Besoin

Charles Pierru est musicien de longue date et développeur. Sa vue a baissé ;
l'arrivée de l'IA lui a permis de **reprendre la programmation**, qu'il
connaissait déjà, et il a tourné cette programmation retrouvée vers des outils
qui l'assistent dans l'apprentissage de **nouveaux instruments**.

Le développement est au service de la musique — jamais l'inverse. C'est le fil
rouge éditorial du site, et il est assumé en page d'accueil, pas en note de bas
de page.

Aujourd'hui, `chalou.link` sert une page unique : une photo, un nom, deux liens
(GitHub, mail). Elle ne dit ni qui il est, ni ce qu'il fabrique, ni où l'essayer.

Le site doit :

1. présenter Charles brièvement — musicien (clarinette, guitare, saxophone,
   percussions), développeur, et l'histoire ci-dessus ;
2. donner envie d'**essayer** ses trois applications, toutes gratuites ;
3. permettre de **le contacter** pour un avis, une amélioration, un bug.

**Action visée chez le visiteur**, dans l'ordre : suivre les liens, essayer les
applis, en parler autour de lui, faire des retours.

### Les trois applications

- **Tonik** — `https://tonik.ink`. Gratuite, non open source. Gammes, accords,
  théorie, rythme, organisation et suivi du travail, entraînement de l'oreille.
  Page de description **généreuse** : c'est l'application phare et la seule
  qu'on essaie directement.
- **Lutrin** — open source, `https://github.com/charlespierru/lutrin`.
  Application de bureau (Tauri), autonome et locale : fiches de travail,
  sessions, niveaux, partitions lues depuis le disque, aucune donnée en ligne.
  Née du module d'organisation du travail de Tonik, devenue un produit à part.
  **Page explicative uniquement** : on dit ce que c'est et d'où ça vient, on
  renvoie vers GitHub, et on précise que l'équivalent s'essaie dans Tonik.
  Pas de bouton « essayer ».
  À écrire honnêtement : le logiciel n'est **pas signé « éditeur vérifié »**
  chez Microsoft (coût disproportionné pour un logiciel gratuit), donc Windows
  affiche un avertissement au lancement. Le visiteur doit le lire chez Charles
  avant de le découvrir sur son écran.
- **FadeBeat** — open source, `https://github.com/charlespierru/FadeBeat`.
  Entraînement rythmique par atténuation progressive des temps, pour
  intérioriser la pulsation. C'est **un seul fichier HTML**, sans installation
  ni serveur : il sera donc hébergé tel quel et **jouable directement sur le
  site**, en plus du lien vers GitHub.

## Périmètre

### Dedans

- Refonte complète du site sur `chalou.link`, **bilingue français / anglais**.
- Structure multi-pages : accueil · Tonik · Lutrin · FadeBeat (avec l'appli qui
  tourne) · contact. Une adresse propre par application, pour qu'un lien puisse
  se coller dans un message ou sur un forum.
- Formulaire de contact qui envoie vers `charles@chalou.link` **et** archive le
  message en base.
- Charte graphique **« Classical Ink »**, reprise de Tonik : palette ivoire /
  encre / bordeaux / bleu / or, Cormorant Garamond en titres, Inter en texte,
  variante sombre déjà prévue par la charte.

### Dehors (explicite)

- **Aucune modification de Tonik**, ni de son code, ni de sa configuration, ni
  de ses données.
- Pas de mode « haute visibilité », pas d'audit d'accessibilité, pas de
  fonctionnalité destinée aux malvoyants : Charles l'a tranché, le site
  s'adresse au public voyant. (HTML sémantique et contrastes corrects restent
  la base normale du métier, ce n'est pas un chantier d'accessibilité.)
- Pas de compte utilisateur, pas de connexion, pas de zone privée.

  > **Note du 2026-09-16 — le nœud 94.e y déroge, sur décision de Charles.**
  > Une page privée à mot de passe a été ajoutée pour Matthieu :
  > `https://chalou.link/videos-<segment>/`, protégée par `auth_basic` nginx,
  > avec un seul compte. Elle est **hors du site public** — aucune page ne la
  > nomme, aucun lien n'y mène, elle n'est pas indexée, elle ne partage avec le
  > site que ses feuilles de style. Le reste de la ligne tient toujours : pas
  > de compte utilisateur, pas de connexion sur le site lui-même.
  > Plan et décisions : `docs/videos-matthieu-plan.md`.
- Pas de blog, pas de lettre d'information, pas de réseaux sociaux.
- Pas de suivi d'audience ni de cookie de mesure.
- Aucune reprise du thème noir et or de la page actuelle : elle est remplacée.

## Contraintes non négociables

### Séparation stricte d'avec Tonik

Le serveur qui sert `chalou.link` est aussi la production de `tonik.ink`
(mesuré : `chalou.link` et `www.chalou.link` résolvent vers 187.124.46.195,
servis par nginx ; la carte du 2026-09-05 montre nginx, mongod et pm2 actifs
sur cette machine). Ce sont **deux sites différents et tout doit être séparé** :

- fichier de configuration nginx distinct ;
- processus distinct, sous un compte système distinct ;
- **base MongoDB distincte, avec son propre compte** — jamais celui de Tonik ;
- journaux distincts ;
- limite mémoire propre, pour qu'un défaut ici ne puisse pas affamer Tonik ;
- aucun secret ni chemin partagé entre les deux.

Précautions de manœuvre, du même socle : contrôle de la configuration nginx
**avant** tout rechargement, rechargement et non redémarrage, sauvegarde
horodatée de toute configuration touchée. Le certificat HTTPS de `chalou.link`
existe déjà (mesuré : le site répond en HTTPS) ; tout ajout de sous-domaine
devra tenir compte du fait que l'outil de renouvellement réécrit lui-même la
configuration nginx.

### Données personnelles

- **Aucune date de naissance publiée**, ni complète ni partielle. Décision de
  Charles : « rien du tout ». La date reste hors du site et hors du dépôt.
- L'adresse `charles@chalou.link` ne doit pas être exposée en clair aux robots.
- Les messages reçus par le formulaire sont des données personnelles de tiers :
  archivage sur le serveur de Charles uniquement, aucun service extérieur.

### Technique

- Pas de framework d'interface, pas d'étape de compilation côté navigateur :
  HTML, CSS et modules JavaScript natifs, servis tels quels. Une page doit
  rester lisible dans un éditeur de texte.
- Le seul code serveur est celui qui est **nécessaire** : formulaire, archivage,
  service des pages.
- Toutes les applications présentées sont **gratuites**. Aucun prix, aucun
  paiement, aucune promesse commerciale sur le site.
- Le dépôt GitHub est donné pour les deux applications open source (Lutrin,
  FadeBeat) ; Tonik n'en a pas et n'en aura pas ici.

## Choix arrêtés pendant le cadrage

> **Correction apportée après validation, le 2026-09-07.** Cette ligne disait
> « Node 24 » quand Charles a donné son go. L'étude de terrain a ensuite mesuré
> que le serveur tourne en Node 22, issu du dépôt de la distribution, et qu'y
> installer Node 24 obligerait à en sortir. La ligne a été corrigée ; ce que
> Charles a validé, c'est le principe « la même pile que Tonik », pas le numéro
> de version. Amendement daté dans `site-chalou-plan.md`.

- **Pile** : Node 22 (celui du serveur, dépôt Rocky), Fastify 5, MongoDB, nodemailer — les mêmes briques que
  Tonik (mesuré dans ses manifestes), pour que Charles ne change pas de monde
  entre ses deux projets. **Sans Vite** : Tonik en a besoin pour de grosses
  bibliothèques (partitions, PDF, sons) que ce site n'utilise pas.
- **MongoDB dès le premier jour**, avec un usage réel : l'archive des messages
  du formulaire. Une base « au cas où » qui ne stocke rien finit par n'être ni
  utilisée ni sauvegardée.
- **Envoi du mail par le Postfix maison**, pas par un service tiers : pas de
  quota, pas de compte à créer, aucun message qui transite chez un inconnu.
- **Bilingue par source unique** : chaque page écrite une fois, les textes dans
  un fichier de traductions, bouton FR|EN qui bascule et retient le choix.
  Écarté : deux jeux de pages `/fr/` et `/en/` — meilleur référencement, mais
  tout existe en double et la version anglaise finit toujours par décrocher.

## Inconnues à étudier en planification

1. **Acheminement du courrier** : par quel chemin le service poste vers le
   Postfix maison, et ce Postfix accepte-t-il une remise pour le domaine
   `chalou.link` ? (Le MX de `chalou.link` pointe vers `mail.chalou.link`
   — mesuré — mais la boîte et son hôte restent à confirmer.)
2. **Protection anti-robot du formulaire**, sans service tiers ni captcha
   d'un grand éditeur : quelles défenses, et à quel prix pour un visiteur
   honnête.
3. **Isolation concrète** sur la machine : compte système, unité de service ou
   pm2, limites mémoire, création de la base et du compte MongoDB dédiés.
4. **Le dossier n'est pas encore un dépôt git** (mesuré) — à initialiser, et à
   décider s'il rejoint GitHub.
5. **Photo de Charles** : garder l'avatar GitHub actuel, ou une vraie photo.
6. **Contenu** : quels instruments sont les « nouveaux » à apprendre, et qui
   relit la version anglaise.
7. **Bascule de l'ancienne page** : à quel moment la page actuelle est
   remplacée, et comment revenir en arrière si besoin.

## Go de Charles

2026-09-07, en conversation, point par point :
- pile serveur et Node pour tout le site : « Tu peux même envisager Node pour
  tout le site » ; MongoDB : « pour l'archivage est une très bonne idée » ;
- séparation des deux sites : « il est bien évident que ce sont deux sites
  différents, tout doit être séparé et sécurisé » ;
- bilingue par source unique : « oui, pars là-dessus » ;
- structure multi-pages, Lutrin en page explicative seule : corrigé et confirmé
  par Charles ;
- date de naissance : « Tu as raison, rien du tout » ;
- fil rouge éditorial dans le bon ordre : « oui, c'est ça » ;
- rédaction de la présente note : « écris la note de cadrage ».
