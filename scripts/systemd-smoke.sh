#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run the AgentV systemd smoke as root." >&2
  exit 1
fi
if [[ "${CI:-}" != "true" || "${AGENTV_SYSTEMD_SMOKE_ALLOW:-}" != "true" ]]; then
  echo "Refusing to mutate systemd outside an explicitly enabled ephemeral CI runner." >&2
  exit 1
fi
if [[ ! -d /run/systemd/system ]]; then
  echo "A live systemd host is required." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(/usr/bin/node -p "require('${repo_root}/package.json').version")"
work="$(mktemp -d)"
marker="${work}/authenticated"
server_pid=""
action_smoke=""

cleanup() {
  systemctl disable --now acornops-agentv-smoke-worker.service >/dev/null 2>&1 || true
  systemctl stop acornops-agentv.service acornops-agentv-actions.service acornops-agentv-actions.socket >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/acornops-agentv-smoke-worker.service
  systemctl daemon-reload >/dev/null 2>&1 || true
  if [[ -n "${server_pid}" ]]; then kill "${server_pid}" >/dev/null 2>&1 || true; fi
  if [[ -n "${action_smoke}" ]]; then rm -f -- "${action_smoke}"; fi
  rm -rf -- "${work}"
}
trap cleanup EXIT

/usr/bin/node "${repo_root}/scripts/systemd-smoke-server.mjs" "${marker}" &
server_pid="$!"

tar -xzf "${repo_root}/release/agentv-${version}.tar.gz" -C "${work}"
archive_root="${work}/agentv-${version}"
bash "${archive_root}/packaging/systemd/install.sh"

env_file="${work}/agentv.env"
printf '%s\n' \
  'ACORNOPS_AGENT_PLATFORM_URL=http://127.0.0.1:18081' \
  'ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT=true' \
  'ACORNOPS_TARGET_ID=agentv-systemd-smoke' \
  'ACORNOPS_AGENT_KEY=systemd-smoke-key' \
  'ACORNOPS_AGENT_TARGET_TYPE=virtual_machine' \
  'ACORNOPS_AGENT_SNAPSHOT_INTERVAL_MS=10000' \
  'ACORNOPS_AGENT_MAX_SNAPSHOT_BYTES=65536' \
  'ACORNOPS_AGENT_LOG_LEVEL=error' \
  'ACORNOPS_VM_OS_FAMILY=linux' \
  'ACORNOPS_VM_SERVICE_MANAGER=systemd' \
  'ACORNOPS_VM_ALLOWED_LOG_UNITS=acornops-agentv.service' \
  'ACORNOPS_VM_COLLECTOR_MODE=live' \
  'ACORNOPS_AGENT_WRITE_ENABLED=true' \
  'ACORNOPS_AGENT_ACTIONS_SOCKET=/run/acornops-agentv/actions.sock' > "${env_file}"
install -o root -g acornops-agent -m 0640 "${env_file}" /etc/acornops/agentv.env

policy_file="${work}/agentv-actions.json"
printf '%s\n' '{"schemaVersion":1,"restartServices":["acornops-agentv-smoke-worker.service"]}' > "${policy_file}"
install -o root -g root -m 0600 "${policy_file}" /etc/acornops/agentv-actions.json

unit_file="${work}/acornops-agentv-smoke-worker.service"
printf '%s\n' \
  '[Unit]' \
  'Description=Disposable AgentV restart smoke worker' \
  '[Service]' \
  'Type=simple' \
  'ExecStart=/usr/bin/sleep infinity' > "${unit_file}"
install -o root -g root -m 0644 "${unit_file}" /etc/systemd/system/acornops-agentv-smoke-worker.service

systemd-analyze verify \
  /etc/systemd/system/acornops-agentv.service \
  /etc/systemd/system/acornops-agentv-actions.socket \
  /etc/systemd/system/acornops-agentv-actions.service \
  /etc/systemd/system/acornops-agentv-smoke-worker.service
systemctl daemon-reload
systemctl enable --now acornops-agentv-smoke-worker.service acornops-agentv-actions.socket
systemctl start acornops-agentv.service

for _ in $(seq 1 100); do
  [[ -f "${marker}" ]] && break
  sleep 0.1
done
[[ -f "${marker}" ]] || { journalctl -u acornops-agentv.service --no-pager -n 100; exit 1; }
systemctl is-active --quiet acornops-agentv.service
[[ "$(systemctl show acornops-agentv.service --property=User --value)" == "acornops-agent" ]]
acornops-agentv-doctor
action_smoke="$(mktemp /tmp/acornops-agentv-action-smoke.XXXXXX.mjs)"
install -o acornops-agent -g acornops-agent -m 0400 "${repo_root}/scripts/systemd-action-smoke.mjs" "${action_smoke}"
/usr/sbin/runuser --user acornops-agent -- /usr/bin/node "${action_smoke}"

upgrade_root="${work}/agentv-${version}-smoke-upgrade"
cp -a "${archive_root}" "${upgrade_root}"
/usr/bin/node --input-type=module --eval \
  "import fs from 'node:fs'; const file=process.argv[1]; const value=JSON.parse(fs.readFileSync(file)); value.version += '-smoke-upgrade'; fs.writeFileSync(file, JSON.stringify(value, null, 2)+'\\n');" \
  "${upgrade_root}/runtime/package.json"
bash "${upgrade_root}/packaging/systemd/install.sh"
[[ "$(readlink /opt/acornops/agentv/current)" == "/opt/acornops/agentv/releases/${version}-smoke-upgrade" ]]
systemctl restart acornops-agentv.service
systemctl stop acornops-agentv-actions.service >/dev/null 2>&1 || true

rollback_link="/opt/acornops/agentv/.rollback-${version}-$$"
ln -s "/opt/acornops/agentv/releases/${version}" "${rollback_link}"
mv -Tf "${rollback_link}" /opt/acornops/agentv/current
systemctl restart acornops-agentv.service
systemctl stop acornops-agentv-actions.service >/dev/null 2>&1 || true
[[ "$(readlink /opt/acornops/agentv/current)" == "/opt/acornops/agentv/releases/${version}" ]]

bash "${archive_root}/packaging/systemd/uninstall.sh"
[[ ! -e /etc/systemd/system/acornops-agentv.service ]]
[[ ! -e /etc/systemd/system/acornops-agentv-actions.socket ]]
[[ -f /etc/acornops/agentv.env ]]
[[ -f /etc/acornops/agentv-actions.json ]]
[[ -d "/opt/acornops/agentv/releases/${version}" ]]
echo "AgentV live systemd install, restart, upgrade, rollback, and uninstall smoke passed."
