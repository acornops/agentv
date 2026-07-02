#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root to uninstall the systemd unit." >&2
  exit 1
fi

systemctl disable --now acornops-agentv 2>/dev/null || true
rm -f /etc/systemd/system/acornops-agentv.service
systemctl daemon-reload
echo "Removed acornops-agentv.service. /etc/acornops/agentv.env was preserved."
