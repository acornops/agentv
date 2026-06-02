#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root to install the systemd unit." >&2
  exit 1
fi

useradd --system --home /var/lib/acornops-vm-agent --shell /usr/sbin/nologin acornops-agent 2>/dev/null || true
install -d -o acornops-agent -g acornops-agent -m 0750 /var/lib/acornops-vm-agent
install -d -o root -g root -m 0755 /opt/acornops/vm-agent
install -d -o root -g root -m 0750 /etc/acornops

if [[ ! -f /etc/acornops/vm-agent.env ]]; then
  install -o root -g acornops-agent -m 0640 packaging/systemd/vm-agent.env.example /etc/acornops/vm-agent.env
  echo "Edit /etc/acornops/vm-agent.env with the target id and agent key before starting."
fi

install -o root -g root -m 0644 packaging/systemd/acornops-vm-agent.service /etc/systemd/system/acornops-vm-agent.service
systemctl daemon-reload
echo "Installed acornops-vm-agent.service. Start with: systemctl enable --now acornops-vm-agent"
