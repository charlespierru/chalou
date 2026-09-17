#!/usr/bin/env bash
# Fabrique la page « Vidéos pour Matthieu » à partir d'un dossier, et l'écrit
# sur la sortie standard. Le résultat est utilisable tel quel comme index.html
# du dossier des vidéos.
#
#   ./videos-page.sh /chemin/du/dossier > index.html
#
# POURQUOI une page générée plutôt que l'index automatique de nginx : l'index
# automatique rend une page nue, sans jeu de caractères déclaré (les accents y
# sortent cassés), avec des noms tronqués, et rien qui puisse s'essayer en
# local. Ici la page est dans la charte du site, elle se relit, elle se teste,
# et un contrôle après dépôt prouve que chaque fichier listé répond vraiment
# (voir videos-deposer.sh).
#
# CE QUE LA PAGE RESPECTE, ET POURQUOI :
#   · aucun style ni script en ligne — la politique de sécurité du site (CSP)
#     les interdit : `style-src 'self'; script-src 'self'`. Les trois feuilles
#     sont donc appelées par chemin ABSOLU (/styles/…), parce que la page est
#     servie depuis /videos-<aléa>/ et qu'un chemin relatif y chercherait
#     /videos-<aléa>/styles/… qui n'existe pas.
#   · `<meta charset="utf-8">` : les noms de fichiers portent des accents.
#   · `<meta name="robots" content="noindex, nofollow">` : ceinture, en plus de
#     l'en-tête X-Robots-Tag posé par nginx. Si un jour la page fuit hors du
#     mot de passe, elle dit elle-même de ne pas l'indexer.
#   · aucun lien vers le site public : la page privée ne relie rien.
#
# ÉCHAPPEMENT — deux choses différentes, à ne pas confondre (les deux fonctions
# sont dans videos-commun.sh) :
#   · l'affichage du nom passe par un échappement HTML (& < > " ') ;
#   · le lien passe par un encodage d'URL (chaque octet hors [A-Za-z0-9._~-]
#     devient %XX). Un nom comme « Répétition n°1 & final.mp4 » donne
#     « R%C3%A9p%C3%A9tition%20n%C2%B01%20%26%20final.mp4 » dans le href et
#     « Répétition n°1 &amp; final.mp4 » dans le texte.
#
# TRI ET LOCALE : le script travaille en locale C. Le tri par nom est donc un
# tri par octets, insensible à la casse (`sort -f`), identique sur toute
# machine — un tri qui changerait selon la locale installée rendrait la page
# intestable. Conséquence assumée : un nom commençant par un accent se range
# après les autres. Les noms de mois sont écrits en dur, pour la même raison :
# aucune dépendance à une locale française installée.
#
# REPRODUCTIBILITÉ : l'heure de fabrication de la liste vient de
# SOURCE_DATE_EPOCH si cette variable est posée, de l'horloge sinon. Une épreuve
# peut ainsi comparer deux sorties.
#
# Codes de sortie :
#   0 — la page est écrite
#   2 — nombre d'arguments faux (il en faut exactement un)
#   3 — l'argument n'est pas un dossier lisible

set -euo pipefail

ICI=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=videos-commun.sh
source "$ICI/videos-commun.sh"

# ── Les refus ───────────────────────────────────────────────────────────────
if (( $# != 1 )); then
  mourir 2 "videos-page.sh attend exactement un argument : le dossier des vidéos." \
           "usage : videos-page.sh <dossier> > index.html"
fi

DOSSIER=$1
if [[ ! -d $DOSSIER || ! -r $DOSSIER ]]; then
  mourir 3 "« $DOSSIER » n'est pas un dossier lisible."
fi

# ── Le relevé du dossier ────────────────────────────────────────────────────
# find -printf '%f\0' : séparateur nul, seul séparateur qu'un nom de fichier ne
# peut pas contenir. Le tri est fait ici, une fois, et la page en découle.
conditions=()
for extension in "${EXTENSIONS_VIDEO[@]}"; do
  conditions+=(-iname "*.${extension}" -o)
done
unset 'conditions[${#conditions[@]}-1]'   # retire le dernier -o

fichiers=()
while IFS= read -r -d '' nom; do
  fichiers+=("$nom")
done < <(find "$DOSSIER" -maxdepth 1 -type f \( "${conditions[@]}" \) -printf '%f\0' \
         | sort -z -f)

# ── La page ─────────────────────────────────────────────────────────────────
maintenant=${SOURCE_DATE_EPOCH:-$(date +%s)}

total_octets=0
for nom in "${fichiers[@]+"${fichiers[@]}"}"; do
  total_octets=$(( total_octets + $(stat -c %s -- "$DOSSIER/$nom") ))
done

nombre=${#fichiers[@]}
case $nombre in
  0) resume="Aucune vidéo pour l’instant." ;;
  1) resume="1 vidéo — $(taille_lisible "$total_octets")." ;;
  *) resume="$nombre vidéos — $(taille_lisible "$total_octets") en tout." ;;
esac

cat <<'EN_TETE'
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Vidéos pour Matthieu</title>
<link rel="stylesheet" href="/styles/tokens.css">
<link rel="stylesheet" href="/styles/site.css">
<link rel="stylesheet" href="/styles/videos.css">
</head>
<body>

<header class="site-header">
  <div class="wrap">
    <span class="brand">Charles Pierru</span>
    <span class="videos-etiquette">Page privée</span>
  </div>
</header>

<main>

  <section class="page-head">
    <div class="wrap">
      <p class="eyebrow">Dépôt privé</p>
      <h1>Vidéos pour Matthieu</h1>
      <p class="page-lead">Les vidéos que Charles a déposées pour toi.</p>
EN_TETE

printf '      <p class="videos-resume">%s</p>\n' "$(echapper_html "$resume")"

cat <<'FIN_TETE'
    </div>
  </section>

  <section class="videos-section">
    <div class="wrap">
FIN_TETE

if (( nombre == 0 )); then
  cat <<'VIDE'
      <p class="videos-vide">Il n’y a rien pour l’instant. Reviens quand Charles
        t’aura prévenu qu’il a déposé quelque chose.</p>
VIDE
else
  echo '      <ul class="videos-liste">'
  for nom in "${fichiers[@]}"; do
    octets=$(stat -c %s -- "$DOSSIER/$nom")
    horodatage=$(stat -c %Y -- "$DOSSIER/$nom")
    printf '        <li class="video">\n'
    printf '          <div class="video-texte">\n'
    printf '            <p class="video-nom">%s</p>\n' "$(echapper_html "$nom")"
    printf '            <p class="video-meta">%s · déposée le <time datetime="%s">%s</time></p>\n' \
           "$(taille_lisible "$octets")" \
           "$(echapper_html "$(date_machine "$horodatage")")" \
           "$(echapper_html "$(date_lisible "$horodatage")")"
    printf '          </div>\n'
    printf '          <a class="btn btn-primary" href="%s" download>Télécharger</a>\n' \
           "$(encoder_url "$nom")"
    printf '        </li>\n'
  done
  echo '      </ul>'
fi

cat <<'FIN_LISTE'
    </div>
  </section>

</main>

<footer class="site-footer">
  <div class="wrap">
FIN_LISTE

printf '    <span>Page privée — elle n’est reliée à rien et n’est pas indexée.</span>\n'
printf '    <span>Liste établie le %s.</span>\n' "$(echapper_html "$(date_lisible "$maintenant")")"

cat <<'PIED'
  </div>
</footer>

</body>
</html>
PIED
