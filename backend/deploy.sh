#!/bin/bash
# ============================================================================
#  Marlowe Vineyard — déploiement sans Docker (Node + systemd)
# ----------------------------------------------------------------------------
#  Depuis le dossier backend/ du dépôt, sur le serveur :
#
#     ./deploy.sh --first    premier déploiement : dépendances, service systemd,
#                            démarrage, vérification
#     ./deploy.sh update     mise à jour : dépendances, redémarrage, vérification
#                            (après un « git pull » ou une modification du .env)
#     ./deploy.sh local      lancement local, sans service (npm start)
#
#  Le port et l'adresse viennent de .env (PORT, SITE_URL) ; le script ne
#  suppose rien d'autre. Le montage Docker a son propre chemin :
#  deploy/docker-compose.yml, voir README.md §4.
# ============================================================================
set -euo pipefail

APP_NAME="marlowe-api"
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
DEPLOY_USER="$(whoami)"

VERT='\033[0;32m'; JAUNE='\033[1;33m'; ROUGE='\033[0;31m'; CYAN='\033[0;36m'; FIN='\033[0m'
ok()   { echo -e "${VERT}✔${FIN}  $1"; }
info() { echo -e "${CYAN}▸${FIN}  $1"; }
warn() { echo -e "${JAUNE}⚠${FIN}  $1"; }
die()  { echo -e "${ROUGE}✘${FIN}  $1"; exit 1; }

# ----------------------------------------------------------------------------
#  Vérifications préalables
# ----------------------------------------------------------------------------
verifier_prerequis() {
  command -v node >/dev/null 2>&1 || die "node n'est pas installé (version 20 ou plus)."
  command -v npm  >/dev/null 2>&1 || die "npm n'est pas installé."
  local majeure
  majeure="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "$majeure" -ge 20 ]] || die "Node $(node -v) trouvé : il faut la version 20 ou plus (API Web Crypto)."
  [[ -f "${BACKEND_DIR}/.env" ]] || die ".env introuvable dans ${BACKEND_DIR} — copiez .env.example et remplissez-le (README.md §3)."
}

lire_env() {
  # Une valeur de .env, sans exécuter le fichier.
  grep -m1 "^$1=" "${BACKEND_DIR}/.env" | cut -d= -f2- | tr -d '\r' || true
}

PORT="$(lire_env PORT)"; PORT="${PORT:-8787}"
SITE_URL="$(lire_env SITE_URL)"

a_systemd() { command -v systemctl >/dev/null 2>&1; }

# ----------------------------------------------------------------------------
#  Dépendances
# ----------------------------------------------------------------------------
installer() {
  info "Installation des dépendances (production)…"
  (cd "${BACKEND_DIR}" && npm install --omit=dev --no-audit --no-fund)
  ok "Dépendances installées."
}

# ----------------------------------------------------------------------------
#  Vérification après démarrage : le service tourne ET l'API répond
# ----------------------------------------------------------------------------
verifier_api() {
  local tentative reponse
  for tentative in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    reponse="$(curl -s "http://127.0.0.1:${PORT}/api/version" 2>/dev/null || true)"
    if [[ "$reponse" == *'"version"'* ]]; then
      ok "L'API répond sur 127.0.0.1:${PORT} — $(echo "$reponse" | grep -o '"version":"[^"]*"')"
      return 0
    fi
  done
  die "L'API ne répond pas sur 127.0.0.1:${PORT} après 10 s. Journal : journalctl -u ${APP_NAME} -n 50"
}

# ----------------------------------------------------------------------------
#  Premier déploiement
# ----------------------------------------------------------------------------
premier() {
  echo; echo -e "${CYAN}══ Marlowe Vineyard — premier déploiement ══${FIN}"; echo
  verifier_prerequis
  a_systemd || die "systemd est indisponible ici. Utilisez « ${0##*/} local », ou pm2 (README.md §4)."

  if systemctl is-active --quiet "${APP_NAME}" 2>/dev/null; then
    warn "Le service ${APP_NAME} tourne déjà. Utilisez « ${0##*/} update »."
    exit 0
  fi
  [[ -n "$SITE_URL" ]] || warn "SITE_URL est vide dans .env : la connexion Discord ne marchera pas tant qu'elle ne l'est pas."

  installer

  local NODE_BIN; NODE_BIN="$(command -v node)"
  info "Création du service systemd (${SERVICE_FILE})…"
  sudo tee "${SERVICE_FILE}" > /dev/null << EOF
[Unit]
Description=Marlowe Vineyard API (site + API)
After=network.target mariadb.service mysql.service

[Service]
Type=simple
User=${DEPLOY_USER}
WorkingDirectory=${BACKEND_DIR}
EnvironmentFile=${BACKEND_DIR}/.env
Environment=NODE_ENV=production
ExecStart=${NODE_BIN} src/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${APP_NAME}

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable "${APP_NAME}" >/dev/null
  sudo systemctl start "${APP_NAME}"
  verifier_api

  echo
  echo -e "  Port       : ${CYAN}${PORT}${FIN} (127.0.0.1 seulement — mettez votre reverse proxy devant)"
  echo -e "  Adresse    : ${CYAN}${SITE_URL:-«  à remplir dans .env »}${FIN}"
  echo -e "  Dossier    : ${CYAN}${BACKEND_DIR}${FIN}"
  echo -e "  État       : ${CYAN}systemctl status ${APP_NAME}${FIN}"
  echo -e "  Journal    : ${CYAN}journalctl -u ${APP_NAME} -f${FIN}"
  echo
  echo "  Reste à faire : l'entrée du reverse proxy vers 127.0.0.1:${PORT}, et le"
  echo "  Redirect OAuth2 chez Discord : ${SITE_URL:-https://<adresse du site>}/api/callback"
  echo
}

# ----------------------------------------------------------------------------
#  Mise à jour
# ----------------------------------------------------------------------------
mise_a_jour() {
  echo; echo -e "${CYAN}══ Marlowe Vineyard — mise à jour ══${FIN}"; echo
  verifier_prerequis
  a_systemd || die "systemd est indisponible ici. Utilisez « ${0##*/} local », ou pm2 (README.md §4)."
  systemctl is-enabled --quiet "${APP_NAME}" 2>/dev/null \
    || die "Le service ${APP_NAME} n'existe pas encore. Lancez d'abord : ${0##*/} --first"

  installer
  info "Redémarrage du service…"
  sudo systemctl restart "${APP_NAME}"
  verifier_api
  echo
  sudo systemctl status "${APP_NAME}" --no-pager -l | head -5
}

# ----------------------------------------------------------------------------
#  Local
# ----------------------------------------------------------------------------
local_() {
  echo; echo -e "${CYAN}══ Marlowe Vineyard — lancement local sur le port ${PORT} ══${FIN}"; echo
  verifier_prerequis
  installer
  (cd "${BACKEND_DIR}" && npm start)
}

usage() {
  echo "Usage : ${0##*/} --first   premier déploiement (dépendances, service systemd, démarrage, vérification)"
  echo "        ${0##*/} update    mise à jour (dépendances, redémarrage, vérification)"
  echo "        ${0##*/} local     lancement local sans service"
  exit 1
}

case "${1:-}" in
  --first)   premier ;;
  update|--update) mise_a_jour ;;
  local)     local_ ;;
  "")        if a_systemd && systemctl is-enabled --quiet "${APP_NAME}" 2>/dev/null; then mise_a_jour; else usage; fi ;;
  -h|--help) usage ;;
  *)         die "Argument inconnu : $1 — ${0##*/} --help" ;;
esac
