import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/env';

type Value = string | number | null;

/** Just enough of D1's API, backed by in-memory SQLite, for route tests. */
class FakeStatement {
  private params: Value[] = [];
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...params: Value[]) {
    this.params = params;
    return this;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[], success: true };
  }
  async first<T>() {
    const row = this.db.prepare(this.sql).get(...this.params);
    return (row ?? null) as T | null;
  }
  async run() {
    const res = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(res.changes) } };
  }
}

export function fakeD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = join(import.meta.dirname, '..', 'migrations');
  for (const file of readdirSync(dir).sort()) db.exec(readFileSync(join(dir, file), 'utf8'));
  return { prepare: (sql: string) => new FakeStatement(db, sql) } as unknown as D1Database;
}

export function fakeR2() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const bucket = {
    async put(key: string, body: ReadableStream | ArrayBuffer, opts?: R2PutOptions) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      const meta = opts?.httpMetadata as R2HTTPMetadata | undefined;
      objects.set(key, { bytes, contentType: meta?.contentType });
      return {};
    },
    async get(key: string) {
      const o = objects.get(key);
      return o ? { body: new Response(o.bytes).body, size: o.bytes.length } : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}

export function testEnv() {
  const r2 = fakeR2();
  const env: Env = {
    DB: fakeD1(),
    RECORDINGS: r2.bucket,
    ASSETS: {} as Fetcher,
    APP_VERSION: 'test',
  };
  return { env, objects: r2.objects };
}
