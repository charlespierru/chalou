# 94.b — FadeBeat se met à jour toute seule sur chalou.link — plan court

Ouvert le 2026-09-09. Petit chantier : plan court, validé en conversation.
**Mais l'objet vérifie une signature** : la règle zéro s'applique (épreuve par un
agent indépendant) et l'audit d'étape 4 est dû.

## Rappel du cadrage

Le site sert une photocopie de FadeBeat, dans `apps/fadebeat/`. Elle est en
retard d'une version sur le dépôt public (mesuré le 2026-09-09 : la copie servie
n'a pas le panneau « Accélération » du chantier #96). Rien ne relie la copie au
dépôt. Première idée (minuteur horaire côté serveur) refusée par Charles :
« trouve-moi plutôt une solution côté GitHub, comme Vercel ».

**Besoin** : Charles pousse sur le dépôt FadeBeat, et le site sert la nouvelle
version sans qu'il touche à rien d'autre.

**Dehors** : toute transformation de FadeBeat (couleurs, langue), les autres
dépôts (Lutrin), la page `/fadebeat` elle-même, le déploiement du site.

## Ce qui a été mesuré le 2026-09-09

- Le fichier servi est `root:root 0664` sous `versions/<date>/apps/fadebeat/`,
  étiquette SELinux `httpd_sys_content_t`. Le service tourne sous `chalou`, avec
  `ProtectSystem=strict` : il ne peut rien écrire, nulle part.
- Le service tourne en `unconfined_service_t` : SELinux ne l'empêchera pas
  d'écrire dans un dossier web, c'est le confinement systemd qui l'empêche.
- Le serveur joint GitHub en sortie : le fichier brut de master répond 200,
  25 939 octets, identique en taille au dépôt local.
- nginx transmet tout `/api/` au service, sans limite de taille propre ;
  le service limite le corps à 64 Kio (global).
- La seule différence voulue entre la copie et le dépôt est la ligne
  `<script src="https://cdn.tailwindcss.com">` → `tailwind.js` local.
- La Content-Security-Policy de `/apps/fadebeat/` autorise déjà le code en
  ligne : rien à changer côté navigateur.
- GitHub (doc lue) : signature dans `X-Hub-Signature-256`, valeur `sha256=`
  + HMAC-SHA256 du corps brut avec le secret, comparaison en temps constant
  exigée ; en-têtes `X-GitHub-Event` et `X-GitHub-Delivery` ; réponse 2xx
  attendue sous 10 secondes ; charge utile jusqu'à 25 Mo.
- `gh` est connecté au compte charlespierru : le webhook peut être créé par
  l'API, sans clic dans l'interface.
- Le coffre (`guichet ranger`) sait tirer un secret neuf sans le montrer.

## Choix retenus

**Un dossier dédié pour FadeBeat, hors des versions du site.**
`/var/www/chalou.link/fadebeat/` : `index.html` appartient à `chalou`, seul
fichier que le service a le droit d'écrire (`ReadWritePaths` sur ce seul
dossier) ; `tailwind.js` y est posé une fois, en lecture seule. nginx y pointe
par un `alias` dans le bloc `/apps/fadebeat/` déjà existant.
*Pourquoi* : un déploiement du site par archive recrée `versions/<date>/` ;
si FadeBeat y vivait, chaque déploiement remettrait une vieille copie jusqu'au
prochain push. Le dossier dédié survit aux déploiements, et le confinement
reste étroit : un seul dossier ouvert en écriture.

**Le webhook ne livre qu'un signal, jamais le contenu.** La route vérifie la
signature, lit trois champs du corps (`ref`, `after`, `repository.full_name`),
puis va chercher elle-même `FadeBeat.html` sur GitHub **à l'adresse du commit
exact** (`raw.githubusercontent.com/<dépôt>/<sha>/FadeBeat.html`).
*Pourquoi le sha et pas master* : l'adresse « master » est mise en cache
plusieurs minutes par GitHub (supposé, comportement connu) ; l'adresse d'un
commit est immuable, donc jamais périmée.

**Refuser plutôt que servir n'importe quoi.** Le fichier reçu doit : peser
entre 10 Kio et 2 Mio, contenir la ligne du CDN Tailwind **exactement une
fois** (sinon la transformation est impossible et on alerte), commencer par
un document HTML. Écriture dans un fichier temporaire du même dossier, puis
renommage : jamais un fichier à moitié écrit en ligne.

**Alerte par courriel en cas d'échec**, par le même chemin que le formulaire
(`mail.js`, port 587 authentifié). Silence = succès uniquement si le journal
le dit aussi.

**Route synchrone.** On répond à GitHub après avoir fini (moins de 10 s :
délai de 8 s sur le téléchargement). Ainsi la page « Recent Deliveries » du
dépôt montre le vrai résultat, avec le message d'erreur s'il y en a un.

## Sécurité

- **Secret partagé** : 32 octets tirés par le coffre, posés dans
  `/etc/chalou/reglages` (déjà 0640 root:chalou) sous `GITHUB_WEBHOOK_SECRET`,
  et donnés à GitHub par l'API. Jamais affiché, jamais dans le dépôt.
- **Signature** : HMAC-SHA256 sur le corps BRUT (pas le JSON reparsé), comparée
  en temps constant. Sans en-tête, ou signature fausse : 401, rien d'autre.
- **Seul le push sur `refs/heads/master` du dépôt `charlespierru/FadeBeat`**
  déclenche quelque chose ; `ping` répond 200 sans rien faire ; tout autre
  événement ou dépôt : 204, ignoré, journalisé.
- **Rejeu** : le `sha` téléchargé est immuable, un rejeu réécrit le même
  contenu, sans effet ; le `X-GitHub-Delivery` est journalisé.
- **Taille** : limite de corps portée à 1 Mio pour cette seule route (un push
  ordinaire pèse quelques Kio ; 64 Kio pourrait couper un push de nombreux
  commits). Freinage propre à la route : 10 par minute.
- **Rien d'extérieur pour le visiteur** : inchangé, le site ne sort que
  serveur → GitHub, au moment du push.

## Phases

- [x] **P0 — FAIT 2026-09-09 22:11 (mesuré : 4 vhosts 200 avant et après le rechargement, page et tailwind servis en 200 depuis l'extérieur, sha du fichier servi = sha du fichier posé, redirection 301 sans barre, ReadWritePaths posé, rechargeur `nginx-recharger-sur` installé) — Le serveur est prêt à recevoir** (root, sur `hostinger`) :
  dossier `/var/www/chalou.link/fadebeat/` ; `index.html` = copie servie
  actuelle, `chown chalou` ; `tailwind.js` copié ; `alias` dans le vhost ;
  `nginx -t` puis reload (jamais restart) ; drop-in systemd
  `ReadWritePaths=/var/www/chalou.link/fadebeat` ; secret tiré par `guichet`
  et posé dans `/etc/chalou/reglages`. Sauvegardes horodatées du vhost et de
  l'unité dans `/root/sauvegardes-chalou/` avant de toucher.
- [x] **P1 — FAIT 2026-09-09 22:20 (contrôle croisé local sur faux GitHub, 11 cas conformes — pas une preuve) — La route** : `server/src/routes/github.js`, `config.js`
  (`GITHUB_WEBHOOK_SECRET`, `FADEBEAT_DOSSIER`), `mail.js` (`envoyerAlerte`),
  enregistrement dans `server.js`. `.env.example` mis à jour — et ses lignes
  fausses sur le port 25 corrigées au passage (elles contredisent le code).
- [x] **P2 — FAIT 2026-09-09 (épreuvier : 87 cas, vue crier 5 fois sur son banc brut, puis 87/87 ; relancée par moi sur le code déployé : 87/87 en 147 s, mesuré) — L'épreuve indépendante** (épreuvier, en parallèle de P1 ; but et
  interdits seulement). Vue échouer sur un service sans la route, puis passée.
- [x] **P3 — FAIT 2026-09-09 22:26 (mesuré : service actif, 0 redémarrage en boucle, sante 200 dehors, refus 401 sans signature dehors) — Déploiement** (porte) : code sur `/opt/chalou/`, redémarrage du
  service, `/api/sante` vivant, formulaire de contact toujours vivant.
- [x] **P4 — FAIT 2026-09-09 22:40 par Charles, À LA MAIN (décision : jeton gh non élargi), secret collé depuis le presse-papier rempli par le coffre ; ping reçu et signé juste (mesuré, livraison 0691a480…) — Le webhook chez GitHub** : créé à la main, événement `push` seul, `ping`
  reçu 200 dans « Recent Deliveries ».
- [x] **P5 — FAIT 2026-09-09 22:43 (mesuré : push du commit 293c3bc à 22:43:30, site à jour 5 s plus tard, marque HTML = sha exact de master, panneau Accélération servi, zéro ligne CDN, une ligne tailwind.js locale, journal avec sha et livraison, 26 061 octets) — Preuve de bout en bout** (porte push) : un vrai commit sur
  FadeBeat (le `.gitignore` modifié attend déjà dans le dépôt), push, puis
  lecture depuis l'extérieur de `https://chalou.link/apps/fadebeat/` : le
  panneau « Accélération » est servi, la ligne Tailwind est locale, le journal
  porte le `sha` et l'identifiant de livraison.
- [x] **P6 — FAIT 2026-09-09 23:05 (PASSATION : fonctionnement, tableau « où », section 8 avec les deux trouvailles ; arbre à jour ; graine annoncée) — Documents** : PASSATION (tableau « où »), note de première
  installation pour ce morceau, `docs/PROMPT-AGENT-SUIVANT.md` si concerné,
  arbre des plans. Le dossier `public/apps/fadebeat/` du dépôt du site devient
  une graine, annoncée comme telle en tête de PASSATION.
- [x] **Audit indépendant** rendu 2026-09-09 23:20 : « pas prêt » (B-1 freinage usurpable par X-Forwarded-For, prouvé en prod ; B-2 course entre deux livraisons ; I-1 pire cas 12,5 s ; I-2 renommage silencieux ; 9 mineurs). Corrigés le soir même, ré-épreuve, re-audit des points corrigés. Puis commit (porte).

## Critères de recette (mesurables)

| # | Critère | Comment on le mesure | S'il est saboté… |
|---|---|---|---|
| C1 | Sans signature, ou signature fausse → 401, fichier intact | requête forgée, empreinte du fichier avant/après | signature ignorée → C1 crie |
| C2 | Signature juste sur `ping` → 200, fichier intact | idem | — |
| C3 | Signature juste, push sur une autre branche ou un autre dépôt → 204, fichier intact | idem | filtre absent → C3 crie |
| C4 | Push valide → fichier remplacé, ligne Tailwind locale, ligne CDN absente, taille > 10 Kio | lecture HTTPS depuis l'extérieur + grep | transformation absente → C4 crie |
| C5 | Fichier GitHub sans la ligne CDN, ou trop petit, ou GitHub injoignable → fichier servi INCHANGÉ, réponse 5xx, courriel d'alerte reçu | faux GitHub sur le banc, boîte lue | garde retirée → l'ancien fichier change → C5 crie |
| C6 | Le service ne peut écrire QUE dans le dossier FadeBeat | tentative d'écriture ailleurs depuis le service : refus | `ReadWritePaths` élargi → C6 crie |
| C7 | Aucun des trois autres vhosts ni le service Tonik ne change de comportement | 4 vhosts lus en direct avant/après chaque geste nginx | — |
| C8 | Preuve réelle : push → sous 60 s, site à jour | P5 | — |
| C9 | Coût : la route répond en moins de 10 s (GitHub coupe au-delà) | durée dans le journal | délai de téléchargement retiré → C9 peut crier |

## Ce que chaque remède peut CASSER ou OUVRIR

- **`alias` nginx** → une faute de chemin rend FadeBeat 404 pour tout le
  monde. *Parade* : `nginx -t`, reload, lecture immédiate de la page, retour
  au vhost sauvegardé si échec.
- **`ReadWritePaths`** → ouvre UN dossier web en écriture au service. Si le
  service est compromis, il peut réécrire FadeBeat, rien d'autre. *Parade* :
  un seul dossier, `index.html` seul fichier appartenant à `chalou`.
- **Route publique de plus sur `/api/`** → surface d'attaque : un corps sans
  signature valide est rejeté avant toute lecture ; freinage propre.
- **Corps à 1 Mio** → mémoire : 10 requêtes/min × 1 Mio, sous `MemoryMax=192M`.
- **Dépendance à GitHub au moment du push** → si GitHub est injoignable, rien
  ne change et Charles reçoit un courriel : pas de panne silencieuse.
- **Le fichier appartient à `chalou`** → un déploiement du site ne le touche
  plus ; **la copie du dépôt du site n'est plus la vérité**, il faut l'écrire.
- **Restart du service** → 1 à 2 s sans formulaire de contact. Tonik non
  concerné (process distinct, mesuré au chantier 94).

## Coût attendu

Une soirée. Route de ~120 lignes. Charge : un push par jour au plus.

## Hors périmètre (noté, pas fait)

- La photo de carte `hostinger` date du 2026-09-05, avant le site : elle
  ignore tout de chalou. À reprendre à la clôture du chantier 94.
- Lutrin n'est pas concerné (téléchargement, pas copie servie).

## Portes

Deploy (P3), action distante GitHub (P4), push FadeBeat (P5), commit du site.

## Amendements en cours de chantier

(datés ; un écart non écrit n'existe pas)

### 2026-09-09 — après la réfutation de l'auditeur (`fadebeat-webhook-plan-refutation.md`)

Verdict de l'auditeur : pas prêt, quatre bloquants dont un silencieux. Tous
acceptés. Ce qui change, point par point ; le corps du plan ci-dessus reste
tel quel pour la traçabilité, **c'est cette section qui fait foi**.

- **B1 (alias + try_files = 404 garanti, bug nginx #97).** Le bloc
  `/apps/fadebeat/` aliasé n'aura PAS de `try_files`. Critère ajouté à P0 :
  `/apps/fadebeat/` ET `/apps/fadebeat/tailwind.js` répondent 200 depuis
  l'extérieur avant de déclarer nginx rechargé.
- **B2 (rename exige l'écriture sur le dossier).** Dossier
  `/var/www/chalou.link/fadebeat/` en `root:chalou 1775` (sticky bit) :
  `chalou` crée son temporaire et renomme sur son `index.html`, mais ne peut
  ni effacer ni écraser `tailwind.js` (root). Le dossier existe AVANT le
  redémarrage du service (sinon `ReadWritePaths` fait échouer le démarrage).
  Étiquette SELinux du fichier écrit vérifiée par `ls -Z` au premier push.
- **B3 (gh api …/hooks → 403, mesuré par l'auditeur).** Le jeton `gh` n'a pas
  le droit `admin:repo_hook`. **Décision de Charles** : soit `gh auth refresh
  -s admin:repo_hook` (élargit le jeton, action distante), soit création du
  webhook à la main dans l'interface GitHub, le secret lui étant donné par
  `guichet pour-charles`. Dans les deux cas : `content_type = json`
  (le défaut GitHub est `form`, que la route rejetterait).
- **B4a (rejeu / désordre = site en retard, en silence).** La route ne
  déploie plus le `sha` du corps. Elle lit le sommet réel de `master` par
  l'API GitHub (`GET /repos/charlespierru/FadeBeat/branches/master`, non
  mis en cache) et télécharge le fichier À CE `sha`. Une relivraison
  ancienne redéploie donc toujours la version courante. Le `sha` déployé
  est inscrit en commentaire HTML en tête d'`index.html`, et journalisé.
- **B4b (404 fugace d'un sha tout frais).** Trois tentatives espacées
  d'une seconde, budget total 7 s.
- **B4c (courrier ET GitHub morts).** Écrit honnêtement : il reste le
  journal du service et la page « Recent Deliveries » de GitHub, documentée
  dans PASSATION comme second canal. La route répond 5xx à GitHub AVANT
  d'envoyer le courriel (I6), pour que l'échec y soit visible.
- **I1.** Corps brut : `addContentTypeParser('application/json',
  {parseAs:'buffer', bodyLimit: 1 Mio})` dans le plugin encapsulé de la
  route, sans effet sur `/api/contact`. Signature de longueur fausse → 401,
  jamais 500 (cas ajouté à C1).
- **I2.** Réglages ajoutés : `GITHUB_API_BASE` et `GITHUB_RAW_BASE`
  (défauts GitHub), pour que le banc puisse jouer un faux GitHub : C5 et le
  sabotage de C9 deviennent mesurables.
- **I3.** Le secret ne passe jamais par une ligne de commande : `gh api
  --input -` sur l'entrée standard, et côté serveur `sudo tee -a` alimenté
  par le coffre en pipe.
- **I4.** Correction : nginx limite déjà le corps à 1 Mio (défaut) ; écrit
  explicitement `client_max_body_size 1m;` dans `/api/` pour que ce soit lu.
- **I5.** C6 mesuré par `nsenter -t <MainPID> -m -- runuser -u chalou --
  touch …` : refus (EROFS) hors du dossier, succès dedans.
- **I7.** C8 : chronomètre depuis la fin du `git push`, sondage externe
  toutes les 5 s jusqu'à présence de `acc-panel`, borne 60 s. C9 : champ
  `responseTime` du journal Fastify.
- **M1.** `/apps/fadebeat` sans barre finale : redirection 301 explicite vers
  la barre finale dans le vhost, pour ne plus dépendre de la graine.
- **M2.** Le dossier n'est pas sauvegardé : PASSATION dira « reconstruit par
  un push ».
- **M3.** L'en-tête de `mail.js` (« pas d'authentification ») et
  `.env.example` (port 25, adresse numérique) sont faux tous les deux :
  corrigés en P1, tous les deux.
- **M4.** Preuve d'identité par `sha256`, plus par la taille.
- M5, M6 : lus, acceptés tels quels.

### 2026-09-09, 22:00 — reprise après la journée du chantier 98 ; le secret

- **Le secret ne passe par aucune ligne de commande.** Fabriqué par
  `guichet ranger` (40 hexadécimaux, entrée `github/webhook-fadebeat`), posé
  sur hostinger par `guichet envoyer` vers un fichier À PART,
  `/etc/chalou/webhook-fadebeat` (root:chalou, 640), contrôlé identique par
  `guichet controler --contre` sans être vu. Le fichier de réglages ne reçoit
  que le CHEMIN de ce fichier (`GITHUB_WEBHOOK_SECRET_FILE`) et le dossier
  FadeBeat (`FADEBEAT_DOSSIER`) : aucune valeur. Le service lit la première
  ligne du fichier au démarrage et refuse de démarrer s'il est absent ou
  trop court. Pour GitHub, c'est Charles qui colle la valeur, dictée par
  `guichet pour-charles` (décision : création à la main, jeton `gh` non
  élargi).
- **Le rechargement nginx est devenu un script**, `nginx-recharger-sur`,
  installé sur hostinger : il teste, recharge sans redémarrer, et compare la
  réponse des quatre sites avant et après ; si le test échoue, il restaure le
  vhost sauvegardé et ne touche pas nginx. Demandé par Charles : « le moindre
  changement sur un site n'a aucune répercussion sur les autres ».
- Le faux `.env.example` (port 25 sans authentification) et l'en-tête faux
  de `mail.js` sont corrigés (M3 de la réfutation).
- Réglages ajoutés : `GITHUB_API_BASE`, `GITHUB_RAW_BASE` (défauts GitHub),
  pour le banc (I2 de la réfutation).

### 2026-09-09, 23:00 — preuves réelles et trouvailles

- **Alerte courriel prouvée en vrai** (décision de Charles : pas de réglage de
  banc) : dossier passé en lecture seule, relivraison GitHub → 500, fichier
  intact, aucun temporaire, courriel d'alerte parti (identifiant de message
  dans le journal), livré par le serveur de courrier en 3,4 s ; Charles l'a
  reçu. Puis droit d'écriture rendu, seconde relivraison → 200, sommet de
  master redéployé (journal : même identifiant de livraison, sha 293c3bc).
- **Épreuve indépendante** : 87 cas, 87 réussites, sur le code déployé. Deux
  constats de l'épreuvier pour l'auditeur : une relivraison réécrit le
  fichier avec un nouvel horodatage (contenu identique, octets différents) ;
  le freinage à 10/minute est clé sur l'adresse vue par le service — derrière
  nginx, c'est l'adresse transmise par `X-Forwarded-For` (`trustProxy` est
  actif), à faire vérifier par l'auditeur.
- **Trouvailles hors chantier** (écrites dans PASSATION §8) : l'épreuve du
  formulaire ne tournait plus depuis le durcissement du courrier du 2026-09-08
  (réparée le 2026-09-10, nœud 94.c : banc autonome, 30/30) ; le
  courriel d'alerte va dans la boîte de réception, pas dans le dossier
  « Alertes » de Charles (tri côté client, motif à aligner).

### 2026-09-09, 23:30 — corrections après l'audit

- B-1 → `trustProxy: '127.0.0.1'` (le relais nommé). PAS `trustProxy: 1` : dans Fastify 5.12 un compte de sauts se ferme et tout le monde devient 127.0.0.1 — régression attrapée par le second audit en production (formulaire limité à 3 messages par minute pour tous), corrigée dans l'heure. B-2 → file d'attente (une
  mise à jour à la fois) + relecture du sommet avant l'écriture (« dépassé »
  = 200 sans écriture, la livraison suivante déploie). I-1 → budget global
  8,5 s (API 3 s, brut ≤ 2,5 s par tentative, borné par le reste ; le plan
  disait 7 s à tort). I-2 → alerte courriel quand un push authentique vise
  une autre branche (hors tags) ou un dépôt au nom changé. M-1 balayage des
  temporaires au démarrage ; M-2 suffixe aléatoire ; M-3 marque sans
  horodatage ; M-4 délai → 502 ; M-5 PASSATION « reconstruit par un push » ;
  M-6 écrit ici : `ReadWritePaths` ouvre le DOSSIER, un service compromis
  pourrait y créer un autre fichier servi sous la CSP assouplie — accepté,
  conséquence du choix 1775 ; M-8 : `PROMPT-AGENT-SUIVANT.md` non modifié,
  il ne concerne pas ce morceau.
- Sujet des alertes : « [WARN] chalou.link — … », validé par Charles, pour
  le filtre « Alertes » du serveur de courrier.
- La section Sécurité du corps du plan dit encore « posé dans
  /etc/chalou/reglages » et « donné par l'API » : c'est l'amendement de
  22:00 qui fait foi (fichier à part, création à la main).

### 2026-09-09, 23:55 — après le second audit

- Second audit « pas prêt » : ma correction B-1 (`trustProxy: 1`) était fausse
  sur cette version de Fastify, un seul compteur pour tous ; corrigée par le
  relais nommé. Le budget démarre désormais à la sortie de la file (une
  livraison qui a attendu derrière une lente n'arrive plus sans temps).
  L'alerte de renommage ne part plus pour une branche de travail : seulement
  si le dépôt n'a plus le bon nom ou si sa branche par défaut n'est plus
  master. Deux phrases fausses de la doc corrigées (ancien sujet d'alerte,
  « nginx seul »).
- Ce que ce chantier a coûté en audits : réfutation du plan (4 bloquants),
  audit (2 bloquants), re-audit (1 bloquant né de ma correction). Trois passes
  de correction le même jour : c'est la limite du protocole. La suivante, si
  elle est nécessaire, se fera un autre jour.

### 2026-09-10, 00:20 — clôture

- Troisième audit « prêt », 14/14, écart 0 (`docs/fadebeat-webhook-audits.md`).
- Dépôt git initialisé dans `landing-chalou`, premier commit local `5cb8273`
  (48 fichiers ; parmi les noms de réglages, seul le gabarit d'exemple est
  indexé ; le banc et les réglages de banc sont exclus par `.gitignore`).
  Dépôt distant demandé par Charles : `charlespierru/chalou` sur GitHub, en ssh.
- Rétro, en trois lignes. (1) Ce que mes propres contrôles n'ont pas vu et
  que les audits ont trouvé : l'usurpation par X-Forwarded-For, la course
  entre livraisons, et ma correction fausse de `trustProxy` — un freinage ne
  se prouve qu'avec DEUX adresses sources, jamais une. (2) Ce que la
  planification n'avait pas vu : la sémantique exacte d'une option dans la
  version installée (Fastify 5.12 ferme un compte de sauts) — lire le code de
  la bibliothèque avant de corriger. (3) Questions posées à Charles qui
  avaient leur réponse dans le dépôt : aucune ; les questions posées
  portaient sur ses décisions (webhook à la main, réglage de banc, sujet
  [WARN]). Mémoire écrite : `freinage-deux-adresses`.

