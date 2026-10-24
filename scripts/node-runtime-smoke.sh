#!/usr/bin/env bash
set -euo pipefail

[[ "$(id -u)" == 0 && "${CI:-}" == true && "${AGENTV_NODE_SMOKE_ALLOW:-}" == true ]] || {
  echo 'Run only as root in an explicitly enabled disposable Linux test environment.' >&2
  exit 1
}
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail() { echo "Node runtime regression failed: $*" >&2; exit 1; }
[[ -f "${repo_root}/packaging/systemd/acornops-agentv-node" ]] || fail 'trusted runtime selector is missing'
work="$(mktemp -d /opt/agentv-node-smoke.XXXXXX)"
trap 'rm -rf -- "${work}"' EXIT
chmod 0755 "${work}"
mkdir -p "${work}/system" "${work}/local" "${work}/state" "${work}/unsafe" "${work}/bin"
real_node="$(command -v node)"
cp "${real_node}" "${work}/local/node"
chmod 0755 "${work}/local/node"
sed -e "s|/usr/bin/node|${work}/system/node|g" \
  -e "s|/usr/local/bin/node|${work}/local/node|g" \
  -e "s|/opt/acornops/agentv/node-path|${work}/state/node-path|g" \
  "${repo_root}/packaging/systemd/acornops-agentv-node" > "${work}/launcher"
chmod 0755 "${work}/launcher"
# shellcheck source=/dev/null
source "${work}/launcher"

expect_failure() {
  if "$@" > "${work}/output" 2>&1; then fail "unexpectedly accepted: $*"; fi
}
expect_path() {
  local expected="$1"; shift
  local actual
  actual="$("$@")" || fail "could not resolve runtime: $*"
  [[ "${actual}" == "${expected}" ]] || fail "expected ${expected}, got ${actual}"
}

# The reported layout: unsupported OS Node with a supported local installation.
printf '#!/bin/sh\necho v20.0.0\n' > "${work}/system/node"
chmod 0755 "${work}/system/node"
expect_path "${work}/local/node" agentv_node_select
# Discovery must not consult PATH; tools used in validation must also be fixed.
printf '#!/bin/sh\ntouch %s/pwned\n' "${work}" > "${work}/bin/node"
cp "${work}/bin/node" "${work}/bin/stat"
chmod 0755 "${work}/bin/"*
# shellcheck disable=SC2016
expect_path "${work}/local/node" env PATH="${work}/bin:${PATH}" /bin/bash -c 'source "$1"; agentv_node_select' _ "${work}/launcher"
[[ ! -e "${work}/pwned" ]] || fail 'executed a PATH-injected command'

# A valid system Node takes precedence only before a selection is persisted.
cp "${work}/local/node" "${work}/system/node"
expect_path "${work}/system/node" agentv_node_select
agentv_node_save "${work}/local/node"
[[ "$(stat -c '%u:%g:%a' "${work}/state/node-path")" == 0:0:644 ]] || fail 'unsafe selection state mode'
expect_path "${work}/local/node" agentv_node_select
expect_path "${work}/local/node" agentv_node_current
[[ "$(NODE_OPTIONS=--require=/missing-agentv-preload NODE_PATH=/missing-agentv-modules \
  "${work}/launcher" -p 'process.execPath')" == "${work}/local/node" ]] || fail 'launcher did not exec the selected Node with sanitized environment'
runuser -u nobody -- "${work}/launcher" -p 'process.execPath' > "${work}/output"
[[ "$(<"${work}/output")" == "${work}/local/node" ]] || fail 'service identity cannot read runtime selection'

# Never silently rediscover when the selected runtime becomes invalid.
chmod 0775 "${work}/local/node"
expect_failure agentv_node_current
expect_failure agentv_node_select
chmod 0755 "${work}/local/node"
chmod 0666 "${work}/state/node-path"
expect_failure agentv_node_current
chmod 0644 "${work}/state/node-path"
printf '%s\n%s\n' "${work}/local/node" "${work}/system/node" > "${work}/state/node-path"
expect_failure agentv_node_current
rm "${work}/state/node-path"
expect_path "${work}/system/node" agentv_node_current

# Validation must precede execution, including every symlink traversal.
cp "${work}/bin/node" "${work}/unsafe/node"
chmod 0755 "${work}/unsafe/node"
chmod 0777 "${work}/unsafe"
expect_failure agentv_node_validate "${work}/unsafe/node"
[[ ! -e "${work}/pwned" ]] || fail 'executed Node from a writable parent'
chmod 0755 "${work}/unsafe"
chown 65534 "${work}/unsafe/node"
expect_failure agentv_node_validate "${work}/unsafe/node"
[[ ! -e "${work}/pwned" ]] || fail 'executed non-root-owned Node'
chown 0 "${work}/unsafe/node"
chmod 0777 "${work}/unsafe/node"
expect_failure agentv_node_validate "${work}/unsafe/node"
[[ ! -e "${work}/pwned" ]] || fail 'executed writable Node'
rm "${work}/unsafe/node"
ln -s ../local/node "${work}/unsafe/node"
expect_path "${work}/local/node" agentv_node_validate "${work}/unsafe/node"
chown -h 65534 "${work}/unsafe/node"
expect_failure agentv_node_validate "${work}/unsafe/node"
chown -h 0 "${work}/unsafe/node"
ln -s "${work}/unsafe/node" "${work}/indirect"
chmod 0777 "${work}/unsafe"
expect_failure agentv_node_validate "${work}/indirect"
chmod 0755 "${work}/unsafe"
rm "${work}/unsafe/node"
ln -s missing "${work}/unsafe/node"
expect_failure agentv_node_validate "${work}/unsafe/node"
rm "${work}/unsafe/node"
ln -s ../indirect "${work}/unsafe/node"
expect_failure agentv_node_validate "${work}/indirect"

rm "${work}/local/node"
expect_path "${work}/system/node" agentv_node_select
printf '#!/bin/sh\necho v20.0.0\n' > "${work}/system/node"
expect_failure agentv_node_select
[[ "$(<"${work}/output")" == *'22'* ]] || fail 'missing minimum-version diagnostic'
expect_failure agentv_node_current
echo 'Node runtime selection, trust boundary, pinning, and launch regressions passed.'
