const SECRET_KEY = /(?:pass(?:word)?|secret|token|api[_-]?key|access[_-]?key|account[_-]?key|client[_-]?secret|private[_-]?key|authorization|credential|cookie|connection[_-]?string|shared[_-]?access[_-]?signature|signature|sig|sas)/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const CLOUD_KEY = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
const GCP_API_KEY = /\bAIza[0-9A-Za-z_-]{35}\b/g;
const COMMON_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g;
const URL_VALUE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>'"]+/gi;
const CONNECTION_CREDENTIALS = /\b((?:jdbc:)?(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:)([^\s@/]+)(@)/gi;
const QUOTED_ASSIGNMENT = /(["'])((?:[A-Za-z_][A-Za-z0-9_.-]*?)?(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|account[_-]?key|client[_-]?secret|shared[_-]?access[_-]?signature|signature))\1\s*:\s*(["'])(.*?)\3/gi;
const ASSIGNMENT = /\b((?:[A-Za-z_][A-Za-z0-9_.-]*?)?(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|account[_-]?key|client[_-]?secret|shared[_-]?access[_-]?signature|signature))\s*[:=]\s*([^\s,;}]+)/gi;
const SHELL_FLAG = /(--?(?:password|passwd|secret|token|api-key|access-key))(?:=|\s+)('[^']*'|"[^"]*"|\S+)/gi;

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) url.username = '<redacted>';
    if (url.password) url.password = '<redacted>';
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEY.test(key)) url.searchParams.set(key, '<redacted>');
    }
    return url.toString();
  } catch {
    return value;
  }
}

/** Redact common secret forms from one string without returning the matched value. */
export function redactString(input: string): string {
  const maybeUrl = /^\w+:\/\//.test(input) ? redactUrl(input) : input;
  return maybeUrl
    .replace(PRIVATE_KEY, '<redacted-private-key>')
    .replace(BEARER, 'Bearer <redacted>')
    .replace(JWT, '<redacted-jwt>')
    .replace(CLOUD_KEY, '<redacted-cloud-key>')
    .replace(GCP_API_KEY, '<redacted-cloud-key>')
    .replace(COMMON_TOKEN, '<redacted-token>')
    .replace(URL_VALUE, (value) => redactUrl(value))
    .replace(CONNECTION_CREDENTIALS, '$1<redacted>$3')
    .replace(QUOTED_ASSIGNMENT, '$1$2$1:$3<redacted>$3')
    .replace(ASSIGNMENT, '$1=<redacted>')
    .replace(SHELL_FLAG, '$1=<redacted>');
}

/** Recursively redact sensitive keys and secret-shaped strings. */
export function redactValue(value: unknown, key = '', seen = new WeakSet<object>()): unknown {
  if (SECRET_KEY.test(key)) return '<redacted>';
  if (typeof value === 'string') return redactString(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '<circular>';
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, '', seen));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([childKey, child]) => [childKey, redactValue(child, childKey, seen)]));
}
