/**
 * Secret scan of the files tracked by git (CI static job; `npm run check:secrets`).
 *
 * Fails on credential-shaped strings (private keys, cloud/API tokens, URLs with
 * embedded passwords) and on tracked files that must never be committed
 * (.env files, key material). Matches are reported by file, line and rule —
 * never by value. This is a pattern check, not a full secret-scanning
 * service: enable GitHub secret scanning / push protection as well
 * (docs/ci.md).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const RULES = [
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/ },
  { name: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Stripe live key', re: /\b[rs]k_live_[A-Za-z0-9]{16,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: 'Anthropic / OpenAI key', re: /\bsk-(?:ant-[A-Za-z0-9_-]{20,}|proj-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{48})\b/ },
  { name: 'JSON web token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  // scheme://user:password@host with a literal password (not ${VAR}, not a placeholder).
  { name: 'URL with embedded password', re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?|smtps?):\/\/[^:\s/'"`@]+:([^@\s'"`]+)@([^/\s'"`:]+)/, url: true },
];

// Throwaway credentials that are deliberately public: local development and the
// disposable CI/test databases (README, CI service containers, test setup).
const ALLOWED_URL_PASSWORDS = new Set(['casino', 'pass', 'password', 'secret', 'PASSWORD']);
const PLACEHOLDER = /^(?:\$\{[^}]+\}|\$[A-Z_]+|<[^>]+>|…|\.\.\.|\*+|x+|changeme|.{1,3})$/i;
// A fake credential in a test fixture is marked on its own line, so every exception is reviewed.
const FIXTURE_MARK = 'secret-scan: fixture';

const FORBIDDEN_FILES = [
  { name: '.env file', re: /(^|\/)\.env(\.(?!example$)[^/]+)?$/ },
  { name: 'key material', re: /\.(pem|key|p12|pfx|keystore|jks)$|(^|\/)id_(rsa|ecdsa|ed25519)$/ },
  { name: 'database dump', re: /\.(dump|sql\.gz|backup)(\.gpg)?$|(^|\/)backups\// },
];

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const findings = [];

for (const file of files) {
  for (const rule of FORBIDDEN_FILES) if (rule.re.test(file)) findings.push(`${file}: tracked ${rule.name}`);
  let size;
  try {
    size = statSync(file).size;
  } catch {
    continue; // deleted in the working tree
  }
  if (size > 2_000_000 || file === 'package-lock.json') continue;
  const text = readFileSync(file, 'utf8');
  if (text.includes('\0')) continue; // binary
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line.includes(FIXTURE_MARK) && file.startsWith('tests/')) return;
    for (const rule of RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      if (rule.url && (ALLOWED_URL_PASSWORDS.has(m[1]) || PLACEHOLDER.test(m[1]))) continue;
      findings.push(`${file}:${i + 1}: ${rule.name}`);
    }
  });
}

if (findings.length) {
  console.error(`secret scan: ${findings.length} finding(s) (values not shown)`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`secret scan: ${files.length} tracked files, no findings`);
