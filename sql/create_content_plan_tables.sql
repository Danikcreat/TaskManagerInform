-- Events catalog for the communications content plan.
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  date TEXT NOT NULL CHECK (
    date ~ '^\d{4}-(0[1-9]|1[0-2])-[0-3]\d$'
  ),
  time TEXT CHECK (
    time IS NULL OR time ~ '^([01]\d|2[0-3]):[0-5]\d$'
  ),
  location TEXT,
  type TEXT NOT NULL
);

-- Instagram content queue linked to optional events.
CREATE TABLE IF NOT EXISTS content_instagram (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  date TEXT NOT NULL CHECK (
    date ~ '^\d{4}-(0[1-9]|1[0-2])-[0-3]\d$'
  ),
  time TEXT CHECK (
    time IS NULL OR time ~ '^([01]\d|2[0-3]):(00|30)$'
  ),
  type TEXT,
  status TEXT,
  event_id INTEGER REFERENCES events (id) ON DELETE SET NULL
);

-- Telegram content queue linked to optional events.
CREATE TABLE IF NOT EXISTS content_telegram (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  date TEXT NOT NULL CHECK (
    date ~ '^\d{4}-(0[1-9]|1[0-2])-[0-3]\d$'
  ),
  time TEXT CHECK (
    time IS NULL OR time ~ '^([01]\d|2[0-3]):(00|30)$'
  ),
  type TEXT,
  status TEXT,
  event_id INTEGER REFERENCES events (id) ON DELETE SET NULL
);

-- Links between content posts (any channel) and tasks from the task tracker.
CREATE TABLE IF NOT EXISTS content_task_links (
  id SERIAL PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('instagram', 'telegram')),
  content_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, channel, content_id)
);

CREATE INDEX IF NOT EXISTS content_task_links_content_idx
  ON content_task_links (channel, content_id);

CREATE INDEX IF NOT EXISTS content_task_links_task_idx
  ON content_task_links (task_id);
