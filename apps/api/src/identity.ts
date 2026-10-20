import { createMiddleware } from 'hono/factory';
import { DEVICE_ID_HEADER, DEVICE_ID_PATTERN } from '@senselab/shared';
import type { AppEnv } from './env';

/**
 * Resolves the request owner. This is the auth seam: replace the header check with session
 * or token verification and every route keeps working off `c.get('ownerId')`.
 */
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  const deviceId = c.req.header(DEVICE_ID_HEADER);
  if (!deviceId || !DEVICE_ID_PATTERN.test(deviceId)) {
    return c.json({ error: `Missing or invalid ${DEVICE_ID_HEADER} header` }, 401);
  }
  c.set('ownerId', deviceId.toLowerCase());
  await next();
});
