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
