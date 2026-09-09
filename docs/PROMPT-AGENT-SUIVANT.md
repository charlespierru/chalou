# Le prompt à donner à l'agent qui reprend

Charles n'a qu'à copier le bloc ci-dessous.

---

```
Chantier #94 — site chalou.link. Tu reprends un travail en cours, tu ne le
recommences pas.

AVANT TOUTE CHOSE, ET AVANT DE ME RÉPONDRE :
lis en entier /mnt/data/Charles/DevPerso/landing-chalou/docs/PASSATION.md
Il dit ce qui est en ligne, ce qui est prouvé et comment, où sont les choses,
les pièges qui ont déjà coûté du temps, et ce qui reste. Puis lis les mémoires
du projet dans ~/.claude/projects/-mnt-data-Charles-DevPerso-landing-chalou/memory/

TA TÂCHE, DANS CET ORDRE :

1. Relever EXHAUSTIVEMENT la zone DNS de chalou.link — tous les
   enregistrements, pas seulement les adresses : A, AAAA, CNAME, MX, TXT, SRV,
   CAA, et les six sous-domaines vivants (www, usa, mail, clannik,
   soleneceramic, elise). Consigne-le dans un document daté. C'est la
   condition de tout le reste : un déplacement de zone se rate en perdant un
   enregistrement qu'on n'avait pas vu.

2. Présenter à Charles les trois voies possibles (elles sont dans sa propre
   documentation, BASCULE-DU-CENTOS-VERS-ROCKY-PLAN.md) : modification à la
   main chez Namecheap, création d'une clé d'accès Namecheap, ou déplacement
   de la zone chez Cloudflare où l'accès existe déjà. Donne ton avis, laisse-le
   décider.

3. Une fois sa décision prise, appliquer ce qu'il a déjà tranché le
   2026-09-07 : « autorise mon serveur, ne touche pas à Brevo ».
   Concrètement, le SPF de chalou.link passe de
       v=spf1 include:spf.brevo.com -all
   à
       v=spf1 ip4:187.77.168.112 include:spf.brevo.com -all
   c'est-à-dire exactement la ligne de tonik.ink. AJOUT SEULEMENT : Brevo
   reste, et ce qui marche aujourd'hui ne doit pas tomber.
   Ajouter aussi une adresse de rapport au DMARC, comme en a tonik.ink.

LA PREUVE QUE J'ATTENDS, et rien de moins :
un vrai message envoyé depuis le formulaire de chalou.link vers une adresse
EXTÉRIEURE (chypi@free.fr), et constaté REÇU dans la boîte de réception — pas
« accepté par le serveur ». Cette distinction a déjà coûté une soirée sur ce
chantier, et trois jours de courrier perdu à Charles en août.
Contrôle négatif d'abord : vérifier que le repère n'existe nulle part AVANT
l'envoi, sinon la recherche répondrait « trouvé » pour n'importe quoi.

COMMENT TRAVAILLER AVEC CHARLES — trois règles, apprises dans la douleur :

· « Fais comme X » veut dire : va LIRE X et reproduis-le. Pas « conçois un
  équivalent ». Si tu penses avoir mieux, dis-le AVANT de t'en écarter.
· Présente toujours : le problème d'abord, ta solution ensuite, et pourquoi
  elle règle ce problème. Jamais un catalogue de dangers.
· Charles est malvoyant. Réponses courtes, langage clair, un sujet à la fois,
  pas de murs de code ni de sorties brutes.

ET SURTOUT : ce qu'il faut savoir est presque toujours déjà écrit sur son
disque — dans vps-tunnel/docs/, dans la carte d'infrastructure
(python3 infra/carte/montre.py <machine> <section>, par petits morceaux), dans
ses mémoires. Cherche avant de conclure. La session précédente a deux fois
décidé sans lire, et deux fois la réponse était là.

OUTILS DE LA MAISON, à utiliser plutôt qu'à réinventer :
· secrets : guichet (ranger, poser, envoyer, essayer, controler) — une valeur
  ne s'affiche jamais ; guichet essayer vérifie qu'un mot de passe ouvre
  réellement la porte au lieu de le supposer.
· état des machines : python3 infra/carte/montre.py, depuis vps-tunnel.
· arbre des plans : plan-actif / plan-chantier. Prends le marqueur sur le
  nœud 94 avant d'agir, et vérifie qu'aucun autre nœud ne porte ce numéro —
  le compteur a déjà réattribué un numéro pris.
· API : api cf|brevo|hostinger|b2 <MÉTHODE> <chemin>.

NE TOUCHE PAS, sans accord explicite de Charles : Tonik, le service du site
qui tourne, les trois refus de démarrage posés dans server/src/config.js (ils
empêchent de refaire la panne du courrier), et Brevo.
```
