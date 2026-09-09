# Site vitrine chalou.link — plan de chantier (version 2)

Chantier #94. Étape 2 du protocole.

**Version 1** écrite le 2026-09-07 à partir du cadrage, de l'étude de terrain et
de trois plans concurrents rédigés en aveugle.
**Version 2**, même jour : réécrite après le rapport de réfutation d'un auditeur
indépendant, qui a trouvé **quatorze défauts**, dont trois qui rendaient un
contrôle muet. Les corrections sont marquées `[R-n]` en face de chaque point.

Marques : `(mesuré)` = une commande l'établit ; `(supposé)` = tout le reste.

- Cadrage : `site-chalou-cadrage.md`
- Étude de terrain : `site-chalou-etude-terrain.md`

## Ce que ça change pour Charles

Sa page actuelle — noir et or, son nom, deux liens — devient un site de six
pages en français et en anglais. Un visiteur pourra essayer Tonik, faire tourner
FadeBeat dans la page, comprendre ce qu'est Lutrin et le télécharger, et écrire à
Charles par un formulaire dont le message arrive dans sa boîte.

Rien de tout cela ne doit pouvoir toucher Tonik, qui tourne sur la même machine.

## Décisions prises par Charles le 2026-09-07

1. **Licence MIT posée sur Lutrin et FadeBeat.** « Oui, mets la licence MIT sur
   les deux. » Le site pourra donc écrire « open source (MIT) » — mais seulement
   une fois les fichiers réellement en place, ce qu'un critère vérifie.
2. **Le courrier ne doit plus dépendre de Brevo.** « Le but final est de ne plus
   jamais utiliser Brevo. Tu m'as déjà réglé ce problème pour Tonik, tu fais
   pareil ici. » → on aligne `chalou.link` sur ce qui a été fait pour
   `tonik.ink`.
3. **Cloudflare devant Tonik** est sorti de ce chantier et inscrit comme
   **chantier #95** à ouvrir plus tard.

## Les quatorze défauts trouvés par l'audit, et ce que j'en fais

**[R-1] Le garde-fou principal était muet.** Tous mes critères de
non-régression disaient « `tonik.ink` répond, donc je n'ai rien cassé ». Or
`tonik.ink` répond par Cloudflare, pas par la machine (mesuré : en-tête
`server: cloudflare` ; `chalou.link` répond `nginx/1.26.3` en direct).
Cloudflare aurait répondu machine à terre.
→ **Les contrôles de Tonik interrogent la machine directement, par son adresse,
en lui présentant le nom attendu** — et **conservent en plus le contrôle par le
chemin public** `[V3]`. Les deux, pas l'un à la place de l'autre : le direct voit
la machine, le public voit ce que voit un visiteur. S'y ajoute un contrôle du
service applicatif lui-même. Et chaque contrôle compare **le contenu servi**, pas
seulement le fait qu'une réponse arrive : les quatre sites de la machine rendent
des pages de tailles très différentes, donc une erreur de nom qui ferait servir
le mauvais site est détectable, et doit l'être `[V3]`.

**[R-2] Une preuve de cloisonnement qui ne prouvait rien.** J'avais écrit que
les en-têtes de sécurité, présents chez moi et absents chez Tonik, prouveraient
la séparation. Ils sont bien déclarés dans la configuration de Tonik mais
n'arrivent pas au visiteur (mesuré) — un piège nginx connu : une règle d'en-tête
posée dans un sous-bloc annule celles du bloc parent.
→ Ce critère est **supprimé**. Et pour le nouveau site, la présence des en-têtes
est vérifiée **sur chaque type d'adresse** — page, police, ressource — pas
seulement sur l'accueil, sinon le même piège se referme sur moi.

**[R-3] La phase 2 aurait détruit la page visible sans qu'aucun critère ne
crie.** Je voulais poser la politique de sécurité stricte en même temps que la
nouvelle plomberie, tout en continuant à servir l'ancienne page. Or cette page
utilise du style écrit dans le fichier, des polices Google et une image
distante : la politique stricte les aurait tous bloqués. Le contenu du fichier
n'ayant pas changé d'un octet, mon critère « même taille, même empreinte »
serait passé au vert devant une page en ruine.
→ **La politique de sécurité et les en-têtes n'arrivent qu'en phase 5**, avec le
contenu qui va avec. Et la phase 2 gagne un critère que le comptage d'octets ne
donne pas : **une capture d'écran de la page publique, regardée.**

**[R-4] Le contrôle du certificat passait au vert précisément quand le
renouvellement échouait.** Je comparais le fichier de configuration avant et
après : un renouvellement raté ne modifie rien, donc la comparaison était
identique, donc « conforme » — pendant que le certificat courait à l'expiration.
→ Le critère devient : **la date d'expiration du certificat a bien été
repoussée**, et le fichier est comparé en plus. Un échec crie.
*Correction de prémisse* : je disais « certbot réécrit le fichier (mesuré) ».
C'est vrai à l'émission, pas à chaque renouvellement (mesuré ailleurs dans les
dossiers de Charles). Le vrai risque est une commande d'extension lancée à la
main — écrit désormais noir sur blanc dans les interdits.

**[R-5] Un document faux ordonne à la surveillance de se taire sur
`chalou.link`.** Une mémoire de projet décrit une ancienne animation sombre qui
n'existe plus, et en tire la consigne de ne pas signaler le site comme cassé sur
la foi d'une capture sombre. Après bascule vers un thème clair, si le site rendait
vide, cette consigne dirait à la veille de ne rien dire.
→ **La skill `reparation` est invoquée** — c'est la règle de Charles pour un
document faux — et un **critère de recette dédié** vérifie que plus aucun
document n'affirme l'ancien état. Même traitement pour la mémoire qui affirme un
espace d'échange de 2 Gio là où la mesure dit zéro : toute la justification de la
limite mémoire repose sur cette absence, et le prochain lecteur croirait le
contraire.

**[R-6] Deux sites voisins n'étaient jamais contrôlés.** La machine sert quatre
sites (mesuré) ; je ne surveillais que Tonik. Or l'un d'eux est un
**sous-domaine de `chalou.link`**, donc le plus exposé à une erreur de nom dans
ma configuration. Et `www.chalou.link`, servi aujourd'hui et couvert par le
certificat, n'apparaissait nulle part dans mon plan.
→ Les quatre sites entrent dans les contrôles de non-régression, et `www` entre
dans la liste des adresses à vérifier.

**[R-7] Le chemin du courrier n'est pas celui que j'ai dit prouvé.** Le
précédent que j'invoque envoie du `tonik.ink` vers `tonik.ink`, avec un outil
différent de celui que j'emploierai. Et surtout : la déclaration publique de
`chalou.link` n'autorise pas son propre serveur de messagerie à envoyer en son
nom, contrairement à celle de `tonik.ink` ; sa politique dit « mettre en
quarantaine » et ne demande aucun rapport (mesuré).
→ **Décision de Charles appliquée : on aligne `chalou.link` sur `tonik.ink`.**
Cela devient une phase à part entière, avec sa propre porte, parce que c'est une
modification du nom de domaine et non du site.
→ Deux dangers de plus, nommés : *(a)* le critère « le jeton est retrouvé dans
la boîte » ne distingue pas la boîte de réception des indésirables — il est
donc **complété par la confirmation de Charles dans son logiciel de courrier**,
seule preuve qui tranche ; *(b)* la bibliothèque d'envoi tente une élévation de
sécurité dès que le serveur la propose, et vérifie le nom du certificat contre
l'adresse appelée : appeler une adresse numérique pendant que le serveur
s'annonce sous un nom fait échouer la vérification. Un réglage explicite ferme
ce chemin, et le garde-fou de démarrage le surveille au même titre que
l'absence de mot de passe.

**[R-8] Mon arbitrage sur la sécurité du système ne retenait que la moitié de la
recette écrite par Charles.** Sa note dit clairement qu'il faut **deux** choses
pour qu'un serveur web ait le droit de joindre un service local : déclarer le
port, **et** activer une autorisation. Je n'avais retenu que la première, et
j'en concluais qu'un port bien choisi dispenserait de tout geste. C'est faux.
→ La phase 0 lit **aussi les autorisations en vigueur**, et le plan cesse de
prétendre qu'un choix de port a une portée de sécurité tant qu'on ignore
laquelle est active.

**[R-9] Deux de mes critères sur FadeBeat s'excluaient.** Je voulais réécrire
son apparence **et** garder son code identique à l'octet près. Impossible : son
code fabrique lui-même les classes de mise en forme (mesuré, ligne 391 et
suivantes). Mon plan retenait par ailleurs une option tout en décrivant les
risques d'une autre.
→ **Question rouverte à Charles**, avec le vrai coût. Voir la question 2 en fin
de document.

**[R-10] Un remède sans contrôle.** J'exige que l'écriture en base soit confirmée
par le seul serveur principal, pour ne pas dépendre du lien vers l'autre
machine. Aucun critère ne lisait la valeur réellement appliquée : si quelqu'un
laissait la valeur par défaut, tout serait vert le jour de la recette, et le
formulaire se figerait des mois plus tard.
→ **Critère qui lit la valeur effective**, plus un essai lien coupé.

**[R-11] Le milieu de la double bascule était une zone grise.** Entre les deux
bascules, mon plan exposait publiquement un formulaire qui écrit des données
personnelles, alors que la page d'information n'existe pas encore, et laissait en
production l'adresse Gmail en clair et l'image empruntée à GitHub — les deux
défauts que l'étude demandait de retirer.
→ **Le formulaire n'est joignable publiquement qu'en phase 5.** Avant, il n'est
atteignable que depuis la machine elle-même. Et **les deux défauts de l'ancienne
page sont retirés dès la phase 2** : l'adresse disparaît, l'image est servie
localement.

*Contradiction relevée au second audit et tranchée ici* `[V3]` : je demandais à
la fois que la page reste « visuellement identique » et qu'on lui retire son lien
de courriel — or ce lien est **l'un des deux seuls boutons visibles** de la page.
Les deux critères ne pouvaient pas être vrais ensemble, et l'un aurait été
arrangé le jour de la recette. **Ce qui est retenu** : la page servie en phase 2
est l'ancienne page dont le bouton « Contact » ne porte plus d'adresse en clair,
et dont la photo et les polices sont servies depuis la machine. Le critère
devient donc « la page présente le même dessin, le même texte et ses deux
boutons ; le bouton Contact ne révèle plus d'adresse ; aucune ressource ne vient
d'un tiers ». Trois appels à Google pour les polices existent aussi dans cette
page (mesuré) : ils sont retirés en même temps, et la police est servie
localement — c'est pourquoi le critère parle du **dessin**, pas d'une identité au
pixel près.

**[R-12] L'adresse d'écoute du service n'était nommée nulle part.** Un service
qui écouterait sur toutes les interfaces serait masqué par le pare-feu, donc
invisible à la recette, jusqu'au jour où le pare-feu change.
→ **Critère explicite** : le service n'écoute que sur la machine elle-même.

**[R-13] Aucune surveillance pour le nouveau service.** J'avais prévu une alerte
pour la sauvegarde et rien pour le site. Un formulaire qui redémarre en boucle
serait invisible jusqu'à ce que Charles s'étonne de ne plus recevoir de courrier
— exactement la forme de l'incident d'août.
→ **Alerte d'échec sur le service web aussi**, et inscription au registre de
surveillance.

**[R-14] J'ai modifié la note de cadrage validée par Charles sans écrire
l'amendement.** Voir la section « Amendements », désormais non vide.

*Un quinzième point, mineur : l'audit note que la convergence de mes trois plans
n'en était pas une, puisqu'ils avaient tous lu la même étude qui recommandait
déjà ces choix. Il a raison. Je ne m'appuie plus sur cette convergence comme sur
un argument.*

## Choix retenus

**Pile.** Node 22, Fastify 5, MongoDB, nodemailer. Pas d'étape de compilation :
HTML, CSS et modules JavaScript natifs servis tels quels.

**Séparation d'avec Tonik**, socle non négociable :
- fichier de configuration nginx distinct ;
- **code exécuté et contenu servi dans deux arborescences séparées**, jamais
  mélangés — trois pannes de la même famille ont frappé cette machine parce
  qu'un exécutable vivait sous l'arborescence servie (mesuré) ;
- compte système dédié, sans interpréteur de connexion, sans droits élevés ;
- base et compte MongoDB dédiés, limités à cette seule base ;
- journaux distincts, limite mémoire propre ;
- aucun secret ni chemin partagé.

**Courrier.** Le site poste vers le serveur de messagerie par le tunnel privé,
sans authentification et sans aucun secret. Ce réglage est volontairement
différent de celui de Tonik : le module de configuration **refuse de démarrer**
si des identifiants apparaissent, **ou si l'élévation de sécurité est
réactivée** `[R-7]`. Un commentaire ne protège pas d'un futur correcteur zélé ;
un refus de démarrage, si.

**Bilingue.** Le français est écrit en clair dans les pages ; l'anglais vit dans
un dictionnaire, et le bouton FR|EN remplace les textes marqués. Sans
JavaScript, le site reste entièrement lisible en français.

**Pages et adresses.** `/` · `/tonik` · `/lutrin` · `/fadebeat` · `/contact` ·
`/mentions`, plus `www` qui doit continuer de répondre `[R-6]`. Une adresse
inconnue renvoie une vraie erreur, pas la page d'accueil.

**Publication.** Versions horodatées et un lien qui désigne celle en service :
le retour arrière est un changement de lien, en quelques secondes, sans toucher
à nginx ni au certificat.

## Sécurité

1. **Fuite du secret de base par l'adresse web.** → racine limitée au dossier de
   contenu ; secrets hors de l'arborescence servie et hors du dépôt. Contrôle :
   demander ces chemins renvoie une erreur.
2. **Accès aux données de Tonik.** → compte MongoDB limité à la seule base du
   site. **On prouve le refus, pas l'autorisation.**
3. **Famine mémoire.** La machine n'a plus d'espace d'échange (mesuré) : un
   dépassement fait choisir une victime au noyau, qui peut être MongoDB ou
   Tonik. → limite mémoire éprouvée pour de vrai.
4. **Relais ouvert.** → on prouve par sabotage qu'une destination extérieure est
   toujours refusée.
5. **Injection dans les en-têtes du courriel.** → rejet des caractères de
   contrôle ; l'adresse du visiteur ne sert que de « répondre à ».
6. **Données personnelles de tiers.** → aucun tiers dans la chaîne ; ni adresse
   du visiteur ni identifiant de navigateur conservés ; le corps du message n'est
   jamais écrit dans les journaux ; durée de conservation appliquée
   automatiquement.
7. **Autorisation d'envoi du domaine** `[R-7]` → phase dédiée, portée séparée.
8. **Adresse moissonnable.** → aucune adresse en clair dans les pages,
   **y compris pendant le chantier** `[R-11]`.
9. **Détournement des sites voisins** `[R-6]` → aucun bloc « par défaut »,
   aucun nom générique ; les quatre sites contrôlés après chaque geste.
10. **Secret dans le dépôt.** → fichier d'exclusion posé avant le premier
    commit, et garde-fou de pré-commit.
11. **Écoute du service** `[R-12]` → sur la machine seule, jamais sur
    l'extérieur.

## Phases

**Phase 0 — Reconnaissance, en lecture seule.** Une douzaine de commandes que
personne ne peut deviner : mode de sécurité du système, ports déjà reconnus,
**et les autorisations en vigueur** `[R-8]` ; contenu réel du fichier nginx de
`chalou.link` ; ports libres ; mémoire ; **et la chaîne de filtrage du serveur
de messagerie** `[R-7]`. Rien n'est modifié. C'est ce qui transforme « une
soirée perdue sur une panne muette » en « trente secondes de lecture ».

**Phase 1 — Le site, hors ligne.** Dépôt, fichier d'exclusion, ancienne page
archivée, les six pages en français, la charte reprise, les polices installées,
FadeBeat traité selon la décision de Charles, **et la réparation des documents
faux** `[R-5]`.

**Phase 2 — Bascule de la plomberie, contenu quasi identique.** Nouveau fichier
nginx, nouvelle racine, nouveaux droits — en continuant de servir l'ancienne
page, **nettoyée de ses deux défauts** `[R-11]`. Ni politique de sécurité ni
en-têtes à ce stade `[R-3]`. Si quelque chose casse, ça se voit sans que
personne n'ait vu le site changer.

**Phase 3 — L'autorisation d'envoi du domaine** `[R-7]`. Ajout du serveur de
messagerie à la déclaration de `chalou.link`, et d'une adresse de rapport,
comme cela a été fait pour `tonik.ink`. Porte distincte : c'est le nom de
domaine, pas le site.

**Phase 4 — Le service, la base, le courrier.** Compte système, service, base et
compte dédiés, formulaire — **joignable depuis la machine seulement** `[R-11]`.
C'est ici que la preuve du courrier est faite.

**Phase 5 — L'anglais, puis la bascule du contenu.** Dictionnaire complet, puis
un changement de lien : le site change de visage, la politique de sécurité et
les en-têtes arrivent, le formulaire devient public. Puis la batterie de
sabotages.

**Phase 6 — Sauvegarde, surveillance, clôture.** Sauvegarde éprouvée, **alerte
sur le service web** `[R-13]`, second déploiement complet pour attraper une
régression, mémoires de projet, contrôle après renouvellement du certificat.

## Critères de recette

Chacun a passé l'épreuve du sabotage : *si je casse volontairement ce remède, ce
critère crie-t-il ?* Quand la réponse est non, c'est écrit.

**Phase 0** — Les sorties existent, datées. Mode de sécurité, ports reconnus,
autorisations en vigueur, contenu du fichier nginx, filtrage du courrier : tout
est consigné. Le port du service est arrêté à partir de cette lecture.

**Phase 1** — Sur les six pages : aucune requête vers un domaine tiers
(sabotage : je remets les polices Google, le compteur passe de zéro à deux) —
**complété par un contrôle que les polices locales se chargent vraiment**, sinon
le compteur resterait à zéro avec un rendu en police système `[audit 14]`.
JavaScript désactivé, les pages restent lisibles en français (sabotage : je mets
le français dans le dictionnaire, la page devient vide). Chaque clé du
dictionnaire anglais a son équivalent français et réciproquement, écart nul
(sabotage : j'enlève une clé, le contrôle crie — sans lui, la version anglaise
décroche en silence). Aucune adresse de courriel, aucune date de naissance. Le
dépôt ne contient aucun fichier de configuration. L'avertissement Windows de la
page Lutrin est écrit **à partir de la source**, sans inventer un coût de
certification que la documentation n'évoque nulle part. Le mot « open source »
n'apparaît que si les fichiers de licence sont **constatés présents le jour
même** dans les deux dépôts. **Et : plus aucun document du parc n'affirme
l'ancien état** — ni l'animation disparue, ni l'espace d'échange qui n'existe
plus `[R-5]`.

**Phase 2** — La page publique est **visuellement identique**, vérifiée par une
capture d'écran regardée `[R-3]`, et ne contient plus ni adresse en clair ni
appel à un tiers `[R-11]`. **Les quatre sites de la machine répondent, interrogés
directement sur la machine et non à travers un intermédiaire** `[R-1]` `[R-6]`,
et le service applicatif de Tonik répond lui aussi en direct. Le contrôle de
configuration nginx passe **avant** tout rechargement, et c'est un rechargement,
jamais un redémarrage. Le compteur de redémarrages de Tonik est inchangé.
Le retour arrière a été exécuté pour de vrai, puis refait à l'endroit.

*Honnêteté sur un critère : « les sites répondent » n'attrape pas une erreur de
syntaxe, puisqu'un rechargement refusé laisse nginx sur l'ancienne configuration,
qui marche. C'est le contrôle préalable qui l'attrape — d'où son statut de
critère à part entière.*

**Phase 3** — La déclaration publique de `chalou.link` autorise désormais le
serveur de messagerie, et une adresse de rapport existe. Les deux sont mesurables
de l'extérieur, par n'importe qui.

**Le critère qui manquait, et c'était le plus important** `[V3]` : ce domaine a
aujourd'hui un envoi qui **fonctionne et qui a été prouvé** — celui qui passe par
le prestataire extérieur. Toucher sa déclaration peut le casser. Donc, après le
changement, **on rejoue un envoi réel par ce chemin-là et on vérifie qu'il est
toujours accepté**. Sans ce critère, on répare un envoi qui n'existe pas encore
en cassant un envoi qui marche, et personne ne s'en aperçoit avant des semaines.

*Deux illusions du plan v2, retirées* `[V3]` : (a) je promettais un « contrôle
négatif » consistant à voir un message refusé avant le changement — il ne peut
pas se produire, puisque le message du formulaire est remis **localement** sur le
serveur de messagerie, où ces contrôles ne s'appliquent pas. Je l'écris au lieu
de garder un critère qui aurait été déclaré vert par accommodement. (b) Copier
l'adresse de rapport de `tonik.ink` ne suffit pas : faire envoyer des rapports
vers un autre domaine exige une autorisation de ce domaine, qui n'existe pas
(mesuré). Le critère devient « les rapports arrivent réellement », pas
« l'adresse est écrite ».

**Phase 4** — Le formulaire répond **à travers nginx** et non seulement en local :
un contrôle sur la machine prouverait que le service tourne, pas que nginx a le
droit de le joindre, et ne peut donc pas attraper l'échec de son propre remède.
**Le service n'écoute que sur la machine** `[R-12]`. Le compte système existe,
sans droits élevés. La limite mémoire est éprouvée : on fait déborder un
processus jetable, le noyau tue ce seul processus, et Tonik comme MongoDB sont
intacts après. Avec les identifiants du site, la lecture de la base de Tonik est
**refusée**. **La confirmation d'écriture appliquée est lue, pas supposée**
`[R-10]`.

**La preuve du courrier**, cœur du chantier. D'abord un contrôle négatif :
chercher un jeton jamais envoyé ne doit rien trouver — sans quoi la recherche
répondrait « trouvé » pour n'importe quoi. Ensuite : un message portant un jeton
unique est envoyé ; le jeton est retrouvé dans la boîte ; **et Charles confirme
l'avoir vu dans son logiciel de courrier, dans sa boîte de réception et non dans
ses indésirables** `[R-7]` — c'est la seule moitié de la preuve qui tranche
vraiment, et elle dépend d'un humain. Je l'écris plutôt que de le masquer.

Sabotage obligatoire : on détourne l'envoi vers un port mort. Le visiteur voit
toujours un succès, le message est quand même archivé, le journal porte l'échec
— et **le critère du message retrouvé crie**. C'est exactement l'erreur qui a
masqué trois jours de non-livraison en août : une acceptation n'est pas une
livraison (mesuré). Symétriquement : base injoignable, le courrier part quand
même.

Champ leurre rempli : aucun courriel, aucun document, réponse identique à un
envoi honnête. Envoi trop rapide : refusé. Quatre envois en une minute : le
quatrième refusé. Le corps du message n'apparaît jamais dans les journaux.

**Un critère déplacé, parce que ma propre correction l'avait rendu muet**
`[V3]` : le journal doit porter **l'adresse réelle du visiteur** et non celle du
serveur, sans quoi la limite de débit bloquerait tous les visiteurs ensemble dès
que l'un d'eux insiste. En rendant le formulaire non public jusqu'à la phase 5,
j'avais retiré toute possibilité de l'éprouver : depuis la machine elle-même,
toutes les requêtes portent la même adresse, et le critère ne pouvait ni réussir
ni échouer. **Il est donc rejoué en phase 5, depuis l'extérieur**, avec le
sabotage qui va avec — je retire le réglage, le critère doit crier.

**Phase 5** — Aucune clé de traduction manquante. Les six adresses répondent,
**`www` compris** `[R-6]`, une adresse inconnue renvoie une erreur. Les en-têtes
et la politique de sécurité sont présents **sur chaque type d'adresse** `[R-2]`,
pas seulement sur l'accueil. Les quatre sites de la machine sont intacts,
vérifiés en direct. Le retour arrière est chronométré et exécuté pour de vrai. Un
message envoyé depuis le **vrai** site public est retrouvé dans la boîte : une
preuve faite avant la bascule ne vaut pas une preuve faite après. Sabotages :
limite mémoire abaissée à l'extrême, le service meurt seul et Tonik survit ;
tentative d'envoi vers l'extérieur, refusée ; service tué, il redémarre seul.

**Phase 6** — La sauvegarde s'exécute, produit une archive dont on relit le
contenu, et son exécutable est hors de l'arborescence servie. Échec provoqué :
une alerte arrive dans la boîte — un mécanisme d'alerte non éprouvé est un
mécanisme absent. **Même épreuve pour l'alerte du service web** `[R-13]`. Puis on
rejoue l'extraction de déploiement et on relance la sauvegarde : elle doit encore
passer — c'est la preuve exacte qui a fermé la famille des trois pannes en
septembre. Enfin, après renouvellement du certificat : **sa date d'expiration a
bien été repoussée** `[R-4]`, et le fichier est comparé à sa référence.

## Ce que chaque remède peut casser ou ouvrir

- **Nouveau fichier nginx** → un rechargement touche les quatre sites (mesuré).
  Une erreur ne coupe rien mais bloque toute correction ultérieure, Tonik
  compris. *Parade : sauvegarde horodatée, contrôle préalable, et répétition de
  la parade en phase 2.*
- **Modification du fichier de `chalou.link`** → une commande d'extension de
  certificat lancée à la main le réécrirait `[R-4]`. *Parade : interdit écrit ;
  l'essentiel vit dans un fichier inclus.*
- **Second processus** → environ 100 Mo sur 6,7 Gio libres, sur deux processeurs
  seulement (mesuré). *Parade : limite mémoire éprouvée.*
- **Déclaration d'un port** → autorise tout serveur web de la machine à le
  joindre, Tonik compris. *Parade : un seul port ; et la phase 0 dit d'abord
  quelle autorisation est déjà active* `[R-8]`.
- **Nouvelle base** → écritures répliquées ; volume négligeable. Mais le journal
  de MongoDB pèse déjà 1,1 Go **sans rotation** (mesuré) : il grossira un peu
  plus vite. *Dette existante, signalée, hors périmètre — mais pas tue.*
- **Modification de la déclaration du domaine** `[R-7]` → une erreur de syntaxe
  pourrait faire rejeter **tout** le courrier de `chalou.link`, y compris celui
  qui fonctionne aujourd'hui. *Parade : valeur actuelle sauvegardée, changement
  additif, relecture par deux résolveurs différents avant de conclure.*
- **Envoi sans authentification** → n'ouvre rien mais crée une dépendance au
  tunnel privé. *Parade : si le tunnel tombe, le message est archivé et l'écran
  ne ment pas au visiteur.*
- **FadeBeat modifié** → divergence permanente avec le dépôt public ; et la
  décision touche son code, pas seulement son apparence `[R-9]`. *Parade :
  divergence déclarée sur la page et en tête de fichier.*
- **Politique de sécurité stricte** → casse toute ressource tierce ajoutée plus
  tard sans y penser. *C'est le but ; écrit dans la documentation.*
- **Sauvegarde supplémentaire** → décalée de celle de Tonik pour ne pas disputer
  les deux processeurs.
- **Dépôt sur GitHub** → le dossier de déploiement cartographie la production de
  Tonik. *Parade : dépôt privé par défaut, décision de Charles.*

## Coût attendu

Environ **25 à 30 heures**, plus le temps de FadeBeat selon la décision. Le poste
le plus lourd est le contenu bilingue, pas la technique.

Pour Charles : environ **deux heures au total** — vingt minutes de lecture sur le
serveur, la relecture des textes, les confirmations de courriel reçu, et les
portes.

## Hors périmètre

Toute modification de Tonik. Cloudflare devant Tonik → **chantier #95**. La
rotation des journaux de MongoDB. Le remplissage de `/boot`. L'absence d'espace
d'échange. Le mode haute visibilité et l'audit d'accessibilité, exclus par le
cadrage. Comptes, connexion, blog, lettre d'information, réseaux sociaux, mesure
d'audience. Captcha. Tout sous-domaine. **La sortie complète de Brevo** : la
volonté de Charles est acquise, mais ce chantier ne fait qu'aligner
`chalou.link` sur `tonik.ink` ; retirer Brevo partout est un chantier à lui seul.

## Portes

1. Validation de ce plan.
2. Reconnaissance sur le serveur, en lecture seule.
3. Premier commit.
4. **Licences MIT sur Lutrin et FadeBeat** — deux autres dépôts, donc commits et
   envois distincts.
5. Bascule de la plomberie — premier geste nginx sur la machine de Tonik.
6. **Modification de la déclaration du domaine** `[R-7]`.
7. Service et base.
8. Bascule du contenu.
9. Mise du dépôt sur GitHub.

## Questions qui restent à Charles

1. **Quels instruments sont les « nouveaux » à apprendre ?** Introuvable dans les
   sources (mesuré). Le fil rouge du site repose dessus.
2. **FadeBeat** `[R-9]` — trois voies, et le choix engage le coût :
   - le laisser tel quel dans un cadre isolé, avec sa bibliothèque figée en local
     : aucune modification, aucun tiers, mais l'application garde ses couleurs
     violet et cyan au milieu d'un site ivoire, et reste en français ;
   - réécrire son apparence aux couleurs du site : oblige à toucher son code, donc
     à assumer une version qui diverge du dépôt public ;
   - la même chose, plus la traduction en anglais : quelques heures de plus, et la
     page anglaise devient cohérente.
3. **Photo** : l'avatar GitHub recopié chez toi, ou une vraie photo ?
4. **Qui relit l'anglais ?** Sans relecteur, la version anglaise sera livrée
   marquée « relecture à faire ».
5. **Le dépôt sur GitHub** : privé, public, ou pas de dépôt distant ?
6. **Durée de conservation des messages** : 24 mois proposé.
7. **Sauvegarde hors-site de la base ?** Ma recommandation : non. Chaque message
   existe déjà en deux endroits — la boîte de Charles sur l'autre serveur, et
   l'archive locale. Une copie hors-site exigerait un nouveau secret, et c'est un
   secret oublié qui a coûté six semaines de sauvegardes muettes en juillet.

## Amendements en cours de chantier

*(datés ; un écart non écrit n'existe pas)*

- **2026-09-07 — Node 24 → Node 22.** La note de cadrage validée par Charles
  disait « Node 24 ». L'étude de terrain a mesuré que le serveur tourne en
  Node 22, issu du dépôt de la distribution, et qu'y installer Node 24
  obligerait à sortir de ce dépôt — l'inverse de ce qui a été décidé en juillet.
  Le cadrage a été corrigé. **Faute de méthode reconnue** `[R-14]` : la
  correction a été faite avant d'être écrite ici, alors que ce plan pose
  lui-même la règle « un écart non écrit n'existe pas ». Signalé par l'audit.
- **2026-09-07 — Le chantier passe en version 2** après le rapport de
  réfutation : quatorze défauts corrigés, dont trois contrôles muets. Deux
  phases nouvelles apparaissent (autorisation d'envoi du domaine, séparée de la
  bascule du contenu), et la politique de sécurité est repoussée de la phase 2 à
  la phase 5.
- **2026-09-07 — Cloudflare sorti du périmètre** sur décision de Charles, et
  inscrit comme chantier #95.
- **2026-09-07 — Version 3, après un second rapport de réfutation.** Verdict du
  re-audit : une seule correction fermée sur quatorze, treize incomplètes, huit
  défauts nouveaux introduits par la version 2. Cinq points sont corrigés ici,
  tous marqués `[V3]` : le contrôle de Tonik garde **les deux** chemins, direct
  et public, et compare le contenu servi ; la contradiction entre « page
  identique » et « adresse retirée » est tranchée au lieu d'être laissée à
  l'arrangement du jour ; la phase du nom de domaine reçoit le critère qui lui
  manquait — rejouer l'envoi qui fonctionne déjà — et deux de ses illusions sont
  retirées ; le contrôle de l'adresse réelle du visiteur est déplacé là où il
  peut encore crier ; `www.axelise.fr`, un nom servi de plus, entre dans les
  contrôles.
  **Ce qui n'est PAS corrigé, et pourquoi.** Le reste des remarques est fondé
  mais relève du raffinement d'un document qui n'a encore rien produit. Le
  protocole dit qu'une troisième passe de correction sur le même objet, le même
  jour, est le début d'une spirale. J'arrête donc ici le cycle d'audit et je
  soumets le plan à Charles, en nommant ses limites plutôt qu'en les polissant :
  le critère de balayage documentaire est trop large et devra être borné à ce qui
  est mesuré ; l'épreuve de la limite mémoire ne doit jamais toucher le lien
  partagé avec Tonik et se fera autrement ; l'épreuve du redémarrage en boucle du
  service exige un réglage de cadence que le plan ne nomme pas encore ; la
  vérification de FadeBeat reste manuelle. **Ces quatre limites sont assumées et
  écrites, pas résolues.**
- **2026-09-07 — Traçabilité des modifications faites hors de ce dossier.** Deux
  corrections directes ont été appliquées dans la journée sans être inscrites
  ici, ce que le second audit a relevé à juste titre : *(a)* dans l'arbre des
  plans, la restauration de l'état d'un nœud qu'une collision de numéro avait
  écrasé, et la renumérotation de ce chantier de 87 en 94 ; *(b)* dans la note de
  cadrage, la correction « Node 24 → Node 22 » et le numéro du chantier. Les deux
  sont désormais écrites. **Reste à faire** : annoter la note de cadrage
  elle-même pour qu'un lecteur qui ne lirait qu'elle sache que sa ligne sur Node
  a été corrigée après coup, et qu'elle ne reflète donc pas mot pour mot ce que
  Charles a validé.
