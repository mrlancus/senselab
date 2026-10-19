export interface Env {
  DB: D1Database;
  RECORDINGS: R2Bucket;
  ASSETS: Fetcher;
  APP_VERSION: string;
}

export interface Variables {
  /** Who is making the request. Today an anonymous device ID; later a real user ID. */
  ownerId: string;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
