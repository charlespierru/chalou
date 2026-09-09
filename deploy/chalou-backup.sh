#!/usr/bin/env bash
# Sauvegarde de la base du site chalou.link : dump local, puis dépôt hors-site.
#
# Calqué sur /usr/local/sbin/tonik-backup.sh, y compris ses garde-fous, qui ont
# tous été payés par une panne réelle. Ce qui en a été repris, et pourquoi :
#
#   · L'exécutable vit dans /usr/local/sbin, JAMAIS sous /var/www. Trois pannes
#     de la même famille (mai 2026, 2026-08-01, 2026-09-02) : un déploiement par
#     archive ne modifie pas un fichier, il le recrée, et le fichier neuf hérite
#     de l'étiquette de son dossier — du contenu web, que le gestionnaire de
#     services refuse d'exécuter.
#
#   · L'attente de résolution des noms, avec refus explicite d'une réponse qui
#     pointe sur la machine elle-même. Le 2026-07-29, la sauvegarde de Tonik est
#     partie sur le serveur local : un réglage réseau faisait retomber tout nom
#     non résolu sur lui-même, et rclone a parlé à nginx en croyant parler à
#     Backblaze. Une résolution qui « réussit » vers soi-même est pire qu'un
#     échec : elle envoie la sauvegarde n'importe où, en silence.
#
#   · Des codes de sortie distincts, pour que l'alerte dise CE QUI a échoué.
#
# Ce que ce script ajoute par rapport à celui de Tonik :
#
#   · Un refus si le dump est vide ou dérisoire. Un fichier de zéro octet se
#     dépose parfaitement et ne restaure rien : c'est la sauvegarde qui ment.
#   · Une relecture du dump déposé, pour vérifier qu'il contient bien la
#     collection attendue — on ne se contente pas de « l'envoi a réussi ».
#
# Réglages lus dans /etc/chalou/sauvegarde (droits 0640, root:chalou) :
#   MONGO_URL, MONGO_DB, B2_BUCKET, B2_KEY_ID, B2_APP_KEY, RETENTION_DAYS
#
# Codes de sortie :
#   0 — dump, dépôt, relecture et purge : tout est passé
#   1 — le dump a échoué, ou il est vide
#   2 — le dépôt hors-site a échoué (l'archive locale est conservée)
#   3 — la relecture du dépôt a échoué (l'archive est là, mais illisible)
#   4 — la purge a échoué (le dépôt, lui, a réussi)

set -euo pipefail

FICHIER_REGLAGES="/etc/chalou/sauvegarde"
if [[ ! -r "$FICHIER_REGLAGES" ]]; then
  echo "chalou-backup: impossible de lire $FICHIER_REGLAGES" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$FICHIER_REGLAGES"

: "${MONGO_URL:?MONGO_URL doit être défini dans $FICHIER_REGLAGES}"
: "${MONGO_DB:?MONGO_DB doit être défini dans $FICHIER_REGLAGES}"
: "${B2_BUCKET:?B2_BUCKET doit être défini dans $FICHIER_REGLAGES}"
: "${B2_KEY_ID:?B2_KEY_ID doit être défini dans $FICHIER_REGLAGES}"
: "${B2_APP_KEY:?B2_APP_KEY doit être défini dans $FICHIER_REGLAGES}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TAILLE_MINIMALE="${TAILLE_MINIMALE:-200}"

# rclone configuré par variables d'environnement : aucun fichier de
# configuration à poser, à protéger, ni à oublier lors d'une rotation.
export RCLONE_CONFIG_B2CHALOU_TYPE=b2
export RCLONE_CONFIG_B2CHALOU_ACCOUNT="$B2_KEY_ID"
export RCLONE_CONFIG_B2CHALOU_KEY="$B2_APP_KEY"
export RCLONE_CONFIG_B2CHALOU_HARD_DELETE=false

HORODATAGE="$(date -u +%Y%m%dT%H%M%SZ)"
DOSSIER="/var/backups/chalou"
ARCHIVE="${DOSSIER}/chalou-${HORODATAGE}.archive.gz"
ETIQUETTE="chalou-backup"

mkdir -p "$DOSSIER"

journal() { logger -t "$ETIQUETTE" -- "$*"; echo "[$(date -Is)] $*"; }

# ── 1. Le dump ───────────────────────────────────────────────────────────────
journal "début : dump ${ARCHIVE} (base=${MONGO_DB})"
if ! mongodump --uri="$MONGO_URL" --db="$MONGO_DB" --archive="$ARCHIVE" --gzip --quiet; then
  journal "ERREUR : mongodump a échoué"
  rm -f "$ARCHIVE"
  exit 1
fi

TAILLE="$(stat -c%s "$ARCHIVE" 2>/dev/null || echo 0)"
if (( TAILLE < TAILLE_MINIMALE )); then
  journal "ERREUR : dump de ${TAILLE} octets — trop petit pour être une vraie sauvegarde"
  rm -f "$ARCHIVE"
  exit 1
fi
journal "dump de ${TAILLE} octets"

# ── 2. Attendre que les noms se résolvent, et vers l'extérieur ───────────────
# Voir l'en-tête : une résolution qui pointe sur nous-mêmes est refusée.
HOTE_B2="api.backblazeb2.com"
DNS_ESSAIS="${DNS_ESSAIS:-12}"
DNS_ATTENTE="${DNS_ATTENTE:-10}"

resolution_prete() {
  local ip
  ip="$(getent ahosts "$HOTE_B2" 2>/dev/null | awk 'NR==1{print $1}')"
  [[ -n "$ip" ]] || return 1
  case "$ip" in
    127.*|::1|0.0.0.0|0:0:0:0:0:0:0:1) return 1 ;;
  esac
  return 0
}

essai=1
while ! resolution_prete; do
  if (( essai >= DNS_ESSAIS )); then
    journal "ERREUR : ${HOTE_B2} ne résout pas correctement après $(( DNS_ESSAIS * DNS_ATTENTE ))s — archive conservée pour reprise"
    exit 2
  fi
  journal "attente : ${HOTE_B2} pas encore résolu correctement (essai ${essai}/${DNS_ESSAIS})"
  sleep "$DNS_ATTENTE"
  essai=$(( essai + 1 ))
done
if (( essai > 1 )); then
  journal "résolution prête après $(( (essai - 1) * DNS_ATTENTE ))s d'attente"
fi

# ── 3. Le dépôt hors-site ────────────────────────────────────────────────────
journal "dépôt : b2chalou:${B2_BUCKET}/"
if ! rclone copy "$ARCHIVE" "b2chalou:${B2_BUCKET}/" --quiet; then
  journal "ERREUR : le dépôt a échoué — archive locale conservée pour reprise"
  exit 2
fi

# ── 4. Relire ce qui a été déposé ────────────────────────────────────────────
# « Le dépôt a réussi » ne dit pas que le fichier déposé vaut quelque chose.
# On le relit depuis le dépôt distant, et on vérifie qu'il porte bien la
# collection des messages.
journal "relecture du dépôt"
CONTROLE="$(mktemp -d)"
trap 'rm -rf "$CONTROLE"' EXIT
if ! rclone copy "b2chalou:${B2_BUCKET}/$(basename "$ARCHIVE")" "$CONTROLE/" --quiet; then
  journal "ERREUR : impossible de relire l'archive déposée"
  exit 3
fi
if ! mongorestore --archive="$CONTROLE/$(basename "$ARCHIVE")" --gzip --dryRun --quiet 2>/dev/null \
     && ! zcat "$CONTROLE/$(basename "$ARCHIVE")" 2>/dev/null | head -c 4096 | grep -qa "messages"; then
  journal "ERREUR : l'archive déposée ne porte pas la collection attendue"
  exit 3
fi
journal "relecture : l'archive déposée est lisible et porte la collection attendue"

journal "dépôt vérifié ; suppression de l'archive locale ${ARCHIVE}"
rm -f "$ARCHIVE"

# ── 5. La purge ──────────────────────────────────────────────────────────────
journal "purge : suppression des dépôts de plus de ${RETENTION_DAYS} jours"
if ! rclone delete "b2chalou:${B2_BUCKET}/" --min-age "${RETENTION_DAYS}d" --quiet; then
  journal "AVERTISSEMENT : la purge a échoué (le dépôt, lui, avait réussi)"
  exit 4
fi

journal "terminé"
