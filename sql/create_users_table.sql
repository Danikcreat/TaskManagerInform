-- Таблица пользователей с требуемыми полями и ограничениями.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  birth_date TEXT CHECK (
    birth_date IS NULL OR birth_date GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'
  ),
  group_number TEXT,
  login TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  position TEXT,
  role TEXT NOT NULL CHECK (
    role IN ('super_admin', 'admin', 'content_manager', 'executor')
  ),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Автообновление updated_at при изменении записи.
CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
  UPDATE users
  SET updated_at = datetime('now')
  WHERE id = OLD.id;
END;
