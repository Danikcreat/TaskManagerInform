require("dotenv").config();
require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const { randomUUID } = require("crypto");
const jwt = require("jsonwebtoken");
const { USER_ROLES } = require("./roles");

const USER_ROLE_VALUES_SQL = Object.values(USER_ROLES)
  .map((role) => `'${role}'`)
  .join(", ");
const USER_SELECT_COLUMNS = [
  "id",
  "last_name",
  "first_name",
  "middle_name",
  "birth_date",
  "group_number",
  "login",
  "password",
  "position",
  "role",
].join(", ");

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
const JWT_SECRET = process.env.JWT_SECRET;
const AUTH_TOKEN_TTL = process.env.JWT_EXPIRES_IN || "7d";

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL environment variable is required. Provide your Supabase connection string."
  );
}

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required for auth token signing.");
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
  Number(process.env.DB_POOL_CONNECTION_TIMEOUT || process.env.PG_CONNECTION_TIMEOUT || 15000)
);
const DB_INIT_MAX_RETRIES = Math.max(1, Number(process.env.DB_INIT_MAX_RETRIES || 5));
const DB_INIT_RETRY_DELAY = Math.max(250, Number(process.env.DB_INIT_RETRY_DELAY || 1500));

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: getSSLConfig(DATABASE_URL),
  max: POOL_MAX_CONNECTIONS,
  idleTimeoutMillis: POOL_IDLE_TIMEOUT,
  connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT,
  allowExitOnIdle: true,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
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

app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const login = normalizeLogin(req.body?.login);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!login || !password) {
      res.status(400).json({ message: "Логин и пароль обязательны." });
      return;
    }

    const { rows } = await pool.query(
      `
      SELECT ${USER_SELECT_COLUMNS}
      FROM users
      WHERE login = $1
      LIMIT 1
    `,
      [login]
    );

    const userRow = rows[0];
    if (!userRow || userRow.password !== password) {
      res.status(401).json({ message: "Неверный логин или пароль." });
      return;
    }

    const user = mapDbUser(userRow);
    res.json({ token: createAuthToken(user), user });
  })
);

app.get(
  "/api/auth/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `
      SELECT ${USER_SELECT_COLUMNS}
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
      [req.auth?.sub]
    );
    const userRow = rows[0];
    if (!userRow) {
      res.status(404).json({ message: "Пользователь не найден." });
      return;
    }
    res.json({ user: mapDbUser(userRow) });
  })
);

app.get(
  "/api/users",
  authenticate,
  asyncHandler(async (req, res) => {
    const actorRole = req.auth?.role;
    const includePasswords = canViewPasswords(actorRole);
    const { rows } = await pool.query(
      `
      SELECT ${USER_SELECT_COLUMNS}
      FROM users
      ORDER BY last_name ASC, first_name ASC, id ASC
    `
    );
    const users = rows.map((row) => {
      const user = mapDbUser(row);
      if (includePasswords) {
        user.password = row.password;
      }
      return user;
    });
    res.json({ users });
  })
);

app.post(
  "/api/users",
  authenticate,
  asyncHandler(async (req, res) => {
    const actorRole = req.auth?.role;
    if (!canManageAnyUsers(actorRole)) {
      res.status(403).json({ message: "Недостаточно прав для управления пользователями" });
      return;
    }
    const { value, error } = normalizeUserPayload(req.body || {}, {
      partial: false,
      allowedRoles: getAssignableRoles(actorRole),
      requirePassword: true,
    });
    if (error) {
      res.status(400).json({ message: error });
      return;
    }
    try {
      const { rows } = await pool.query(
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
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING ${USER_SELECT_COLUMNS}
      `,
        [
          value.lastName,
          value.firstName,
          value.middleName ?? null,
          value.birthDate ?? null,
          value.groupNumber ?? null,
          value.login,
          value.password,
          value.position ?? null,
          value.role,
        ]
      );
      const createdRow = rows[0];
      const user = mapDbUser(createdRow);
      if (canViewPasswords(actorRole)) {
        user.password = createdRow.password;
      }
      res.status(201).json({ user });
    } catch (err) {
      if (String(err?.code) === "23505" || String(err?.message).includes("duplicate")) {
        res.status(409).json({ message: "Пользователь с таким логином уже существует" });
        return;
      }
      console.error("Failed to create user", err);
      res.status(500).json({ message: "Не удалось создать пользователя" });
    }
  })
);

app.put(
  "/api/users/:id",
  authenticate,
  asyncHandler(async (req, res) => {
    const actorRole = req.auth?.role;
    if (!canManageAnyUsers(actorRole)) {
      res.status(403).json({ message: "Недостаточно прав для управления пользователями" });
      return;
    }
    const targetRow = await findUserById(req.params.id);
    if (!targetRow) {
      res.status(404).json({ message: "Пользователь не найден" });
      return;
    }
    if (!canManageSpecificUser(actorRole, targetRow.role)) {
      res.status(403).json({ message: "Нельзя изменять этого пользователя" });
      return;
    }
    const { value, error } = normalizeUserPayload(req.body || {}, {
      partial: true,
      allowedRoles: getAssignableRoles(actorRole),
      requirePassword: false,
    });
    if (error) {
      res.status(400).json({ message: error });
      return;
    }
    const fields = [];
    const params = [];
    let paramIndex = 1;
    const pushField = (column, key) => {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        fields.push(`${column} = $${paramIndex}`);
        params.push(value[key]);
        paramIndex += 1;
      }
    };
    pushField("last_name", "lastName");
    pushField("first_name", "firstName");
    pushField("middle_name", "middleName");
    pushField("birth_date", "birthDate");
    pushField("group_number", "groupNumber");
    pushField("login", "login");
    pushField("position", "position");
    pushField("role", "role");
    if (!fields.length) {
      res.status(400).json({ message: "Нет изменений для сохранения" });
      return;
    }
    const query = `
      UPDATE users
      SET ${fields.join(", ")}, updated_at = NOW()
      WHERE id = $${paramIndex}
      RETURNING ${USER_SELECT_COLUMNS}
    `;
    params.push(targetRow.id);
    try {
      const { rows } = await pool.query(query, params);
      const updatedRow = rows[0];
      const user = mapDbUser(updatedRow);
      if (canViewPasswords(actorRole)) {
        user.password = updatedRow.password;
      }
      res.json({ user });
    } catch (err) {
      if (String(err?.code) === "23505" || String(err?.message).includes("duplicate")) {
        res.status(409).json({ message: "Пользователь с таким логином уже существует" });
        return;
      }
      console.error("Failed to update user", err);
      res.status(500).json({ message: "Не удалось обновить пользователя" });
    }
  })
);

app.delete(
  "/api/users/:id",
  authenticate,
  asyncHandler(async (req, res) => {
    const actorRole = req.auth?.role;
    if (!canManageAnyUsers(actorRole)) {
      res.status(403).json({ message: "Недостаточно прав для управления пользователями" });
      return;
    }
    const targetRow = await findUserById(req.params.id);
    if (!targetRow) {
      res.status(404).json({ message: "Пользователь не найден" });
      return;
    }
    if (!canManageSpecificUser(actorRole, targetRow.role)) {
      res.status(403).json({ message: "Нельзя удалять этого пользователя" });
      return;
    }
    try {
      await pool.query("DELETE FROM users WHERE id = $1", [targetRow.id]);
      res.status(204).send();
    } catch (err) {
      console.error("Failed to delete user", err);
      res.status(500).json({ message: "Не удалось удалить пользователя" });
    }
  })
);

app.post(
  "/api/users/:id/reset-password",
  authenticate,
  asyncHandler(async (req, res) => {
    const actorRole = req.auth?.role;
    if (!canManageAnyUsers(actorRole)) {
      res.status(403).json({ message: "Недостаточно прав для управления пользователями" });
      return;
    }
    const targetRow = await findUserById(req.params.id);
    if (!targetRow) {
      res.status(404).json({ message: "Пользователь не найден" });
      return;
    }
    if (!canManageSpecificUser(actorRole, targetRow.role)) {
      res.status(403).json({ message: "Нельзя сбросить пароль этому пользователю" });
      return;
    }
    const newPassword = generatePassword(8);
    try {
      const { rows } = await pool.query(
        `
        UPDATE users
        SET password = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING ${USER_SELECT_COLUMNS}
      `,
        [newPassword, targetRow.id]
      );
      const updatedRow = rows[0];
      const user = mapDbUser(updatedRow);
      if (canViewPasswords(actorRole)) {
        user.password = updatedRow.password;
      }
      res.json({ user, password: newPassword });
    } catch (err) {
      console.error("Failed to reset password", err);
      res.status(500).json({ message: "Не удалось сбросить пароль пользователя" });
    }
  })
);

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

async function initializeDatabase(attempt = 1) {
  try {
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
  } catch (error) {
    if (isTransientConnectionError(error) && attempt < DB_INIT_MAX_RETRIES) {
      const delay = DB_INIT_RETRY_DELAY * attempt;
      console.warn(
        `Database init attempt ${attempt} failed (${error.message}). Retrying in ${delay}ms...`
      );
      await sleep(delay);
      return initializeDatabase(attempt + 1);
    }
    throw error;
  }
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

function isTransientConnectionError(error) {
  if (!error) return false;
  const code = error.code;
  const message = String(error.message || "").toLowerCase();
  const transientCodes = new Set(["57P01", "57P02", "57P03", "53300", "53400", "08006", "08001"]);
  if (code && transientCodes.has(code)) {
    return true;
  }
  if (
    message.includes("connection terminated") ||
    message.includes("connection timeout") ||
    message.includes("terminating connection") ||
    message.includes("remaining connection slots") ||
    message.includes("connection refused")
  ) {
    return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function mapDbUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    lastName: row.last_name,
    firstName: row.first_name,
    middleName: row.middle_name,
    birthDate: row.birth_date,
    groupNumber: row.group_number,
    login: row.login,
    position: row.position,
    role: row.role,
    displayName: formatDisplayName(row),
  };
}

function formatDisplayName(row) {
  return [row.first_name, row.middle_name, row.last_name]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function createAuthToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      login: user.login,
    },
    JWT_SECRET,
    { expiresIn: AUTH_TOKEN_TTL }
  );
}

function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ message: "Требуется авторизация." });
    return;
  }
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Недействительный или истекший токен." });
  }
}

function extractToken(req) {
  const authHeader = req.headers?.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  return null;
}

function normalizeLogin(value) {
  return String(value || "").trim();
}

function canManageAnyUsers(role) {
  return role === USER_ROLES.SUPER_ADMIN || role === USER_ROLES.ADMIN;
}

function canViewPasswords(role) {
  return canManageAnyUsers(role);
}

function canManageSpecificUser(actorRole, targetRole) {
  if (actorRole === USER_ROLES.SUPER_ADMIN) return true;
  if (actorRole === USER_ROLES.ADMIN) {
    return (
      targetRole === USER_ROLES.CONTENT_MANAGER || targetRole === USER_ROLES.EXECUTOR
    );
  }
  return false;
}

function getAssignableRoles(role) {
  if (role === USER_ROLES.SUPER_ADMIN) {
    return Object.values(USER_ROLES);
  }
  if (role === USER_ROLES.ADMIN) {
    return [USER_ROLES.CONTENT_MANAGER, USER_ROLES.EXECUTOR];
  }
  return [];
}

async function findUserById(id) {
  if (!id) return null;
  const { rows } = await pool.query(
    `
    SELECT ${USER_SELECT_COLUMNS}
    FROM users
    WHERE id = $1
    LIMIT 1
  `,
    [id]
  );
  return rows[0] || null;
}

function normalizeUserPayload(payload, options = {}) {
  const { partial = false, allowedRoles = Object.values(USER_ROLES), requirePassword = false } =
    options;
  const source = payload || {};
  const result = {};

  if (!partial || source.lastName !== undefined) {
    const value = String(source.lastName || "").trim();
    if (!value) {
      return { error: "Фамилия обязательна" };
    }
    result.lastName = value;
  }

  if (!partial || source.firstName !== undefined) {
    const value = String(source.firstName || "").trim();
    if (!value) {
      return { error: "Имя обязательно" };
    }
    result.firstName = value;
  }

  if (source.middleName !== undefined) {
    const value = String(source.middleName || "").trim();
    result.middleName = value || null;
  }

  if (source.groupNumber !== undefined) {
    const value = String(source.groupNumber || "").trim();
    result.groupNumber = value || null;
  }

  if (source.birthDate !== undefined) {
    const value = String(source.birthDate || "").trim();
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { error: "Дата рождения должна быть в формате ГГГГ-ММ-ДД" };
    }
    result.birthDate = value || null;
  }

  if (!partial || source.login !== undefined) {
    const value = String(source.login || "").trim();
    if (!value) {
      return { error: "Логин обязателен" };
    }
    result.login = value;
  } else if (source.login === null) {
    return { error: "Логин обязателен" };
  }

  if (source.position !== undefined) {
    const value = String(source.position || "").trim();
    result.position = value || null;
  }

  if (!partial || source.role !== undefined) {
    const value = String(source.role || "").trim();
    if (!value) {
      return { error: "Роль обязательна" };
    }
    if (!allowedRoles.includes(value)) {
      return { error: "Эта роль недоступна для назначения" };
    }
    result.role = value;
  }

  if (requirePassword || source.password !== undefined) {
    const value = String(source.password || "").trim();
    if (!value) {
      return { error: "Пароль обязателен" };
    }
    if (value.length < 6) {
      return { error: "Пароль должен содержать минимум 6 символов" };
    }
    result.password = value;
  }

  if (partial && Object.keys(result).length === 0) {
    return { error: "Нет данных для обновления" };
  }

  return { value: result };
}

function generatePassword(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let password = "";
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * alphabet.length);
    password += alphabet[index];
  }
  return password;
}
