# 94.b — les trois audits indépendants du 2026-09-09, déposés tels quels

Rendus par l'agent `auditeur` dans ses réponses (son portier n'écrit pas dans le dépôt).

## Audit 1 (23:20) — « pas prêt »

Rien ne traîne (le `pgrep` n'a attrapé que ma propre ligne de commande). La course est maintenant prouvée proprement : livraison 2 (B) écrite à +5559 ms avec 200, puis livraison 1 (A, plus lente) écrite par-dessus à +7023 ms avec 200 « deploye A », fichier final = A alors que le sommet réel est B, zéro ligne d'erreur, zéro alerte.

J'ai tout ce qu'il me faut. Mon portier interdit l'écriture dans le dépôt (et le harnais interdit les fichiers de rapport) : le rapport est rendu intégralement ci-dessous.

---

# Audit indépendant — 94.b « FadeBeat se met à jour toute seule — webhook GitHub »

## 1. Périmètre audité

- Plan : `/mnt/data/Charles/DevPerso/landing-chalou/docs/fadebeat-webhook-plan.md` (critères C1–C9, amendements du 2026-09-09 faisant foi) et `docs/fadebeat-webhook-plan-refutation.md`.
- Code lu : `server/src/routes/github.js`, `server/src/config.js`, `server/src/mail.js`, `server/src/server.js`, `server/src/db.js`, `.env.example`, `.gitignore`.
- Doc lue : `docs/PASSATION.md` §1, §2, §8.
- Production (lecture seule) : vhost `/etc/nginx/conf.d/chalou.link.conf`, directives nommées de `chalou-site.service` et du drop-in `fadebeat.conf`, droits/étiquettes de `/var/www/chalou.link/fadebeat/`, droits (jamais le contenu) de `/etc/chalou/`, script `/usr/local/sbin/nginx-recharger-sur`, journal du service.
- Extérieur : `https://chalou.link/apps/fadebeat/`, `/apps/fadebeat` sans barre, `tailwind.js`, `/api/sante`, POST sur `/api/github/fadebeat`, les 5 hôtes, et l'API publique GitHub (sommet de `master`).
- **Mon propre banc** (scratchpad, jamais dans le dépôt) : faux GitHub (API + brut pilotables : délais, codes, contenus), faux courrier, préchargement qui détourne le port 587, service lancé sur le vrai code ; 43 cas à moi (A1–A16, B1–B6, C1–C5, D1–D10, E1–E2, F1–F2, G1, H1–H2) + une rejouée isolée de la course F1 avec chronologie.
- Garde-fou : le portier a bloqué la génération d'un fichier `.key` pour un faux courrier STARTTLS. Je n'ai pas contourné : mon faux courrier est en clair. Conséquence : je prouve qu'une alerte est **tentée** (connexion + `EHLO` + `STARTTLS` reçus) et **quand**, mais je n'ai pas capturé le **contenu** des courriels ; pour lui je m'appuie sur le code et sur le journal prod (`messageId` d'une alerte réellement envoyée).

Critères recensés : **9** (C1–C9).

## 2. Verdicts, critère par critère

1. **C1 — sans signature / signature fausse → 401, fichier intact : conforme.** Banc : A1 sans en-tête, A2 `sha256=` vide, A3 mauvaise longueur, A4 bonne longueur fausse, A5 hexadécimal en majuscules, A6 `sha1=`, A7 clé = 2ᵉ ligne du fichier, A8 clé = fichier entier, A9 signature sur JSON reformaté, A13 corps + 1 octet → **401 ×10, empreinte du fichier identique, jamais 500**. Prod : POST sans signature → `401 {"erreur":"signature-invalide"}` en 35 ms ; signature `sha256=abc` → 401 ; corps `form` → 415 (avant toute lecture). HMAC calculé sur le `Buffer` brut (`addContentTypeParser(parseAs:'buffer')` encapsulé), comparaison `timingSafeEqual` après garde de longueur (lu). Le corps brut survit à un `Content-Type: application/json; charset=utf-8` (A11 → 200).
2. **C2 — ping signé → 200, fichier intact : conforme.** Banc A10/A11 → `200 {"pong":true}`, intact. Prod journal : `req-5` ping, livraison `0691a480…`, 200 en 3,2 ms.
3. **C3 — autre branche / autre dépôt → 204, intact : conforme.** Banc B1 (`refs/heads/dev`), B2 (`charlespierru/Lutrin`), B3 (`release`) → 204, intact, journalisé « ignoré ». Voir toutefois **I-2** (renommage = silence).
4. **C4 — push valide → fichier remplacé, ligne locale, CDN absent, > 10 Kio : conforme.** Banc C1 avec le vrai `FadeBeat.html` (25 939 o) : 200 en 39 ms, CDN = 0, `tailwind.js` local = 1, contenu strictement égal à l'attendu hors marque, 26 061 o, mode 644, marque = sha rendu par l'API. Prod, depuis l'extérieur : 200, 26 061 o, `text/html`, CDN 0, ligne locale 1, `acc-panel` 1, marque `<!-- FadeBeat 293c3bc… -->` = sommet de `master` lu par moi sur `api.github.com`.
5. **C5 — fichier invalide ou GitHub injoignable → fichier INCHANGÉ, 5xx, courriel : conforme.** Banc D1 sans CDN, D2 deux CDN, D3 9 Kio, D4 sans doctype, D5 2,1 Mio, D6 brut 404 ×3, D7 API 404, D8 sha mal formé, D9 API muette, D10 renommage impossible → 502/500, empreinte identique, dossier = exactement `index.html, tailwind.js` (aucun temporaire), **une connexion courrier par cas, ouverte 1–46 ms APRÈS la réponse**. Prod journal `req-7` : EACCES (dossier en lecture seule) → 500 en 555 ms, puis « alerte envoyée » avec `messageId` 3,8 s plus tard, fichier réécrit ensuite par `req-8`.
6. **C6 — écriture possible dans le seul dossier FadeBeat : conforme (par lecture, test d'écriture interdit).** Unité : `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, `NoNewPrivileges=yes`, `User/Group=chalou` ; drop-in : une seule ligne, `ReadWritePaths=/var/www/chalou.link/fadebeat` ; aucun `StateDirectory`, `BindPaths`, autre `ReadWritePaths`. Dossier `drwxrwxr-t root:chalou` (1775), `index.html` `chalou:chalou 644` étiquette `system_u:object_r:httpd_sys_content_t`, `tailwind.js` `root:root 644` (sticky bit → non écrasable). Nuance : le `/tmp` privé et `/dev/shm` restent inscriptibles, sans effet web.
7. **C7 — les autres vhosts inchangés : conforme.** Mesuré aujourd'hui : `chalou.link`, `www.chalou.link`, `tonik.ink`, `axelise.fr`, `usa.chalou.link` → 200. Script `nginx-recharger-sur` lu : `nginx -t`, `reload` (jamais `restart`), photo des 4 codes avant/après, refus + restauration si le test échoue. Il ne compare que les codes HTTP, pas le contenu — suffisant pour le critère.
8. **C8 — push réel → site à jour sous 60 s : conforme sur preuves observées, non rejoué par moi (push interdit).** Journal prod `req-6` : livraison `1e15c014…` reçue, « FadeBeat mise à jour » 754 ms plus tard, `sha 293c3bc`, `annonce` = même sha, 26 061 o ; fichier servi = ce sha ; API GitHub = ce sha.
9. **C9 — réponse < 10 s « dans tous les cas » : ÉCART.** Réel : 755 / 555 / 455 ms (journal). Mais pire cas mesuré sur mon banc, **E1 : API à 2,8 s (sous son délai de 3 s) + brut muet → 502 en 12 309 ms**. Le budget du code est 3 s + 3 × 2,5 s + 2 × 1 s = **12,5 s** ; le plan (B4b) affirme « budget total 7 s ». E2 (API rapide + brut muet) : 9 508 ms, à 0,5 s de la limite. Bavard (GitHub affiche « timed out », le courriel part quand même), mais le critère est « dans tous les cas ».

## 3. Trouvailles hors critères, classées

### Bloquant

**B-1 — Le freinage est clé sur une adresse choisie par le client : un inconnu peut bloquer les vraies livraisons GitHub, en silence.**
`server.js` : `trustProxy: true` = confiance à *tous* les sauts → `request.ip` = valeur la plus à **gauche** de `X-Forwarded-For`. Vhost : `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` **ajoute** l'adresse réelle à **droite** de ce que le client a envoyé. **Prouvé en prod** : 11 POST non signés depuis ma machine avec `X-Forwarded-For: 203.0.113.77` → `401 ×10, 429` ; puis `X-Forwarded-For: 203.0.113.78` depuis la même machine → `401` (bucket neuf). Banc G1 : même chose, la valeur de droite (réelle) ne compte pas. Conséquence : 10 requêtes par minute avec `X-Forwarded-For: <adresse de hookshot>` (plages publiques sur `api.github.com/meta`) et toute livraison réelle reçoit 429 **avant la route** : pas de journal d'erreur, pas de courriel, site en retard tant que l'attaque dure — visible seulement dans « Recent Deliveries ». Accessoirement, le freinage est contournable à volonté (XFF changeante). Remède d'une ligne : `trustProxy: 1` (un seul saut, Fastify prend alors l'adresse ajoutée par nginx) — et le formulaire de contact (60/min) est dans le même cas, hors chantier.

**B-2 — Deux livraisons rapprochées : l'ancienne version peut écraser la nouvelle, avec deux 200 et zéro alerte.**
Rejouée isolément : livraison 1 lit `master = A`, brut de A lent (1,5 s) ; livraison 2 arrive 80 ms après, lit `master = B`, écrit B (+5559 ms, 200) ; livraison 1 finit et **écrit A par-dessus** (+7023 ms, `200 {"deploye": A}`). Fichier servi = A, sommet réel = B, `0` ligne d'erreur, `0` courriel. Le remède B4a du plan (lire le sommet réel) ne ferme pas la fenêtre : la lecture et l'écriture ne sont pas atomiques entre elles, et rien ne sérialise deux livraisons. Fenêtre réelle : la durée du téléchargement de la 1ʳᵉ — jusqu'à 9,5 s avec les nouveaux essais sur 404 fugace, scénario que le plan lui-même juge plausible (B4b). Silencieux jusqu'au push suivant. Remède : une file (une mise à jour à la fois) et/ou relire le sommet juste avant le `rename` et abandonner si ce n'est plus le sha téléchargé.

### Important

**I-1 — C9 : pire cas 12,5 s > 10 s** (détail au verdict 9). Cas retors possible : GitHub coupe à 10 s, le service réussit à 11 s → « Recent Deliveries » dit échec, le site est à jour ; ou l'inverse. Remède : un budget global partagé (~8 s) au lieu de délais empilés.

**I-2 — Renommage de branche ou de dépôt = site figé, sans alerte.** `BRANCHE`, `DEPOT` et l'appel `branches/master` sont codés en dur. Banc B4 (`refs/heads/main`, `default_branch: main`) et B5 (`charlespierru/FadeBeat2`) → 204 « ignoré », **0 courriel** (B6). Un jour où Charles renomme `master` en `main`, chaque push est « ignoré » au niveau `info`, et rien ne le lui dit. Remède : alerter quand le dépôt est le bon mais la branche n'est pas `master`, ou suivre `repository.default_branch`.

### Mineur

- **M-1** — Temporaire abandonné jamais nettoyé : un `.index.html.tmp-999-1` posé avant un push réussi est **toujours là après** (C2). Un kill entre `writeFile` et `rename` laisse donc un fichier à `chalou` dans un dossier servi par nginx (servi si nommé ; nom peu devinable). Prod aujourd'hui : 0 temporaire. Remède : balayer `.index.html.tmp-*` au démarrage.
- **M-2** — Nom de temporaire `pid-Date.now()` : deux livraisons dans la même milliseconde se partagent le nom → l'une échoue au `rename` (500 + courriel, bavard). Suffixe aléatoire.
- **M-3** — La marque HTML porte un horodatage : une relivraison réécrit des octets différents (C3), `ETag`/`Last-Modified` changent, et le sha256 du fichier ne peut plus servir de preuve d'identité (contredit M4 de la réfutation). Le plan dit encore « un rejeu réécrit le même contenu ».
- **M-4** — API muette → 500 (D9, `AbortError` n'est pas un `Refus`) alors que toute autre panne GitHub → 502. Cosmétique.
- **M-5** — Doc : l'amendement M2 promettait que PASSATION dirait « reconstruit par un push » ; aucune occurrence, et `chalou-backup.sh` ne mentionne pas `fadebeat/` (grep vide). PASSATION §1 « seul endroit où le service a le droit d'écrire » : nuance `/tmp` privé. Le plan affirme « budget total 7 s » pour un code à 9,5 s.
- **M-6** — `ReadWritePaths` ouvre **le dossier**, pas le seul `index.html` : un service compromis peut y créer n'importe quel fichier, servi par nginx sous `/apps/fadebeat/` avec la CSP assouplie (`unsafe-inline`, `unsafe-eval`). Le plan dit « réécrire FadeBeat, rien d'autre » — c'est un peu plus. Accepté par le choix 1775, à écrire.
- **M-7** — `.git` absent de `/mnt/data/Charles/DevPerso/landing-chalou/` : la porte « commit » du plan n'est pas exécutable en l'état (PASSATION §4.2 le sait).
- **M-8** — `docs/PROMPT-AGENT-SUIVANT.md` : 0 mention du webhook (« si concerné », à trancher).
- **M-9** — Mes sondes prod ont laissé 13 lignes `warn` (401) et un 429 dans le journal du service ; adresses de documentation RFC 5737, rien d'autre touché.

### Points du mandat, un par un

1. Freinage : **B-1**. 2. Signature : conforme (brut, temps constant, 401 partout, charset OK, A1–A13). 3. Corps non cru / course : sommet lu par l'API (`annonce` seulement journalisé) ; course → **B-2**. 4. Validation, atomicité, droits : conforme (D1–D5, D10 ; 644, `chalou`, `httpd_sys_content_t`) ; temporaire → **M-1/M-2**. 5. < 10 s : **I-1** ; alerte après réponse : prouvé (banc 1–46 ms après, prod +3,8 s) ; secret : 0 occurrence dans journal/réponses/courrier du banc (H1), en-tête de signature jamais journalisé, mot de passe SMTP absent (H2). 6. Confinement : C6. 7. nginx : `alias` sans `try_files` (lu), 301 mesuré, CSP racine inchangée et CSP FadeBeat assouplie identique à l'attendu avec les 4 en-têtes répétés dans le bloc, `client_max_body_size 1m`, 5 hôtes 200. 8. Secret : `/etc/chalou/webhook-fadebeat` `root:chalou 640`, 41 octets (cohérent avec 40 hexa + fin de ligne, taille seule lue) ; grep du dépôt : seules des mentions de noms de variable ; `.env.example` sans valeur ; `config.js` lit la première ligne seulement (A7/A8). 9. Doc : PASSATION conforme au réel (graine annoncée §1, épreuve du formulaire cassée signalée §8), sauf **M-5**. 10. Oubli du plan : renommage → **I-2** ; CDN changé, fichier disparu → bavards (D1, D6) ; 50 relivraisons → 429 après 10, site déjà au sommet (F2 : 3 simultanées, 200 ×3, dossier propre) ; deux livraisons simultanées → **B-2**.

## 4. Couverture

- Critères vérifiés : **9 sur 9**, écart : **1** (C9).
- Aucune surface d'écran dans ce chantier ; états externes exercés : page servie, redirection sans barre, `tailwind.js`, temporaire nommé (404), `/api/sante`, POST sans signature / mauvaise longueur / `form` / GET, 5 hôtes.
- Cas de banc fabriqués par moi : 43 + 1 rejouée, tous rendus avec verdict ; 2 écarts (E1, F1), 4 constats (B6, C2, C3, G1).
- Non fait : contenu des courriels d'alerte (portier), test d'écriture en prod (interdit), push réel (interdit).

## 5. Résumé (10 lignes)

1. La signature est solide : 10 formes fausses → 401, jamais 500, corps brut, charset toléré, première ligne du secret seule lue.
2. Les refus sont tous bavards : 10 pannes provoquées → 5xx, fichier intact, aucun temporaire, courriel tenté après la réponse.
3. Le push réel du 2026-09-09 est cohérent sur trois sources (journal, fichier servi, API GitHub) : 754 ms, sha 293c3bc.
4. **Bloquant B-1** : le freinage est clé sur la valeur gauche de `X-Forwarded-For`, choisie par le client (prouvé en prod) : 10 requêtes/min et les vraies livraisons reçoivent 429 sans journal ni courriel.
5. **Bloquant B-2** : deux livraisons rapprochées → l'ancienne version écrase la nouvelle avec deux 200 et aucune alerte (rejoué, chronologie à l'appui).
6. **Important I-1 (C9)** : pire cas 12,3 s mesuré, budget code 12,5 s, le plan disait 7 s.
7. **Important I-2** : branche ou dépôt renommé → 204 « ignoré » sans alerte, site figé.
8. Confinement, nginx, droits, étiquette SELinux, secret hors ligne de commande, `.env.example` : conformes.
9. Mineurs : temporaire jamais nettoyé, nom de temporaire collisionnable, relivraison change les octets, PASSATION sans « reconstruit par un push », dossier non sauvegardé, pas de `.git`.
10. Deux remèdes tiennent en quelques lignes (`trustProxy: 1` ; une file + relecture du sommet avant `rename`).

## 6. Verdict global

**Pas prêt** : deux fautes silencieuses (freinage usurpable en prod, course entre livraisons) contredisent la promesse « pas de panne silencieuse », s'ajoutant à l'écart mesuré sur C9 ; le reste du livré est conforme et bien prouvé.

---

## Audit 2 (23:45) — « pas prêt »

# Rapport de re-audit — nœud 94.b « FadeBeat par webhook », seconde passe

## Résumé (10 lignes)

1. **PAS PRÊT — un bloquant nouveau, prouvé en production** : `trustProxy: 1` ne corrige pas B-1, il l'aggrave. Dans Fastify 5.12.3 (local ET prod, `node_modules/fastify/lib/request.js:52` : « Hop-count-only trust cannot validate the immediate peer. Fail closed »), un `trustProxy` numérique ne fait confiance à **aucun** saut : `request.ip` = 127.0.0.1 (nginx) pour tout le monde.
2. Conséquence mesurée depuis l'extérieur : après 3 POST `/api/contact` depuis ma machine, **hostingerd (187.77.168.112, autre adresse) reçoit 429** ; après 10 POST non signés sur la route, **hostingerd reçoit 429**. Un seul compteur pour la planète : 10 requêtes non signées de n'importe qui bloquent les vraies livraisons GitHub une minute (429 silencieux : ni journal applicatif, ni courriel), et le formulaire de contact est limité à 3 messages/minute pour tous les visiteurs réunis (régression du site).
3. La mesure de l'implémenteur (« 401×10 puis 429, autre en-tête forgé → 429 ») est vraie mais ne distingue pas « compteur par adresse réelle » de « compteur commun » ; il fallait deux adresses sources.
4. B-2 (course) : conforme sur banc — A lent puis B : fichier final = B, livraison A → 200 « dépassé » sans écriture ; même sommet simultané : deux 200, octets identiques ; sommet changé entre téléchargement et relecture → 200, rien écrit ; ping/sante/contact répondent en < 10 ms pendant un brut lent.
5. I-1 : toutes les réponses < 10 s (max 8 504 ms) ; budget épuisé avant la relecture → 502 sans écriture (sûr). Le délai couvre bien la lecture du corps (goutte-à-goutte coupé à 2,5 s, 2e tentative réussie).
6. **Important (bavard, pas silencieux)** : le budget démarre AVANT l'attente dans la file. Une livraison qui attend 7,7 s derrière une lente arrive avec ~0,8 s : à 400 ms par appel GitHub → 502 « budget épuisé », site en retard d'un push, courriel envoyé, relivraison manuelle nécessaire.
7. I-2 : conforme (main → 204 + alerte ; tag → 204 sans ; dépôt renommé → 204 + alerte ; ping → rien). Bavard en plus : suppression d'une branche feature et corps `{}` signé alertent aussi.
8. M-1/M-2/M-3/M-4 : conformes (temporaire balayé et journalisé, suffixe aléatoire, relivraison = sha256 identique, API muette → 502 en 3,0 s + alerte).
9. Régression : 87/87 à l'épreuve (145,8 s) ; code prod = local (4 empreintes égales) ; page servie 200, 26 061 octets, 0 ligne CDN, 1 ligne locale, `acc-panel` présent, sha256 prod = sha256 lu dehors ; 0 temporaire en prod ; aucun secret dans le dépôt.
10. Doc : PASSATION §8 (l. 385) affirme encore l'ancien sujet « [chalou.link] ALERTE — … » et §8bis/plan affirment « nginx seul » — faux tous deux.

## 1. Périmètre audité

- Plan : `/mnt/data/Charles/DevPerso/landing-chalou/docs/fadebeat-webhook-plan.md` (amendement 23:30) ; PASSATION §1 et §8bis ; code `server/src/{server.js,routes/github.js,mail.js,config.js}`.
- Mandat : 7 points de re-audit (B-1, B-2, I-1, I-2, M-1..M-4, régressions, doc). Critères de recette C1–C9 non refaits sauf où touchés (C4, C5, C8-lecture, C9).
- Banc : le mien (`scratchpad/banc/lib.mjs`, scen1/2/3), faux GitHub pilotable par requête, faux courrier STARTTLS, service lancé sur le code du dépôt. Prod en lecture seule + requêtes HTTP depuis ma machine et hostingerd.

## 2. Verdicts

1. **B-1 freinage — ÉCART BLOQUANT.** Mesure locale (`ip.mjs`, mini-Fastify 5.12.3) : `trustProxy: 1` + `X-Forwarded-For: 9.9.9.9, 10.1.0.7` → `ip: 127.0.0.1` ; `trustProxy: "127.0.0.1"` → `ip: 10.1.0.7` (la bonne sémantique existe, ce n'est pas celle livrée). Prod : `curl` ×4 `/api/contact` depuis chez moi → `400 400 400 429` ; puis 1 POST depuis hostingerd → **429**. Route : `401`×10 puis `429` ; 1 POST depuis hostingerd → **429** ; `/api/sante` depuis hostingerd → 200 (global 60/min pas encore atteint). L'en-tête forgé ne crée plus de compteur neuf (vrai) mais parce qu'il n'y a plus qu'UN compteur. Le formulaire de contact n'a plus de freinage « par visiteur réel ».
2. **B-2 — conforme.** scen1 : r1 (sommet A, brut 2 s) → `200 {"deploye":null,"depasse":"bd78…"}` ; r2 → `200 {"deploye":"bd78…"}` ; fichier contient B, pas A. Même sommet C simultané : deux 200, sha256 `c6fb43c9…` ; relivraison → même sha256. Sommet D→E pendant le téléchargement, sans livraison E : `200 depasse`, fichier inchangé, journal « sommet dépassé… rien écrit ». Pendant un brut de 2,4 s : ping 2 ms, sante 4 ms, contact 9 ms (400 attendu).
3. **I-1 — conforme sur le < 10 s, avec réserve importante.** API muette → 502 en 3 010 ms ; brut muet ×3 → 502 en 8 504 ms ; API 2,8 s + brut muet → 8 504 ms ; API 2,8 s + brut 2,3 s + relecture API 2,8 s → 502 « délai dépassé » en 8 503 ms, rien écrit ; brut muet puis ok 2,2 s + relecture 0,3 s → 502 en 8 503 ms, rien écrit. La relecture compte dans le budget ; épuisé → refus, jamais écriture sans relecture. **Réserve** (scen3) : r1 200 en 7 752 ms (déploie A), r2 arrivée +100 ms, sommet B, GitHub à 400 ms/appel → `502 "budget de temps épuisé avant de joindre GitHub"` en 8 054 ms, fichier = A, 1 alerte. Le budget devrait démarrer à la sortie de la file.
4. **I-2 — conforme.** scen2 : `refs/heads/main` → 204 + 1 alerte `[WARN] chalou.link — webhook…` ; `refs/tags/v1` → 204, 0 ; `charlespierru/FadeBeat2` → 204 + 1 ; ping → 200, 0 ; release → 204, 0. En plus : `refs/heads/feature deleted:true` → alerte ; corps `{}` signé → alerte (bavard).
5. **M-1..M-4 — conformes.** `.index.html.tmp-4242-deadbeef` posé avant démarrage → absent après, journal `{"level":40,…,"fichier":".index.html.tmp-4242-deadbeef","msg":"temporaire abandonné balayé"}` ; nom = pid + 12 hex aléatoires (code l.142) ; relivraison → sha256 identique ; API muette → 502 + alerte. Sujet observé `[WARN] chalou.link — …`.
6. **Régressions — conforme sauf B-1.** Épreuve : `tests 87, pass 87, fail 0, 145 794 ms` (bac dans le scratchpad). Prod : `chalou-site` active ; `/apps/fadebeat/` 200, 26 061 octets, `cdn.tailwindcss` 0, `tailwind.js` 1, `acc-panel` 1 ; sha256 fichier prod `106b9f90…` = sha256 téléchargé ; `tailwind.js` 200 ; `/apps/fadebeat` → 301 ; dossier `drwxrwxr-t root:chalou`, `index.html chalou:chalou 644`, 0 temporaire ; `grep GITHUB_WEBHOOK_SECRET=` vide hors bac. Note : la page prod porte encore la marque horodatée (écrite 21:02 UTC par l'ancien code ; aucune écriture depuis).
7. **Doc — écart.** `docs/PASSATION.md:385` : « celui du webhook est « [chalou.link] ALERTE — … ». À aligner » — contredit §8bis et le code (`mail.js:83`). `PASSATION.md:397-398` et plan l.281 : « un seul saut de confiance (`trustProxy: 1`), nginx seul » — faux (mesuré). `docs/site-chalou-etude-terrain.md:77` parle encore de `trustProxy: true` (document d'étude, acceptable). PROMPT-AGENT-SUIVANT non modifié (mtime 09-08), conforme à M-8.

## 3. Trouvailles hors critères

- Pas de `.git` (M-7 toujours ouvert, commit attendu en porte).
- `epreuve/bac/` contient un `secret-webhook` et `reglages-banc.conf` de 22:17 (banc manuel de l'implémenteur), gitignorés ; pas le vrai secret d'après leur date/usage, mais un fichier nommé « secret » qui traîne. *(Note du 2026-09-10 : ces fichiers n'existent plus ; depuis le nœud 94.c, aucune épreuve ne lit de réglages de banc pré-écrits.)*
- Alerte I-2 « bavarde » sur toute branche de travail du dépôt FadeBeat : chaque push feature enverra un courriel [WARN].

## 4. Couverture

- 7 points du mandat vérifiés sur 7 ; écarts : 1 bloquant (B-1), 1 important (budget avant file), 1 doc.
- États exercés : 3 cas de course + 2 simultanés + 1 dépassé + non-blocage ; 8 chronos ; 8 cas I-2 ; M-1..M-4 ; 87/87 épreuve ; 5 mesures prod externes avec 2 adresses sources.
- **Non observé** : directives nommées de l'unité (`systemctl cat`/`show`) et journal prod (`journalctl`) — bloqués trois fois par le hook `porte.py` comme « déversement de secrets d'un service », même filtrés. Je n'ai pas contourné ; à faire par le superviseur si nécessaire (ReadWritePaths avait été vu au premier audit ; le code déployé est identique au local).

## 5. Verdict global

**Pas prêt** : la correction de B-1 remplace un freinage usurpable par un freinage commun à tous (prouvé en prod depuis deux adresses), ce qui bloque silencieusement les livraisons GitHub et casse le formulaire de contact ; la bonne forme est `trustProxy: '127.0.0.1'` (ou fonction), mesurée comme rendant l'adresse ajoutée par nginx. Les autres corrections (B-2, I-1, I-2, M-1..M-4) sont conformes ; à corriger aussi le départ du budget dans la file et les deux phrases fausses de la doc.

---

## Audit 3 (00:10) — « prêt »

# Rapport — troisième audit ciblé, nœud 94.b « FadeBeat par webhook »

## 1. Périmètre audité

- Plan lu : `/mnt/data/Charles/DevPerso/landing-chalou/docs/fadebeat-webhook-plan.md` (amendements 23:30 et 23:55), `docs/PASSATION.md` §8 et §8bis, nœud 94.b de `PLAN_TREE.md`.
- Code lu : `server/src/server.js`, `server/src/routes/github.js`, `server/src/routes/contact.js`, `server/src/config.js`, `server/src/mail.js`.
- Mandat : 4 points (B-1 en prod et sur banc ; budget à la sortie de la file ; alerte de renommage ; régressions), soit 14 sous-critères recensés ci-dessous.
- Préalable vérifié : le code déployé sur hostinger (`/opt/chalou/server/src/server.js`, `routes/github.js`) a le même sha256 que le code local (`87e027bb…`, `1749005a…`). Ce que j'ai lu est bien ce qui tourne.

## 2. Verdicts

**Point 1 — B-1, freinage par adresse réelle**

1. Route webhook, 11 POST non signés depuis ma station → `401 401 401 401 401 401 401 401 401 401 429`. **Conforme.**
2. Route webhook, depuis hostingerd (`ssh hostingerd curl …`) dans la même minute → `401` (pas 429 : compteur distinct). **Conforme.**
3. Route webhook, `X-Forwarded-For: 203.0.113.77` forgé depuis la station freinée → `429` (l'en-tête n'a pas ouvert un nouveau compteur). **Conforme.**
4. `/api/contact`, 4 envois depuis la station (leurre rempli, rien n'est envoyé ni archivé) → `202 202 202 429`. **Conforme.**
5. `/api/contact`, depuis hostingerd juste après → `202` (pas 429). **Conforme.**
6. `/api/contact`, 5e envoi station avec XFF forgé → `429`. **Conforme.**
7. Banc local (`scratchpad/banc-trustproxy.mjs`, Fastify 5.12.3 du repo, faux nginx = connexion depuis 127.0.0.1 qui ajoute XFF) avec `trustProxy: '127.0.0.1'` : XFF `203.0.113.5` → `request.ip = 203.0.113.5` ; XFF forgé `1.2.3.4, 203.0.113.5` → `203.0.113.5` (la valeur ajoutée par nginx, pas celle du client) ; connexion directe depuis 127.0.0.2 avec XFF forgé → `127.0.0.2` (en-tête ignoré). Contre-épreuve : `trustProxy: 1` donne `127.0.0.1` pour tous (le bug du second audit reproduit), `trustProxy: true` donne `1.2.3.4` (usurpation du premier audit reproduite). **Conforme.**

**Point 2 — budget créé à la sortie de la file**

8. Banc local (`scratchpad/banc2/banc.mjs`, service réel `server.js` + faux GitHub à délais programmés) : r1 avec API 2,8 s → A, brut 2,4 s, relecture 2,4 s → B ; r2 envoyée 100 ms après ; GitHub à 400 ms ensuite. Résultat : r1 → `200 {"deploye":null,"depasse":"bbbb…"}` en 7 651 ms ; r2 → `200 {"deploye":"bbbb…"}` en 8 758 ms ; fichier servi = `VERSION-bbbb`, marque `<!-- FadeBeat bbbb… — servi par chalou.link, mis à jour par webhook -->` (sans horodatage), 0 temporaire. Le journal du service porte « sommet dépassé pendant le téléchargement, rien écrit » puis « FadeBeat mise à jour sha=bbbb ». Avant la correction, r2 n'aurait eu que ~0,8 s de budget. **Conforme.**

**Point 3 — alerte de renommage** (alerte observée par la ligne de journal `l'alerte n'est pas partie (connect ECONNREFUSED 127.0.0.1:587)` : le banc n'a pas de courrier, ce qui prouve la tentative d'envoi ; l'absence de ligne prouve l'absence de tentative)

9. Push signé `refs/heads/feature`, dépôt `charlespierru/FadeBeat`, `default_branch: master` → `204`, 0 ligne d'alerte. **Conforme.**
10. Idem avec `default_branch: main` → `204` + 1 alerte. **Conforme.**
11. Push sur `refs/heads/master` du dépôt `charlespierru/FadeBeat2` → `204` + 1 alerte. **Conforme.**
12. Tag `refs/tags/v1`, dépôt bon, `default_branch master` → `204`, 0 alerte. **Conforme.** (Cas supplémentaire : sans champ `default_branch` → 204, 0 alerte ; fichier servi intact dans les cinq cas.)

**Point 4 — régressions**

13. Épreuve `epreuve/epreuve-webhook-fadebeat.test.js` lancée par moi (bac dans le scratchpad, pas dans le repo) : `tests 87, pass 87, fail 0`, 145,7 s ; cas L1 (clé partagée absente des réponses, du journal, des courriels) passé ; ma propre recherche de la clé de banc dans le journal : 0 occurrence. Page prod `https://chalou.link/apps/fadebeat/` → 200, 26 061 octets, `acc-panel` ×1, `cdn.tailwindcss.com` ×0, `src="tailwind.js"` ×1 ; `tailwind.js` → 200 ; `/api/sante` → 200. Dossier prod (`ls` en lecture seule sur hostinger) : `index.html` (chalou, 26 061) et `tailwind.js` (root) seulement, 0 temporaire, dossier `1775 root:chalou`. Secret : aucune chaîne de 40 hexadécimaux dans le repo hors `node_modules`/`bac` autre que le sha de commit `293c3bc…` ; `.env.example` ne porte que le chemin `/etc/chalou/webhook-fadebeat`. **Conforme.**
14. Doc : `trustProxy: '127.0.0.1'` écrit dans PASSATION §8bis (l. 400) et dans le plan (l. 281, 303) avec l'explication du `1` fautif ; budget 8,5 s (PASSATION l. 411) ; règle de renommage « branche par défaut ≠ master ou dépôt renommé » (plan l. 305-307). « nginx seul » ne subsiste que dans l'amendement qui dit l'avoir corrigé ; aucun ancien sujet d'alerte ne subsiste, seul « [WARN] chalou.link — … » apparaît (PASSATION l. 387, 417 ; `mail.js` l. 83). **Conforme.**

## 3. Trouvailles hors critères

- **Le temps vu par GitHub n'est pas borné pour une livraison en file** (mineur, déjà écrit en commentaire dans `github.js` l. 239-242). Dans ma course, r2 a répondu en 8 758 ms alors que son propre budget n'a consommé ~1,2 s : GitHub compte depuis l'envoi. Si r1 consomme ses 8,5 s pleins, r2 peut dépasser 10 s côté GitHub : le site est quand même déployé, mais « Recent Deliveries » affichera un échec — fausse alarme, pas panne silencieuse. Acceptable pour un push par jour ; à savoir.
- Le fichier servi en prod porte encore une marque horodatée (`… mis à jour par webhook le 2026-09-09T21:02:08Z`) : aucun push n'a eu lieu depuis la correction M-3, c'est la version d'avant. Le banc prouve que la prochaine écriture posera la marque sans horodatage. Rien à faire.
- `docs/PASSATION.md` l. 236 (« Le service web n'a pas d'alerte en cas d'échec ») parle du redémarrage en boucle du service, pas des livraisons : toujours vrai, non trompeur.
- L'épreuve `epreuve-contact.test.js` reste cassée (connue, hors chantier, écrite dans PASSATION §8). *(Note du 2026-09-10 : constat daté du 09-09 ; réparée depuis, nœud 94.c, 30/30 sur banc autonome.)*
- Hook « porte » : mon premier banc a été bloqué (valeur factice `SMTP_PASS` pour un faux courrier inexistant, dans un heredoc). Je n'ai pas contourné : j'ai utilisé la voie que le hook prescrit lui-même pour une citation de banc (marqueur `SECRET-EN-ARGUMENT-CITE` sur la ligne, journalisé dans `~/.local/state/porte-citations.log`), exactement comme l'épreuve du repo à sa ligne 373. À signaler au superviseur pour transparence.
- Aucune écriture dans le repo de ma part : le bac de l'épreuve et mes bancs sont dans `/tmp/claude-1000/…/scratchpad/` ; les dossiers `epreuve/bac/webhook-*` datent des passes de l'implémenteur.

## 4. Couverture

- Critères vérifiés : **14 sur 14, écart 0.**
- Prod exercée depuis deux adresses (station + hostingerd), sur les deux routes, avec en-tête forgé ; prod en lecture seule (aucun journalctl/systemctl, aucun accès à un fichier de secret).
- États du banc exercés : 3 valeurs de `trustProxy` × 4 provenances ; 5 cas d'alerte de renommage ; 1 course r1/r2 avec sommet mouvant. Pas de surface d'UI dans ce périmètre (aucune capture requise).

## 5. Verdict global

**Prêt** : les trois corrections annoncées sont observées en production (B-1) et sur banc (budget, renommage), l'épreuve rend 87/87, rien n'a régressé, la doc dit ce qui est livré.

---

**Résumé en 6 lignes**
1. B-1 prouvé en prod : station 401×10→429 puis contact 202×3→429 ; hostingerd 401 et 202 dans la même minute ; XFF forgé → 429 sur les deux routes.
2. Banc Fastify 5.12.3 : `trustProxy: '127.0.0.1'` rend l'adresse ajoutée par nginx et ignore l'en-tête d'un client direct ; `1` et `true` reproduisent les deux bugs précédents.
3. Course : r1 lente (7,65 s) → 200 « dépassé », r2 → 200 déploie B, fichier = B, marque sans horodatage, 0 temporaire.
4. Alerte : feature+master → rien ; feature+main → alerte ; dépôt renommé → alerte ; tag → rien ; fichier intact.
5. Régressions : épreuve 87/87 (145,7 s), prod 200 avec acc-panel, 0 temporaire, secret introuvable, doc corrigée, code déployé = code local (sha256).
6. Verdict : **conforme / prêt** ; une remarque mineure (temps vu par GitHub pour une livraison en file), une note de transparence (hook porte, marqueur de citation utilisé, pas de contournement).

---

