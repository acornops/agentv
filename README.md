<p align="center">
  <img width="220" src="https://raw.githubusercontent.com/acornops/docs-website/main/logo/light.svg" alt="AcornOps" />
</p>

<h1 align="center">AcornOps AgentV</h1>

<p align="center">
  <a href="https://github.com/acornops/agentv/actions/workflows/ci.yml"><img src="https://github.com/acornops/agentv/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://codecov.io/gh/acornops/agentv"><img src="https://codecov.io/gh/acornops/agentv/branch/main/graph/badge.svg" alt="Coverage" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-22-green.svg" alt="Node 22" /></a>
  <a href="docs/contracts/README.md"><img src="https://img.shields.io/badge/contracts-checked-blue.svg" alt="Contracts checked" /></a>
</p>

<p align="center">
  Outbound-only Linux/systemd AgentV for host snapshots, read-only diagnostics, and JSON-RPC tool execution.
</p>

## Status

This repository owns the AgentV code, systemd packaging assets, production image, AgentV protocol contract, and agent-level docs. Central platform deployment wiring belongs in `acornops-deployment`.

## Agent-Assisted Development

This repository supports human and agent-assisted development. Start coding
agents from this repository root for AgentV-only work, and from the AcornOps
workspace cloned from the [`acornops`](https://github.com/acornops/acornops)
repository for changes that touch multiple AcornOps repositories.

## Contracts

Cross-repo contract documentation lives in [`docs/contracts/README.md`](docs/contracts/README.md). This repo's direct platform dependency is the control-plane outbound agent bridge documented there.
Machine-readable contract data lives in [`docs/contracts/manifest.json`](docs/contracts/manifest.json).
Run `npm run contracts:check` to mechanically verify the documented AgentV/control-plane contract shape.

Coverage is generated in CI with Vitest V8 coverage, uploaded as a workflow
artifact, and published to Codecov when `CODECOV_TOKEN` is configured for the
repository. Run `npm run test:coverage` locally to produce text, HTML, and lcov
reports under `coverage/`.

## Documentation

Primary docs:

- [`AGENTS.md`](AGENTS.md)
- [`ARCHITECTURE.md`](ARCHITECTURE.md)
- [`docs/index.md`](docs/index.md)
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- Whole-system architecture: [`../docs/system-architecture.md`](../docs/system-architecture.md)

## Features

- **Outbound-only**: Initiates a secure WebSocket connection to the control plane.
- **Host snapshots**: Collects bounded Linux/systemd telemetry for host, metrics, services, processes, listeners, logs, and findings.
- **MCP bridge**: Serves JSON-RPC `tools/list` and `tools/call` requests from the platform.
- **Read-only by default**: Built-in tools only inspect host state; they do not execute shell commands or mutate files, packages, processes, or services.
- **Adapter-ready**: OS family, service manager, collector mode, and log sources are explicit so future non-Linux support can be added behind adapters.

## Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript
- **Core Libraries**: `ws`, Vitest with V8 coverage, TypeScript
- **Packaging**: Docker image and Linux systemd unit assets

## Configuration

The agent is configured with environment variables:

| Variable | Description | Default |
| --- | --- | --- |
| `ACORNOPS_AGENT_PLATFORM_URL` | Control-plane HTTPS base URL. The agent appends `/api/v1/agent/connect`. | Required |
| `ACORNOPS_AGENT_ADDITIONAL_CA_BUNDLE_FILE` | Optional readable PEM bundle added to normal public CA trust for the control-plane WebSocket. | Empty |
| `ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT` | Allows `http://` only for local development. Do not set in production. | `false` |
| `ACORNOPS_TARGET_ID` | Control-plane VM target id this agent key is bound to. | Required |
| `ACORNOPS_AGENT_KEY` | Agent authentication token. | Required |
| `ACORNOPS_AGENT_TARGET_TYPE` | Target type advertised during handshake. | `virtual_machine` |
| `ACORNOPS_AGENT_SNAPSHOT_INTERVAL_MS` | Snapshot cadence after handshake acknowledgement. | `30000` |
| `ACORNOPS_AGENT_MAX_SNAPSHOT_BYTES` | Maximum serialized snapshot payload size. | `1048576` |
| `ACORNOPS_AGENT_LOG_LEVEL` | Logging level (`debug`, `info`, `warn`, `error`). | `info` |
| `ACORNOPS_VM_OS_FAMILY` | VM operating system family. V1 supports `linux`. | `linux` |
| `ACORNOPS_VM_SERVICE_MANAGER` | VM service manager. V1 supports `systemd`. | `systemd` |
| `ACORNOPS_VM_ALLOWED_LOG_SOURCES` | Comma-separated log sources the live collector may read. | `journald,syslog` |
| `ACORNOPS_VM_COLLECTOR_MODE` | Collector mode: `live` for Linux/systemd hosts, `mock` for local and CI development. | `live` |

## Local Development

Install dependencies:

```bash
npm install
```

Run validation:

```bash
npm run validate
```

Run the agent against a local control plane with mock host data:

```bash
ACORNOPS_AGENT_PLATFORM_URL=http://127.0.0.1:8081 \
ACORNOPS_AGENT_ALLOW_INSECURE_TRANSPORT=true \
ACORNOPS_TARGET_ID=your-vm-target-id \
ACORNOPS_AGENT_KEY=your-agent-key \
ACORNOPS_AGENT_TARGET_TYPE=virtual_machine \
ACORNOPS_VM_COLLECTOR_MODE=mock \
npm run dev
```

Use `ACORNOPS_VM_COLLECTOR_MODE=mock` for local Docker and CI. Use `live` on a Linux host with systemd and journald available.

## Systemd Install Assets

Systemd packaging assets live in [`packaging/systemd`](packaging/systemd):

- `acornops-agentv.service`: service unit for Linux VMs.
- `agentv.env.example`: environment file template.
- `install.sh` and `uninstall.sh`: install helpers for the service assets.

Runtime configuration belongs in `/etc/acornops/agentv.env`. Keep that file owned by `root:acornops-agent` with mode `0640` because it contains the agent key.

## Validation

Canonical validation:

```bash
npm run validate
```

Focused checks:

```bash
npm run typecheck
npm run test
npm run test:coverage
npm run contracts:check
npm run harness:check
npm run build
```
