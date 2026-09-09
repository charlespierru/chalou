# Site chalou.link — passation

Chantier **#94** de l'arbre des plans. État arrêté le **2026-09-08**, fin de la
session qui a construit et mis en ligne le site.

Ce document est écrit pour l'agent qui reprend. Il dit ce qui existe et comment
je le sais, ce qui reste, et surtout les pièges qui ont déjà coûté du temps.

**Règle de lecture** : `(mesuré)` = une commande de la session l'a établi ;
`(supposé)` = tout le reste. Rien de ce qui suit n'est marqué « mesuré » sans
qu'une commande l'ait montré.

---

## 1. Ce qui est en ligne et fonctionne

**Le site** : `https://chalou.link`, six pages — accueil, Tonik, Lutrin,
FadeBeat, contact, mentions. `www` répond, une adresse inconnue rend une vraie
erreur 404 (mesuré).

**Bilingue** : le français est écrit en clair dans les pages, l'anglais vit dans
`public/js/en.js`. 192 textes, aucune traduction manquante, aucune clé orpheline
(mesuré). **L'anglais n'est pas une traduction** : c'est une réécriture, à la
demande de Charles — « les pages doivent être rédigées comme si le site était
nativement en anglais ». Ne pas le retraduire mot à mot.

**Rien d'extérieur** : polices, images et programmes viennent tous du serveur.
Le seul lien sortant des pages est le lien cliquable vers `tonik.ink` (mesuré).
C'est une exigence de Charles, pas un détail d'optimisation.

**FadeBeat** est intégrée telle quelle et s'ouvre en pleine page dans un nouvel
onglet. Une seule ligne diffère du dépôt public : sa bibliothèque de mise en
forme est servie localement au lieu d'un CDN. Ses mots de Charles : « elle
s'appelle FadeBeat, un point c'est tout » — on ne la transforme pas.

**Depuis le 2026-09-09, FadeBeat se met à jour toute seule** (chantier 94.b,
plan `docs/fadebeat-webhook-plan.md`). Un webhook GitHub prévient le site à
chaque push sur le dépôt public ; le service vérifie la signature, va relire
le fichier au sommet RÉEL de master (jamais au commit annoncé par le corps :
une relivraison ancienne remettrait une vieille version), remplace la ligne du
CDN, et écrit d'un seul coup dans `/var/www/chalou.link/fadebeat/` — un
dossier À PART, hors des versions du site, seul endroit où le service a le
droit d'écrire. Si quelque chose rate, l'ancienne version reste en ligne,
GitHub voit l'erreur dans « Recent Deliveries », et Charles reçoit un
courriel. Prouvé le soir même : push → site à jour en 5 s ; échec provoqué
(dossier en lecture seule) → 500, fichier intact, courriel reçu ; relivraison
→ redéploiement du sommet de master. **Conséquence : `public/apps/fadebeat/`
dans ce dépôt n'est plus qu'une graine** — la vérité est sur GitHub, et sur
le serveur dans le dossier dédié. Ce dossier n'est PAS sauvegardé : il est
**reconstruit par un push** (ou une relivraison dans « Recent Deliveries »). Épreuve indépendante :
`epreuve/epreuve-webhook-fadebeat.test.js` (87 cas).

**Le formulaire de contact** livre dans la boîte de réception de
`charles@chalou.link` (mesuré : jeton absent avant l'envoi, présent après, hors
du dossier des indésirables).

**La sauvegarde** tourne toutes les nuits à 04:15, dépose dans l'espace
Backblaze `chalou-backups` — séparé de celui de Tonik, avec une clé qui n'ouvre
que lui —, **relit l'archive déposée** pour vérifier qu'elle porte bien les
messages, puis purge au-delà de 30 jours. Une exécution réelle a réussi de bout
en bout, et un échec provoqué a bien déclenché l'alerte par courriel (mesuré).

## 2. Où sont les choses

| Quoi | Où |
|---|---|
| Sources du site | `/mnt/data/Charles/DevPerso/landing-chalou/` |
| Pages servies | serveur `hostinger` : `/var/www/chalou.link/versions/<date>/`, avec un lien `courant` |
| Code du service | serveur : `/opt/chalou/` — **jamais sous `/var/www`** |
| Réglages du service | serveur : `/etc/chalou/reglages` (0640 root:chalou) |
| Réglages de sauvegarde | serveur : `/etc/chalou/sauvegarde` (0600 root:root) |
| Script de sauvegarde | serveur : `/usr/local/sbin/chalou-backup.sh` |
| Unités | `chalou-site.service`, `chalou-backup.{service,timer}`, `chalou-backup-failed.service` |
| Secrets | coffre : `mongo/chalou-app`, `b2/chalou-backup-writer`, `mail/charles-chalou` |
| Sauvegardes de configuration | serveur : `/root/sauvegardes-chalou/` (vhost et page d'origine, horodatés) |
| FadeBeat servie | serveur : `/var/www/chalou.link/fadebeat/` (`index.html` à `chalou`, réécrit par le webhook ; `tailwind.js` à root) |
| Secret du webhook | serveur : `/etc/chalou/webhook-fadebeat` (root:chalou 640, posé par le guichet) ; coffre : `github/webhook-fadebeat` |
| Webhook GitHub | dépôt `charlespierru/FadeBeat`, réglages → Webhooks, créé à la main par Charles, événement push seul |
| Rechargeur nginx | serveur : `/usr/local/sbin/nginx-recharger-sur` — teste, recharge sans redémarrer, compare les 4 sites avant/après |

**Retour arrière du site** : refaire pointer le lien `courant` vers une autre
version. Quelques secondes, sans toucher à nginx. Le vhost d'origine et la page
d'avant sont dans `/root/sauvegardes-chalou/`.

## 3. Les pièges — chacun a déjà coûté du temps

**Le courrier ne part QUE par la porte authentifiée.** `mx.tonik.ink`, port 587,
TLS exigé, authentification. C'est écrit dans la documentation de Charles
(`vps-tunnel/docs/email/webmail-ajouter-une-boite.md`) : *« envoi : mx.tonik.ink
port 587, TOUJOURS, quel que soit le domaine »*. J'ai commencé par le port 25
sans authentification, par économie de secret : les messages partaient,
arrivaient — et **finissaient tous dans les indésirables**, parce qu'un envoi non
authentifié est traité comme du courrier venu du dehors. Trois refus explicites
sont posés dans `server/src/config.js` pour qu'on ne refasse pas ce chemin : le
service ne démarre pas sans authentification, ni avec une adresse numérique, ni
sur un autre port que 587. **Ne pas les retirer.**

**Le port du service est déclaré, pas emprunté.** 3002, ajouté explicitement à
la politique de sécurité du serveur, à côté du 3001 de Tonik — c'est la
convention de la maison, visible dans la machine : elle ne portait qu'une seule
addition locale avant celle-ci (mesuré). Sans cette déclaration, nginx n'a pas
le droit de joindre le service : erreur 502, **et rien dans le journal de
nginx**.

**Aucun exécutable de service sous `/var/www`.** Trois pannes de cette famille
sur cette machine : un déploiement par archive recrée les fichiers, et le
fichier neuf hérite de l'étiquette de son dossier — du contenu web, que systemd
refuse d'exécuter.

**Tonik répond par Cloudflare, pas par la machine.** Vérifier « tonik.ink
répond » ne prouve rien sur le serveur : Cloudflare répondrait machine à terre
(mesuré). Pour les contrôles de non-régression, interroger la machine
directement, en lui présentant le nom attendu. Sujet ouvert séparément :
**chantier #95**.

**Le journal ne garde pas l'adresse des visiteurs.** La page « mentions » le
promet ; une épreuve indépendante a trouvé que le service la conservait quand
même. Corrigé dans `server/src/server.js`. Si quelqu'un rétablit les
descripteurs de requête par défaut, le site rement.

**Le mot de passe de la base est écrit à deux endroits** : `/etc/chalou/reglages`
et `/etc/chalou/sauvegarde`. S'il tourne, mettre à jour **les deux**. C'est
l'oubli de ce geste qui a rendu les sauvegardes de Tonik muettes six semaines en
mai 2026.

## 4. Ce qui reste à faire

### 4.1 — La zone DNS de `chalou.link` *(le sujet chaud, à traiter en premier)*

> **✅ FAIT le 2026-09-08 — cette section est de l'histoire, pas une liste de tâches.**
> Les deux modifications demandées (« ce qu'il faut obtenir » ci-dessous) ont été saisies
> chez Namecheap à 01:20 par la voie (a) ; un TXT DKIM `mx202609._domainkey` s'y est ajouté
> à 02:30. La zone compte **34 enregistrements** — relevé exhaustif dans
> `DNS-CHALOU-LINK-RELEVE-2026-09-08.md`. La preuve attendue à la fin de cette section
> **est faite** : voir §7bis. Ce qui reste ouvert, c'est la seule question (c) — amener ou
> non la zone chez Cloudflare : **décision de Charles, non prise**.

**Le constat, mesuré.** `chalou.link` n'est pas chez Cloudflare : sa zone est
chez **Namecheap** (`dns1/dns2.registrar-servers.com`), alors que `tonik.ink`
est chez Cloudflare. Le seul jeton du coffre, `cf/edit-dns-tonik-ink`, ne voit
qu'une zone : `tonik.ink`. La documentation de Charles le dit déjà, noir sur
blanc (`vps-tunnel/docs/BASCULE-DU-CENTOS-VERS-ROCKY-PLAN.md`) : *« Le coffre ne
contient aucun accès à IONOS (axelise.fr) ni à Namecheap (chalou.link,
usa.chalou.link). »*

**Ce que porte cette zone** (mesuré, six noms vivants, aucun délégué ailleurs) :

- `chalou.link` et `www` → serveur web `187.124.46.195`
- `usa.chalou.link` → même serveur web
- `mail.chalou.link` → serveur de courrier `187.77.168.112`
- `clannik.chalou.link` → serveur de courrier
- `soleneceramic.chalou.link` → serveur de courrier
- `elise.chalou.link` → **serveur OVH `51.79.85.101`**, le seul qui pointe ailleurs

Plus les enregistrements non-adresse déjà relevés : MX vers `mail.chalou.link`,
SPF `v=spf1 include:spf.brevo.com -all`, DMARC `v=DMARC1; p=quarantine` (sans
adresse de rapport), et un code de vérification Brevo.

**Ce qu'il faut obtenir.** Deux choses, dans cet ordre :

1. **Autoriser le serveur de courrier de Charles à écrire au nom de
   `chalou.link`** — décision prise par Charles le 2026-09-07 : *« oui, autorise
   mon serveur, ne touche pas à Brevo »*. Concrètement, l'enregistrement TXT
   passe de `v=spf1 include:spf.brevo.com -all` à
   `v=spf1 ip4:187.77.168.112 include:spf.brevo.com -all`, c'est-à-dire
   exactement la ligne de `tonik.ink` (mesuré). **Ajout seulement : Brevo
   reste**, et rien de ce qui marche aujourd'hui ne doit tomber.
2. **Ajouter une adresse de rapport à la déclaration DMARC**, comme
   `tonik.ink` en a une. Sans elle, des messages peuvent être écartés partout
   dans le monde sans que Charles l'apprenne jamais.

**Le problème d'accès, et les trois voies** — elles sont dans la documentation
de Charles, pas inventées :

- **(a)** Charles fait la modification à la main chez Namecheap. Deux lignes.
  C'est la voie la plus rapide pour ce soir.
- **(b)** Créer une clé d'accès Namecheap. Pénible une fois, puis tout devient
  automatisable. Réserve écrite dans sa documentation : *« Namecheap conditionne
  l'ouverture de son accès automatisé à des critères de compte, ce qui peut
  échouer. »*
- **(c)** Amener `chalou.link` chez Cloudflare, où l'accès existe déjà et
  fonctionne pour Tonik. Une manipulation unique chez le bureau
  d'enregistrement, et les **six** sous-domaines deviennent administrables.
  Décision structurante — c'est à Charles de la prendre.

**Mon avis, à prendre pour ce qu'il vaut** : (c), parce que le domaine le plus
ramifié de Charles est justement le seul qu'on ne peut pas toucher, et que la
dispersion entre deux fournisseurs a déjà coûté du temps ce soir.

**AVANT tout déplacement de zone** : relever **tous** les enregistrements
existants, un par un, et les consigner. Un déplacement de zone se rate en
perdant un enregistrement qu'on n'avait pas vu. Le relevé ci-dessus est
**incomplet** : il porte sur les adresses et l'autorité, pas sur la totalité des
enregistrements (TXT de vérification, CNAME, éventuels enregistrements de
service). **Ce relevé exhaustif est la première tâche, et il conditionne tout le
reste.**

**La preuve attendue à la fin** : un message réellement envoyé depuis le
formulaire vers une adresse **extérieure** (Free, par exemple), et constaté
reçu — pas « accepté », **reçu**, dans la boîte de réception.

### 4.2 — Le dépôt git

Le dossier `landing-chalou/` **n'est pas encore un dépôt** — `git init` a été
lancé pendant la session mais rien n'a été commité. Le `.gitignore` est écrit et
exclut les fichiers de réglages. Reste : premier commit, puis décision de
Charles sur GitHub (privé, public, ou pas de dépôt distant). **Attention** : le
dossier `deploy/` décrit la production — adresses, ports, chemins, comptes.

### 4.3 — L'audit indépendant du chantier

L'étape 4 du protocole n'a **pas** été faite sur le livré. Le plan a été audité
avant exécution, et une épreuve indépendante a été passée sur le service du
formulaire — elle a trouvé deux vrais défauts, tous deux corrigés. Mais
personne n'a vérifié le résultat final, critère par critère, avec un regard
neuf.

### 4.4 — Les documents faux à réparer

- `vps-tunnel/docs/memoire/chalou_link_dark_intro.md` décrit une animation
  WebGL sur `chalou.link` qui n'existe plus, et **en tire la consigne de ne pas
  signaler le site comme cassé sur la foi d'une capture sombre**. Le site est
  maintenant clair : cette consigne peut faire taire une alerte utile.
- Une mémoire du parc affirme un espace d'échange de 2 Gio sur le serveur ; la
  mesure dit zéro. Toute la justification de la limite mémoire du service repose
  sur cette absence.

Le protocole `reparation` de Charles s'applique aux deux : une réparation n'est
finie que quand plus aucun document n'affirme l'ancien état.

### 4.5 — Plus petit, mais réel

- La documentation de première installation (`deploy/premiere-installation.md`)
  n'existe pas encore : tout ce qui a été fait sur le serveur ce soir n'est
  décrit que dans ce document-ci.
- Le service web n'a **pas** d'alerte en cas d'échec, contrairement à la
  sauvegarde. Un redémarrage en boucle serait invisible.
- L'épreuve indépendante a listé ce qu'elle ne couvre pas : la durée du
  freinage anti-robot, la péremption réelle des messages à 24 mois, la
  concurrence, et une coupure au milieu d'un envoi. Voir
  `epreuve/epreuve-contact.test.js`.

## 5. Comment travailler avec Charles

Trois choses apprises dans la douleur pendant cette session. Elles sont dans les
mémoires du projet ; les relire évitera de refaire mes erreurs.

**« Fais comme X » veut dire : va lire X et reproduis-le.** Pas « conçois un
équivalent ». Si tu penses avoir mieux, dis-le avant de t'en écarter — une
divergence non annoncée est une décision prise à sa place. C'est l'erreur qui a
envoyé tous ses messages dans les indésirables.

**Le problème d'abord, la solution ensuite, et pourquoi ça le règle.** Jamais un
catalogue de dangers. Un document né d'audits successifs devient illisible et ne
lui permet plus de décider.

**Charles est malvoyant.** Réponses courtes, langage clair, un sujet à la fois,
pas de murs de code ni de sorties brutes. Le détail technique reste dans les
fichiers.

**Et surtout, la leçon de cette session** : ce qu'il faut savoir est presque
toujours **déjà écrit sur son disque** — dans `vps-tunnel/docs/`, dans la carte
d'infrastructure (`infra/carte/montre.py`), dans ses mémoires. Chercher avant de
conclure. Deux fois ce soir j'ai décidé sans lire, et deux fois la réponse
était là.

## 6. Outils de la maison à utiliser

- **Les secrets** : `guichet` (`ranger`, `poser`, `envoyer`, `essayer`,
  `controler`). Une valeur ne s'affiche jamais. `guichet essayer` vérifie qu'un
  mot de passe ouvre réellement la porte, au lieu de le supposer.
- **L'état des machines** : `python3 infra/carte/montre.py <machine> <section>`
  depuis `vps-tunnel`, par petits morceaux — jamais la carte entière.
- **L'arbre des plans** : `plan-actif` et `plan-chantier`, dans `vps-tunnel`.
  Attention, défaut connu : le compteur de numéros ignore certains en-têtes et
  peut réattribuer un numéro déjà pris. Vérifier après création.
- **Les API** : `api cf|brevo|hostinger|b2 <MÉTHODE> <chemin>`.

---

## 7. Reprise du 2026-09-08 (nuit) — où on en est

- **Relevé DNS exhaustif FAIT** : `docs/DNS-CHALOU-LINK-RELEVE-2026-09-08.md`,
  33 enregistrements au moment du relevé (mesuré), conforme à BREVO-CHALOU-LINK écart 0.
  **34 depuis 02:30**, avec le TXT DKIM `mx202609._domainkey.chalou.link`.
- **Décision de Charles** : voie (a), modification chez Namecheap, par
  l'extension Chrome pilotée par moi (comme le 2026-08-14). Les deux valeurs
  cibles sont dans le relevé (SPF avec `ip4:187.77.168.112`, DMARC avec
  `rua=mailto:charles@chalou.link`).
- **DNS MODIFIÉ le 2026-09-08 vers 01:20, par l'extension Chrome pilotée par
  moi** : SPF de `chalou.link` = `v=spf1 ip4:187.77.168.112 include:spf.brevo.com -all`,
  DMARC = `v=DMARC1; p=quarantine; rua=mailto:charles@chalou.link`. Visibles sur
  `dns1` ET `dns2.registrar-servers.com`, un seul SPF (mesuré). Les 31 autres
  lignes du panneau intactes (relues avant : 31 lignes, compte attendu).
- **Panne rencontrée avant** : l'extension Chrome parlait à l'application Claude
  de bureau (pont posé le 2026-08-27), pas à Claude Code. Réparé et PROUVÉ par
  la commande `chrome-claude` (`code|bureau|reconnecter|etat`), sans
  redémarrer Chrome. Doc : `vps-tunnel/docs/CHROME-CLAUDE-BRANCHEMENT.md`,
  mémoire `project_chrome_claude_branchement_extension`.
- **Ni le service, ni Brevo n'ont été touchés** *(vrai au moment de la saisie DNS, 01:20 ;
  le serveur a été touché plus tard dans la nuit — voir ci-dessous)*.
- **Découverte utile pour la preuve, vraie jusqu'au 2026-09-08 à 02:40** : le courrier
  `@chalou.link` sortait encore par Brevo côté serveur (`sender_relay`, plan #86 phase 6),
  donc la preuve « reçu chez Free » ne dépendait pas du DNS ; mais le formulaire n'écrit
  qu'à `charles@chalou.link` (`mail.js`) : prouver une arrivée extérieure demandait un
  changement temporaire de `MAIL_TO` sur le serveur, à faire valider par Charles.
  **⚠ Cette phrase n'est plus l'état du serveur** : voir le point suivant.

### 7bis. Fait dans la même nuit — `@chalou.link` sort du serveur, et c'est prouvé

- **02:40 — la ligne `@chalou.link` a été RETIRÉE de `sender_relay` sur `hostingerd`.**
  L'apex ne passe plus par Brevo : il part en direct depuis 187.77.168.112, signé
  `d=chalou.link; s=mx202609` (clé posée à 01:37, TXT DKIM publié à 02:30). Une ligne
  d'adresse complète `invitation@chalou.link` a été ajoutée **avant** ce retrait :
  les invitations Clannik partent toujours par Brevo, témoin réel à l'appui.
- **✅ LA PREUVE EXIGÉE EST FAITE (02:45).** Un message écrit dans le formulaire de
  `chalou.link` est arrivé **en boîte de réception** chez Free (`chypi@free.fr`) : même
  Message-ID que le journal du serveur, premier `Received` externe
  `from mx.tonik.ink ([187.77.168.112])`, `Received-SPF` en succès,
  `brevo`/`sendinblue`/`X-Mailin`/`List-Unsubscribe` comptés à **0**, classement
  `state=HAM score=0`. La fenêtre `MAIL_TO=chypi@free.fr` a duré deux minutes (02:43 →
  02:45) ; le fichier `/etc/chalou/reglages` a été remis et **prouvé identique octet pour
  octet** à son état d'avant, service `chalou-site` actif.
  Rapport complet, mesure par mesure :
  `vps-tunnel/docs/email/chalou-link-autonome-rapport-phases-4-5.md`
  (phases 0 à 3 dans `…-rapport-phases-0-3.md`).
- **Ce que la preuve ne dit pas** : Free n'écrit pas d'en-tête `Authentication-Results`,
  donc **aucun tiers ne déclare `dkim=pass` pour `chalou.link`** à ce jour. Le SPF, lui,
  est déclaré en succès par Free.
- **Deux messages d'essai à supprimer dans la boîte Free de Charles** :
  `CLANNIK-TEMOIN-20260908-P4` et `[chalou.link] CHALOUR1PREUVE20260908`.

**Écart du chantier parent (#94) LEVÉ le 2026-09-08 à 16:12 — deux restes du travail de
la nuit, sur `hostinger`.** Trouvés par l'auditeur indépendant du nœud 94.a
(`vps-tunnel/docs/email/chalou-link-autonome-audit.md`, « trouvailles hors critères ») :
deux fichiers portant des réglages du site étaient restés lisibles trop largement ou au
mauvais endroit. Les deux gestes, mesurés :

1. **`/tmp/poser-reglages.sh` détruit.** C'était le script qui avait servi à poser les
   réglages du site le 2026-09-07 à 21:00 ; il appartenait à `charles` en mode `0644`
   (lisible par n'importe quel compte de la machine) et portait des valeurs sensibles.
   Vérifié avant destruction, sans jamais l'afficher : 1480 octets, 45 lignes, et
   **aucune référence à ce fichier nulle part** — `grep -rl poser-reglages` sur `/etc`,
   `/opt`, `/usr/local` et `/var/spool/cron` ne rend rien, aucune unité systemd ne le
   nomme. Détruit par `shred -u` (écrasement, pas simple suppression) ; `ls` ne le trouve
   plus.
2. **`/etc/chalou/reglages.avant-courrier-587.20260907-214735` sorti de `/etc/chalou/`.**
   Cette sauvegarde de la veille (666 octets, `root:chalou` en `0640`) était lisible par
   tout membre du groupe `chalou`. Déplacée dans `/root/sauvegardes-chalou/`, mise en
   `root:root` et `0600` — plus que `root` la lit. Contrôle après coup : `/etc/chalou/`
   ne contient plus que `reglages` et `sauvegarde`, comme voulu.

Aucun service n'a été touché, aucun contenu de fichier n'a été affiché.

## 8. Fait le 2026-09-09 (soir) — FadeBeat par webhook, et deux trouvailles

Voir la section 1 pour le fonctionnement, la section 2 pour les chemins, et
`docs/fadebeat-webhook-plan.md` pour le plan, sa réfutation et ses
amendements. Ce qui mérite d'être su au-delà :

- **Le secret n'a jamais été affiché ni écrit en argument.** Fabriqué par
  `guichet ranger`, posé sur le serveur par `guichet envoyer` vers un fichier à
  part, contrôlé identique par `guichet controler --contre`, donné à GitHub
  par Charles depuis son presse-papier. Le fichier de réglages ne porte que le
  CHEMIN du fichier de secret (`GITHUB_WEBHOOK_SECRET_FILE`) et le dossier
  (`FADEBEAT_DOSSIER`). Le service refuse de démarrer si le fichier est
  absent ou trop court.
- **Le rechargement de nginx est un script**, `nginx-recharger-sur` : test,
  rechargement sans redémarrage, photo des quatre sites avant et après, refus
  et restauration du vhost si le test échoue. Exigence de Charles : « le
  moindre changement sur un site n'a aucune répercussion sur les autres ».
- **Trouvaille 1 — l'épreuve du formulaire ne tournait plus depuis le
  durcissement du courrier du 2026-09-08. RÉPARÉE le 2026-09-10 (nœud 94.c).**
  Elle dépendait d'un banc lancé à la main (fichier de réglages hors dépôt,
  service, base, faux courrier en clair) que le service refusait depuis le
  garde-fou « nom, port 587, identifiant, TLS ». Elle est désormais AUTONOME,
  sur le modèle de l'épreuve du webhook : faux courrier STARTTLS+AUTH avec
  certificat jetable, module préchargé qui détourne le seul port 587 vers le
  banc, service lancé par l'épreuve, base jetable sur le mongod local de la
  station. Le faux courrier TLS est un module partagé par les deux épreuves,
  `epreuve/epreuve-banc-courrier.js` ; l'ancien faux courrier en clair est
  retiré. Rien du service n'a été touché. Mesuré le 2026-09-10 : formulaire
  30/30 (dont un cas neuf : courrier parti chiffré), webhook 87/87, aucune
  ligne régressée. Lancement : `npm run epreuve`, sans rien préparer.
- **Trouvaille 2 — le courriel d'alerte arrive dans la boîte de réception,
  pas dans le dossier « Alertes »** de Charles. Aucune règle de tri côté
  serveur (mesuré : `doveadm sieve list` vide) ; le tri est donc dans son
  client, sur un motif de sujet inconnu ici. Le sujet des alertes de
  sauvegarde est « [BACKUP FAILED] … ». Résolu le soir même : la règle est
  sur le serveur de courrier (filtre global, règle 5 : sujet contenant
  « [WARN] », « [CRITICAL] » ou « [Vigil] ») ; le sujet des alertes du site
  commence désormais par « [WARN] chalou.link — … » (validé par Charles).
- Le serveur de courrier a livré l'alerte en 3,4 s (mesuré) ; le « retard »
  vu par Charles est celui de son client.

### 8bis. Après l'audit indépendant du 94.b (2026-09-09, 23:30)

Verdict « pas prêt », quatre écarts réels, tous corrigés le soir même :

- **Le freinage était usurpable** : le service faisait confiance à tous les
  sauts (`trustProxy: true`), donc à la valeur la plus à gauche de
  `X-Forwarded-For`, que le client écrit lui-même. Prouvé en production par
  l'auditeur : dix requêtes forgées et les vraies livraisons GitHub auraient
  reçu 429 sans journal ni courriel. Corrigé : le relais de confiance est
  NOMMÉ (`trustProxy: '127.0.0.1'`, nginx sur cette machine). Première
  tentative fausse, `trustProxy: 1` : dans Fastify 5.12 un compte de sauts se
  ferme et tout le monde devient 127.0.0.1 — un seul compteur pour la planète,
  formulaire compris ; attrapé par le second audit, en production, depuis
  deux adresses. Valait aussi pour le formulaire de contact.
- **Deux livraisons rapprochées** pouvaient faire écraser la version neuve
  par l'ancienne, deux 200, zéro alerte. Corrigé : une mise à jour à la
  fois (file), et relecture du sommet juste avant l'écriture — si le sommet a
  bougé pendant le téléchargement, rien n'est écrit, la livraison suivante
  déploie.
- **Le pire cas dépassait 10 s** (délais empilés : 12,5 s). Corrigé : un
  budget global de 8,5 s partagé par l'API et les tentatives sur le brut.
- **Branche ou dépôt renommés = site figé en silence.** Corrigé : un push
  authentique sur une autre branche (pas un tag) ou un dépôt au nom changé
  est ignoré ET signalé par courriel.
- Mineurs : temporaires balayés au démarrage, nom de temporaire aléatoire,
  marque sans horodatage (une relivraison réécrit des octets identiques),
  délai GitHub → 502. Le sujet des alertes commence par « [WARN] » : c'est
  le mot que le filtre global du serveur de courrier (règle 5 de
  `before.sieve` sur hostingerd) reconnaît pour ranger dans « Alertes ».

