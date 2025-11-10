const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");

const PORT = process.env.PORT || 4000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "app.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.prepare(
  `
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `
).run();

const insertTaskStmt = db.prepare(
  "INSERT INTO tasks (id, payload, created_at, updated_at) VALUES (@id, @payload, @created_at, @updated_at)"
);
const updateTaskStmt = db.prepare(
  "UPDATE tasks SET payload = @payload, updated_at = @updated_at WHERE id = @id"
);
const deleteTaskStmt = db.prepare("DELETE FROM tasks WHERE id = ?");
const findTaskStmt = db.prepare("SELECT payload FROM tasks WHERE id = ?");
const listTasksStmt = db.prepare("SELECT payload FROM tasks ORDER BY datetime(updated_at) DESC");
const countTasksStmt = db.prepare("SELECT COUNT(1) as count FROM tasks");

db.prepare(
  `
    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `
).run();

const insertFeatureStmt = db.prepare(
  "INSERT INTO features (id, payload, created_at, updated_at) VALUES (@id, @payload, @created_at, @updated_at)"
);
const updateFeatureStmt = db.prepare(
  "UPDATE features SET payload = @payload, updated_at = @updated_at WHERE id = @id"
);
const deleteFeatureStmt = db.prepare("DELETE FROM features WHERE id = ?");
const findFeatureStmt = db.prepare("SELECT payload FROM features WHERE id = ?");
const listFeaturesStmt = db.prepare(
  "SELECT payload FROM features ORDER BY datetime(updated_at) DESC"
);
const countFeaturesStmt = db.prepare("SELECT COUNT(1) as count FROM features");

ensureSeedData();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.get("/api/tasks", (_req, res) => {
  const tasks = listTasksStmt
    .all()
    .map(rowToTask)
    .filter(Boolean);
  res.json(tasks);
});

app.get("/api/tasks/:id", (req, res) => {
  const task = rowToTask(findTaskStmt.get(req.params.id));
  if (!task) {
    res.status(404).json({ message: "Task not found" });
    return;
  }
  res.json(task);
});

app.post("/api/tasks", (req, res) => {
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
    insertTaskStmt.run({
      id: task.id,
      payload: JSON.stringify(task),
      created_at: task.createdAt,
      updated_at: task.updatedAt,
    });
  } catch (err) {
    if (String(err.message).includes("UNIQUE constraint failed")) {
      res.status(409).json({ message: "Task with the same id already exists" });
      return;
    }
    console.error("Failed to insert task", err);
    res.status(500).json({ message: "Failed to save task" });
    return;
  }

  res.status(201).json(task);
});

app.put("/api/tasks/:id", (req, res) => {
  const existing = rowToTask(findTaskStmt.get(req.params.id));
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
    updateTaskStmt.run({
      id: updatedTask.id,
      payload: JSON.stringify(updatedTask),
      updated_at: updatedTask.updatedAt,
    });
  } catch (err) {
    console.error("Failed to update task", err);
    res.status(500).json({ message: "Failed to update task" });
    return;
  }

  res.json(updatedTask);
});

app.delete("/api/tasks/:id", (req, res) => {
  const result = deleteTaskStmt.run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ message: "Task not found" });
    return;
  }
  res.status(204).send();
});

app.get("/api/features", (_req, res) => {
  const features = listFeaturesStmt
    .all()
    .map(rowToFeature)
    .filter(Boolean);
  res.json(features);
});

app.get("/api/features/:id", (req, res) => {
  const feature = rowToFeature(findFeatureStmt.get(req.params.id));
  if (!feature) {
    res.status(404).json({ message: "Feature not found" });
    return;
  }
  res.json(feature);
});

app.post("/api/features", (req, res) => {
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
    insertFeatureStmt.run({
      id: feature.id,
      payload: JSON.stringify(feature),
      created_at: feature.createdAt,
      updated_at: feature.updatedAt,
    });
  } catch (err) {
    if (String(err.message).includes("UNIQUE constraint failed")) {
      res.status(409).json({ message: "Feature with the same id already exists" });
      return;
    }
    console.error("Failed to insert feature", err);
    res.status(500).json({ message: "Failed to save feature" });
    return;
  }

  res.status(201).json(feature);
});

app.put("/api/features/:id", (req, res) => {
  const existing = rowToFeature(findFeatureStmt.get(req.params.id));
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
    updateFeatureStmt.run({
      id: updatedFeature.id,
      payload: JSON.stringify(updatedFeature),
      updated_at: updatedFeature.updatedAt,
    });
  } catch (err) {
    console.error("Failed to update feature", err);
    res.status(500).json({ message: "Failed to update feature" });
    return;
  }

  res.json(updatedFeature);
});

app.delete("/api/features/:id", (req, res) => {
  const result = deleteFeatureStmt.run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ message: "Feature not found" });
    return;
  }
  res.status(204).send();
});

const staticDir = __dirname;
app.use(express.static(staticDir));

app.use((err, _req, res, _next) => {
  console.error("Unhandled server error", err);
  res.status(500).json({ message: "Unexpected server error" });
});

app.listen(PORT, () => {
  console.log(`Server ready at http://localhost:${PORT}`);
});

function rowToTask(row) {
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch (err) {
    console.error("Failed to parse task row", err);
    return null;
  }
}

function rowToFeature(row) {
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch (err) {
    console.error("Failed to parse feature row", err);
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
      return { error: "Field \"deadline\" must be a valid date" };
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

function ensureSeedData() {
  seedTasks();
  seedFeatures();
}

function seedTasks() {
  const { count } = countTasksStmt.get();
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

  const insert = db.prepare(
    "INSERT INTO tasks (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)"
  );
  const insertMany = db.transaction((records) => {
    for (const task of records) {
      insert.run(task.id, JSON.stringify(task), task.createdAt, task.updatedAt);
    }
  });
  insertMany(tasks);
}

function seedFeatures() {
  const { count } = countFeaturesStmt.get();
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

  const insert = db.prepare(
    "INSERT INTO features (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)"
  );
  const insertMany = db.transaction((records) => {
    for (const feature of records) {
      insert.run(feature.id, JSON.stringify(feature), feature.createdAt, feature.updatedAt);
    }
  });
  insertMany(features);
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
