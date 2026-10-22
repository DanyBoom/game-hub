import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['AWS access key', /\bAKIA[A-Z0-9]{16}\b/],
  [
    'personal Windows profile path',
    /[A-Z]:[\\/]Users[\\/](?!Public\b|Default\b|FixtureUser\b)[\w.-]+[\\/]/i,
  ],
  [
    'email address',
    /\b[A-Z0-9._%+-]+@(?!users\.noreply\.github\.com\b|example\.(?:com|org)\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  ],
];
let failed = false;
for (const file of files) {
  if (
    /(?:^|\/)(?:servers|backups|userdata|\.env)(?:\/|$)|\.(?:db|sqlite|pfx|pem|exe|jar|log)$/i.test(
      file,
    )
  ) {
    console.error('Forbidden publish file:', file);
    failed = true;
    continue;
  }
  const value = readFileSync(file, 'utf8');
  for (const [name, re] of rules)
    if (!(file === 'package-lock.json' && name === 'email address') && re.test(value)) {
      console.error(`${file}: ${name}`);
      failed = true;
    }
}
if (failed) process.exit(1);
console.log(
  `Privacy checks passed for ${files.length} files. Heuristic scan; manual review is still required.`,
);
