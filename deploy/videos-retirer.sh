#!/usr/bin/env bash
# Retire UNE vidéo de la page privée de Matthieu — l'inverse de videos-deposer.sh.
#
#   ./videos-retirer.sh 'répétition du 12.mp4'
#
# On donne le NOM tel qu'il apparaît dans la page, pas un chemin : le fichier
# à retirer est sur le serveur, pas sur la station.
#
# CE QU'IL FAIT, DANS L'ORDRE
#   1. Refuse, AVANT tout contact réseau : pas d'argument, plus d'un argument,
#      une option, un nom qui contient « / » ou « .. », le nom de la page.
#   2. Vérifie que le fichier est bien dans le dossier distant — sinon il le
#      dit, plutôt que de faire semblant d'avoir supprimé quelque chose.
#   3. Supprime, refabrique la page depuis le dossier distant, l'envoie,
#      repose le contexte SELinux — sans s'arrêter si ce dernier geste rate.
#   4. CONTRÔLE, TOUJOURS : l'ancienne adresse doit rendre 404, et la page 200.
#      Attention : 404 se demande AVEC le mot de passe. Sans lui, nginx rend
#      401 pour tout, y compris pour un fichier qui n'existe pas — un 401 ne
#      prouverait donc rien sur la disparition du fichier.
#      Dès que la page est republiée, le contrôle a lieu : le code de sortie
#      rend compte des deux, 15 si le contrôle rate (il prime), 14 si seul
#      restorecon a raté.
#
# LES ARTIFICES DU BANC D'ESSAI et LES CODES DE SORTIE sont déclarés en tête de
# videos-commun.sh.

set -euo pipefail

ICI=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=videos-commun.sh
source "$ICI/videos-commun.sh"

# ── 1. Les refus, avant tout contact réseau ─────────────────────────────────

if (( $# == 0 )); then
  mourir 2 "Aucune vidéo à retirer." \
           "usage : videos-retirer.sh <nom de la vidéo>"
fi

if (( $# > 1 )); then
  mourir 2 "Un seul nom à la fois : $# arguments reçus." \
           "usage : videos-retirer.sh <nom de la vidéo>"
fi

NOM=$1

if [[ $NOM == -* ]]; then
  mourir 3 "« $NOM » commence par un tiret : aucune option n'est acceptée." \
           "Un secret ne passe JAMAIS en argument — la ligne de commande est" \
           "lisible par tous les comptes de la machine."
fi

if [[ $NOM == */* ]]; then
  mourir 6 "« $NOM » contient une barre oblique." \
           "On donne le nom du fichier, pas un chemin : le retrait ne sort pas" \
           "du dossier des vidéos."
fi

if [[ $NOM == *..* ]]; then
  mourir 6 "« $NOM » contient « .. »." \
           "On ne remonte pas hors du dossier des vidéos."
fi

nom_acceptable "$NOM" || mourir 6 \
  "Le nom « $NOM » est refusé." \
  "Ni barre oblique, ni « .. », ni saut de ligne, ni caractère de contrôle," \
  "et « index.html » est la page : elle se refabrique, elle ne se retire pas."

lire_secrets

TRAVAIL=$(mktemp -d -t videos-retirer.XXXXXXXX)
trap 'rm -rf -- "$TRAVAIL"' EXIT

# ── 2. Le fichier est-il vraiment là ? ──────────────────────────────────────

avancer "relevé du dossier distant"
relever_dossier_distant "$TRAVAIL/avant"

trouve=non
poids_retire=0
while IFS= read -r -d '' ligne; do
  taille=${ligne%%$'\t'*}
  reste=${ligne#*$'\t'}
  candidat=${reste#*$'\t'}
  if [[ $candidat == "$NOM" ]]; then
    trouve=oui
    poids_retire=$taille
  fi
done < "$TRAVAIL/avant"

if [[ $trouve == non ]]; then
  mourir 16 "« $NOM » n'est pas dans $VIDEOS_DOSSIER_DISTANT sur le serveur." \
            "Rien n'a été touché. Le nom doit être écrit exactement comme dans la page."
fi

# ── 3. La suppression, puis la page ─────────────────────────────────────────

avancer "suppression de « $NOM » ($(taille_lisible "$poids_retire"))"
distant "rm -f -- $(citer "$VIDEOS_DOSSIER_DISTANT/$NOM")" \
  || mourir 17 "La suppression a échoué sur le serveur ; la page n'a pas été touchée."

avancer "page refaite depuis le dossier distant, puis envoyée"
refaire_et_envoyer_la_page "$TRAVAIL"
dire "  le dossier contient maintenant $NB_VIDEOS vidéo(s), $(taille_lisible "$POIDS_VIDEOS")"

# Un échec ici n'arrête PLUS le script : il est retenu, et c'est le contrôle du
# point 4 qui dira ce qui est vrai. Voir reposer_le_contexte, dans
# videos-commun.sh, pour la faute que cet ordre a corrigée.
avancer "contexte SELinux sur $VIDEOS_DOSSIER_DISTANT"
selinux=0
reposer_le_contexte || selinux=$?
dire_le_contexte "$selinux"

# ── 4. Le contrôle ──────────────────────────────────────────────────────────

avancer "contrôle : l'ancienne adresse doit rendre 404, la page 200"
preparer_netrc "$TRAVAIL/netrc"

rates=()

adresse=$(adresse_du_fichier "$NOM")
code=$(code_avec_mot_de_passe "$adresse")
[[ $code == 404 ]] || rates+=("« $NOM » rend encore $code au lieu de 404 — $adresse")

adresse=$(adresse_privee)
code=$(code_sans_mot_de_passe "$adresse")
[[ $code == 401 ]] || rates+=("la page sans mot de passe rend $code au lieu de 401")
code=$(code_avec_mot_de_passe "$adresse")
[[ $code == 200 ]] || rates+=("la page avec mot de passe rend $code au lieu de 200")

# La page ne doit plus nommer le fichier retiré. Le contrôle le lit vraiment,
# au lieu de le supposer : c'est la page SERVIE qui compte, pas celle qu'on
# croit avoir envoyée.
for restant in "${VIDEOS_PRESENTES[@]+"${VIDEOS_PRESENTES[@]}"}"; do
  [[ $restant == "$NOM" ]] && rates+=("« $NOM » est encore listé dans la page")
done

if (( ${#rates[@]} > 0 )); then
  # Le contrôle prime : tant qu'il n'a pas établi ce qui est servi, un
  # restorecon manqué n'est qu'une piste de plus, pas le sujet.
  suite=()
  if (( selinux == 1 )); then
    suite=("" \
      "restorecon a AUSSI refusé, juste avant ce contrôle :" \
      "  ssh $VIDEOS_HOTE_DISTANT 'sudo restorecon -R $VIDEOS_DOSSIER_DISTANT'")
  fi
  mourir 15 \
    "Le contrôle a trouvé ${#rates[@]} anomalie(s) :" \
    "${rates[@]}" \
    "${suite[@]+"${suite[@]}"}"
fi
bon "contrôle passé : 404 sur l'ancienne adresse, page toujours servie"

# Le contrôle est passé : ce qui suit est mesuré, pas supposé.
if (( selinux == 1 )); then
  mourir 14 \
    "restorecon a refusé sur le serveur." \
    "CE QUI VIENT D'ÊTRE VÉRIFIÉ, par de vraies requêtes :" \
    "  « $NOM » rend 404, la page rend 401 sans mot de passe et 200 avec, et" \
    "  elle ne liste plus le fichier retiré. Le retrait est bien fait." \
    "CE QUI RESTE À FAIRE À LA MAIN, les étiquettes SELinux :" \
    "  ssh $VIDEOS_HOTE_DISTANT 'sudo restorecon -R $VIDEOS_DOSSIER_DISTANT'"
fi

# ── Le mot de la fin ────────────────────────────────────────────────────────

echo
bon "Retiré : $NOM — $(taille_lisible "$poids_retire")"
dire "  La page liste maintenant $NB_VIDEOS vidéo(s), $(taille_lisible "$POIDS_VIDEOS")."
echo
dire "  Adresse de la page :"
dire "      $(adresse_privee)"
