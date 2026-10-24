#!/usr/bin/env bash
set -euo pipefail

[[ "$(id -u)" == 0 && "${CI:-}" == true && "${AGENTV_SYSTEMD_SMOKE_ALLOW:-}" == true ]] || {
  echo 'Refusing to replace Node paths outside an explicitly enabled disposable CI host.' >&2
  exit 1
}
selected_node="$(readlink -f "$(command -v node)")"
[[ "$("${selected_node}" -p 'Number(process.versions.node.split(".")[0])')" -ge 22 ]]
# Hosted runner images may leave /opt runner-writable. Match the trusted
# installation root of a normal Ubuntu host without relaxing production checks.
install -d -o root -g root -m 0755 /opt
install -d -o root -g root -m 0755 /usr/local/bin
if [[ "${selected_node}" != /usr/local/bin/node ]]; then
  install -o root -g root -m 0755 "${selected_node}" /usr/local/bin/node
fi
# Model the user's old OS Node without downloading an unsupported runtime.
# This only runs in disposable CI and never ships in the release archive.
old_node="$(mktemp)"
trap 'rm -f -- "${old_node}"' EXIT
# shellcheck disable=SC2016
printf '#!/bin/sh\nif [ "$1" = --version ]; then echo v20.0.0; else echo 20; fi\n' > "${old_node}"
rm -f /usr/bin/node
install -o root -g root -m 0755 "${old_node}" /usr/bin/node
echo "Mixed-runtime fixture ready: /usr/bin/node is unsupported; /usr/local/bin/node is $(/usr/local/bin/node --version)."
