#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root to uninstall the systemd unit." >&2
  exit 1
fi

systemctl disable --now acornops-vm-agent 2>/dev/null || true
rm -f /etc/systemd/system/acornops-vm-agent.service
systemctl daemon-reload
echo "Removed acornops-vm-agent.service. /etc/acornops/vm-agent.env was preserved."
