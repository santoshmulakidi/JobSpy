import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const releaseDirectory = join(root, 'release');
mkdirSync(releaseDirectory, { recursive: true });

function run(command) {
  return execSync(command, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const evidence = {
  generatedAt: new Date().toISOString(),
  name: pkg.name,
  version: pkg.version,
  electron: pkg.devDependencies.electron,
};

try {
  const commit = run('git rev-parse HEAD').trim();
  if (commit) evidence.gitCommit = commit;
} catch {
  // Packaging evidence remains useful outside a git checkout (CI exports).
}

writeFileSync(join(releaseDirectory, 'sbom.cdx.json'), run('npm sbom --sbom-format=cyclonedx'));

let audit;
let auditStatus = 'clean';
try {
  audit = JSON.parse(run('npm audit --json'));
} catch (error) {
  // npm audit exits non-zero whenever vulnerabilities exist; the report is still valid.
  audit = JSON.parse(error.stdout);
  auditStatus = 'vulnerabilities-present';
}
evidence.auditStatus = auditStatus;
evidence.vulnerabilities = audit.metadata?.vulnerabilities ?? null;
writeFileSync(join(releaseDirectory, 'npm-audit.json'), JSON.stringify(audit, null, 2));

const packagedRoot = join(root, 'out');
if (existsSync(packagedRoot)) {
  const checksums = {};
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (!path.endsWith('.pdb')) {
        const content = readFileSync(path);
        checksums[join('out', path.slice(packagedRoot.length + 1))] =
          `sha256:${createHash('sha256').update(content).digest('hex')}`;
      }
    }
  };
  walk(packagedRoot);
  evidence.artifactChecksums = checksums;
}

writeFileSync(join(releaseDirectory, 'release-evidence.json'), JSON.stringify(evidence, null, 2));
console.log(`Release evidence written to ${join('release', 'release-evidence.json')}`);
