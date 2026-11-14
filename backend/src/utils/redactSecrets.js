// Removes credentials from free text and objects before they reach a log line or an error detail.
// Defence in depth: BridgeX never logs request/response bodies or headers to begin with; this covers
// the places where text from a library (SOAP faults, driver errors, URLs) could carry a secret.
const SENSITIVE_KEY = /pass(word|wd)?|pwd|secret|token|api[-_]?key|authorization|auth|credential|cookie|session|signature|private/i;
const MASK = '[REDACTED]';

const PATTERNS = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, `Bearer ${MASK}`],
  [/\bBasic\s+[A-Za-z0-9+/=]{6,}/gi, `Basic ${MASK}`],
  [/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '[REDACTED_JWT]'],
  [/\bbx_(?:live|test)_[a-f0-9]{16,}/gi, '[REDACTED_API_KEY]'],
  // user:password@host in any URL / connection string
  [/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]*:[^@\s/]+@/gi, `$1${MASK}@`],
  // key=value / key: value / "key":"value" for sensitive key names
  [/((?:pass(?:word|wd)?|pwd|secret|token|api[-_]?key|apikey|authorization|credential|client[-_]?secret|access[-_]?key)["']?\s*[=:]\s*["']?)[^\s"'&,;}<]+/gi, `$1${MASK}`],
  // WS-Security / XML elements carrying secrets
  [/(<(?:\w+:)?(?:Password|Secret|Token|BinarySecurityToken)[^>]*>)[^<]*(<\/)/gi, `$1${MASK}$2`],
];

function redactText(input) {
  let text = String(input === undefined || input === null ? '' : input);
  for (const [re, replacement] of PATTERNS) text = text.replace(re, replacement);
  return text;
}

function redactValue(value, depth = 0) {
  if (depth > 6) return MASK;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? MASK : redactValue(v, depth + 1);
    return out;
  }
  return value;
}

/** Headers: values of credential-bearing headers are always masked. */
function redactHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) out[k] = SENSITIVE_KEY.test(k) ? MASK : redactText(Array.isArray(v) ? v.join(', ') : v);
  return out;
}

module.exports = { redactText, redactValue, redactHeaders, MASK };
