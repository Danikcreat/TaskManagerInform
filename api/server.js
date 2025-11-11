require("dotenv").config();
require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const { randomUUID } = require("crypto");
const { USER_ROLES } = require("./roles");

const USER_ROLE_VALUES_SQL = Object.values(USER_ROLES)
  .map((role) => `'${role}'`)
  .join(", ");

const DEFAULT_SUPER_ADMIN = {
  login: process.env.DEFAULT_SUPER_ADMIN_LOGIN,
  password: process.env.DEFAULT_SUPER_ADMIN_PASSWORD,
  firstName: process.env.DEFAULT_SUPER_ADMIN_FIRST_NAME || "Super",
  lastName: process.env.DEFAULT_SUPER_ADMIN_LAST_NAME || "Admin",
  middleName: process.env.DEFAULT_SUPER_ADMIN_MIDDLE_NAME || null,
  birthDate: process.env.DEFAULT_SUPER_ADMIN_BIRTH_DATE || null,
  groupNumber: process.env.DEFAULT_SUPER_ADMIN_GROUP_NUMBER || null,
  position: process.env.DEFAULT_SUPER_ADMIN_POSITION || "Super Administrator",
};

const PORT = process.env.PORT || 4000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL environment variable is required. Provide your Supabase connection string."
  );
}

const POOL_MAX_CONNECTIONS = Math.max(
  1,
  Number(process.env.DB_POOL_MAX || process.env.PG_POOL_MAX || 1)
);
const POOL_IDLE_TIMEOUT = Math.max(
  1000,
  Number(process.env.DB_POOL_IDLE_TIMEOUT || 5000)
);
const POOL_CONNECTION_TIMEOUT = Math.max(
  1000,
  Number(process.env.DB_POOL_CONNECTION_TIMEOUT || process.env.PG_CONNECTION_TIMEOUT || 5000)
);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: getSSLConfig(DATABASE_URL),
  max: POOL_MAX_CONNECTIONS,
  idleTimeoutMillis: POOL_IDLE_TIMEOUT,
  connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT,
  allowExitOnIdle: true,
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.get(
  "/api/tasks",
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query("SELECT payload FROM tasks ORDER BY updated_at DESC");
    const tasks = rows.map(rowToTask).filter(Boolean);
    res.json(tasks);
  })
);

app.get(
  "/api/tasks/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT payload FROM tasks WHERE id = $1 LIMIT 1", [
      req.params.id,
    ]);
    const task = rowToTask(rows[0]);
    if (!task) {
      res.status(404).json({ message: "Task not found" });
      return;
    }
    res.json(task);
  })
);

app.post(
  "/api/tasks",
  asyncHandler(async (req, res) => {
    const { value, error } = normalizeTaskPayload(req.body || {}, { partial: false });
    if (error) {
      res.status(400).json({ message: error });
      return;
    }

    const now = new Date().toISOString();
    const task = {
      ...value,
      id: value.id || createId(),
      attachments: value.attachments ?? [],
      subtasks: value.subtasks ?? [],
      createdAt: now,
      updatedAt: now,
    };

    try {
      await pool.query(
        "INSERT INTO tasks (id, payload, created_at, updated_at) VALUES ($1, $2, $3, $4)",
        [task.id, task, task.createdAt, task.updatedAt]
      );
    } catch (err) {
      if (String(err.message).includes("duplicate key value violates unique constraint")) {
        res.status(409).json({ message: "Task with the same id already exists" });
        return;
      }
      console.error("Failed to insert task", err);
      res.status(500).json({ message: "Failed to save task" });
      return;
    }

    res.status(201).json(task);
  })
);

app.put(
  "/api/tasks/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT payload FROM tasks WHERE id = $1 LIMIT 1", [
      req.params.id,
    ]);
    const existing = rowToTask(rows[0]);
    if (!existing) {
      res.status(404).json({ message: "Task not found" });
      return;
    }

    const { value, error } = normalizeTaskPayload(req.body || {}, { partial: true });
    if (error) {
      res.status(400).json({ message: error });
      return;
    }

    const updatedTask = {
      ...existing,
      ...value,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    };

    try {
      await pool.query("UPDATE tasks SET payload = $1, updated_at = $2 WHERE id = $3", [
        updatedTask,
        updatedTask.updatedAt,
        updatedTask.id,
      ]);
    } catch (err) {
      console.error("Failed to update task", err);
      res.status(500).json({ message: "Failed to update task" });
      return;
    }

    res.json(updatedTask);
  })
);

app.delete(
  "/api/tasks/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM tasks WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).json({ message: "Task not found" });
      return;
    }
    res.status(204).send();
  })
);

app.get(
  "/api/features",
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query("SELECT payload FROM features ORDER BY updated_at DESC");
    const features = rows.map(rowToFeature).filter(Boolean);
    res.json(features);
  })
);

app.get(
  "/api/features/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT payload FROM features WHERE id = $1 LIMIT 1", [
      req.params.id,
    ]);
    const feature = rowToFeature(rows[0]);
    if (!feature) {
      res.status(404).json({ message: "Feature not found" });
      return;
    }
    res.json(feature);
  })
);

app.post(
  "/api/features",
  asyncHandler(async (req, res) => {
    const { value, error } = normalizeFeaturePayload(req.body || {}, { partial: false });
    if (error) {
      res.status(400).json({ message: error });
      return;
    }

    const now = new Date().toISOString();
    const feature = {
      ...value,
      id: value.id || createId(),
      tags: Array.isArray(value.tags) ? value.tags : [],
      baseVotes: Number.isFinite(value.baseVotes) ? value.baseVotes : 0,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await pool.query(
        "INSERT INTO features (id, payload, created_at, updated_at) VALUES ($1, $2, $3, $4)",
        [feature.id, feature, feature.createdAt, feature.updatedAt]
      );
    } catch (err) {
      if (String(err.message).includes("duplicate key value violates unique constraint")) {
        res.status(409).json({ message: "Feature with the same id already exists" });
        return;
      }
      console.error("Failed to insert feature", err);
      res.status(500).json({ message: "Failed to save feature" });
      return;
    }

    res.status(201).json(feature);
  })
);

app.put(
  "/api/features/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT payload FROM features WHERE id = $1 LIMIT 1", [
      req.params.id,
    ]);
    const existing = rowToFeature(rows[0]);
    if (!existing) {
      res.status(404).json({ message: "Feature not found" });
      return;
    }

    const { value, error } = normalizeFeaturePayload(req.body || {}, { partial: true });
    if (error) {
      res.status(400).json({ message: error });
      return;
    }

    const updatedFeature = {
      ...existing,
      ...value,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    };

    try {
      await pool.query("UPDATE features SET payload = $1, updated_at = $2 WHERE id = $3", [
        updatedFeature,
        updatedFeature.updatedAt,
        updatedFeature.id,
      ]);
    } catch (err) {
      console.error("Failed to update feature", err);
      res.status(500).json({ message: "Failed to update feature" });
      return;
    }

    res.json(updatedFeature);
  })
);

app.delete(
  "/api/features/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM features WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) {
      res.status(404).json({ message: "Feature not found" });
      return;
    }
    res.status(204).send();
  })
);

const staticDir = path.join(__dirname, "..");
app.use(express.static(staticDir));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    next();
    return;
  }
  res.sendFile(path.join(staticDir, "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled server error", err);
  res.status(500).json({ message: "Unexpected server error" });
});
const serverReady = initializeDatabase().catch((err) => {
  console.error("Failed to initialize database", err);
  throw err;
});

if (require.main === module) {
  serverReady
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Server ready at http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error("Failed to start server", err);
      process.exit(1);
    });
} else {
  module.exports = async (req, res) => {
    await serverReady;
    return app(req, res);
  };
}

function rowToTask(row) {
  return parsePayload(row, "task");
}

function rowToFeature(row) {
  return parsePayload(row, "feature");
}

function parsePayload(row, label) {
  if (!row) return null;
  const rawPayload = row.payload;
  if (rawPayload === null || rawPayload === undefined) {
    return null;
  }
  if (typeof rawPayload === "object") {
    return rawPayload;
  }
  try {
    return JSON.parse(rawPayload);
  } catch (err) {
    console.error(`Failed to parse ${label} row`, err);
    return null;
  }
}

function normalizeTaskPayload(raw, { partial } = { partial: false }) {
  const requiredFields = ["title", "responsible", "deadline", "priority", "status"];
  const payload = {};

  if (!partial) {
    for (const field of requiredFields) {
      if (!raw?.[field] || !String(raw[field]).trim()) {
        return { error: `Field "${field}" is required` };
      }
    }
  }

  if (raw.title !== undefined) payload.title = String(raw.title).trim();
  if (raw.responsible !== undefined) payload.responsible = String(raw.responsible).trim();
  if (raw.description !== undefined) payload.description = String(raw.description || "").trim();
  if (raw.priority !== undefined) payload.priority = String(raw.priority);
  if (raw.status !== undefined) payload.status = String(raw.status);

  if (raw.deadline !== undefined) {
    const deadlineDate = new Date(raw.deadline);
    if (Number.isNaN(deadlineDate.getTime())) {
      return { error: 'Field "deadline" must be a valid date' };
    }
    payload.deadline = deadlineDate.toISOString();
  }

  if (raw.attachments !== undefined) {
    payload.attachments = normalizeCollection(raw.attachments, (item) => {
      if (!item?.url) {
        return null;
      }
      const normalizedLabel = item.label ? String(item.label).trim() : "";
      const normalizedUrl = String(item.url).trim();
      if (!normalizedUrl) return null;
      return {
        id: item.id || createId(),
        label: normalizedLabel || normalizedUrl,
        url: normalizedUrl,
      };
    });
  }

  if (raw.subtasks !== undefined) {
    payload.subtasks = normalizeCollection(raw.subtasks, (item) => {
      if (!item?.text) return null;
      return {
        id: item.id || createId(),
        text: String(item.text).trim(),
        done: Boolean(item.done),
      };
    });
  }

  if (raw.createdAt !== undefined) {
    const createdAtDate = new Date(raw.createdAt);
    if (!Number.isNaN(createdAtDate.getTime())) {
      payload.createdAt = createdAtDate.toISOString();
    }
  }

  if (partial && Object.keys(payload).length === 0) {
    return { error: "Nothing to update" };
  }

  return { value: payload };
}

function normalizeFeaturePayload(raw, { partial } = { partial: false }) {
  const requiredFields = ["title", "status"];
  const payload = {};

  if (!partial) {
    for (const field of requiredFields) {
      if (!raw?.[field] || !String(raw[field]).trim()) {
        return { error: `Field "${field}" is required` };
      }
    }
  }

  if (raw.title !== undefined) {
    const title = String(raw.title).trim();
    if (!title) return { error: 'Field "title" is required' };
    payload.title = title;
  }

  if (raw.description !== undefined) {
    payload.description = String(raw.description || "").trim();
  }

  if (raw.status !== undefined) {
    const status = String(raw.status).trim();
    if (!status) return { error: 'Field "status" is required' };
    payload.status = status;
  }

  if (raw.eta !== undefined) {
    payload.eta = String(raw.eta || "").trim();
  }

  if (raw.category !== undefined) {
    payload.category = String(raw.category || "").trim();
  }

  if (raw.tags !== undefined) {
    payload.tags = Array.isArray(raw.tags)
      ? raw.tags
          .map((tag) => String(tag ?? "").trim())
          .filter(Boolean)
      : [];
  }

  if (raw.baseVotes !== undefined) {
    const votes = Number(raw.baseVotes);
    if (Number.isNaN(votes)) {
      return { error: 'Field "baseVotes" must be a number' };
    }
    payload.baseVotes = Math.max(0, Math.round(votes));
  }

  if (raw.createdAt !== undefined) {
    const createdAtDate = new Date(raw.createdAt);
    if (!Number.isNaN(createdAtDate.getTime())) {
      payload.createdAt = createdAtDate.toISOString();
    }
  }

  if (partial && Object.keys(payload).length === 0) {
    return { error: "Nothing to update" };
  }

  return { value: payload };
}

function normalizeCollection(items, mapper) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      try {
        return mapper(item);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);

  await ensureUsersTable();
  await ensureDefaultSuperAdmin();
  await ensureSeedData();
}

async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      last_name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      birth_date TEXT,
      group_number TEXT,
      login TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      position TEXT,
      role TEXT NOT NULL CHECK (role IN (${USER_ROLE_VALUES_SQL}))
    )
  `);

  await pool.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_birth_date_check");

  await pool.query(`
    UPDATE users
    SET birth_date = to_char(to_date(birth_date, 'DD.MM.YYYY'), 'YYYY-MM-DD')
    WHERE birth_date ~ '^[0-9]{2}\\.[0-9]{2}\\.[0-9]{4}$'
  `);

  await pool.query(`
    UPDATE users
    SET birth_date = NULL
    WHERE birth_date IS NOT NULL
      AND birth_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  `);

  await pool.query(
    `
    ALTER TABLE users
    ADD CONSTRAINT users_birth_date_check
    CHECK (
      birth_date IS NULL OR birth_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    )
  `
  );
}

async function ensureDefaultSuperAdmin() {
  const { login, password } = DEFAULT_SUPER_ADMIN;
  if (!login || !password) {
    console.warn(
      "DEFAULT_SUPER_ADMIN_LOGIN and DEFAULT_SUPER_ADMIN_PASSWORD must be set to seed the default super admin."
    );
    return;
  }

  const existing = await pool.query("SELECT id FROM users WHERE login = $1 LIMIT 1", [login]);
  if (existing.rowCount > 0) {
    return;
  }

  const normalizedBirthDate = normalizeBirthDate(DEFAULT_SUPER_ADMIN.birthDate);

  await pool.query(
    `
    INSERT INTO users (
      last_name,
      first_name,
      middle_name,
      birth_date,
      group_number,
      login,
      password,
      position,
      role
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `,
    [
      DEFAULT_SUPER_ADMIN.lastName,
      DEFAULT_SUPER_ADMIN.firstName,
      DEFAULT_SUPER_ADMIN.middleName,
      normalizedBirthDate,
      DEFAULT_SUPER_ADMIN.groupNumber,
      login,
      password,
      DEFAULT_SUPER_ADMIN.position,
      USER_ROLES.SUPER_ADMIN,
    ]
  );

  console.info(`Default super admin created with login "${login}".`);
}

function normalizeBirthDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const dotFormat = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotFormat) {
    const [, day, month, year] = dotFormat;
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    const day = String(parsed.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  console.warn(`Invalid birth date format "${raw}", skipping value.`);
  return null;
}

async function ensureSeedData() {
  await seedTasks();
  await seedFeatures();
}

async function seedTasks() {
  const { rows } = await pool.query("SELECT COUNT(1)::int AS count FROM tasks");
  const count = Number(rows[0]?.count ?? 0);
  if (count > 0) return;

  const now = new Date();
  const tasks = [
    {
      id: createId(),
      title: "??????????? ?????? ?? ??????????? ?? ??????",
      description:
        "????? ??????? ???????? ??????????, ???????? ????? ? ??????????? ??????????? ??? ?????????? ???????.",
      responsible: "????? ???????",
      status: "in_progress",
      priority: "high",
      deadline: dateFromNow(now, 2, 14),
      attachments: [
        { id: createId(), label: "?????? ??????", url: "https://example.com/report-template" },
      ],
      subtasks: [
        { id: createId(), text: "??????? ????? ?? CRM", done: true },
        { id: createId(), text: "??????? ????/???? ? ??????? ?????", done: false },
      ],
    },
    {
      id: createId(),
      title: "??????????? ??????????? ??? ???????????? ????????",
      description: "???????? ???? ?? ??????? ? KPI, ???????? ??????????? ?? ?????????????.",
      responsible: "???? ???????",
      status: "pending",
      priority: "medium",
      deadline: dateFromNow(now, 5, 10),
      attachments: [],
      subtasks: [{ id: createId(), text: "??????? ?????? ?? ??????????", done: false }],
    },
  ].map((task) => ({
    ...task,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  const insertQuery =
    "INSERT INTO tasks (id, payload, created_at, updated_at) VALUES ($1, $2, $3, $4)";
  for (const task of tasks) {
    // Sequential inserts keep the logic simple for a tiny seed dataset.
    await pool.query(insertQuery, [task.id, task, task.createdAt, task.updatedAt]);
  }
}

async function seedFeatures() {
  const { rows } = await pool.query("SELECT COUNT(1)::int AS count FROM features");
  const count = Number(rows[0]?.count ?? 0);
  if (count > 0) return;

  const features = [
    {
      id: createId(),
      title: "????????????? ?????????? ???-??????",
      description: "??????? ????????? ????? ???????? ??????? ? ?????? ?????????? ?????? ??????.",
      status: "in_progress",
      eta: "???? 2025",
      category: "Workflow",
      tags: ["Automation", "Content"],
      baseVotes: 32,
    },
    {
      id: createId(),
      title: "????????????? ????????? ??????????",
      description: "?????????? ? Google Calendar, ????? ??????? ?????? ?????? ?????? ???????.",
      status: "planned",
      eta: "??? 2025",
      category: "Collaboration",
      tags: ["Calendar", "Sync"],
      baseVotes: 24,
    },
    {
      id: createId(),
      title: "????? ???????????",
      description: "?????? ????? ??? ????? ? e-mail, ????? ?? ?????????? ??????? ?? ???????.",
      status: "in_progress",
      eta: "?????? 2025",
      category: "Communication",
      tags: ["Realtime"],
      baseVotes: 35,
    },
    {
      id: createId(),
      title: "???? ? ????? ???????",
      description: "??????????????? ?????????? ?? ?????????????? ???????? ? ???????? ???????.",
      status: "planned",
      eta: "???? 2025",
      category: "Security",
      tags: ["Roles", "Permissions"],
      baseVotes: 41,
    },
  ].map((feature) => ({
    ...feature,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  const insertQuery =
    "INSERT INTO features (id, payload, created_at, updated_at) VALUES ($1, $2, $3, $4)";
  for (const feature of features) {
    await pool.query(insertQuery, [feature.id, feature, feature.createdAt, feature.updatedAt]);
  }
}

function dateFromNow(baseDate, days, hours = 12) {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + days);
  date.setHours(hours, 0, 0, 0);
  return date.toISOString();
}

function createId() {
  if (typeof randomUUID === "function") {
    return randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getSSLConfig(url) {
  if (!url) return undefined;
  return /localhost|127\.0\.0\.1/i.test(url) ? undefined : { rejectUnauthorized: false };
}
