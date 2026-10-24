# Curl-compatible bootstrap implementation plan

Goal: make the AgentV bootstrap work with curl 7.68 without changing download
security, enrollment, runtime requirements, or host package management.

Design approved by the user on 2026-10-25: remove the optional
`--retry-all-errors` flag, retain `--retry 3` and all existing validation, prove
the fix with real older curl, publish a new release, and update the demo pin.
Feature detection and requiring a curl upgrade add no necessary behavior here.

Branch: `fix/agentv-curl-compatibility` in AgentV and demo-infra, using the
existing checkouts as previously requested. No API or data contract changes.

## Constraints and review focus

- Keep HTTPS-only transport/redirects, TLS validation, timeouts, and checksums.
- Check both archive and checksum downloads, including transient failures,
  missing assets, corrupt checksums, and unsafe archives.
- Curl compatibility is not Ubuntu 20.04 live-systemd qualification; only Ubuntu
  24.04 remains qualified. Node 22+ remains required.
- No demo teardown, user-VM mutation, token generation, or automatic agent update.
- Do not replace existing tags or release assets; deployment follows verified
  publication and retains all other image/chart pins.

## Task 1: Installer fix and release

Files: `scripts/install-agentv.sh`, `scripts/bootstrap-smoke.mjs`,
`scripts/curl-compat.Dockerfile`, `package.json`, `package-lock.json`,
`src/config.spec.ts`, `.github/workflows/{ci,release}.yml`, and
`docs/{DEVELOPMENT,OPERATIONS}.md`.

- [x] Run the existing bootstrap smoke under real curl 7.68 in a disposable
  Ubuntu 20.04 container; expect the checksum-path assertion to fail because
  curl rejects `--retry-all-errors` before downloading.
- [x] Extend the existing smoke with transient HTTP 503 retry checks for each
  download and missing-checksum rejection. Assert the bootstrap reaches checksum
  validation after retries; no installation or enrollment is performed.
- [x] Remove only the two unsupported flags. Run modern/legacy curl smoke;
  both must pass. Add the legacy-curl smoke to CI and the release gate.
- [x] Prepare unused version `0.0.1-experimental.9`; update operations and
  development docs with retry behavior and the tested compatibility boundary.
- [x] Run `npm run validate`, `npm run test:coverage:all`,
  `npm run smoke:package`, `npm run smoke:curl-compat`, `bash -n`,
  `shellcheck`, and `git diff --check`. Review the complete branch.
- [ ] Commit, fast-forward and push `main`, then publish the new immutable tag.
  Require hosted CI and release gates, installer/archive checksum verification,
  and release provenance before updating the demo.

## Task 2: Demo rollout

Files in demo-infra: `ansible/group_vars/demo/platform.yml`,
`ansible/roles/acornops_platform/defaults/main.yml`,
`docs/demo-vm-onboarding.md`, and its release evidence plan.

- [ ] Change only the installer pin to the verified release and update docs.
- [ ] Run `ANSIBLE_SYNTAX_REQUIRED=true task validate` and verify the rendered
  installer pin. Review and push `main`; its existing workflow deploys normally.
- [ ] Verify the deployment workflow, live ConfigMap and control-plane process
  version, workload readiness, preserved PVCs, and `task demo:verify`.
- [ ] Record exact commits, runs and outcomes; move plans to completed.

Rollback: revert the demo installer pin to `.8` and reconcile normally. Existing
agents and data are unchanged, but newly generated `.8` commands retain the
older-curl bug. No open design questions.

## Local validation

The original `.8` bootstrap failed under real Ubuntu 20.04 curl 7.68 with the
reported unsupported-option error before checksum validation. With only the
two flags removed, `npm run validate` passed (74 tests),
`npm run test:coverage:all` passed (78 tests), and both `npm run smoke:package`
and `npm run smoke:curl-compat` passed. `bash -n scripts/install-agentv.sh`,
`shellcheck scripts/install-agentv.sh` and `git diff --check` passed.

The unchanged Zod high advisory and staging power-cycle acceptance remain
tracked in `docs/exec-plans/tech-debt-tracker.md`; this experimental fix does not
waive production-promotion gates. Hosted release and demo evidence are pending.

Independent read-only review found no actionable issues in the AgentV or demo
diffs. The demo pin must not be pushed before verified publication. Local demo
validation and the real Ansible template assertion passed without host changes.
