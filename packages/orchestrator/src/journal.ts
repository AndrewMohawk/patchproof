import { DatabaseSync } from 'node:sqlite';
import type { ProductRun } from '../../contracts/src/product.ts';
import { ContractError } from '../../contracts/src/index.ts';

export class RunJournal {
  readonly #db: DatabaseSync;
  constructor(filename: string, readOnly = false) {
    this.#db = new DatabaseSync(filename, { readOnly });
    if (readOnly) return;
    this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.#db.exec('CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL, document TEXT NOT NULL, evidence_digest TEXT)');
  }
  findRequest(key: string): { id: string; fingerprint: string } | null {
    const row = this.#db.prepare('SELECT id,fingerprint FROM runs WHERE request_key=?').get(key);
    return row ? { id: String(row.id), fingerprint: String(row.fingerprint) } : null;
  }
  insert(key: string, fingerprint: string, run: ProductRun) {
    this.#db.prepare('INSERT INTO runs(id,request_key,fingerprint,document) VALUES(?,?,?,?)').run(run.id, key, fingerprint, JSON.stringify(run));
  }
  save(run: ProductRun, evidenceDigest?: string | null) {
    this.#db.prepare('UPDATE runs SET document=?,evidence_digest=CASE WHEN ? THEN ? ELSE evidence_digest END WHERE id=?')
      .run(JSON.stringify(run), evidenceDigest !== undefined ? 1 : 0, evidenceDigest ?? null, run.id);
  }
  get(id: string): ProductRun {
    const row = this.#db.prepare('SELECT document FROM runs WHERE id=?').get(id);
    if (!row) throw new ContractError('not_found', 'Run not found.', 404);
    return JSON.parse(String(row.document)) as ProductRun;
  }
  evidenceDigest(id: string): string | null {
    return (this.#db.prepare('SELECT evidence_digest FROM runs WHERE id=?').get(id)?.evidence_digest as string) ?? null;
  }
  list(): ProductRun[] {
    return this.#db.prepare('SELECT document FROM runs ORDER BY rowid DESC LIMIT 1000').all().map(row => JSON.parse(String(row.document)) as ProductRun);
  }
  close() { this.#db.close(); }
}
