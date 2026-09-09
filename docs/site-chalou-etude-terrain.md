# Étude de terrain — chantier #94, site vitrine chalou.link

Étape 2 du protocole de chantier. Rendue le 2026-09-07 par l'agent
`planificateur`, en lecture seule, sans aucune connexion SSH. Déposée ici par la
session principale : le planificateur n'a pas le droit d'écrire, et il l'a
signalé plutôt que de contourner.

Chaque affirmation porte sa marque : `(mesuré)` = une commande de l'étude
l'établit ; `(supposé)` = tout le reste.

## 1. La charte graphique « Classical Ink »

**Fichiers sources** (mesuré, lus en entier) :
`tonik/packages/frontend/src/styles/tokens.css` (1 594 o, 71 lignes),
`base.css` (1 957 o, 113 lignes), `fonts.css` (494 o), `app.css` (16 781 o, 794 lignes).

**tokens.css** (mesuré) : 12 variables de palette (`--ink-ivory #f6f1e7`,
`--ink-cream`, `--ink-paper`, `--ink-black #1a1612`, `--ink-muted`, `--ink-faint`,
`--ink-hairline`, `--ink-burgundy #6b1f2e`, `--ink-burgundy-deep`,
`--ink-blue #1a3a5c`, `--ink-blue-deep`, `--ink-gold #b08740`) ; 3 familles
typographiques (`--font-display` Cormorant Garamond, `--font-ui` Inter,
`--font-musical` Bravura Text) ; 9 tailles (`--text-xs` → `--text-hero` 6rem) ;
9 espacements base 4 px ; 3 durées + 1 courbe
(`--ease-confident: cubic-bezier(0.22, 1, 0.36, 1)`) ; `--hairline`,
`--radius-sm: 2px`, `--radius-md: 4px`.

**Variante sombre** (mesuré, tokens.css l. 56-71) : pilotée **uniquement** par
`@media (prefers-color-scheme: dark)`, qui redéfinit les 12 variables sur
`:root`. Aucune classe `.dark`, aucun attribut `data-theme`, aucun interrupteur
manuel nulle part dans le dépôt frontend. **Conséquence** : reprendre la charte
donne le mode sombre gratuitement, mais un bouton clair/sombre serait un ajout,
pas une reprise.

**Polices — Google Fonts, pas d'auto-hébergement** (mesuré). Cormorant Garamond
et Inter sont chargées depuis le CDN Google en trois endroits identiques :
`packages/frontend/index.html:13-17`, `public/notice/index.html:8-11`,
`public/notice/en/index.html:8-11`. Famille demandée : Cormorant Garamond
(italique et normal, graisses 400/500/600) et Inter (400/500/600), avec
`display=swap` et deux `<link rel="preconnect">`.
Seule police auto-hébergée : `public/fonts/BravuraText.woff2`, 335 660 octets,
licence SIL Open Font License, source `github.com/steinbergmedia/bravura`,
servie sur `/fonts/`. Elle sert aux glyphes ♯ ♭ ♮ — **sans objet pour un site
vitrine**.
La page `chalou.link` actuelle charge elle aussi Google Fonts (Cormorant
Garamond + **DM Sans**, pas Inter).

**Composants réutilisables déjà présents dans `app.css`** (mesuré) — ils
couvrent presque exactement les besoins du site :
- En-tête : `.app-header` (flex, space-between, `max-width: 1100px`, filet
  inférieur en `color-mix`), `.app-brand` (Cormorant 600, bordeaux au survol),
  `.app-nav`.
- **Bascule de langue déjà stylée** : `.locale-toggle`, `.locale-btn`,
  `.locale-btn.active`, `.locale-sep` — capitales, `letter-spacing: 0.18em`,
  actif en `--ink-black`, inactif en `--ink-faint`. C'est littéralement le
  bouton FR|EN du cadrage.
- Boutons : `.btn-primary` (fond encre, texte ivoire, bordeaux au survol, état
  `:disabled`), `.btn-ghost`, `.btn-danger`, `.btn-link`.
- Pied de page : `.legal-footer` (Cormorant italique, `margin-top: auto`, filet
  supérieur), `.legal-link`, `.legal-sep`.
- Formulaire : `.field`, `.field-hint`, `.field-check`, `.field-password`,
  `.auth-form`, `.auth-error`, `.auth-success`.
- Cartes : `.resume-card` / `.resume-cards` (grille eyebrow + titre + glyphe),
  `.coming-soon-card`. **Pas de classe `.card` générique** — les cartes sont
  contextuelles.
- Page de texte long : `.legal-page` (`max-width: 44rem`), `.legal-article` —
  bon patron pour les pages de description.

**base.css** (mesuré) : reset universel ; `html` en `--font-ui` / 16 px /
line-height 1.55 ; `h1`-`h4` en `--font-display` (h1 = `--text-hero` 6rem,
poids 600) ; `em` en Cormorant italique ; `a` en bordeaux souligné au survol ;
`button` cerclé filet ; `:focus-visible` outline bordeaux 2 px ; `::selection`
bordeaux/ivoire.

## 2. Le patron backend de Tonik

**`packages/backend/src/server.js`** (mesuré, 78 lignes) : Fastify configuré
avec `logger: true`, `trustProxy: true`, et le nettoyage des champs superflus en
production. `trustProxy` est indispensable derrière nginx, sinon le limiteur de
débit voit toutes les requêtes venir de 127.0.0.1 — le commentaire du fichier le
dit explicitement. Ordre d'enregistrement : CORS → cookie → limiteur de débit →
authentification → routes. La connexion à la base et la création des index sont
faites **avant** la construction de l'application. Écoute sur
`host: '127.0.0.1'` — **jamais sur l'interface publique**. Arrêt propre sur
SIGINT/SIGTERM.

**Fichiers statiques : Tonik n'en sert AUCUN** (mesuré). `@fastify/static` est
**absent** du fichier de verrouillage des dépendances. C'est nginx qui sert le
dossier construit du frontend. Divergence à trancher pour le site vitrine.

**MongoDB** (mesuré, `src/db.js`) : client unique partagé, délai de sélection du
serveur à 5 secondes, plus les fonctions d'accès, de fermeture et de test de
vie.

**Configuration** (mesuré, `src/config.js` + `package.json`) : Node lit lui-même
le fichier de configuration au démarrage, sans bibliothèque tierce. Le module de
configuration valide puis **gèle** l'objet ; il refuse de démarrer si le secret
des cookies manque ou vaut encore le gabarit, et en production si l'un des
réglages de messagerie manque — le commentaire précise : « il l'a fait pendant
huit minutes le 2026-09-02 ». Réglages lus : environnement, port (défaut 3000),
URL et nom de la base Mongo, secret de cookie, origine CORS, URL du site, hôte /
port / utilisateur / mot de passe SMTP, adresse d'expéditeur.
Aucun fichier de configuration réel n'a été lu, pas même les exemples (règle
secrets) : la liste vient du code qui les lit.

**nodemailer** (mesuré, `src/email/sender.js`) : transport créé paresseusement,
`secure: false` et `requireTLS: true` — c'est-à-dire connexion en clair sur le
port 587, élevée par STARTTLS, et refusée si le serveur ne l'offre pas — avec
authentification par identifiant et mot de passe. Le commentaire du fichier
précise : « la production pointe notre propre `mx.tonik.ink` depuis le chantier
#86 (2026-09-02) ».

**Limitation de débit** (mesuré, `src/plugins/rateLimit.js`) :
`@fastify/rate-limit` v10.3.0, global, 60 requêtes par minute et par adresse IP,
compteurs **en mémoire**, réponse 429 structurée. Surcharges documentées :
inscription 5/min, connexion 10/min.

**Versions verrouillées** (mesuré) : fastify 5.8.5, `@fastify/rate-limit`
10.3.0, `@fastify/cookie` 11.0.2, `@fastify/cors` 11.2.0, `@fastify/multipart`
10.0.0, mongodb 7.1.1, nodemailer 9.0.3, argon2 0.44, jsonwebtoken 9.0.3.

**Version de Node — écart avec le cadrage** : `tonik/package.json` exige `>=22`
(mesuré) ; `.nvmrc` dit `24` (mesuré) ; la station locale a v24.15.0 (mesuré) ;
**le serveur `hostinger` a `node v22.23.2`, `npm 10.9.8`** (mesuré, carte, photo
du 2026-09-05). La mémoire `vps_hostinger.md` précise que Node vient désormais
du dépôt Rocky (`nodejs-22.23.1-4.el10_2`) et suit donc les correctifs de la
distribution. **Le « Node 24 » du cadrage n'existe pas en production**, et l'y
installer signifierait sortir du dépôt de la distribution — l'inverse de ce que
le chantier #35.d a fait.

## 3. Le déploiement de Tonik — et SELinux

Dossier `tonik/deploy/` lu en entier (8 fichiers).

**Arrivée sur le serveur** (mesuré, `deploy.sh`, 108 lignes) : construction en
local → archive `tar` avec exclusions (dépendances installées, configuration
locale, `.git`, `.claude`, `docs`, banques de sons) → copie par `scp` avec une
clé dédiée vers le compte `charles` du serveur → par SSH : extraction dans
`/var/www/tonik`, installation des dépendances de production, rechargement pm2,
sauvegarde de l'état pm2 → enfin contrôle de la configuration nginx puis
rechargement du service.

**pm2, pas systemd, pour le service web** (mesuré) : `deploy/ecosystem.config.cjs`
→ nom `tonik-backend`, répertoire de travail `/var/www/tonik` (« obligatoire,
sinon PM2 démarre depuis /root et le chargement de la configuration boucle en
crash »), redémarrage automatique au-delà de 512 Mo, journaux dans
`/var/log/tonik-backend-*.log`. Le démon pm2 tourne sous le compte **`charles`**
via `pm2-charles.service` (mesuré, carte).
Incohérence interne mesurée : le fichier `ecosystem.config.cjs` de la racine
déclare 300 Mo et un autre chemin ; c'est celui de `deploy/` qui est lancé.

**systemd n'est utilisé que pour la sauvegarde** (mesuré) : `backup.service`
(`Type=oneshot`, `User=root`, exécutable dans `/usr/local/sbin/`,
`ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`,
`NoNewPrivileges=true`, un seul chemin en écriture, `OnFailure=`) +
`backup.timer` (tous les jours à 03:30, `Persistent=true`, décalage aléatoire de
5 minutes).

**nginx** (mesuré, `deploy/nginx-tonik.ink.conf`, 87 lignes) : installé dans
`/etc/nginx/conf.d/` (RHEL : `conf.d/`, pas `sites-enabled/`). Le dépôt ne
contient que le bloc en clair ; le bloc chiffré et la redirection **sont ajoutés
par certbot**, qui réécrit le fichier. Emplacements avec durées de cache
distinctes pour les ressources construites (1 an, immuables), les banques de
sons, le contenu (5 minutes), le service worker (jamais mis en cache), les
polices et icônes (7 jours) ; `/api/` en proxy vers `127.0.0.1:3001` avec les
en-têtes d'origine et un délai de lecture de 30 s ; le reste en repli sur la
page d'accueil. En-têtes de sécurité : `X-Content-Type-Options nosniff`,
`X-Frame-Options DENY`, `Referrer-Policy strict-origin-when-cross-origin`.
**Politique de sécurité du contenu volontairement absente** (commentaire : style
en ligne produit par Vite + Google Fonts).

**Vhosts présents sur la machine** (mesuré, carte) : `axelise.fr.conf` (859 o,
29 mars), `chalou.link.conf` (862 o, 16 avril), `tonik.ink.conf` (4 169 o,
20 avril), `usa.chalou.link.conf` (901 o, 28 avril). `chalou.link` sert
`chalou.link` et `www.chalou.link`, en clair et en chiffré (« managed by
Certbot »). **Le contenu exact du fichier n'est pas mesurable sans SSH.**

**Certificats** (mesuré, carte) : `chalou.link` couvre `chalou.link` +
`www.chalou.link`, ECDSA, expire **2026-10-25 09:27:58 UTC**.
`certbot-renew.timer` armé et actif.

### SELinux — la question décisive

**SELinux est ACTIF en mode `Enforcing`, politique `targeted`** (mesuré, deux
sources datées concordantes) : `vps-tunnel/docs/memoire/vps_hostinger.md:29`
(« depuis la réinstallation du 2026-08-01 ; la ligne "inactif" décrivait
l'ancien système, corrigée le 2026-08-16 ») et le même fichier l. 80, événement
du **2026-09-05**.

Honnêteté sur la mesure : la carte **ne contient aucune mesure directe** de
`getenforce`/`sestatus` — cherchée section par section. Les indices convergents
sont les paquets de politique SELinux installés, l'unité de ré-étiquetage
activée, le compte système `setroubleshoot`, et les points SELinux (`-rw-r--r--.`)
sur tous les listings de `/etc/systemd/system` et `/etc/nginx/conf.d`.
**Un contrôle `getenforce` manque à la carte** — trou d'outillage à signaler,
pas un doute sur le fait.

**L'incident, mesuré** (`deploy/first-deploy.txt` §9bis, `deploy/backup.service`,
mémoire `feedback_systemd_scripts_chmod_x.md`, arbre nœud 87.a) : **trois**
pannes `203/EXEC` de la même famille. Mai 2026 (bit d'exécution perdu),
2026-08-01 et 2026-09-02 (étiquette SELinux perdue). Mécanisme : *un déploiement
par archive ne modifie pas un fichier, il le supprime et le recrée ; le fichier
neuf hérite de l'étiquette de son dossier parent, qui sous `/var/www` est du
contenu web, que systemd refuse d'exécuter.* Une règle de politique posée à
l'avance **ne protège pas** — elle ne s'applique qu'à une remise d'étiquette
explicite, jamais à la création. Classe fermée le 2026-09-03 en sortant
l'exécutable de l'arborescence servie (`/usr/local/sbin/`, `root:root 0755`,
étiquette de binaire), et fermeture **prouvée en rejouant l'extraction fautive**.
Le `chmod +x` du déploiement a été retiré et **ne doit pas être remis**.

**Règle applicable, mot pour mot** (mémoire `feedback_systemd_scripts_chmod_x.md`)
: « Si tu t'apprêtes à ajouter un `chmod`, un `restorecon` ou une règle de
politique pour qu'un fichier de `/var/www` redevienne exécutable : arrête, et
déplace-le. » Et : « Quand on voit un `ExecStart=` qui pointe sous `/var/www` :
c'est la panne, pas encore arrivée. »

## 4. Inconnue n°1 — l'acheminement du courrier : RÉSOLUE

Aucune machine jointe. Faits issus de résolutions DNS publiques, de la carte, et
de la documentation locale.

**a. Où le courrier doit arriver** (mesuré, `dig`, 2026-09-07) :
`MX chalou.link → 10 mail.chalou.link` ; `mail.chalou.link → 187.77.168.112` ;
`chalou.link → 187.124.46.195` ; SPF `v=spf1 include:spf.brevo.com -all` plus un
code de vérification Brevo.
`187.77.168.112` **est `hostingerd`** (mesuré, carte réseau : adresse publique
`187.77.168.112/24`, adresse de tunnel `10.10.10.3/29`).

**b. Ce Postfix accepte `chalou.link` en réception — OUI** (mesuré, carte
`hostingerd` section mail) : les domaines de boîtes virtuelles sont `tonik.ink`,
`elise.chalou.link`, `soleneceramic.chalou.link`, `clannik.chalou.link` et
**`chalou.link`** ; remise en LMTP à Dovecot ; nom d'hôte annoncé
`mx.tonik.ink` ; réseaux de confiance limités à la boucle locale ; restrictions
de destinataire `permit_mynetworks, reject_unauth_destination`. Postfix 3.10.13,
Dovecot 2.4.1-4, comptes en SQLite, Maildir sous `/var/mail/vmail`. Ports en
écoute : 25, 587, 993, 995, 110 (mesuré).

**c. La boîte `charles@chalou.link` existe et reçoit** (mesuré, documentation
locale) : `docs/email/adresses-email-apps-plan.md:255-261` — domaine ajouté aux
boîtes virtuelles, compte créé, mot de passe jamais vu, 5 authentifications
réelles prouvées. Et `docs/email/README.md:176` + `.claude/state/email-infra.md:158`
: « 2026-08-11 — REMISE ENTRANTE RÉPARÉE : les 9 boîtes (tonik.ink + chalou.link)
reçoivent de nouveau chez elles (chantier #69). » Avec l'avertissement explicite :
au chantier #66, seule l'authentification avait été prouvée, et la livraison
était morte du 2026-08-08 23:53 au 2026-08-11. **Prouver l'authentification ne
prouve pas la remise.**

**d. Le précédent exact à réutiliser** — `vps-tunnel/scripts/tonik-backup-alert`
(2 568 o, posé dans `/usr/local/sbin/`, `-rwxr-xr-x root root`, mesuré). Son
en-tête dit textuellement : « Mail best-effort vers charles@tonik.ink via le
mesh WireGuard : SMTP sans authentification vers Postfix hostingerd
(10.10.10.3:25). AUCUN secret. Un echec d'envoi ne fait JAMAIS echouer le
handler. » Destinataire, expéditeur et URL SMTP sont surchargeables sans secret
par un fichier de réglages de 90 octets. La remise se fait par `curl` en mode
SMTP, avec délais de connexion et d'exécution bornés, et le message est composé
à la main (En-têtes From / To / Subject / Date / Message-ID / MIME).

Donc : **`hostinger` (10.10.10.1) → mesh WireGuard → `hostingerd` (10.10.10.3)
port 25, SMTP en clair, sans authentification, sans aucun secret.**

**Pourquoi ce n'est pas un relais ouvert** : `10.10.10.1` n'est **pas** dans les
réseaux de confiance, donc la permission par réseau ne s'applique pas ; mais le
rejet des destinations non autorisées ne vise que les destinations *non
locales*. `chalou.link` figurant dans les domaines de boîtes virtuelles,
`charles@chalou.link` est une destination locale et la remise est acceptée.
Toute tentative de relais vers l'extérieur serait refusée. Le nœud 24 de l'arbre
le confirme : « piège mynetworks/relais-ouvert identifié et évité ».

**Chemin réseau vérifié** (mesuré) : l'interface de tunnel de `hostinger` porte
`10.10.10.1/29`, avec les deux pairs attendus, un keepalive de 25 s, des
poignées de main fraîches et du trafic bidirectionnel. `hostingerd` écoute bien
sur le port 25.

**Deux chemins existent, tous deux prouvés en production :**
- *Chemin A, le précédent d'alerte* : `10.10.10.3:25` via WireGuard, aucun
  chiffrement applicatif (le réseau l'est), **aucune authentification, aucun
  secret**, n'expose aucun autre nom de domaine. Preuve : 4 messages livrés au
  chantier #24.
- *Chemin B, le patron Tonik* : `mx.tonik.ink:587` par Internet, STARTTLS
  obligatoire, authentification avec **secret à gérer**, expose le nom
  `mx.tonik.ink` dans la configuration de `chalou.link`. Preuve : envois Tonik
  quotidiens.

## 5. Les trois applications — matière factuelle

### Tonik (tonik.ink, gratuite, non open source)

Sources : `tonik/README.md`, notice utilisateur
`packages/frontend/public/notice/index.html` (55 192 o), `docs/lutrin-plan.md` §2.

**Ce que la notice affirme sous « Ce que fait Tonik »** (mesuré, à ne pas
déformer) : afficher les 15 gammes majeures et leurs modes (do à si, dièses et
bémols) ; donner pour chaque gamme les notes, la signature, la pédagogie
associée, les arpèges, les accords diatoniques ; faire entendre la gamme, ses
arpèges et ses accords avec plusieurs timbres et plusieurs instruments ; deux
modules d'entraînement (travail d'oreille, exercice de gamme) ; partager
n'importe quelle vue par une URL ; fonctionner hors ligne après la première
visite.

**Et sous « Ce que Tonik n'est pas »** : « ni un séquenceur, ni un enregistreur,
ni un éditeur de partition, ni un cours de composition. C'est un compagnon de
référence. »

**⚠ Ce résumé est en retard sur l'application** (mesuré, table des matières
complète de la même notice) : huit modules ne sont pas cités par le résumé —
Transposition (chap. 10), **Métronome** (11), **Rythme** (12), **Atelier** (13),
Compte utilisateur (14), Préférences (15), Partage par URL (16), Hors ligne (17).
Version affichée : « Version 1.1 · Juin 2026 ». **Pour écrire la page de
description, s'appuyer sur la table des matières, pas sur le paragraphe de
résumé.**

**Noms exacts des modules** (mesuré) :
- **Page Échelle** : tonique, mode, 10 instruments (piano, violon, flûte,
  clarinette, trompette, saxophones soprano/alto/ténor/baryton…), 3 timbres
  (sombre, brillant, neutre), volume, grille des degrés avec intervalles ton /
  demi-ton, signature de clé.
- **Pédagogie** (monographie par gamme), **Arpèges**, **Accords diatoniques**,
  **Travail d'oreille**, **Exercice de gamme**.
- **Transposition** — charger une partition, choisir source et cible, exporter ;
  une section « Limites connues » figure dans la notice.
- **Métronome** — transport, cinq sons, guide visuel, et **« Mode travail — les
  temps qui s'effacent »** : « Cochez un ou plusieurs temps de la mesure : le
  volume du click de chaque temps coché va descendre progressivement, mesure
  après mesure, rester un moment au volume plancher, **puis remonter**. […]
  Chaque temps coché a ses propres réglages : durée de descente, de maintien et
  de remontée, volumes de départ, plancher et de retour, et nombre de
  répétitions du cycle (ou sans fin). »
- **Rythme** — générateur d'exercices : mesure binaire (2/4, 3/4, 4/4) ou
  ternaire (6/8, 9/8, 12/8), 1 à 8 mesures, sept figures de la ronde à la
  quadruple croche, silences / pointées / doublement pointées en interrupteurs,
  partition affichée, écoute, export. Refus explicite de générer une mesure
  impossible.
- **Atelier** — la liste et le panneau *Aujourd'hui*, quatre façons de voir,
  fiche en détail, partition sous les yeux, consigner depuis un exercice,
  statistiques / export / restauration, **« Suivre, ou être suivi par un
  professeur »** (code d'invitation, accès en lecture, commentaires, révocable
  des deux côtés).
- **Compte** facultatif — « Tonik fonctionne sans compte ». Courriel de
  vérification envoyé depuis `inscriptions@tonik.ink`.

**Fait éditorial exploitable** (mesuré) : le « Mode travail » du métronome de
Tonik **est** le principe de FadeBeat, et l'**Atelier** de Tonik **est**
l'ancêtre de Lutrin (`lutrin-plan.md` §2 : « Réutilisé tel quel : les vues
(liste/détail/stats + tableau/kanban/calendrier), l'état + la logique, le rendu
OSMD, l'i18n FR/EN »). Les trois applications forment une famille cohérente ; ce
n'est pas une reconstruction a posteriori.

### Lutrin

Sources lues en entier : `README.md`, `docs/notice.md` (179 l.),
`docs/lutrin-plan.md` (148 l.), `docs/message-testeurs.md`.

- **Ce que c'est** (mesuré) : application de bureau **Tauri v2** (webview natif
  + cœur Rust), **100 % locale, aucun serveur, aucun compte**. Données dans un
  fichier unique sous le dossier de données de l'utilisateur.
- **Fonctionnalités réelles** (notice) : fiches de travail (Type
  Morceau/Exercice/Théorie/Routine ; État À commencer/En cours/Bloqué/À
  consolider/Acquis/Archivé ; Priorité) ; instruments, étiquettes, échéance,
  tempo actuel → tempo cible, notes ; quatre onglets par fiche (Détails,
  **Sessions** avec date, durée, tempo, difficulté 1-5, énergie 1-5,
  commentaire ; **Partition** ; **Références**) ; bloc **« Aujourd'hui »**
  (jusqu'à 5 propositions classées : En retard, À débloquer, Échéance proche,
  Priorité haute, À reprendre, À commencer) ; **quatre vues** (Liste, Tableau,
  Calendrier, Kanban) ; filtres, recherche et 5 tris ; **Statistiques** (minutes
  par semaine, progression du tempo, répartition par source / instrument /
  catégorie) ; **export JSON et CSV**, **import JSON** ; **bascule EN/FR
  retenue**.
- **Partitions** (mesuré, §4 du plan) : lecture depuis le disque de **MusicXML**
  (rendu OSMD, y compris les archives compressées), **PDF** (rendu pdf.js, avec
  son moteur embarqué pour fonctionner hors ligne) et **images** (PNG, JPEG,
  WebP). Affichage en pages A4 pleine largeur. Lutrin ne garde que le chemin,
  jamais le fichier.
- **Plateformes et binaires** (mesuré, API GitHub, release `lutrin-v0.1.0`,
  publiée 2026-07-08, **marquée pré-version**, 9 fichiers, **0 téléchargement**) :
  installateur Windows `.exe` (3,0 Mo) et `.msi` (4,16 Mo) ; macOS `.dmg` Apple
  Silicon (4,59 Mo) et Intel (4,72 Mo) ; Linux `.deb` (4,30 Mo), `.rpm`
  (4,30 Mo) et `.AppImage` (**81,8 Mo**) ; plus 2 archives `.app.tar.gz`.
  URL : `https://github.com/charlespierru/lutrin/releases/tag/lutrin-v0.1.0`
- **Absence de signature — ce que dit exactement la doc** :
  `lutrin-plan.md:136` : « Binaires **non signés** → avertissement "éditeur
  inconnu" à la 1re ouverture. »
  `message-testeurs.md:44` (Windows, texte réutilisable) : « **C'est une version
  de test, non signée.** Au lancement, Windows va afficher un écran bleu
  "Windows a protégé votre ordinateur" avec la mention "Éditeur inconnu".
  **C'est normal, ce n'est pas un virus.** Pour installer : 1. cliquer sur
  "Informations complémentaires". 2. Puis sur "Exécuter quand même". »
  `message-testeurs.md:25` (macOS) : refus « le développeur ne peut pas être
  vérifié » → clic droit puis « Ouvrir », ou Réglages Système → Confidentialité
  et sécurité → « Ouvrir quand même ».
  **Nuance mesurée** : la documentation parle de binaires « non signés » et
  d'une « version de test » ; elle ne parle nulle part de « éditeur vérifié
  Microsoft » ni de coût. La formulation du cadrage est une interprétation,
  exacte sur le fond mais à reformuler à partir de la source.
- **⚠ Licence** (mesuré, API GitHub) : dépôt public, branche par défaut
  **`master`**, **aucune licence déclarée, aucun fichier de licence**.

### FadeBeat

Sources : API GitHub + `README.md` (5 038 o) + `FadeBeat.html` (18 955 o) +
`vercel.json`, tous récupérés et lus.

- **Contenu réel du dépôt, branche `master`, exhaustif** (mesuré) : **4 fichiers**
  — `.gitignore` (18 o), **`FadeBeat.html` (18 955 o)**, `README.md` (5 038 o),
  `vercel.json` (79 o). Dépôt public, 9 Ko, créé et poussé le **2026-03-22**,
  description « Rhythm training app with progressive beat attenuation ».
- **Un seul fichier HTML autonome : confirmé, avec UNE réserve importante**
  (mesuré) : la seule ressource externe est, ligne 7, un script chargé depuis
  `cdn.tailwindcss.com`. C'est la seule occurrence d'une adresse web dans tout
  le fichier. Aucune police, aucun son, aucune image externes — tous les sons
  sont générés par Web Audio API (oscillateurs, gains, filtres, tampons de bruit
  blanc). **Mais** le fichier porte **44 attributs `class`** qui dépendent de
  Tailwind : retirer le script casserait la mise en forme. Et ce CDN est celui
  de *développement* de Tailwind — il compile la feuille de style dans le
  navigateur, ce n'est pas prévu pour la production.
- **La page se déclare en français** et son titre est « FadeBeat – Entraînement
  Rythmique » : **l'interface est en français seulement**. Le site est bilingue ;
  l'application intégrée ne le sera pas.
- **Fonctionnalités réelles** (README) : 4 cercles de temps colorés
  (violet, ambre, cyan, vert) qui pulsent, barre de volume par temps ;
  **6 timbres** (Métronome, Cloche, Woodblock, Hi-hat, Kick doux, Sinus pur), le
  temps 1 toujours accentué ; tempo 40 → 300 BPM (curseur + champ) ; par temps,
  **deux réglages indépendants** — « Durée fade » 0 → 16 mesures et « Début
  après » 0 → 16 mesures ; décroissance linéaire ; Play / Stop / Reset ;
  **barre d'espace** en raccourci. Technique : horloge haute résolution,
  anticipation de 100 ms, réveil toutes les 25 ms, visuels synchronisés sur le
  rafraîchissement de l'écran. Inspiration créditée : une vidéo de Jamie
  Anderson, lien YouTube dans le README.
- **⚠ Licence** (mesuré) : **aucune licence déclarée, aucun fichier de licence**.
  La section « Licence » du README dit en tout et pour tout : « Libre
  d'utilisation et de modification. »
- `vercel.json` redirige la racine vers `FadeBeat.html` : le dépôt a été pensé
  pour un hébergement Vercel. Aucun déploiement Vercel actif n'a été vérifié.

## 6. L'état de départ côté local

**`/mnt/data/Charles/DevPerso/landing-chalou/`** (mesuré), contenu exhaustif :
`index.html` (8 995 o, 16 avril 2026 19:32) et `docs/site-chalou-cadrage.md`.
**Aucun dépôt git** : `.git` absent. Aucun manifeste de paquet, aucune
dépendance installée, aucun fichier d'exclusion git, aucun CLAUDE.md.

**Ce que sert réellement `chalou.link`** (mesuré, `curl` du 2026-09-07 15:20 UTC) :
`HTTP/1.1 200 OK`, `nginx/1.26.3`, longueur 8 995 octets, dernière modification
le 16 avril 2026 à 17:32 UTC. **Le fichier servi est identique au fichier
local** : même taille, même horodatage. Fichier statique servi par nginx,
**sans aucun code serveur**.

**Contenu de la page actuelle** (mesuré) : thème noir et or (`#08070A`,
`#C8913A`, `#EDE5D8`), polices Google (Cormorant Garamond + **DM Sans**), grain
en SVG intégré, halo radial, photo ronde à anneau conique animé, nom, accroche
« Musicien & Développeur », séparateur, ligne « Instruments à vent · Guitare ·
Théorie », deux liens.

**Deux éléments à retirer** (mesuré dans le fichier) :
1. ligne 295 : l'image de profil est **hotlinkée** depuis GitHub — dépendance
   tierce, et l'adresse IP de chaque visiteur part chez GitHub ;
2. ligne 327 : **une adresse Gmail personnelle en clair**, moissonnable par
   n'importe quel robot. Le cadrage exige l'inverse, et la mémoire
   `feedback_no_more_gmail_for_tonik` porte une règle de non-usage de Gmail.

**⚠ Mémoire de projet fausse, à effacer** :
`vps-tunnel/docs/memoire/chalou_link_dark_intro.md` affirme « chalou.link a une
intro **WebGL** très sombre au premier chargement (orbe à peine visible sur fond
noir) », confirmé par Charles le 2026-05-01. **La page mesurée aujourd'hui ne
contient aucun WebGL, aucun canvas, aucune orbe.** Cette mémoire décrit une
version disparue. Le protocole `reparation` s'applique.

**Mémoires du projet** : le dossier mémoire de `landing-chalou` **existe et est
vide** (mesuré). Aucun agent de domaine n'existe pour ce projet.

## 7. Points de friction et risques mesurés

**Ports en écoute sur `hostinger`** (mesuré, carte, 2026-09-05) : 22 (SSH), 80
et 443 (nginx), `127.0.0.1:3001` (node Tonik), 27017 sur la boucle locale et sur
l'adresse de tunnel (mongod), 51820/udp (WireGuard), 323/udp local (chronyd).
→ **3002 et au-delà sont libres.** 3000 est libre aussi, mais c'est la valeur
par défaut de la configuration de Tonik : le prendre invite la confusion.

**Pare-feu** (mesuré) : zone publique sur l'interface principale, services
`dhcpv6-client http https ssh`, plus trois règles fines (tunnel WireGuard depuis
les deux IP des pairs, MongoDB depuis le sous-réseau du mesh). **80 et 443 sont
déjà ouverts — aucun geste pare-feu n'est nécessaire.** `fail2ban` actif, une
seule prison (SSH).

**Mémoire** (mesuré) : 7,5 Gio au total, **794 Mio utilisés, 6,7 Gio
disponibles**. Postes principaux : mongod 233 Mo, node Tonik 100 Mo, démon pm2
69 Mo. **Aucun espace d'échange** : la table des espaces d'échange est vide.
**⚠ Contradiction documentaire** : `vps_hostinger.md:27` affirme « swapfile
/swapfile 2 GiB actif, survie au reboot PROUVÉE 2026-07-16 » — preuve
**antérieure à la réinstallation du 2026-08-01**. La mesure prime : **il n'y a
plus de swap**. Une limite mémoire propre au nouveau service est donc d'autant
plus nécessaire : sans espace d'échange, un dépassement se termine par le tueur
de processus du noyau, qui peut choisir mongod ou le backend Tonik.

**Disque** (mesuré) : la racine fait 99 Go en XFS, **remplie à 9 %**, inodes à
1 %. `/boot` est **à 84 %** (936 Mo) — sans rapport avec ce chantier mais à ne
pas aggraver. `/var/log/mongodb` pèse **1,1 Go** et **mongodb n'a aucune règle
de rotation de journaux** (mesuré). Dette existante, hors périmètre, mais qui
grossit.

**Comptes système existants** (mesuré) : `charles` (1001, sudo sans mot de
passe), `jean` (1002, **verrouillé volontairement — décision de Charles du
2026-08-16, à ne surtout pas « réparer »**), `vigil` (1003), `nginx` (992),
`mongod` (993), `exim` (93). **Aucun compte dédié à un second site** : en créer
un est un geste neuf sur cette machine.

**MongoDB — état du groupe** (mesuré, carte) : version 8.0.28, écoute limitée à
la boucle locale et à l'adresse de tunnel, **autorisation activée**, fichier de
clé partagé, groupe de réplication `rs0`. Primaire : `hostinger` ; second
porteur de données : OVH ; arbitre : `hostingerd`. 469 Mo sur disque.
Utilisateurs : un administrateur global et `tonik_app` limité en lecture-écriture
à la seule base `tonik` — mots de passe hors de portée, jamais lus.

**Trois risques Mongo concrets :**
1. **Confirmation d'écriture par défaut « majorité »** (mesuré,
   `vps_hostinger.md:59`). Avec 2 porteurs de données et 1 arbitre, « majorité »
   veut dire 2 accusés de réception. **Si le lien du tunnel vers OVH tombe,
   toute écriture bloque puis expire.** Un formulaire qui archive en base
   hériterait de cette fragilité. Le remède est local à l'opération, pas un
   changement global.
2. **La nouvelle base ne serait pas sauvegardée.** Le script de sauvegarde de
   Tonik ne sauvegarde **qu'une seule base**, celle nommée dans son fichier de
   réglages. Une base `chalou` créée aujourd'hui n'entrerait dans aucune
   sauvegarde.
3. **Piège d'habilitation** (mémoire `feedback_mongo_replicaset_gotchas.md`) :
   avec l'autorisation activée, la création d'utilisateur se fait **sur le
   primaire**, avec un compte porteur du rôle d'administration des utilisateurs.
   Le patron exact figure dans `deploy/first-deploy.txt` §2. Aucun geste
   pare-feu : la connexion sera locale.

**SELinux — les pièges qui menacent ce chantier :**
- *(mesuré, classe déjà fermée pour Tonik)* Ne jamais placer un exécutable de
  service sous `/var/www`. Si le site finit sous `/var/www/chalou`, aucun
  `ExecStart` ne doit y pointer.
- *(supposé, non mesurable sans SSH)* Sur RHEL en mode strict, un processus
  nginx ne peut pas ouvrir de connexion réseau sortante sans un booléen dédié,
  ou sans que le port cible soit déclaré comme port web. Or Tonik fait déjà un
  proxy vers `127.0.0.1:3001` **et fonctionne** — donc quelque chose a déjà été
  fait sur cette machine, mais on ne sait pas quoi. **Conséquence : si le
  nouveau service prend un port différent de 3001, le proxy peut être refusé par
  SELinux au premier essai, avec une erreur 502 et un refus muet côté nginx.**
  À vérifier sur place avant le premier rechargement.
- *(mesuré)* Le contenu servi par nginx doit porter une étiquette de contenu
  web ; un fichier déposé par extraction d'archive sous `/var/www` l'hérite
  automatiquement — cas favorable. Le danger est l'inverse : un fichier déposé
  ailleurs puis déplacé.

**Cohabitation avec Tonik :**
- Un contrôle de configuration puis un **rechargement** de nginx (jamais un
  redémarrage) touche **les quatre vhosts en même temps** : une erreur de
  syntaxe dans `chalou.link.conf` empêcherait le rechargement et **laisserait
  tonik.ink sur l'ancienne configuration** — pas de coupure, mais toute
  correction ultérieure serait bloquée. Le contrôle avant rechargement est la
  bonne parade, et il est déjà dans le script de déploiement de Tonik.
- **certbot réécrit les fichiers de vhost** (mesuré). Toute directive ajoutée
  dans `chalou.link.conf` doit survivre à un renouvellement. Le minuteur de
  renouvellement est armé ; le certificat expire le **2026-10-25**, donc un
  renouvellement automatique tombera dans la fenêtre du chantier.
- Le processus Tonik a **6 redémarrages** au compteur pm2 et une limite de
  512 Mo. Ajouter un second processus pm2 partagerait le même démon sous le
  compte `charles` — **ce qui contredit l'exigence « processus distinct sous un
  compte système distinct »**. Un service systemd sous un compte dédié tient
  l'exigence ; pm2 sous `charles` ne la tient pas.

**Autres frictions mesurées :**
- **2 processeurs seulement**, charge moyenne 0,59 / 0,46 / 0,20.
- La machine a connu **3 redémarrages avec coupure de `tonik.ink`** cette saison
  (88 s le 2026-09-05, environ 60 s le 2026-08-26, 91 s le 2026-08-15) : le
  nouveau site subira les mêmes.
- **Aucun précédent d'anti-robot** dans les dépôts de Charles : recherche des
  motifs habituels sur `elise/`, `aymoai/` et les paquets de Tonik → **zéro
  occurrence**. Le seul dispositif existant est le limiteur de débit de Fastify.
- **Le patron bilingue de Tonik n'est pas transposable tel quel sans build** :
  `src/i18n/t.js` importe ses traductions sous forme de modules JSON, avec ce
  commentaire mesuré : « required by Node ≥22 for JSON modules; **Vite 6 passes
  it through** ». Le cadrage écarte Vite. Les modules JSON importés nativement
  dans le navigateur n'ont pas le même niveau de prise en charge que les modules
  JavaScript — risque à ne pas prendre en aveugle.

## 8. Options techniques — une recommandation par choix

Le planificateur ne décide rien ; il pose les options et recommande.

**A. Version de Node.** (1) exiger Node 24 → dépôt tiers sur `hostinger`, à
rebours du chantier #35.d ; (2) **viser Node 22, celui de la distribution** ;
(3) binaire embarqué.
→ **Recommandation : (2).** Node 22.23.2 est en place, suit les correctifs
Rocky, et fait tourner Fastify 5, le pilote MongoDB 7 et nodemailer 9 sans
réserve — Tonik le prouve tous les jours. Rien dans le besoin n'exige Node 24.
**Corriger le cadrage**, qui dit « Node 24 ».

**B. Superviseur du service.** (1) pm2 sous `charles`, comme Tonik ;
(2) **unité systemd sous un compte système dédié**.
→ **Recommandation : (2).** Le cadrage exige « processus distinct, sous un
compte système distinct » et « limite mémoire propre » ; pm2 sous `charles` ne
donne ni l'un ni l'autre. systemd donne les deux nativement, plus le
durcissement déjà éprouvé sur cette machine (système en lecture seule, dossiers
personnels masqués, /tmp privé, pas d'élévation de privilèges) et un mécanisme
d'alerte en cas d'échec. Coût : un montage différent de celui de Tonik, à
documenter.

**C. Qui sert les pages HTML.** (1) **nginx sert les fichiers, Fastify n'expose
que l'interface de programmation** (patron Tonik) ; (2) Fastify sert tout.
→ **Recommandation : (1).** Patron déjà en place, plus rapide, et surtout : les
pages restent servies si le service Node s'arrête — seul le formulaire tombe.
Le cadrage veut « le seul code serveur nécessaire » ; servir des fichiers
statiques ne l'est pas.

**D. Chemin d'envoi du courrier.** (A) **mesh WireGuard vers le port 25 de
`hostingerd`, sans authentification, sans secret** ; (B) `mx.tonik.ink:587`
STARTTLS avec authentification.
→ **Recommandation : (A).** Trois raisons mesurées : (i) **zéro secret à créer,
poser, roter** — le cadrage exige « aucun secret partagé », et le chantier #23 a
montré ce que coûte un secret oublié lors d'une rotation : six semaines de
sauvegardes muettes ; (ii) elle n'écrit le nom `tonik` nulle part dans la
configuration de `chalou.link` — or le rejet de Charles du 2026-08-10 portait
exactement sur la visibilité du nom `tonik` dans les réglages d'un autre
domaine ; (iii) elle est déjà prouvée sur ce trajet précis, avec 4 messages
livrés au chantier #24. Coût : dépendance au tunnel WireGuard, et nodemailer
devra être configuré sans TLS obligatoire et sans authentification —
c'est-à-dire **différent** du patron de Tonik. **À écrire explicitement dans le
plan pour que personne ne « corrige » ce réglage en croyant réparer un oubli.**

**E. FadeBeat et son CDN Tailwind.** (1) héberger le fichier tel quel → script
tiers chargé chez chaque visiteur, contraire à l'esprit « aucun service
extérieur », et CDN de développement ; (2) **servir une copie locale figée de la
feuille de style**, une seule ligne changée dans le HTML ; (3) réécrire les 44
classes en CSS maison.
→ **Recommandation : (2).** Supprime la dépendance tierce pour le coût d'une
ligne, garde le fichier lisible, laisse le dépôt GitHub intact. **Conséquence à
assumer et à écrire** : la copie hébergée diverge d'un caractère du dépôt public.
(3) est propre mais c'est un chantier à part entière.
**Fait connexe** : l'interface de FadeBeat est **en français seulement**. Sur une
page anglaise du site, l'application restera francophone. À dire, ou à traiter.

**F. Mécanique bilingue.** (1) copier le patron Tonik, qui importe des modules
JSON — dépend de Vite, écarté ; (2) **traductions en modules JavaScript natifs**,
même fonction de traduction que Tonik ; (3) attributs `data-i18n` +
dictionnaire.
→ **Recommandation : (2).** Garde **exactement** l'ergonomie de Tonik — mêmes
clés, même fonction — sans dépendre du niveau de prise en charge des modules
JSON dans les navigateurs. La bascule visuelle est déjà stylée.

**G. Protection anti-robot du formulaire.** Options : champ leurre invisible ;
délai minimal de remplissage ; limitation de débit par route ; question simple ;
preuve de travail JavaScript ; captcha tiers — **exclu par le cadrage**.
→ **Recommandation : les trois premières, cumulées.** Champ leurre + délai
minimal + limiteur de débit avec une surcharge sévère sur la route du formulaire
— le patron existe déjà, Tonik met 5 par minute sur l'inscription. Coût pour un
visiteur honnête : **nul, et rien à cliquer**. Aucune ne dépend d'un tiers. La
question arithmétique est le repli si le volume de nuisance le justifie un jour,
pas avant : c'est une friction gratuite.
**Attention** : le limiteur est **en mémoire** — il repart à zéro à chaque
redémarrage du service — et il faut faire confiance au proxy pour qu'il voie la
vraie adresse du visiteur derrière nginx.

**H. Écriture des messages en base.** (1) confirmation d'écriture par défaut
(« majorité ») → dépend de la santé du lien vers OVH ; (2) **confirmation par le
seul primaire, avec une reprise**.
→ **Recommandation : (2)**, plus l'envoi du courrier **indépendant** de
l'écriture en base : le message part même si la base refuse, et inversement. Un
visiteur ne doit jamais voir « erreur » parce qu'un tunnel entre deux serveurs a
hoqueté.

**I. Sauvegarde de la nouvelle base.** (1) ne rien faire ; (2) **une unité de
sauvegarde propre au site**, sur le modèle exact de celle de Tonik, **exécutable
posé dans `/usr/local/sbin`** ; (3) élargir la sauvegarde de Tonik.
→ **Recommandation : (2).** (3) est exclu par le cadrage (« aucune modification
de Tonik »). (1) reproduit précisément la situation que le cadrage veut éviter.

## 9. Réponses aux 7 inconnues du cadrage

**1. Acheminement du courrier — TRANCHÉE.** Voir §4. Réserve honnête : la
dernière preuve de remise date du 2026-08-11 ; il faudra la refaire pour cette
boîte-ci, et **prouver la livraison, pas l'authentification** — c'est exactement
l'erreur qui a masqué trois jours de panne au chantier #66.

**2. Protection anti-robot — options établies, choix non tranché.** Aucun
précédent dans les dépôts de Charles. Seul le limiteur de débit est en place.
Voir option G.

**3. Isolation concrète — établie, avec un point non mesurable.** Aucun compte
de site n'existe aujourd'hui ; il faut en créer un. systemd plutôt que pm2
(option B). Limite mémoire par systemd ; **pas d'espace d'échange sur la
machine**, donc la limite n'est pas un confort. Base et compte Mongo : création
sur le primaire, rôle limité à la seule nouvelle base, patron dans
`first-deploy.txt` §2 ; aucun geste pare-feu. Penser à la confirmation
d'écriture et à la sauvegarde (options H et I). Point non mesurable sans SSH :
l'état du réglage SELinux qui autorise nginx à joindre le nouveau port.

**4. Dépôt git — état confirmé, décision non prise.** Aucun dépôt. Les trois
autres dépôts de Charles portent un fichier d'exclusion et un garde-fou qui
refuse un commit de code sans documentation. Le site contiendra un fichier de
configuration avec au minimum une chaîne de connexion à la base : un fichier
d'exclusion git est **obligatoire** avant le premier commit. La mise sur GitHub
est une décision de Charles ; rien de technique ne s'y oppose.

**5. Photo — état factuel, choix non tranché.** La page actuelle **hotlinke**
l'avatar GitHub. Quelle que soit l'image retenue, **la servir depuis
`chalou.link`** : le hotlink fait fuiter l'adresse IP de chaque visiteur vers
GitHub. Le choix avatar / vraie photo est une décision de Charles.

**6. Contenu — non tranchée.** Instruments : le cadrage cite clarinette,
guitare, saxophone, percussions ; la page actuelle affiche « Instruments à vent ·
Guitare · Théorie » ; le dépôt Tonik contient des chaînes de travail pour la
clarinette et le saxophone. **Lesquels sont les « nouveaux » à apprendre n'est
écrit nulle part** — question à Charles. Relecture de l'anglais : aucun
relecteur identifié ; Tonik a une version anglaise complète (fichier de
traductions de 28 919 o, notice anglaise de 50 086 o), donc un précédent de
qualité existe, mais on ne sait pas qui l'a relue.

**7. Bascule de l'ancienne page — éléments établis, calendrier non tranché.** Le
vhost `chalou.link.conf` existe (862 o) et sert un fichier statique ; son contenu
n'est pas lisible sans SSH. Le retour arrière est simple : conserver
l'`index.html` actuel — il n'est versionné nulle part, donc le sauvegarder est
le premier geste — et une copie horodatée du vhost avant toute modification.
Contrainte de calendrier : le certificat expire le **2026-10-25** et le minuteur
de renouvellement est armé — certbot réécrit le vhost, donc toute modification
doit être vérifiée après le premier renouvellement.

## 10. Ce que je n'ai pas pu établir

1. **Le contenu de `/etc/nginx/conf.d/chalou.link.conf`** (862 o). N'existe dans
   aucun dépôt local ; le lire exige SSH, interdit à l'étude.
2. **L'état des réglages SELinux relatifs à nginx** et la liste des ports
   déclarés comme ports web. Le proxy de Tonik vers 3001 prouve qu'un réglage
   existe, **pas lequel**. Risque n°1 d'échec au premier essai.
3. **Une mesure directe du mode SELinux.** Le mode strict est établi par deux
   entrées datées et par trois pannes réelles ; il n'y a **pas** de contrôle
   SELinux dans la carte. Trou d'outillage à signaler.
4. **Le contenu des fichiers de configuration de Tonik** et les valeurs réelles
   de l'hôte SMTP, de l'expéditeur, de l'URL Mongo et du port. Non lus
   délibérément (règle secrets).
5. **La preuve d'une remise fraîche vers `charles@chalou.link`.** Dernière preuve
   mesurée : 2026-08-11. Le plan doit prévoir cette preuve, et vérifier la
   **livraison** — message retrouvé dans la boîte —, jamais seulement
   l'acceptation.
6. **Le contenu des tables d'alias et de comptes de la messagerie.** La carte
   donne leur existence, pas leurs lignes. La conclusion « boîte réelle et non
   alias » vient de la documentation du chantier #66, pas d'une lecture directe.
7. **Quels instruments Charles apprend en ce moment**, et **qui relira
   l'anglais**. Aucune source écrite.
8. **Le poids réel de la feuille Tailwind chargée par FadeBeat.**
9. **Si un déploiement Vercel de FadeBeat est actif.**
10. **L'existence éventuelle d'une signature DKIM propre à `chalou.link`** au-delà
    du SPF Brevo mesuré. Sans objet si le courrier reste interne au mesh.

## 11. Couverture

**39 fichiers lus en entier** : la note de cadrage · `landing-chalou/index.html` ·
tokens.css · base.css · fonts.css · server.js · config.js · db.js ·
plugins/rateLimit.js · plugins/cors.js · email/sender.js · manifeste du backend ·
manifeste de Tonik · `.nvmrc` · ecosystem.config.cjs (racine) · tonik/README.md ·
frontend/index.html · i18n/t.js · deploy.sh · nginx-tonik.ink.conf ·
first-deploy.txt · backup.sh · backup.service · backup.timer ·
deploy/ecosystem.config.cjs · scripts/tonik-backup-alert · vps_hostinger.md ·
project_email_infrastructure.md · chalou_link_dark_intro.md ·
feedback_mongo_replicaset_gotchas.md · feedback_systemd_scripts_chmod_x.md ·
adresses-email-apps-plan.md · lutrin/README.md · lutrin/docs/notice.md ·
lutrin-plan.md · message-testeurs.md · FadeBeat README.md · FadeBeat vercel.json ·
FadeBeat.html (18 955 o, analysé intégralement).

**4 lus partiellement, motif écrit** : `app.css` (794 l. — inventaire complet des
60 sélecteurs + 4 sections lues en entier) · notice Tonik (55 192 o — table des
matières intégrale des 18 chapitres + 6 sections extraites) · `PLAN_TREE.md`
(nœuds #94, #93, #87, #87.a + en-tête de règles) · `state/email-infra.md`
(4 extraits ciblés sur « chalou »).

**7 non lus délibérément** : tous les fichiers de configuration porteurs de
secrets, y compris les exemples (règle secrets) ; les relevés bruts de la carte
(consigne explicite : 170 pages).

**14 commandes de mesure** : 10 consultations de la carte, 4 résolutions DNS,
4 lectures web. **Zéro SSH, zéro écriture, zéro commande modifiante.**

**Recompte : 43 fichiers concernés, 39 lus en entier, 4 lus partiellement avec
motif — écart 0 non justifié.**
