# 94.b — réfutation du plan par l'auditeur indépendant (2026-09-09)

Rapport rendu par l'agent `auditeur`, déposé tel quel par la session principale (l'auditeur n'écrit pas dans le dépôt).

## Rapport de réfutation — plan `docs/fadebeat-webhook-plan.md`

**Note préalable.** Mon mandat m'interdit toute écriture dans le dépôt (Write/Edit/Bash modifiant le repo). Je n'ai donc **pas** créé `docs/fadebeat-webhook-plan-refutation.md` : le rapport complet est ci-dessous, à déposer par le superviseur s'il le juge bon. Rien n'a été modifié, ni en local ni sur `hostinger` (lecture seule : vhost, `grep` de directives nommées de l'unité, `ls -ld/-Z`, `ps -eZ`).

### Périmètre lu
Plan (176 lignes, 9 critères C1–C9, 7 phases). Contexte : `docs/PASSATION.md`, `server/src/{server,config,mail}.js`, `server/src/routes/contact.js`, `epreuve/*`, `.env.example`, `deploy/*`, `/mnt/data/Charles/DevPerso/zic-app/FadeBeat.html` (25 939 o, ligne CDN unique en l. 7, `<!DOCTYPE html>` en tête, HEAD `3784387`), et sur `hostinger` : `/etc/nginx/conf.d/chalou.link.conf`, directives de `chalou-site.service`, droits de `/var/www/chalou.link`.

---

### BLOQUANT

**B1 — `alias` + `try_files` : le bloc existant, tel que le plan veut le réutiliser, rend FadeBeat 404.**
Le bloc `location /apps/fadebeat/` en production contient `try_files $uri $uri/ =404;`. Avec `alias`, nginx compose le chemin testé par `try_files` à partir de l'URI **complète** (bug nginx #97, toujours ouvert en 1.26.3) : il cherchera `/var/www/chalou.link/fadebeat/apps/fadebeat/index.html`. `nginx -t` ne le voit pas ; seule une lecture réelle le voit. Le plan prévoit cette lecture (parade), donc la faute serait bavarde — mais le P0 tel qu'écrit garantit une panne puis un retour arrière. Remède : dans le bloc aliasé, **supprimer** `try_files` (nginx rend 404 lui-même pour un fichier absent, et `index index.html` hérité sert le dossier). Critère à ajouter au P0 : `curl -sI https://chalou.link/apps/fadebeat/` = 200 **et** `curl -sI .../apps/fadebeat/tailwind.js` = 200, avant de déclarer nginx rechargé.

**B2 — Le renommage atomique est incompatible avec « `index.html` seul fichier appartenant à `chalou` ».**
Créer un fichier temporaire puis `rename()` exige le droit d'écriture sur le **dossier**, pas sur le fichier. Si le dossier reste `root 755`, chaque push échoue (EACCES) — bavard mais site figé à chaque push. Si le dossier est ouvert à `chalou`, la promesse « `tailwind.js` en lecture seule » tombe : le service peut le renommer par-dessus. Remède qui tient les deux : dossier `root:chalou 1775` (sticky bit) — `chalou` crée son temporaire et renomme sur `index.html` (qui lui appartient), mais ne peut ni supprimer ni écraser `tailwind.js` (root). `ReadWritePaths` sous `ProtectSystem=strict` fonctionne bien pour ce cas (bind mount rw du dossier ; `rename` dans le même dossier reste sur le même montage). Deux précisions à écrire au plan : le chemin de `ReadWritePaths` doit exister au démarrage (sans préfixe `-`, un chemin absent fait échouer le démarrage du service — et `Restart=on-failure` bouclerait) ; le fichier créé hérite de l'étiquette `httpd_sys_content_t` du dossier (vérifié : `/var/www/chalou.link` porte cette étiquette, `Enforcing`), à confirmer par `ls -Z` après le premier écrit.

**B3 — La phase P4 est infaisable avec le jeton `gh` actuel.**
Mesuré : `gh api repos/charlespierru/FadeBeat/hooks` → **403 « Resource not accessible by personal access token »**. Le plan affirme « le webhook peut être créé par l'API » sans l'avoir vérifié. Remède : `gh auth refresh -s admin:repo_hook` (porte : action distante, à faire valider) ou création dans l'interface. Ajouter aussi `config.content_type=json` à la création : le défaut GitHub est `form` (`payload=…` url-encodé), qui ferait rejeter toutes les livraisons par un parseur `application/json` — C1 à C4 échoueraient sur le vrai GitHub tout en passant sur le banc.

**B4 — Trois pannes SILENCIEUSES non couvertes (les plus graves du plan).**
a) *Rejeu / désordre.* « Un rejeu réécrit le même contenu, sans effet » est faux : la relivraison d'une **ancienne** livraison (bouton « Redeliver », ou deux pushes rapprochés livrés dans le désordre) écrit l'ancien `sha`, le journal dit « succès », aucun courriel, site en retard jusqu'au push suivant. Remède : ne pas déployer le `sha` du corps mais le **sommet réel de `master`** lu par l'API (`GET /repos/…/commits/master`, non mis en cache), ou inscrire le `sha` déployé en commentaire dans `index.html` et refuser un `after` dont le `before` ne correspond pas.
b) *Fraîcheur de `raw.githubusercontent.com`.* Le raisonnement sur l'immutabilité par `sha` est juste (mesuré : `cache-control: max-age=300` sur les deux adresses, mais le contenu par `sha` ne peut pas se périmer). Le risque réel est ailleurs : un `sha` tout frais peut répondre **404 quelques secondes** (réplication) ; GitHub ne réessaie jamais ; le plan n'a pas de nouvel essai. Remède : 2–3 tentatives espacées (budget 8 s), ou l'API `contents?ref=<sha>` avec `Accept: application/vnd.github.raw` (mesuré 200, 25 939 o).
c) *Courrier ET GitHub injoignables.* Il reste : journald (personne ne le lit — PASSATION §4.5 : « le service web n'a pas d'alerte ») et la page « Recent Deliveries » (visible seulement si Charles va la regarder). Le plan doit le dire honnêtement, et au minimum : journaliser en `error`, répondre 5xx à GitHub **avant** d'envoyer le courriel (voir I6), et documenter « Recent Deliveries » comme second canal. La note « pas de panne silencieuse » de la section « Casser/Ouvrir » est fausse en l'état.

### IMPORTANT

**I1 — Corps brut sous Fastify 5 : le plan ne dit pas comment.** Le parseur JSON par défaut consomme le flux. Remède précis : dans le plugin `routes/github.js` (encapsulé, donc sans effet sur `/api/contact`), `app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 1024*1024 }, …)` : conserver le `Buffer`, calculer la HMAC dessus, puis `JSON.parse`. Garde obligatoire : `timingSafeEqual` **lance** si les longueurs diffèrent — une signature de mauvaise longueur doit donner 401, pas 500 (cas de sabotage à ajouter à C1).

**I2 — C5 et C9 ne sont pas mesurables sans un réglage de plus.** « Faux GitHub sur le banc » suppose une base d'URL configurable (`GITHUB_RAW_BASE` ou équivalent) ; `config.js` du plan ne liste que `GITHUB_WEBHOOK_SECRET` et `FADEBEAT_DOSSIER`. Sans lui, l'épreuve ne peut simuler ni l'absence de ligne CDN, ni GitHub injoignable, ni un GitHub qui traîne (sabotage de C9).

**I3 — Le secret passera par la ligne de commande.** `gh api -f config[secret]=…` et `ssh hostinger "echo … >> /etc/chalou/reglages"` exposent le secret dans `ps` et l'historique des deux machines. Remède : `gh api --input -` avec le JSON sur stdin ; côté serveur, `ssh hostinger 'sudo tee -a …'` alimenté par le coffre en pipe. Rappel : le service lit `--env-file=/etc/chalou/reglages` au démarrage → restart obligatoire (P3 le prévoit).

**I4 — « nginx transmet sans limite de taille propre » est faux.** Aucun `client_max_body_size` dans `nginx.conf` ni `conf.d/` → défaut **1m**. Au-delà, nginx répond 413 sans que le service ni le courriel ne le sachent (visible seulement chez GitHub). Sans gravité pour FadeBeat (un push pèse quelques Kio), mais à écrire explicitement dans la location `/api/`.

**I5 — C6 n'a pas de procédure de mesure.** « Tentative d'écriture ailleurs depuis le service » : `sudo -u chalou touch` ne teste pas le confinement systemd. Remède mesurable : `nsenter -t <MainPID> -m -- runuser -u chalou -- touch /var/www/chalou.link/courant/index.html` → attendu `EROFS` ; même geste dans `fadebeat/` → succès.

**I6 — L'alerte courriel fait dépasser les 10 s.** `mail.js` : `connectionTimeout 8000 + greetingTimeout 8000 + socketTimeout 15000`, après 8 s de téléchargement. En cas d'échec, GitHub coupe à 10 s et `proxy_read_timeout 30s` rend 504 : le « vrai message d'erreur » promis dans Recent Deliveries n'y sera pas. Remède : répondre 5xx d'abord (`reply.send()`), envoyer le courriel ensuite.

**I7 — C8 et C9 : mesurables, mais la procédure manque.** C8 : T0 = fin du `git push` local, sondage externe toutes les 5 s de `https://chalou.link/apps/fadebeat/` jusqu'à présence de `acc-panel`, borne 60 s. C9 : Fastify journalise `responseTime` dans « request completed » au niveau `info` (actif en production) — dire que c'est ce champ qu'on lit, et ajouter le cas d'échec (voir I6).

### MINEUR

- M1 — `/apps/fadebeat` **sans** barre finale tombe dans `location /` et dépend de `courant/apps/fadebeat/` : si la « graine » disparaît d'un futur déploiement, cette adresse devient 404. Garder la graine ou ajouter une redirection explicite.
- M2 — `/var/www/chalou.link/fadebeat/` n'est pas dans le périmètre décrit de la sauvegarde ; à vérifier (`chalou-backup.sh`), sinon PASSATION doit dire « reconstruit par un push ».
- M3 — Le commentaire en tête de `mail.js` (« pas d'authentification, pas d'élévation TLS ») est faux comme `.env.example` ; le plan ne corrige que le second. `.env.example` propose de surcroît `SMTP_HOST=10.10.10.3`, que `config.js` **refuse** au démarrage.
- M4 — « Identique en taille » n'est pas une preuve d'identité ; comparer un `sha256`.
- M5 — Le freinage 10/min peut être franchi par des relivraisons manuelles rapprochées : sans conséquence, mais à savoir en lisant Recent Deliveries.
- M6 — `tailwind.js` local est le compilateur Play (407 Ko) : les nouvelles classes d'une future version de FadeBeat passeront ; si FadeBeat épingle un jour une URL CDN différente, la règle « exactement une fois » alertera (bavard, acceptable).

### Épreuve du sabotage — bilan par critère
C1, C3, C4 : attrapent bien le retrait de leur garde. C2, C7 : sans sabotage prévu, acceptable. C5 : n'attrape rien tant qu'I2 n'est pas réglé. C6 : sans procédure (I5). C8 : n'attrape pas B4a ni B4b (un succès mensonger ou un 404 fugace passent le critère si le push d'essai a de la chance). C9 : n'attrape pas I6.

---

**Résumé (10 lignes)**
1. Rapport livré ici, pas en fichier : mon mandat interdit toute écriture dans le dépôt.
2. B1 : `alias` + `try_files $uri` = 404 garanti (bug nginx #97) ; retirer `try_files` du bloc aliasé.
3. B2 : temp+rename exige l'écriture sur le dossier, contradiction avec « seul `index.html` à `chalou` » ; proposer `root:chalou 1775`.
4. B3 : `gh api …/hooks` répond 403 (mesuré) ; P4 infaisable sans `admin:repo_hook` ; `content_type=json` oublié.
5. B4 : trois pannes silencieuses — relivraison/désordre qui régresse le site, 404 fugace du `sha` frais sans nouvel essai, courrier+GitHub morts = journald seul.
6. I1 : corps brut = `addContentTypeParser(parseAs:'buffer')` encapsulé ; garder 401 sur signature de mauvaise longueur.
7. I2 : sans base d'URL configurable, C5 et le sabotage de C9 sont inmesurables sur le banc.
8. I3 : secret sur ligne de commande (gh, ssh) ; passer par stdin. I4 : nginx limite déjà à 1m, le plan dit le contraire.
9. I5–I7 : C6 sans procédure ; l'alerte courriel (jusqu'à 31 s) casse les 10 s ; C8/C9 à outiller.
10. Verdict : plan **pas prêt** en l'état — quatre bloquants, dont un qui rend l'outil silencieux (B4).