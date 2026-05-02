import type { Request } from "express";

/**
 * Typed accessor for an Express route parameter.
 *
 * `@types/express` widens `req.params[k]` to `string | string[]` (the array
 * arm exists for query-string-style array params). For an Express route
 * segment like `/foo/:id`, the runtime value is always a single string —
 * never an array — so this helper narrows the type and throws on the
 * unreachable array case so a misuse fails loud rather than silently
 * stringifying `["a","b"]` to `"a,b"`.
 *
 * Use at every site that previously did `req.params.id`, `req.params.projectId`
 * etc. and was flowing into a `string`-typed sink (drizzle `eq()`, storage
 * methods, etc.).
 */
export function paramId(req: Request, key: string = "id"): string {
  const v = req.params[key];
  if (typeof v !== "string") {
    throw new Error(`Expected string route param "${key}", got ${typeof v}`);
  }
  return v;
}
