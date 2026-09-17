# Fonctions communes aux scripts vidéos de chalou.link.
#
# Ce fichier NE S'EXÉCUTE PAS : il se lit par `source`, depuis videos-page.sh,
# videos-deposer.sh et videos-retirer.sh, qui vivent dans le même dossier.
# Pourquoi un fichier commun : le dépôt et le retrait font exactement les mêmes
# gestes (lire les secrets, relever le dossier distant, refabriquer la page,
# l'envoyer, contrôler par HTTP). Deux copies de ces gestes finiraient par
# diverger, et c'est toujours celle qu'on ne relit plus qui ment.
#
# C'est au script appelant de poser `set -euo pipefail` : un fichier lu par
# `source` qui change le comportement du shell de son appelant est une mauvaise
# surprise.
#
# ── LES ARTIFICES (ce qui permet d'essayer sans serveur) ────────────────────
#
# Toute la tuyauterie distante passe par DEUX fonctions, `distant` et `copier`,
# et par une seule adresse web. Chacune se remplace par une variable
# d'environnement, pour qu'un banc d'essai puisse mettre un faux à la place et
# voir les scripts marcher — et surtout les voir ÉCHOUER quand le faux répond
# mal. Une vérification qui ne sait pas échouer ne prouve rien.
#
#   VIDEOS_SECRETS           fichier des secrets (défaut ~/.config/chalou/videos-matthieu.env)
#   VIDEOS_HOTE_DISTANT      alias ssh du serveur (défaut « hostinger ») ; vide = tout en local
#   VIDEOS_DOSSIER_DISTANT   dossier servi (défaut /var/www/chalou.link/videos)
#   VIDEOS_DISTANT_CMD       commande qui exécute une ligne sur le serveur (défaut « ssh <hôte> »)
#   VIDEOS_COPIE_CMD         commande de copie (défaut « rsync --archive --no-links --partial --human-readable --chmod=D755,F644 »)
#   VIDEOS_HOTE_WEB          adresse du site pour le contrôle (défaut https://chalou.link)
#   VIDEOS_ESPACE_MINIMAL_GO plancher d'espace libre après copie (défaut 20)
#   VIDEOS_DELAI_HTTP        délai maximal d'une requête de contrôle, en secondes (défaut 30)
#
# ── LES CODES DE SORTIE, communs aux trois scripts ─────────────────────────
#
#    0  tout est passé
#    2  nombre d'arguments faux (dont : aucun argument)
#    3  une option a été passée — aucune n'est acceptée
#    4  fichier introuvable, ou pas un fichier ordinaire lisible
#    5  ce n'est pas une vidéo (extension)
#    6  nom de fichier refusé (barre oblique, « .. », saut de ligne, index.html…)
#    7  fichier de secrets absent ou illisible
#    8  droits du fichier de secrets différents de 0600
#    9  une valeur manque ou est mal formée dans le fichier de secrets
#   10  espace libre insuffisant sur le serveur
#   11  la copie a échoué
#   12  le relevé du dossier distant a échoué
#   13  l'envoi de la page a échoué
#   14  restorecon a échoué — mais le contrôle HTTP a bien eu lieu, et il est
#       passé : la page est en ligne et vérifiée, seules les étiquettes SELinux
#       restent à reposer à la main
#   15  contrôle HTTP : réponse inattendue. Ce code PRIME sur le 14 : tant que
#       le contrôle n'a pas établi ce qui est servi, rien n'est acquis
#   16  le fichier demandé n'est pas dans le dossier distant
#   17  la suppression distante a échoué

# Locale C partout : le tri des noms, l'encodage d'URL octet par octet et le
# format des nombres ne doivent dépendre d'aucune locale installée.
export LC_ALL=C

# Les extensions tenues pour des vidéos, une seule fois pour les trois scripts.
EXTENSIONS_VIDEO=(mp4 mov webm mkv m4v)

MOIS=(janvier février mars avril mai juin juillet
      août septembre octobre novembre décembre)

VIDEOS_SECRETS=${VIDEOS_SECRETS:-$HOME/.config/chalou/videos-matthieu.env}
VIDEOS_HOTE_DISTANT=${VIDEOS_HOTE_DISTANT-hostinger}
VIDEOS_DOSSIER_DISTANT=${VIDEOS_DOSSIER_DISTANT:-/var/www/chalou.link/videos}
VIDEOS_DISTANT_CMD=${VIDEOS_DISTANT_CMD:-ssh $VIDEOS_HOTE_DISTANT}
# --chmod : nginx (utilisateur « nginx ») doit pouvoir LIRE ce qu'on dépose.
# `--archive` recopie les droits de la station tels quels : un fichier en 600
# chez Charles arrivait en 600 sur le serveur, et nginx répondait 403 pour la
# page ET pour chaque vidéo — mesuré au premier passage réel, le 2026-09-17,
# par le contrôle de ce script lui-même. On impose donc 644 aux fichiers et
# 755 aux dossiers, quoi qu'il en soit à la source.
#
# --no-links : DEUXIÈME CEINTURE contre le lien symbolique. `--archive` contient
# `-l`, qui recopie un lien COMME LIEN. Un lien vers une vidéo arrivait donc sur
# le serveur en lien pendouillant : `find -type f` ne le voyait pas, la page ne
# le listait pas, et le dépôt se déclarait réussi (défaut relevé par l'audit du
# 2026-09-17). videos-deposer.sh refuse maintenant tout lien AVANT de copier ;
# cette option fait qu'une entrée qui lui échapperait ne franchirait pas rsync —
# il l'ignore et le dit (« skipping non-regular file »).
VIDEOS_COPIE_CMD=${VIDEOS_COPIE_CMD:-rsync --archive --no-links --partial --human-readable --chmod=D755,F644}
VIDEOS_HOTE_WEB=${VIDEOS_HOTE_WEB:-https://chalou.link}
VIDEOS_ESPACE_MINIMAL_GO=${VIDEOS_ESPACE_MINIMAL_GO:-20}
VIDEOS_DELAI_HTTP=${VIDEOS_DELAI_HTTP:-30}

# Où rsync doit déposer. Un hôte vide donne un chemin local : c'est ce que fait
# le banc d'essai, qui copie dans un faux serveur posé sur la station.
if [[ -n $VIDEOS_HOTE_DISTANT ]]; then
  DESTINATION_COPIE="${VIDEOS_HOTE_DISTANT}:${VIDEOS_DOSSIER_DISTANT}/"
else
  DESTINATION_COPIE="${VIDEOS_DOSSIER_DISTANT}/"
fi

# ── Dire et mourir ──────────────────────────────────────────────────────────

dire()    { printf '%s\n' "$*"; }
avancer() { printf '→ %s\n' "$*"; }
bon()     { printf '✓ %s\n' "$*"; }

# mourir <code> <première ligne> [lignes suivantes…]
mourir() {
  local code=$1; shift
  printf '✗ %s\n' "$1" >&2; shift
  local ligne
  for ligne in "$@"; do printf '  %s\n' "$ligne" >&2; done
  exit "$code"
}

# ── Texte : échapper, encoder, mettre en forme ──────────────────────────────

# Échappement HTML, caractère par caractère.
#
# PIÈGE PAYÉ ICI : la première version passait par ${s//</&lt;}. Depuis bash 5.2,
# une esperluette dans le texte de remplacement d'une substitution de motif
# désigne LE TEXTE TROUVÉ, comme dans sed — « &lt; » rendait donc « <lt; ».
# Le banc l'a attrapé (« L'été » sortait « L'#39;été »). Une boucle sur les
# caractères n'a pas cette ambiguïté, quelle que soit la version de bash.
echapper_html() {
  local s=$1 sortie='' i c
  for (( i = 0; i < ${#s}; i++ )); do
    c=${s:i:1}
    case $c in
      '&') sortie+='&amp;' ;;
      '<') sortie+='&lt;' ;;
      '>') sortie+='&gt;' ;;
      '"') sortie+='&quot;' ;;
      "'") sortie+='&#39;' ;;
      *)   sortie+=$c ;;
    esac
  done
  printf '%s' "$sortie"
}

# Encodage d'URL, octet par octet. La locale C garantit que ${s:i:1} est bien
# UN octet : un caractère accenté sort donc en deux séquences %XX correctes.
# À NE PAS CONFONDRE avec l'échappement HTML : l'un sert au href, l'autre au
# texte affiché. Le résultat d'un encodage d'URL ne contient que des caractères
# sûrs en HTML ; l'inverse serait faux.
encoder_url() {
  local s=$1 sortie='' i c
  for (( i = 0; i < ${#s}; i++ )); do
    c=${s:i:1}
    case $c in
      [A-Za-z0-9._~-]) sortie+=$c ;;
      *) printf -v sortie '%s%%%02X' "$sortie" "'$c" ;;
    esac
  done
  printf '%s' "$sortie"
}

# Taille lisible : octets, Ko, Mo, Go, To — une décimale, virgule française.
# Paliers de 1024, comme les affiche le gestionnaire de fichiers.
taille_lisible() {
  local octets=$1
  if (( octets < 1024 )); then
    printf '%s o' "$octets"
    return
  fi
  awk -v o="$octets" 'BEGIN {
    split("Ko Mo Go To", unites, " ");
    valeur = o / 1024; rang = 1;
    while (valeur >= 1024 && rang < 4) { valeur /= 1024; rang++ }
    texte = sprintf("%.1f", valeur);
    sub(/\./, ",", texte);
    printf "%s %s", texte, unites[rang];
  }'
}

# Date lisible en français, sans dépendre d'une locale installée.
date_lisible() {
  local horodatage=$1 jour mois annee heure
  read -r jour mois annee heure < <(date -d "@$horodatage" '+%-d %-m %Y %H:%M')
  printf '%s %s %s à %s' "$jour" "${MOIS[mois - 1]}" "$annee" "$heure"
}

date_machine() { date -d "@$1" '+%Y-%m-%dT%H:%M:%S%:z'; }

# ── Noms de fichiers ────────────────────────────────────────────────────────

est_une_video() {
  local nom=$1 extension minuscules
  minuscules=${nom,,}
  for extension in "${EXTENSIONS_VIDEO[@]}"; do
    [[ $minuscules == *".${extension}" ]] && return 0
  done
  return 1
}

# Un nom de fichier qui va traverser un shell distant, une URL et du HTML.
# Ce qui est refusé, et pourquoi :
#   · une barre oblique ou « .. » : on sortirait du dossier des vidéos ;
#   · un saut de ligne ou un caractère de contrôle : le relevé distant sépare
#     ses lignes par un octet nul, mais un tel nom casserait tout le reste ;
#   · « index.html » : c'est la page, elle se refabrique, elle ne se dépose ni
#     ne se retire à la main.
nom_acceptable() {
  local nom=$1
  [[ -n $nom ]]                  || return 1
  [[ $nom != */* ]]              || return 1
  [[ $nom != "." && $nom != ".." ]] || return 1
  [[ $nom != *..* ]]             || return 1
  [[ $nom != index.html ]]       || return 1
  [[ $nom != *[[:cntrl:]]* ]]    || return 1
  return 0
}

# ── Les secrets ─────────────────────────────────────────────────────────────

# Le fichier est LU, pas exécuté. `source` ferait tourner tout ce qu'il
# contient : un mot de passe qui porterait par accident « $( » deviendrait une
# commande. On analyse donc ligne à ligne, et on ne retient que trois clés.
lire_secrets() {
  local fichier=$VIDEOS_SECRETS

  [[ -e $fichier ]] || mourir 7 \
    "Pas de fichier de secrets : $fichier" \
    "Voir deploy/videos-matthieu.md, « Le fichier de secrets »."
  [[ -f $fichier && -r $fichier ]] || mourir 7 \
    "Le fichier de secrets n'est pas un fichier ordinaire lisible : $fichier"

  local droits
  droits=$(stat -c %a -- "$fichier")
  [[ $droits == 600 ]] || mourir 8 \
    "Les droits du fichier de secrets sont $droits, il les faut 600." \
    "Corrige : chmod 600 $fichier"

  VIDEOS_SEGMENT=''
  VIDEOS_UTILISATEUR=''
  VIDEOS_MOT_DE_PASSE=''

  local ligne cle valeur
  while IFS= read -r ligne || [[ -n $ligne ]]; do
    ligne=${ligne%$'\r'}
    [[ $ligne =~ ^[[:space:]]*(#.*)?$ ]] && continue
    [[ $ligne =~ ^[[:space:]]*([A-Za-z_][A-Za-z_0-9]*)[[:space:]]*=(.*)$ ]] || continue
    cle=${BASH_REMATCH[1]}
    valeur=${BASH_REMATCH[2]}
    if (( ${#valeur} >= 2 )) && [[ ( ${valeur:0:1} == '"' && ${valeur: -1} == '"' ) \
                               || ( ${valeur:0:1} == "'" && ${valeur: -1} == "'" ) ]]; then
      valeur=${valeur:1:${#valeur}-2}
    fi
    case $cle in
      VIDEOS_SEGMENT|VIDEOS_UTILISATEUR|VIDEOS_MOT_DE_PASSE)
        printf -v "$cle" '%s' "$valeur" ;;
    esac
  done < "$fichier"

  [[ -n $VIDEOS_SEGMENT ]] || mourir 9 \
    "VIDEOS_SEGMENT manque dans $fichier"
  [[ -n $VIDEOS_UTILISATEUR ]] || mourir 9 \
    "VIDEOS_UTILISATEUR manque dans $fichier"
  [[ -n $VIDEOS_MOT_DE_PASSE ]] || mourir 9 \
    "VIDEOS_MOT_DE_PASSE manque dans $fichier"

  # Le segment devient un morceau d'adresse : s'il portait autre chose, le
  # contrôle interrogerait une adresse qui n'est pas celle que nginx sert.
  [[ $VIDEOS_SEGMENT =~ ^[A-Za-z0-9_-]+$ ]] || mourir 9 \
    "VIDEOS_SEGMENT ne doit contenir que des lettres, des chiffres, « - » et « _ »."
  # netrc sépare ses champs par des espaces : un identifiant ou un mot de passe
  # qui en contient ne s'y écrit pas.
  [[ $VIDEOS_UTILISATEUR != *[[:space:]]* ]] || mourir 9 \
    "VIDEOS_UTILISATEUR ne doit pas contenir d'espace."
  [[ $VIDEOS_MOT_DE_PASSE != *[[:space:]]* ]] || mourir 9 \
    "VIDEOS_MOT_DE_PASSE ne doit pas contenir d'espace."
}

# ── La tuyauterie distante ──────────────────────────────────────────────────

# Met une chaîne entre apostrophes pour le shell distant. Toute apostrophe
# interne est fermée, échappée, rouverte : la forme qui marche partout.
citer() {
  local s=${1//\'/\'\\\'\'}
  printf "'%s'" "$s"
}

# LE seul chemin vers le serveur. `ssh hostinger "ligne de commande"`, ou le
# faux du banc d'essai. Le découpage en mots de la variable est voulu.
distant() {
  # shellcheck disable=SC2086
  $VIDEOS_DISTANT_CMD "$1"
}

# LA seule copie. rsync, ou le faux du banc. Découpage en mots voulu aussi.
copier() {
  # shellcheck disable=SC2086
  $VIDEOS_COPIE_CMD "$@"
}

creer_le_dossier_distant() {
  distant "mkdir -p -- $(citer "$VIDEOS_DOSSIER_DISTANT")" \
    || mourir 12 "Impossible de créer ou d'atteindre $VIDEOS_DOSSIER_DISTANT sur le serveur."
}

# Espace libre du système de fichiers qui porte le dossier, en octets.
espace_libre_octets() {
  local sortie
  sortie=$(distant "df -Pk -- $(citer "$VIDEOS_DOSSIER_DISTANT")") \
    || mourir 12 "Impossible de mesurer l'espace libre sur le serveur."
  printf '%s' "$sortie" | awk 'NR == 2 { printf "%.0f", $4 * 1024 }'
}

# Relevé RÉEL du dossier distant : taille, date, nom, séparés par des
# tabulations, les enregistrements séparés par un octet nul — le seul octet
# qu'un nom de fichier ne peut pas contenir.
relever_dossier_distant() {
  local sortie=$1
  distant "find $(citer "$VIDEOS_DOSSIER_DISTANT") -maxdepth 1 -type f -printf '%s\t%T@\t%f\0'" \
    > "$sortie" \
    || mourir 12 "Impossible de relever le contenu de $VIDEOS_DOSSIER_DISTANT."
}

# CHOIX ASSUMÉ — comment la page est refabriquée à partir du serveur.
#
# La page doit dire ce que le dossier DISTANT contient, pas ce que la station
# croit y avoir mis. Deux voies étaient possibles : apprendre à videos-page.sh
# à lire un relevé, ou donner à videos-page.sh un vrai dossier qui ressemble
# exactement au distant. C'est la seconde qui est retenue : videos-page.sh
# garde une seule entrée (un dossier), celle qui s'essaie à la main, et le
# chemin de code qui fabrique la page en production est EXACTEMENT celui que
# le banc d'essai exerce.
#
# Le miroir ne coûte rien : `truncate` fabrique des fichiers CREUX, qui ont la
# bonne taille pour `stat` et occupent zéro octet sur le disque. Miroir de
# 40 Go de vidéos = 0 octet écrit.
construire_miroir() {
  local releve=$1 miroir=$2
  local ligne taille reste horodatage nom
  rm -rf -- "$miroir"
  mkdir -p -- "$miroir"
  while IFS= read -r -d '' ligne; do
    taille=${ligne%%$'\t'*}
    reste=${ligne#*$'\t'}
    horodatage=${reste%%$'\t'*}
    nom=${reste#*$'\t'}
    horodatage=${horodatage%%.*}          # find rend 1758…@.1234567890
    [[ $nom == */* || -z $nom ]] && continue
    [[ $taille =~ ^[0-9]+$ ]] || continue
    # index.html est la PAGE, pas un contenu : le dossier distant la contient
    # dès le deuxième dépôt. Sans ce filtre elle serait comptée comme une
    # vidéo et contrôlée deux fois (défaut vu au banc le 2026-09-16).
    [[ $nom == index.html ]] && continue
    : > "$miroir/$nom"
    truncate -s "$taille" -- "$miroir/$nom"
    touch -d "@$horodatage" -- "$miroir/$nom"
  done < "$releve"
}

# Refabrique la page depuis le relevé distant et l'envoie. Rend le nombre de
# vidéos et leur poids total par les variables NB_VIDEOS et POIDS_VIDEOS.
refaire_et_envoyer_la_page() {
  local travail=$1
  local releve="$travail/releve" miroir="$travail/miroir" page="$travail/index.html"

  relever_dossier_distant "$releve"
  construire_miroir "$releve" "$miroir"

  "$ICI/videos-page.sh" "$miroir" > "$page" \
    || mourir 13 "La fabrication de la page a échoué."

  copier "$page" "$DESTINATION_COPIE" \
    || mourir 13 "L'envoi de index.html vers $DESTINATION_COPIE a échoué."

  # Ce que la page liste vraiment — même filtre que videos-page.sh, pour que
  # le contrôle porte exactement sur les lignes de la page, ni plus ni moins.
  NB_VIDEOS=0
  POIDS_VIDEOS=0
  VIDEOS_PRESENTES=()
  local nom
  while IFS= read -r -d '' nom; do
    est_une_video "$nom" || continue
    VIDEOS_PRESENTES+=("$nom")
    NB_VIDEOS=$(( NB_VIDEOS + 1 ))
    POIDS_VIDEOS=$(( POIDS_VIDEOS + $(stat -c %s -- "$miroir/$nom") ))
  done < <(cd "$miroir" && find . -maxdepth 1 -type f -printf '%f\0' | sort -z -f)
}

# SELinux : sous /var/www un fichier neuf hérite du contexte de son dossier,
# mais on ne le suppose pas — on le repose. /usr/sbin n'est pas dans le chemin
# d'un shell ssh non interactif, d'où le PATH forcé.
#
# CETTE FONCTION NE TUE PLUS LE SCRIPT (corrigé le 2026-09-16, faute attrapée
# par l'épreuve indépendante sur onze cas). Elle appelait `mourir 14` — et elle
# est appelée AVANT le contrôle HTTP. Résultat : dès que restorecon refusait,
# le script sortait en 14 en affirmant « les fichiers SONT déposés et la page
# est à jour : rien n'est perdu » alors que PAS UN SEUL contrôle n'avait eu
# lieu. La page était publiée sans vérification et l'opérateur lisait un
# message rassurant : la forme silencieuse de la faute, la pire.
# Elle rend donc maintenant un état ; le contrôle a toujours lieu ; c'est
# l'appelant qui conclut, une fois qu'il sait ce que le contrôle a établi.
#
#   0  contexte reposé
#   1  restorecon est là mais il a refusé (ou le serveur n'a pas répondu)
#   2  pas de restorecon sur la machine : aucun outillage SELinux, donc rien à
#      réétiqueter. Ce n'est PAS une erreur — et ce n'est pas un contournement :
#      le serveur réel est un Rocky Linux en Enforcing, qui l'a. Distinguer les
#      deux situations évite de crier à la panne sur une machine qui n'a
#      simplement pas de SELinux (un banc d'essai, une Debian).
reposer_le_contexte() {
  local reponse
  # Un seul aller-retour : on demande au serveur s'il a l'outil et, s'il l'a,
  # on le lance dans la foulée. Le mot rendu distingue les trois issues — un
  # simple code de sortie confondrait « absent » et « serveur injoignable ».
  reponse=$(distant "PATH=\$PATH:/usr/sbin:/sbin; \
if command -v restorecon > /dev/null 2>&1; \
then restorecon -R $(citer "$VIDEOS_DOSSIER_DISTANT") && echo CONTEXTE-REPOSE; \
else echo PAS-DE-RESTORECON; fi") || return 1
  case $reponse in
    *CONTEXTE-REPOSE*)   return 0 ;;
    *PAS-DE-RESTORECON*) return 2 ;;
    *)                   return 1 ;;
  esac
}

# Ce que l'appelant dit à l'écran juste après, sans rien conclure encore.
dire_le_contexte() {
  case $1 in
    0) dire "  étiquettes SELinux reposées." ;;
    2) dire "  pas de restorecon sur ce serveur : aucune étiquette SELinux à reposer." ;;
    *) dire "  restorecon a refusé — le contrôle a lieu quand même, et la fin en rend compte." ;;
  esac
}

# ── Le contrôle par HTTP ────────────────────────────────────────────────────

# L'hôte nu, tel que netrc l'attend : ni schéma, ni port, ni chemin.
hote_nu() {
  local h=${VIDEOS_HOTE_WEB#*://}
  h=${h%%/*}
  h=${h%%:*}
  printf '%s' "$h"
}

# Le mot de passe ne passe JAMAIS en ligne de commande (leçon du chantier 98 :
# la ligne de commande est lisible par tout le monde dans la liste des
# processus). Il est écrit dans un fichier netrc à 600, détruit à la sortie.
preparer_netrc() {
  NETRC=$1
  ( umask 077; : > "$NETRC" )
  printf 'machine %s\nlogin %s\npassword %s\n' \
    "$(hote_nu)" "$VIDEOS_UTILISATEUR" "$VIDEOS_MOT_DE_PASSE" > "$NETRC"
}

adresse_privee() {           # sans nom de fichier : la page elle-même
  printf '%s/videos-%s/' "$VIDEOS_HOTE_WEB" "$VIDEOS_SEGMENT"
}

adresse_du_fichier() {
  printf '%s/videos-%s/%s' "$VIDEOS_HOTE_WEB" "$VIDEOS_SEGMENT" "$(encoder_url "$1")"
}

# Rend le code HTTP, ou 000 si rien n'a répondu. Jamais d'échec du script ici :
# c'est l'appelant qui décide si le code obtenu est le bon.
code_http() {
  local code
  code=$(curl --silent --show-error --head --max-time "$VIDEOS_DELAI_HTTP" \
              --output /dev/null --write-out '%{http_code}' "$@" 2>/dev/null) || true
  printf '%s' "${code:-000}"
}

code_sans_mot_de_passe() { code_http "$1"; }
code_avec_mot_de_passe() { code_http --netrc-file "$NETRC" "$1"; }

# Une requête de plage : c'est ce que fait un navigateur qui reprend un
# téléchargement interrompu. 206 = la reprise marche.
code_plage() {
  local code
  code=$(curl --silent --show-error --max-time "$VIDEOS_DELAI_HTTP" \
              --netrc-file "$NETRC" --range 0-0 \
              --output /dev/null --write-out '%{http_code}' "$1" 2>/dev/null) || true
  printf '%s' "${code:-000}"
}
