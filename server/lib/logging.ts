export function structuredLog(entry: Record<string, any>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}

// Path segments that are bearer capabilities (tracking + unsubscribe tokens):
// anyone holding one can replay the hit or read where its links go, so they
// never reach the logs. Case-insensitive, like Express routing. Only the
// exact route shapes keep their structure; any other path under a capability
// prefix (a typo, a mangled link) is cut at the prefix, since a token can sit
// in any segment of it.
const CLICK_PATH_RE = /^(\/api\/public\/email\/c)\/[^/]+(\/\d+)$/i;
const PIXEL_PATH_RE = /^(\/api\/public\/email\/o)\/[^/]+$/i;
const UNSUBSCRIBE_PATH_RE = /^(\/api\/public\/unsubscribe)\/[^/]+$/i;
const CAPABILITY_PREFIX_RE = /^(\/api\/public\/(?:email|unsubscribe))(?=\/|$)/i;

export function redactPath(path: string): string {
  if (CLICK_PATH_RE.test(path)) return path.replace(CLICK_PATH_RE, "$1/:token$2");
  if (PIXEL_PATH_RE.test(path)) return path.replace(PIXEL_PATH_RE, "$1/:token");
  if (UNSUBSCRIBE_PATH_RE.test(path)) return path.replace(UNSUBSCRIBE_PATH_RE, "$1/:token");
  const prefix = CAPABILITY_PREFIX_RE.exec(path);
  if (prefix && path.length > prefix[0].length + 1) return `${prefix[1]}/:redacted`;
  return path;
}
