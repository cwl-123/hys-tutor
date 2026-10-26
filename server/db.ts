import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

// 控制面数据库：账号 / 会话 / 邀请码 / 配额 / 用量 / 反馈。
// 课程内容仍在 data/users/<uid>/ 的 JSON 里，这里只放需要事务和跨用户查询的小数据。
function resolveDbPath(): string {
  if (process.env.HYS_DB_PATH) return process.env.HYS_DB_PATH
  const dataDir = process.env.HYS_DATA_DIR
    ? path.resolve(process.env.HYS_DATA_DIR)
    : path.resolve(process.cwd(), 'data')
  return path.join(dataDir, 'control.db')
}

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id                   TEXT PRIMARY KEY,
        nickname             TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email                TEXT UNIQUE COLLATE NOCASE,
        password_hash        TEXT NOT NULL,
        role                 TEXT NOT NULL DEFAULT 'user',
        status               TEXT NOT NULL DEFAULT 'active',
        must_change_password INTEGER NOT NULL DEFAULT 0,
        created_at           TEXT NOT NULL,
        last_login_at        TEXT,
        terms_accepted_at    TEXT
      );

      CREATE TABLE sessions (
        token_hash   TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   TEXT NOT NULL,
        expires_at   TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        ip           TEXT,
        user_agent   TEXT
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);
      CREATE INDEX idx_sessions_exp  ON sessions(expires_at);

      CREATE TABLE invites (
        code_hash  TEXT PRIMARY KEY,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        max_uses   INTEGER NOT NULL DEFAULT 1,
        used_count INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        note       TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE usage_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL,
        model       TEXT,
        tokens_in   INTEGER NOT NULL DEFAULT 0,
        tokens_out  INTEGER NOT NULL DEFAULT 0,
        cost_micros INTEGER NOT NULL DEFAULT 0,
        estimated   INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL DEFAULT 'ok',
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_usage_user_time ON usage_events(user_id, created_at);
      CREATE INDEX idx_usage_time      ON usage_events(created_at);

      CREATE TABLE quota_overrides (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        json    TEXT NOT NULL
      );

      CREATE TABLE feedback (
        id         TEXT PRIMARY KEY,
        user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
        kind       TEXT NOT NULL,
        page       TEXT,
        target_id  TEXT,
        body       TEXT NOT NULL,
        contact    TEXT,
        status     TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL
      );

      CREATE TABLE events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    TEXT,
        name       TEXT NOT NULL,
        props      TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_events_name_time ON events(name, created_at);
    `,
  },
]

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db
  const file = resolveDbPath()
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
  const opened = new DatabaseSync(file)
  opened.exec('PRAGMA journal_mode = WAL;')
  opened.exec('PRAGMA foreign_keys = ON;')
  opened.exec('PRAGMA busy_timeout = 5000;')
  migrate(opened)
  // 本地开发/单测没有登录流程，补一个 local 用户，避免 usage_events 外键失败
  if (process.env.NODE_ENV !== 'production') {
    const now = new Date().toISOString()
    opened
      .prepare(
        `INSERT OR IGNORE INTO users
           (id, nickname, password_hash, role, status, created_at, terms_accepted_at)
         VALUES ('local', '本地用户', '!', 'admin', 'active', ?, ?)`,
      )
      .run(now, now)
  }
  db = opened
  return opened
}

function migrate(opened: DatabaseSync): void {
  const row = opened.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  let current = Number(row?.user_version ?? 0)
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    opened.exec('BEGIN')
    try {
      opened.exec(m.sql)
      opened.exec(`PRAGMA user_version = ${m.version}`)
      opened.exec('COMMIT')
      current = m.version
    } catch (err) {
      opened.exec('ROLLBACK')
      throw err
    }
  }
}

// 仅测试用：关闭并重置单例，便于多个临时库互不影响
export function closeDbForTests(): void {
  db?.close()
  db = null
}

export function dbFilePath(): string {
  return resolveDbPath()
}
