import type { Context } from 'hono';
import type { z } from 'zod';

/** Parses a JSON body against a schema; returns the data or a 400 response. */
export async function parseJson<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: 'Body must be JSON' }, 400) };
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.join('.') || 'body';
    return { ok: false, response: c.json({ error: `${where}: ${issue?.message}` }, 400) };
  }
  return { ok: true, data: result.data };
}
