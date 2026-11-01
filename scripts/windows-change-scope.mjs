import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Skip only prose-only PRs; non-Markdown contract fixtures still require CI. */
export function needsWindowsValidation(files) {
  return !files?.length || files.some(file => !(/\.(md|mdx)$/i.test(file)
    || /(^|\/)(README|CHANGELOG|CONTRIBUTING|LICENSE)(\.txt)?$/.test(file)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let files = null;
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    try {
      // Compare the whole PR, not just its latest commit. Include deleted paths
      // when a source file is renamed to documentation. Missing parents run CI.
      files = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', 'HEAD^1', 'HEAD^2'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
    } catch { /* Unresolved comparison must not skip validation. */ }
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `run_native=${needsWindowsValidation(files)}\n`);
}
