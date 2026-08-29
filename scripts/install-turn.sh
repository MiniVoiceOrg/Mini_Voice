#!/usr/bin/env bash
#
# Installs the coturn TURN server used by the Monky relay (#425).
#
# Why a script instead of a bundled binary: coturn publishes no official
# binaries, only source and Docker images. Installing from the distribution's
# repository means the operator gets a build their vendor stands behind, plus
# security updates through the usual channel. That is also why this is
# Linux-only -- no coturn package exists for Windows or macOS.
#
# Usage: sudo bash scripts/install-turn.sh

set -euo pipefail

RED=$'\e[31m'
GREEN=$'\e[32m'
YELLOW=$'\e[33m'
DIM=$'\e[2m'
RESET=$'\e[0m'

fail() {
  echo "${RED}ERRO:${RESET} $1" >&2
  exit 1
}

if [[ "$(uname -s)" != "Linux" ]]; then
  fail "Este script só funciona em Linux. Não existe pacote do coturn para Windows ou macOS."
fi

if [[ "${EUID}" -ne 0 ]]; then
  fail "Rode como root: sudo bash scripts/install-turn.sh"
fi

if command -v turnserver >/dev/null 2>&1; then
  echo "${GREEN}coturn já está instalado${RESET} ($(command -v turnserver))"
else
  echo "Instalando o coturn..."

  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y coturn
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y coturn
  elif command -v yum >/dev/null 2>&1; then
    yum install -y coturn
  elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm coturn
  elif command -v zypper >/dev/null 2>&1; then
    zypper install -y coturn
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache coturn
  else
    fail "Nenhum gerenciador de pacotes conhecido encontrado. Instale o coturn manualmente."
  fi

  command -v turnserver >/dev/null 2>&1 || fail "A instalação terminou, mas 'turnserver' não foi encontrado no PATH."
  echo "${GREEN}coturn instalado com sucesso.${RESET}"
fi

# The Monky server spawns and configures its own coturn process, so the
# distribution's system service must stay out of the way: two instances would
# fight over port 3478 and the one that lost would die on boot.
if command -v systemctl >/dev/null 2>&1; then
  if systemctl list-unit-files 2>/dev/null | grep -q '^coturn\.service'; then
    echo "Desabilitando o serviço de sistema do coturn (quem gerencia o processo é o Monky)..."
    systemctl stop coturn >/dev/null 2>&1 || true
    systemctl disable coturn >/dev/null 2>&1 || true
  fi
fi

# Debian/Ubuntu ship this flag file; while it says no, the service refuses to
# start. It is irrelevant to us (we never use the service), but leaving a
# confusing file behind is worse than fixing it.
if [[ -f /etc/default/coturn ]]; then
  sed -i 's/^#*TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=0/' /etc/default/coturn || true
fi

cat <<EOF

${GREEN}Pronto.${RESET}

Próximos passos:

  1. Habilite o relay no servidor:
       ${DIM}monky config set turn true${RESET}

  2. Reinicie o servidor para aplicar:
       ${DIM}monky restart${RESET}

  3. Libere as portas no firewall do host ${YELLOW}e também no painel do seu provedor${RESET}
     (VPS costuma ter um firewall externo, separado do iptables):

       ${DIM}3478/tcp e 3478/udp${RESET}   sinalização do TURN
       ${DIM}49152-65535/udp${RESET}       faixa de relay da mídia

     Exemplo com ufw:
       ${DIM}ufw allow 3478/tcp && ufw allow 3478/udp && ufw allow 49152:65535/udp${RESET}

O relay só é usado quando dois membros não conseguem se conectar diretamente,
então ele não muda nada para quem já conectava bem.
EOF
