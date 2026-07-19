#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root to install AgentV." >&2
  exit 1
fi
if [[ ! -x /usr/bin/node ]]; then
  echo "AgentV requires Node.js 22 or newer at /usr/bin/node." >&2
  exit 1
fi
node_major="$(/usr/bin/node -p "Number(process.versions.node.split('.')[0])")"
if [[ "${node_major}" -lt 22 ]]; then
  echo "AgentV requires Node.js 22 or newer at /usr/bin/node; found $(/usr/bin/node --version)." >&2
  exit 1
fi

archive_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
version="$(/usr/bin/node -p "require('${archive_root}/runtime/package.json').version")"
release_root="/opt/acornops/agentv/releases/${version}"

if ! getent group acornops-agent >/dev/null; then
  groupadd --system acornops-agent
fi
if ! id -u acornops-agent >/dev/null 2>&1; then
  useradd --system --gid acornops-agent --home /var/lib/acornops-agentv --shell /usr/sbin/nologin acornops-agent
else
  usermod -a -G acornops-agent acornops-agent
fi
if getent group systemd-journal >/dev/null; then
  usermod -a -G systemd-journal acornops-agent
fi
install -d -o acornops-agent -g acornops-agent -m 0750 /var/lib/acornops-agentv
install -d -o root -g root -m 0700 /var/lib/acornops-agentv/actions
install -d -o root -g root -m 0755 /opt/acornops/agentv/releases
install -d -o root -g root -m 0750 /etc/acornops
if [[ -e "${release_root}" ]]; then
  echo "AgentV ${version} is already installed; release directories are immutable." >&2
  exit 1
fi
install_stage="$(mktemp -d "/opt/acornops/agentv/releases/.install-${version}.XXXXXX")"
cleanup_stage() { rm -rf -- "${install_stage}"; }
trap cleanup_stage EXIT
cp -a "${archive_root}/runtime/." "${install_stage}/"
chown -R root:root "${install_stage}"
mv "${install_stage}" "${release_root}"
trap - EXIT

if [[ ! -f /etc/acornops/agentv.env ]]; then
  install -o root -g acornops-agent -m 0640 "${archive_root}/packaging/systemd/agentv.env.example" /etc/acornops/agentv.env
fi
if [[ ! -f /etc/acornops/agentv-actions.json ]]; then
  install -o root -g root -m 0600 "${archive_root}/packaging/systemd/agentv-actions.json.example" /etc/acornops/agentv-actions.json
fi

install -o root -g root -m 0644 "${archive_root}/packaging/systemd/acornops-agentv.service" /etc/systemd/system/acornops-agentv.service
install -o root -g root -m 0644 "${archive_root}/packaging/systemd/acornops-agentv-actions.service" /etc/systemd/system/acornops-agentv-actions.service
install -o root -g root -m 0644 "${archive_root}/packaging/systemd/acornops-agentv-actions.socket" /etc/systemd/system/acornops-agentv-actions.socket
install -o root -g root -m 0755 "${archive_root}/packaging/systemd/acornops-agentv-doctor" /usr/local/bin/acornops-agentv-doctor

temporary_link="/opt/acornops/agentv/.current-${version}-$$"
ln -s "${release_root}" "${temporary_link}"
mv -Tf "${temporary_link}" /opt/acornops/agentv/current
systemctl daemon-reload
systemctl enable acornops-agentv.service
echo "Installed AgentV ${version}. Edit /etc/acornops/agentv.env, run acornops-agentv-doctor, then start acornops-agentv."
echo "The privileged action socket remains disabled until explicitly enabled."
