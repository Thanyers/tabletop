import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export interface StoredObject { key: string; sha256: string; bytes: number }
export interface PrivateObjectStore { put(data: Uint8Array): Promise<StoredObject>; get(key: string): Promise<Uint8Array>; remove(key: string): Promise<void> }
const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Local development private store. Never place this directory under the static root. */
export class LocalObjectStore implements PrivateObjectStore {
  constructor(private readonly directory: string) {}
  private location(key: string) { if (!keyPattern.test(key)) throw new Error('Invalid object key'); return path.join(path.resolve(this.directory), key) }
  async put(data: Uint8Array) { await fs.mkdir(this.directory, { recursive: true, mode: 0o700 }); const key = randomUUID(); await fs.writeFile(this.location(key), data, { flag: 'wx', mode: 0o600 }); return { key, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.byteLength } }
  async get(key: string) { return new Uint8Array(await fs.readFile(this.location(key))) }
  async remove(key: string) { await fs.rm(this.location(key), { force: true }) }
}
