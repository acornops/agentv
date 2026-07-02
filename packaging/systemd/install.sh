#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root to install the systemd unit." >&2
  exit 1
fi

useradd --system --home /var/lib/acornops-agentv --shell /usr/sbin/nologin acornops-agent 2>/dev/null || true
install -d -o acornops-agent -g acornops-agent -m 0750 /var/lib/acornops-agentv
install -d -o root -g root -m 0755 /opt/acornops/agentv
install -d -o root -g root -m 0750 /etc/acornops

if [[ ! -f /etc/acornops/agentv.env ]]; then
  install -o root -g acornops-agent -m 0640 packaging/systemd/agentv.env.example /etc/acornops/agentv.env
  echo "Edit /etc/acornops/agentv.env with the target id and agent key before starting."
fi

install -o root -g root -m 0644 packaging/systemd/acornops-agentv.service /etc/systemd/system/acornops-agentv.service
systemctl daemon-reload
echo "Installed acornops-agentv.service. Start with: systemctl enable --now acornops-agentv"
