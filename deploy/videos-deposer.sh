#!/usr/bin/env bash
# Dépose une ou plusieurs vidéos dans la page privée de Matthieu — une seule
# commande, depuis la station de Charles.
#
#   ./videos-deposer.sh ~/Vidéos/répétition.mp4 ~/Vidéos/final.mkv
#
# Rien ne tourne sur le serveur : le script vit dans ce dépôt et parle au
# serveur par ssh et rsync. AUCUN exécutable ne doit vivre sous /var/www — la
# leçon a été payée trois fois sur cette machine (un déploiement par archive
# recrée les fichiers, et le fichier neuf hérite de l'étiquette de son dossier,
# du contenu web, que systemd refuse d'exécuter).
#
# CE QU'IL FAIT, DANS L'ORDRE
#   1. Refuse, AVANT tout contact réseau : pas d'argument, une option, un
#      fichier absent, UN LIEN SYMBOLIQUE, un fichier qui n'est pas une vidéo,
#      « index.html », un fichier de secrets absent ou trop ouvert. Chaque
#      refus a son code de sortie.
#   2. Mesure l'espace libre du serveur et refuse si la copie ferait descendre
#      sous 20 Go (la base Mongo partage la partition).
#   3. Copie par rsync — reprise possible, un gros fichier interrompu repart
#      où il en était.
#   4. Date les fichiers déposés à l'instant du dépôt (voir plus bas).
#   5. Relève la liste RÉELLE du dossier distant, refabrique index.html à
#      partir de ce relevé, l'envoie — et vérifie que CHAQUE nom qu'on vient de
#      déposer figure dans ce relevé. Un absent sort en 15 : sans ce contrôle,
#      un fichier qui n'arrive jamais n'est listé nulle part, n'a donc rien à
#      contrôler en HTTP, et le dépôt se déclarerait réussi sur du vide.
#   6. Repose le contexte SELinux — sans s'arrêter si ça rate.
#   7. CONTRÔLE, TOUJOURS : pour la page et pour chaque vidéo listée, l'adresse
#      privée doit rendre 401 sans mot de passe, 200 avec, et 206 sur une
#      requête de plage. Une page qui liste un fichier absent serait un
#      mensonge : c'est ce contrôle qui l'interdit.
#
# DÈS QUE QUELQUE CHOSE EST PUBLIÉ, LE CONTRÔLE A LIEU. Rien entre le point 5
# et le point 7 n'a le droit d'arrêter le script : une page en ligne dont
# personne n'a vérifié ce qu'elle sert est exactement ce qu'on veut éviter.
# Le code de sortie rend compte des deux : contrôle raté → 15 (il prime) ;
# contrôle passé mais restorecon raté → 14, avec ce qui a été vérifié et ce
# qui reste à faire à la main.
#
# LE MOT DE PASSE NE PASSE JAMAIS EN ARGUMENT — ni du script, ni de curl : la
# ligne de commande d'un processus est lisible par tout le monde sur la
# machine (leçon du chantier 98). Aucune option n'est donc acceptée, et curl
# reçoit les identifiants par un fichier netrc à 600, détruit en sortant.
#
# DATE AFFICHÉE : rsync préserve la date des fichiers ; la page dirait alors la
# date de montage de la vidéo, pas celle du dépôt. Le script date donc les
# fichiers qu'il vient de déposer à l'instant du dépôt, pour que « déposée
# le… » soit vrai. Coût assumé : redéposer exactement le même fichier fait
# retravailler rsync (dates différentes) — il ne retransmettra presque rien,
# mais il relira le fichier des deux côtés.
#
# LES ARTIFICES DU BANC D'ESSAI et LES CODES DE SORTIE sont déclarés en tête de
# videos-commun.sh. En deux mots : VIDEOS_DISTANT_CMD remplace « ssh
# hostinger », VIDEOS_COPIE_CMD remplace rsync, VIDEOS_HOTE_WEB remplace
# https://chalou.link. Un banc peut ainsi tout exercer sans toucher au serveur.

set -euo pipefail

# readlink -f : le script est aussi appelé par un lien depuis ~/.local/bin
# (videos-deposer, videos-retirer) ; sans lui, dirname donnerait ~/.local/bin
# et videos-commun.sh ne serait pas trouvé.
ICI=$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd)
# shellcheck source=videos-commun.sh
source "$ICI/videos-commun.sh"

# ── 1. Les refus, avant tout contact réseau ─────────────────────────────────

if (( $# == 0 )); then
  mourir 2 "Aucune vidéo à déposer." \
           "usage : videos-deposer.sh <fichier…>" \
           "Le mot de passe et l'adresse ne se passent pas en argument : ils" \
           "sont lus dans $VIDEOS_SECRETS."
fi

for argument in "$@"; do
  if [[ $argument == -* ]]; then
    mourir 3 "« $argument » commence par un tiret : aucune option n'est acceptée." \
             "Un secret ne passe JAMAIS en argument — la ligne de commande est" \
             "lisible par tous les comptes de la machine. Les réglages se lisent" \
             "dans $VIDEOS_SECRETS." \
             "Pour un fichier dont le nom commence vraiment par un tiret : ./-nom.mp4"
  fi
done

for argument in "$@"; do
  # LE LIEN SYMBOLIQUE EST REFUSÉ — défaut GRAVE relevé par l'audit du
  # 2026-09-17. Un lien vers un .mp4 passait le test « -f && -r » (qui suit le
  # lien), rsync le recopiait COMME LIEN, le relevé distant (`find -type f`) ne
  # le voyait pas, la page ne le listait pas — et le script sortait en 0 avec
  # « ✓ Déposé ». Un mensonge silencieux, la pire forme.
  # Le test vient AVANT « -e » : un lien cassé donne ainsi le vrai motif du
  # refus, au lieu d'un « fichier introuvable » qui envoie chercher ailleurs.
  [[ ! -L $argument ]] || mourir 4 \
    "« $argument » est un lien symbolique : refusé." \
    "Donne le fichier réel — un lien serait recopié COMME LIEN sur le serveur," \
    "où il ne pointerait sur rien, et la page ne le listerait jamais." \
    "Le chemin réel : readlink -f -- $argument"
  [[ -e $argument ]] || mourir 4 "Fichier introuvable : $argument"
  [[ -f $argument && -r $argument ]] \
    || mourir 4 "« $argument » n'est pas un fichier ordinaire lisible."
done

for argument in "$@"; do
  nom=$(basename -- "$argument")
  # « index.html » est nommé ICI, avant le test d'extension. Sans cette ligne,
  # il sortait en 5 (« ce n'est pas une vidéo ») alors que la table des codes de
  # videos-commun.sh et le message du refus promettent tous deux le 6 (« nom de
  # fichier refusé … index.html »). Écart relevé par l'audit du 2026-09-17 ; le
  # refus lui-même n'a pas changé, seul son code dit maintenant la vérité.
  # (nom_acceptable, plus bas, le refuserait aussi — mais après le test
  # d'extension, donc trop tard pour rendre le bon code.)
  [[ $nom != index.html ]] || mourir 6 \
    "Le nom « $nom » est refusé." \
    "« index.html » est la page : elle se refabrique à chaque dépôt, elle ne" \
    "se dépose pas à la main. Renomme le fichier."
  est_une_video "$nom" || mourir 5 \
    "« $nom » n'est pas une vidéo." \
    "Extensions acceptées : ${EXTENSIONS_VIDEO[*]}."
  nom_acceptable "$nom" || mourir 6 \
    "Le nom « $nom » est refusé." \
    "Ni barre oblique, ni « .. », ni saut de ligne, ni caractère de contrôle," \
    "et « index.html » est réservé à la page."
done

# Deux fichiers de même nom dans des dossiers différents : le second écraserait
# le premier sur le serveur, sans que rien ne le dise.
noms_vus=()
for argument in "$@"; do
  nom=$(basename -- "$argument")
  for deja in "${noms_vus[@]+"${noms_vus[@]}"}"; do
    [[ $deja == "$nom" ]] && mourir 6 \
      "Deux fichiers portent le même nom : « $nom »." \
      "Le second écraserait le premier sur le serveur. Renomme-en un."
  done
  noms_vus+=("$nom")
done

lire_secrets

# ── Un coin de travail, nettoyé quoi qu'il arrive ───────────────────────────
TRAVAIL=$(mktemp -d -t videos-deposer.XXXXXXXX)
trap 'rm -rf -- "$TRAVAIL"' EXIT

# ── 2. L'espace libre ───────────────────────────────────────────────────────

avancer "serveur : mesure de l'espace libre"
creer_le_dossier_distant

poids_a_deposer=0
for argument in "$@"; do
  poids_a_deposer=$(( poids_a_deposer + $(stat -c %s -- "$argument") ))
done

libre=$(espace_libre_octets)
[[ $libre =~ ^[0-9]+$ ]] || mourir 12 "Espace libre illisible sur le serveur."
plancher=$(( VIDEOS_ESPACE_MINIMAL_GO * 1024 * 1024 * 1024 ))
apres=$(( libre - poids_a_deposer ))

if (( apres < plancher )); then
  mourir 10 \
    "Pas assez de place sur le serveur." \
    "libre aujourd'hui   : $(taille_lisible "$libre")" \
    "à déposer           : $(taille_lisible "$poids_a_deposer")" \
    "il resterait        : $( (( apres < 0 )) && echo "rien" || taille_lisible "$apres")" \
    "plancher exigé      : $(taille_lisible "$plancher") (la base Mongo partage la partition)"
fi
dire "  libre : $(taille_lisible "$libre") — après dépôt : $(taille_lisible "$apres")"

# ── 3. La copie ─────────────────────────────────────────────────────────────

avancer "copie de $# fichier(s) ($(taille_lisible "$poids_a_deposer")) vers $DESTINATION_COPIE"
copier "$@" "$DESTINATION_COPIE" \
  || mourir 11 "La copie a échoué. Rien n'a été changé sur la page ; relance quand c'est réparé."

# ── 4. Dater les fichiers déposés à l'instant du dépôt ──────────────────────

# --no-create : `touch` CRÉE le fichier s'il n'existe pas. Un fichier que la
# copie n'a pas déposé (lien symbolique ignoré par rsync, copie partielle
# balayée) renaissait donc ici en fichier VIDE, de 0 octet — la page le listait,
# le contrôle HTTP le trouvait, et le dépôt se déclarait réussi sur du vide.
# Mesuré au banc le 2026-09-17, en exerçant la correction de l'audit : sans
# cette option, le contrôle « chaque nom déposé est-il dans le relevé ? » ne
# mordait jamais, parce que `touch` avait recréé le nom juste avant.
# Avec --no-create, un nom absent le reste, et le contrôle le voit.
commande_touch="touch --no-create --"
for argument in "$@"; do
  commande_touch+=" $(citer "$VIDEOS_DOSSIER_DISTANT/$(basename -- "$argument")")"
done
distant "$commande_touch" \
  || mourir 11 "Les fichiers sont copiés, mais impossible de les dater sur le serveur."

# ── 5. La page, refaite depuis le dossier distant ───────────────────────────

avancer "relevé du dossier distant, puis page refaite et envoyée"
refaire_et_envoyer_la_page "$TRAVAIL"
dire "  le dossier contient $NB_VIDEOS vidéo(s), $(taille_lisible "$POIDS_VIDEOS")"

# CE QU'ON VIENT DE DÉPOSER EST-IL VRAIMENT LÀ ?
#
# Le relevé distant est la SEULE vérité sur le dossier du serveur. Jusqu'à
# l'audit du 2026-09-17, le script ne contrôlait que ce que la page liste : si
# un fichier n'arrivait jamais (rsync qui l'ignore, nom transformé en chemin,
# copie partielle balayée), la page ne le nommait pas, le contrôle HTTP n'avait
# donc rien à interroger… et le script sortait en 0 avec « ✓ Déposé ».
# Le contrôle porte maintenant sur les noms QU'ON VIENT DE DONNER, un par un.
#
# Les manquants ne tuent pas le script ici : ils sont retenus et joints aux
# anomalies du point 7. Règle de la maison — dès que la page est publiée, le
# contrôle HTTP a lieu quoi qu'il arrive, et c'est lui qui conclut (voir la
# faute de restorecon corrigée le 2026-09-16). Le code de sortie reste 15.
manquants=()
for argument in "$@"; do
  nom=$(basename -- "$argument")
  trouve=non
  for present in "${VIDEOS_PRESENTES[@]+"${VIDEOS_PRESENTES[@]}"}"; do
    [[ $present == "$nom" ]] && { trouve=oui; break; }
  done
  [[ $trouve == oui ]] || manquants+=("$nom")
done

# ── 6. SELinux ──────────────────────────────────────────────────────────────
#
# Un échec ici n'arrête PLUS le script : il est retenu, et c'est le contrôle du
# point 7 qui dira ce qui est vrai. Voir reposer_le_contexte, dans
# videos-commun.sh, pour la faute que cet ordre a corrigée.

avancer "contexte SELinux sur $VIDEOS_DOSSIER_DISTANT"
selinux=0
reposer_le_contexte || selinux=$?
dire_le_contexte "$selinux"

# ── 7. Le contrôle ──────────────────────────────────────────────────────────

avancer "contrôle : la page et chaque vidéo, sans mot de passe puis avec"
preparer_netrc "$TRAVAIL/netrc"

rates=()

# Les absents du dossier distant, relevés juste après le point 5 : ce sont des
# anomalies à part entière, et les plus graves — rien ne les aurait signalées.
for nom in "${manquants[@]+"${manquants[@]}"}"; do
  rates+=("« $nom » N'EST PAS dans $VIDEOS_DOSSIER_DISTANT sur le serveur — la copie ne l'y a jamais mis")
done

adresse=$(adresse_privee)
code=$(code_sans_mot_de_passe "$adresse")
[[ $code == 401 ]] || rates+=("la page sans mot de passe rend $code au lieu de 401 — $adresse")
code=$(code_avec_mot_de_passe "$adresse")
[[ $code == 200 ]] || rates+=("la page avec mot de passe rend $code au lieu de 200 — $adresse")

for nom in "${VIDEOS_PRESENTES[@]+"${VIDEOS_PRESENTES[@]}"}"; do
  adresse=$(adresse_du_fichier "$nom")
  code=$(code_sans_mot_de_passe "$adresse")
  [[ $code == 401 ]] || rates+=("« $nom » sans mot de passe rend $code au lieu de 401")
  code=$(code_avec_mot_de_passe "$adresse")
  [[ $code == 200 ]] || rates+=("« $nom » avec mot de passe rend $code au lieu de 200")
  code=$(code_plage "$adresse")
  [[ $code == 206 ]] || rates+=("« $nom » en reprise (Range) rend $code au lieu de 206")
done

if (( ${#rates[@]} > 0 )); then
  # Le contrôle prime : tant qu'il n'a pas établi ce qui est servi, un
  # restorecon manqué n'est qu'une piste de plus, pas le sujet.
  suite=()
  if (( selinux == 1 )); then
    suite=("" \
      "restorecon a AUSSI refusé, juste avant ce contrôle : commence par là," \
      "  ssh $VIDEOS_HOTE_DISTANT 'sudo restorecon -R $VIDEOS_DOSSIER_DISTANT'" \
      "puis relance le dépôt — une étiquette SELinux fausse fait rendre 403.")
  fi
  mourir 15 \
    "La page est en ligne mais le contrôle a trouvé ${#rates[@]} anomalie(s) :" \
    "${rates[@]}" \
    "" \
    "Tant que ceci n'est pas réglé, la page peut lister un fichier qui ne se" \
    "télécharge pas. Vérifie le bloc nginx (voir deploy/videos-matthieu.md)." \
    "${suite[@]+"${suite[@]}"}"
fi
bon "contrôle passé : 401 sans mot de passe, 200 avec, 206 en reprise"

# Le contrôle est passé : « rien n'est perdu » n'est plus une supposition, il
# vient d'être mesuré. C'est seulement maintenant qu'on peut le dire.
if (( selinux == 1 )); then
  mourir 14 \
    "restorecon a refusé sur le serveur." \
    "CE QUI VIENT D'ÊTRE VÉRIFIÉ, par de vraies requêtes :" \
    "  la page et chacune des $NB_VIDEOS vidéo(s) rendent 401 sans mot de passe," \
    "  200 avec, 206 en reprise. Les fichiers sont déposés, la page est à jour" \
    "  et servie : rien n'est perdu." \
    "CE QUI RESTE À FAIRE À LA MAIN, les étiquettes SELinux :" \
    "  ssh $VIDEOS_HOTE_DISTANT 'sudo restorecon -R $VIDEOS_DOSSIER_DISTANT'" \
    "Sans ce geste la page marche aujourd'hui, mais les étiquettes ne sont pas" \
    "celles que la politique attend : un réétiquetage du serveur les changerait." \
    "" \
    "Adresse de la page : $(adresse_privee)"
fi

# ── Le mot de la fin ────────────────────────────────────────────────────────

echo
bon "Déposé :"
for argument in "$@"; do
  nom=$(basename -- "$argument")
  dire "    · $nom — $(taille_lisible "$(stat -c %s -- "$argument")")"
done
dire "  Total déposé : $(taille_lisible "$poids_a_deposer")"
dire "  La page liste maintenant $NB_VIDEOS vidéo(s), $(taille_lisible "$POIDS_VIDEOS")."
echo
dire "  Adresse à donner à Matthieu :"
dire "      $(adresse_privee)"
dire "  Le mot de passe n'est pas écrit ici : il est dans $VIDEOS_SECRETS"
dire "  et au coffre. Transmets-le par un autre canal que l'adresse."
