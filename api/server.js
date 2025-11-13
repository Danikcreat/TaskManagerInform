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

const CONTENT_PLAN_BUCKETS = Object.freeze({
  EVENTS: "events",
  INSTAGRAM: "instagram",
  TELEGRAM: "telegram",
});

const CONTENT_PLAN_TABLES = Object.freeze({
  [CONTENT_PLAN_BUCKETS.EVENTS]: "events",
  [CONTENT_PLAN_BUCKETS.INSTAGRAM]: "content_instagram",
  [CONTENT_PLAN_BUCKETS.TELEGRAM]: "content_telegram",
});

const CONTENT_PLAN_PERMISSIONS = Object.freeze({
  [CONTENT_PLAN_BUCKETS.EVENTS]: new Set([USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN]),
  [CONTENT_PLAN_BUCKETS.INSTAGRAM]: new Set([
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.ADMIN,
    USER_ROLES.CONTENT_MANAGER,
  ]),
  [CONTENT_PLAN_BUCKETS.TELEGRAM]: new Set([
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.ADMIN,
    USER_ROLES.CONTENT_MANAGER,
  ]),
});

const MAX_CONTENT_PLAN_RANGE_DAYS = Math.max(
  7,
  Number(process.env.CONTENT_PLAN_RANGE_LIMIT_DAYS || 93)
);

const CONTENT_PLAN_BUCKET_CONFIG = Object.freeze({
  [CONTENT_PLAN_BUCKETS.EVENTS]: {
    bucket: CONTENT_PLAN_BUCKETS.EVENTS,
    table: CONTENT_PLAN_TABLES[CONTENT_PLAN_BUCKETS.EVENTS],
    columns: ["title", "description", "date", "time", "location", "type"],
    normalizer: normalizeEventPayload,
  },
  [CONTENT_PLAN_BUCKETS.INSTAGRAM]: {
    bucket: CONTENT_PLAN_BUCKETS.INSTAGRAM,
    table: CONTENT_PLAN_TABLES[CONTENT_PLAN_BUCKETS.INSTAGRAM],
    columns: ["title", "description", "date", "time", "type", "status", "event_id"],
    normalizer: (payload, options) => normalizeContentPayload(payload, options),
  },
  [CONTENT_PLAN_BUCKETS.TELEGRAM]: {
    bucket: CONTENT_PLAN_BUCKETS.TELEGRAM,
    table: CONTENT_PLAN_TABLES[CONTENT_PLAN_BUCKETS.TELEGRAM],
    columns: ["title", "description", "date", "time", "type", "status", "event_id"],
    normalizer: (payload, options) => normalizeContentPayload(payload, options),
  },
});

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

app.get(
  "/api/content-plan",
  asyncHandler(async (req, res) => {
    const { value: range, error } = resolveContentPlanRange(req.query || {});
    if (error) {
      res.status(400).json({ message: error });
      return;
    }
    const payload = await fetchContentPlanRange(range);
    res.json(payload);
  })
);

app.post(
  "/api/content-plan/:bucket",
  authenticate,
  asyncHandler(async (req, res) => {
    const config = getContentPlanBucketConfig(req.params.bucket);
    if (!config) {
      res.status(404).json({ message: "Неизвестный раздел контент-плана." });
      return;
    }
    if (!canManageContentPlanBucket(req.auth?.role, config.bucket)) {
      res
        .status(403)
        .json({ message: "Недостаточно прав для изменения записей контент-плана." });
      return;
    }
    const { value, error } = config.normalizer(req.body || {}, { partial: false });
    if (error) {
      res.status(400).json({ message: error });
      return;
    }
    const record = await insertContentPlanItem(config, value);
    res.status(201).json(record);
  })
);

app.put(
  "/api/content-plan/:bucket/:id",
  authenticate,
  asyncHandler(async (req, res) => {
    const config = getContentPlanBucketConfig(req.params.bucket);
    if (!config) {
      res.status(404).json({ message: "Неизвестный раздел контент-плана." });
      return;
    }
    if (!canManageContentPlanBucket(req.auth?.role, config.bucket)) {
      res
        .status(403)
        .json({ message: "Недостаточно прав для изменения записей контент-плана." });
      return;
    }
    const itemId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      res.status(400).json({ message: "Некорректный идентификатор записи." });
      return;
    }
    const { value, error } = config.normalizer(req.body || {}, { partial: true });
    if (error) {
      res.status(400).json({ message: error });
      return;
    }
    const record = await updateContentPlanItem(config, itemId, value);
    if (!record) {
      res.status(404).json({ message: "Запись не найдена." });
      return;
    }
    res.json(record);
  })
);

app.delete(
  "/api/content-plan/:bucket/:id",
  authenticate,
  asyncHandler(async (req, res) => {
    const config = getContentPlanBucketConfig(req.params.bucket);
    if (!config) {
      res.status(404).json({ message: "Неизвестный раздел контент-плана." });
      return;
    }
    if (!canManageContentPlanBucket(req.auth?.role, config.bucket)) {
      res
        .status(403)
        .json({ message: "Недостаточно прав для изменения записей контент-плана." });
      return;
    }
    const itemId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      res.status(400).json({ message: "Некорректный идентификатор записи." });
      return;
    }
    const removed = await removeContentPlanItem(config, itemId);
    if (!removed) {
      res.status(404).json({ message: "Запись не найдена." });
      return;
    }
    res.status(204).send();
  })
);

app.get(
  "/api/content-plan/:bucket/:id/assets",
  asyncHandler(async (req, res) => {
    const resolved = await resolveContentItemRequest(req, res, { allowEvents: false });
    if (!resolved) return;
    const assets = await fetchContentAssets(resolved.config.bucket, resolved.itemId);
    res.json(assets);
  })
);

app.post(
  "/api/content-plan/:bucket/:id/assets",
  authenticate,
  asyncHandler(async (req, res) => {
    const resolved = await resolveContentItemRequest(req, res, { allowEvents: false });
    if (!resolved) return;
    const { value, error } = normalizeContentAssetPayload(req.body || {});
    if (error) {
      res.status(400).json({ message: error });
      return;
    }
    const asset = await insertContentAsset(resolved.config.bucket, resolved.itemId, value);
    res.status(201).json(asset);
  })
);

app.delete(
  "/api/content-plan/:bucket/:id/assets/:assetId",
  authenticate,
  asyncHandler(async (req, res) => {
    const resolved = await resolveContentItemRequest(req, res, { allowEvents: false });
    if (!resolved) return;
    const assetId = Number.parseInt(req.params.assetId, 10);
    if (!Number.isFinite(assetId) || assetId <= 0) {
      res.status(400).json({ message: "Некорректный идентификатор вложения." });
      return;
    }
    const removed = await removeContentAsset(resolved.config.bucket, resolved.itemId, assetId);
    if (!removed) {
      res.status(404).json({ message: "Вложение не найдено." });
      return;
    }
    res.status(204).send();
  })
);

app.get(
  "/api/content-plan/:bucket/:id/tasks",
  asyncHandler(async (req, res) => {
    const resolved = await resolveContentItemRequest(req, res, { allowEvents: false });
    if (!resolved) return;
    const tasks = await fetchLinkedContentTasks(resolved.config.bucket, resolved.itemId);
    res.json(tasks);
  })
);

app.post(
  "/api/content-plan/:bucket/:id/tasks",
  authenticate,
  asyncHandler(async (req, res) => {
    const resolved = await resolveContentItemRequest(req, res, { allowEvents: false });
    if (!resolved) return;
    const taskId = String(req.body?.taskId || "").trim();
    if (!taskId) {
      res.status(400).json({ message: "Не указан идентификатор задачи." });
      return;
    }
    const task = await getTaskById(taskId);
    if (!task) {
      res.status(404).json({ message: "Задача не найдена." });
      return;
    }
    const link = await linkTaskToContent(resolved.config.bucket, resolved.itemId, taskId);
    if (!link) {
      res.status(409).json({ message: "Задача уже привязана к публикации." });
      return;
    }
    res.status(201).json(link);
  })
);

app.delete(
  "/api/content-plan/:bucket/:id/tasks/:taskId",
  authenticate,
  asyncHandler(async (req, res) => {
    const resolved = await resolveContentItemRequest(req, res, { allowEvents: false });
    if (!resolved) return;
    const taskId = String(req.params.taskId || "").trim();
    if (!taskId) {
      res.status(400).json({ message: "Не указан идентификатор задачи." });
      return;
    }
    const removed = await unlinkTaskFromContent(resolved.config.bucket, resolved.itemId, taskId);
    if (!removed) {
      res.status(404).json({ message: "Связь задачи с публикацией не найдена." });
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

function normalizeEventPayload(raw, { partial } = { partial: false }) {
  const source = raw || {};
  const payload = {};

  if (!partial || source.title !== undefined) {
    const title = normalizeRequiredText(source.title);
    if (!title) {
      return { error: "Название обязательно." };
    }
    payload.title = title;
  }

  if (!partial || source.description !== undefined) {
    payload.description = normalizeOptionalText(source.description);
  }

  if (!partial || source.date !== undefined) {
    const normalizedDate = normalizeIsoDate(source.date);
    if (!normalizedDate) {
      return { error: "Некорректная дата. Используйте формат ГГГГ-ММ-ДД." };
    }
    payload.date = normalizedDate;
  }

  if (!partial || source.time !== undefined) {
    const { value: normalizedTime, error } = normalizeTimeValue(source.time, {
      halfHourOnly: false,
    });
    if (error) return { error };
    payload.time = normalizedTime;
  }

  if (!partial || source.location !== undefined) {
    payload.location = normalizeOptionalText(source.location);
  }

  if (!partial || source.type !== undefined) {
    const type = normalizeRequiredText(source.type);
    if (!type) {
      return { error: "Тип обязателен." };
    }
    payload.type = type;
  }

  if (partial) {
    cleanupPartialPayload(payload);
    if (Object.keys(payload).length === 0) {
      return { error: "Нет данных для обновления." };
    }
  } else {
    if (!("description" in payload)) payload.description = null;
    if (!("time" in payload)) payload.time = null;
    if (!("location" in payload)) payload.location = null;
  }

  return { value: payload };
}

function normalizeContentPayload(raw, { partial } = { partial: false }) {
  const source = raw || {};
  const payload = {};

  if (!partial || source.title !== undefined) {
    const title = normalizeRequiredText(source.title);
    if (!title) {
      return { error: "Название обязательно." };
    }
    payload.title = title;
  }

  if (!partial || source.description !== undefined) {
    payload.description = normalizeOptionalText(source.description);
  }

  if (!partial || source.date !== undefined) {
    const normalizedDate = normalizeIsoDate(source.date);
    if (!normalizedDate) {
      return { error: "Некорректная дата. Используйте формат ГГГГ-ММ-ДД." };
    }
    payload.date = normalizedDate;
  }

  if (!partial || source.time !== undefined) {
    const { value: normalizedTime, error } = normalizeTimeValue(source.time, {
      halfHourOnly: true,
    });
    if (error) return { error };
    payload.time = normalizedTime;
  }

  if (!partial || source.type !== undefined) {
    payload.type = normalizeOptionalText(source.type);
  }

  if (!partial || source.status !== undefined) {
    payload.status = normalizeOptionalText(source.status);
  }

  const rawEventId =
    source.event_id !== undefined ? source.event_id : source.eventId;
  if (!partial || rawEventId !== undefined) {
    if (rawEventId === undefined || rawEventId === null || rawEventId === "") {
      payload.event_id = null;
    } else {
      const eventId = Number.parseInt(rawEventId, 10);
      if (!Number.isFinite(eventId) || eventId <= 0) {
        return { error: "Некорректная привязка к событию." };
      }
      payload.event_id = eventId;
    }
  }

  if (partial) {
    cleanupPartialPayload(payload);
    if (Object.keys(payload).length === 0) {
      return { error: "Нет данных для обновления." };
    }
  } else {
    if (!("description" in payload)) payload.description = null;
    if (!("time" in payload)) payload.time = null;
    if (!("type" in payload)) payload.type = null;
    if (!("status" in payload)) payload.status = null;
    if (!("event_id" in payload)) payload.event_id = null;
  }

  return { value: payload };
}

function normalizeTimeValue(value, { halfHourOnly = false } = {}) {
  if (value === undefined || value === null) {
    return { value: null };
  }
  const raw = String(value).trim();
  if (!raw) {
    return { value: null };
  }
  const pattern = halfHourOnly
    ? /^([01]\d|2[0-3]):(00|30)$/
    : /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!pattern.test(raw)) {
    return { error: "Некорректное время. Используйте формат ЧЧ:ММ." };
  }
  return { value: raw };
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const raw = String(value).trim();
  return raw || null;
}

function normalizeRequiredText(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const raw = String(value).trim();
  return raw || null;
}

function cleanupPartialPayload(payload) {
  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) {
      delete payload[key];
    }
  });
}

function resolveContentPlanRange(query = {}) {
  let from = normalizeIsoDate(query.from);
  let to = normalizeIsoDate(query.to);

  const hasMonthParams = query.month !== undefined || query.year !== undefined;
  if ((!from || !to) && hasMonthParams) {
    const normalized = normalizeMonthYearRange(query.month, query.year);
    if (!normalized) {
      return { error: "Некорректные параметры месяца или года." };
    }
    from = normalized.from;
    to = normalized.to;
  }

  if (!from || !to) {
    const fallback = getDefaultMonthRange();
    from = fallback.from;
    to = fallback.to;
  }

  if (from > to) {
    return { error: "Дата начала больше даты окончания." };
  }

  if (countDaysBetween(from, to) > MAX_CONTENT_PLAN_RANGE_DAYS) {
    return {
      error: `Диапазон слишком большой. Максимум ${MAX_CONTENT_PLAN_RANGE_DAYS} дней.`,
    };
  }

  return { value: { from, to } };
}

function getDefaultMonthRange() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return {
    from: formatISODate(start),
    to: formatISODate(end),
  };
}

function normalizeMonthYearRange(monthValue, yearValue) {
  const month = Number.parseInt(monthValue, 10);
  const year = Number.parseInt(yearValue, 10);
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  if (!Number.isFinite(year) || year < 1970 || year > 9999) {
    return null;
  }
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return {
    from: formatISODate(start),
    to: formatISODate(end),
  };
}

function normalizeIsoDate(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(raw)) {
    return raw;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return formatISODate(parsed);
}

function formatISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function countDaysBetween(from, to) {
  const start = isoToEpoch(from);
  const end = isoToEpoch(to);
  if (start === null || end === null) {
    return Number.POSITIVE_INFINITY;
  }
  const diff = end - start;
  return Math.floor(diff / 86400000) + 1;
}

function isoToEpoch(value) {
  const match = value?.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  return Date.UTC(year, month, day);
}

function fetchContentPlanRange(range) {
  return Promise.all([
    fetchContentPlanCollection(CONTENT_PLAN_BUCKETS.EVENTS, range),
    fetchContentPlanCollection(CONTENT_PLAN_BUCKETS.INSTAGRAM, range),
    fetchContentPlanCollection(CONTENT_PLAN_BUCKETS.TELEGRAM, range),
  ]).then(([events, instagram, telegram]) => ({
    range,
    events,
    instagram,
    telegram,
  }));
}

async function fetchContentPlanCollection(bucket, range) {
  const config = getContentPlanBucketConfig(bucket);
  if (!config) return [];
  const query = `
    SELECT *
    FROM ${config.table}
    WHERE date >= $1 AND date <= $2
    ORDER BY date ASC, time ASC NULLS LAST, id ASC
  `;
  const { rows } = await pool.query(query, [range.from, range.to]);
  return rows.map((row) => mapContentPlanRow(config.bucket, row)).filter(Boolean);
}

function getContentPlanBucketConfig(rawBucket) {
  if (!rawBucket) return null;
  const normalized = String(rawBucket).trim().toLowerCase();
  if (!normalized) return null;
  return CONTENT_PLAN_BUCKET_CONFIG[normalized] || null;
}

function canManageContentPlanBucket(role, bucket) {
  if (!role || !bucket) return false;
  const allowed = CONTENT_PLAN_PERMISSIONS[bucket];
  if (!allowed) return false;
  return allowed.has(role);
}

async function insertContentPlanItem(config, payload) {
  const columns = config.columns;
  const values = columns.map((column) => (payload[column] !== undefined ? payload[column] : null));
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const query = `
    INSERT INTO ${config.table} (${columns.join(", ")})
    VALUES (${placeholders})
    RETURNING *
  `;
  const { rows } = await pool.query(query, values);
  return mapContentPlanRow(config.bucket, rows[0]);
}

async function updateContentPlanItem(config, id, payload) {
  const entries = Object.entries(payload);
  if (!entries.length) {
    return null;
  }
  const setFragments = entries.map(
    ([column], index) => `${column} = $${index + 1}`
  );
  const values = entries.map(([, value]) => value);
  const query = `
    UPDATE ${config.table}
    SET ${setFragments.join(", ")}, updated_at = NOW()
    WHERE id = $${entries.length + 1}
    RETURNING *
  `;
  const { rows } = await pool.query(query, [...values, id]);
  if (!rows[0]) {
    return null;
  }
  return mapContentPlanRow(config.bucket, rows[0]);
}

async function removeContentPlanItem(config, id) {
  const { rowCount } = await pool.query(`DELETE FROM ${config.table} WHERE id = $1`, [id]);
  return rowCount > 0;
}

function mapContentPlanRow(bucket, row) {
  if (!row) return null;
  const base = {
    id: row.id,
    title: row.title,
    description: row.description,
    date: row.date,
    time: row.time,
    type: row.type,
    channel: bucket,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
  if (bucket === CONTENT_PLAN_BUCKETS.EVENTS) {
    base.location = row.location;
  } else {
    base.status = row.status;
    base.eventId = row.event_id;
  }
  return base;
}

async function findContentPlanItem(config, id) {
  const { rows } = await pool.query(
    `SELECT * FROM ${config.table} WHERE id = $1 LIMIT 1`,
    [id]
  );
  return mapContentPlanRow(config.bucket, rows[0]);
}

async function resolveContentItemRequest(req, res, { allowEvents = true } = {}) {
  const config = getContentPlanBucketConfig(req.params.bucket);
  if (!config) {
    res.status(404).json({ message: "Коллекция не найдена." });
    return null;
  }
  if (!allowEvents && config.bucket === CONTENT_PLAN_BUCKETS.EVENTS) {
    res.status(400).json({ message: "Операция доступна только для публикаций." });
    return null;
  }
  const itemId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    res.status(400).json({ message: "Некорректный идентификатор записи." });
    return null;
  }
  const record = await findContentPlanItem(config, itemId);
  if (!record) {
    res.status(404).json({ message: "Запись не найдена." });
    return null;
  }
  return { config, itemId, record };
}

async function fetchContentAssets(channel, contentId) {
  const { rows } = await pool.query(
    `
      SELECT *
      FROM content_assets
      WHERE channel = $1 AND content_id = $2
      ORDER BY created_at DESC, id DESC
    `,
    [channel, contentId]
  );
  return rows.map(mapContentAssetRow).filter(Boolean);
}

function mapContentAssetRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    notes: row.notes,
    channel: row.channel,
    contentId: row.content_id,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

function normalizeContentAssetPayload(raw) {
  const title = String(raw?.title || "").trim();
  if (!title) {
    return { error: 'Field "title" is required' };
  }
  const url = raw?.url ? String(raw.url).trim() : "";
  const notes = raw?.notes ? String(raw.notes).trim() : "";
  return {
    value: {
      title,
      url,
      notes,
    },
  };
}

async function insertContentAsset(channel, contentId, payload) {
  const { rows } = await pool.query(
    `
      INSERT INTO content_assets (channel, content_id, title, url, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `,
    [channel, contentId, payload.title, payload.url || null, payload.notes || null]
  );
  return mapContentAssetRow(rows[0]);
}

async function removeContentAsset(channel, contentId, assetId) {
  const { rowCount } = await pool.query(
    `
      DELETE FROM content_assets
      WHERE id = $1 AND channel = $2 AND content_id = $3
    `,
    [assetId, channel, contentId]
  );
  return rowCount > 0;
}

async function fetchLinkedContentTasks(channel, contentId) {
  const { rows } = await pool.query(
    `
      SELECT ctl.task_id, ctl.created_at AS linked_at, t.payload
      FROM content_task_links ctl
      LEFT JOIN tasks t ON t.id = ctl.task_id
      WHERE ctl.channel = $1 AND ctl.content_id = $2
      ORDER BY ctl.created_at DESC, ctl.id DESC
    `,
    [channel, contentId]
  );
  return rows
    .map((row) => {
      const task = rowToTask(row);
      if (!task) return null;
      return {
        ...task,
        linkedAt: toIsoTimestamp(row.linked_at),
      };
    })
    .filter(Boolean);
}

async function linkTaskToContent(channel, contentId, taskId) {
  const { rows } = await pool.query(
    `
      INSERT INTO content_task_links (task_id, channel, content_id, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (task_id, channel, content_id) DO NOTHING
      RETURNING created_at
    `,
    [taskId, channel, contentId]
  );
  if (!rows[0]) {
    return null;
  }
  const task = await getTaskById(taskId);
  if (!task) {
    return null;
  }
  return {
    ...task,
    linkedAt: toIsoTimestamp(rows[0].created_at),
  };
}

async function unlinkTaskFromContent(channel, contentId, taskId) {
  const { rowCount } = await pool.query(
    `
      DELETE FROM content_task_links
      WHERE task_id = $1 AND channel = $2 AND content_id = $3
    `,
    [taskId, channel, contentId]
  );
  return rowCount > 0;
}

async function getTaskById(taskId) {
  const { rows } = await pool.query("SELECT payload FROM tasks WHERE id = $1 LIMIT 1", [taskId]);
  return rowToTask(rows[0]);
}

function toIsoTimestamp(value) {
  if (!value) return null;
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  } catch {
    return null;
  }
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
    await ensureContentPlanTables();
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
      role TEXT NOT NULL CHECK (role IN (${USER_ROLE_VALUES_SQL})),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query("UPDATE users SET created_at = NOW() WHERE created_at IS NULL");
  await pool.query("UPDATE users SET updated_at = NOW() WHERE updated_at IS NULL");

  await pool.query("ALTER TABLE users ALTER COLUMN created_at SET DEFAULT NOW()");
  await pool.query("ALTER TABLE users ALTER COLUMN updated_at SET DEFAULT NOW()");
  await pool.query("ALTER TABLE users ALTER COLUMN created_at SET NOT NULL");
  await pool.query("ALTER TABLE users ALTER COLUMN updated_at SET NOT NULL");

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

async function ensureContentPlanTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      date TEXT NOT NULL CHECK (
        date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-[0-3][0-9]$'
      ),
      time TEXT CHECK (
        time IS NULL OR time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      ),
      location TEXT,
      type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_instagram (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      date TEXT NOT NULL CHECK (
        date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-[0-3][0-9]$'
      ),
      time TEXT CHECK (
        time IS NULL OR time ~ '^([01][0-9]|2[0-3]):(00|30)$'
      ),
      type TEXT,
      status TEXT,
      event_id INTEGER REFERENCES events (id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_telegram (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      date TEXT NOT NULL CHECK (
        date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-[0-3][0-9]$'
      ),
      time TEXT CHECK (
        time IS NULL OR time ~ '^([01][0-9]|2[0-3]):(00|30)$'
      ),
      type TEXT,
      status TEXT,
      event_id INTEGER REFERENCES events (id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_task_links (
      id BIGSERIAL PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
      channel TEXT NOT NULL CHECK (channel IN ('instagram', 'telegram')),
      content_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (task_id, channel, content_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_assets (
      id BIGSERIAL PRIMARY KEY,
      channel TEXT NOT NULL CHECK (channel IN ('instagram', 'telegram')),
      content_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE content_instagram
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE content_instagram
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE content_telegram
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE content_telegram
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE content_task_links
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE content_task_links
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE content_assets
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE content_assets
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_task_links_content_idx
    ON content_task_links (channel, content_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_task_links_task_idx
    ON content_task_links (task_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS content_assets_content_idx
    ON content_assets (channel, content_id)
  `);

  await pool.query("CREATE INDEX IF NOT EXISTS idx_events_date ON events (date)");
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_content_instagram_date ON content_instagram (date)"
  );
  await pool.query(
    "CREATE INDEX IF NOT EXISTS idx_content_telegram_date ON content_telegram (date)"
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
