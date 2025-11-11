# User Roles And `users` Table

## Role Enumeration
- `super_admin` — full access to every resource, including creating/deleting any user or record.
- `admin` — manages every user except super admins and other admins; has control over tasks, content plans, and event plans; no access to the project roadmap.
- `content_manager` — manages content plans, creates tasks, and assigns executors.
- `executor` — can see every task but may change only the status of tasks assigned to them.

Constants and a permission matrix live in `api/roles.js`.

## `users` Table Structure
SQLite helper script: `sql/create_users_table.sql`.

| Column            | Type / Constraint              | Notes                                                                                 |
|-------------------|--------------------------------|---------------------------------------------------------------------------------------|
| `id`              | INTEGER PK AUTOINCREMENT       | Unique id.                                                                            |
| `last_name`       | TEXT NOT NULL                  | Last name.                                                                            |
| `first_name`      | TEXT NOT NULL                  | First name.                                                                           |
| `middle_name`     | TEXT                           | Middle name / patronymic.                                                             |
| `birth_date`      | TEXT                           | `YYYY-MM-DD`, validated via `CHECK`.                                                  |
| `group_number`    | TEXT                           | Student group number.                                                                 |
| `login`           | TEXT UNIQUE NOT NULL           | Unique login.                                                                         |
| `password`        | TEXT NOT NULL                  | Generated password (plain text for now).                                              |
| `position`        | TEXT                           | Job title.                                                                            |
| `role`            | TEXT NOT NULL                  | One of the role constants, enforced with `CHECK`.                                     |
| `created_at`      | TEXT DEFAULT `datetime('now')` | Auto creation timestamp (UTC).                                                        |
| `updated_at`      | TEXT DEFAULT `datetime('now')` | Auto update timestamp (UTC), kept in sync by `trg_users_updated_at`.                  |

## Default Super Admin Seed
The Express API (PostgreSQL/Supabase) now creates the `users` table and, if configured, inserts a default super admin. Define the following variables in `.env` before the first launch:

- `JWT_SECRET` — обязательный секрет для подписи JWT-токенов (выберите длинную случайную строку).
- `DEFAULT_SUPER_ADMIN_LOGIN` (required for seeding)
- `DEFAULT_SUPER_ADMIN_PASSWORD` (required for seeding)
- `DEFAULT_SUPER_ADMIN_FIRST_NAME` (optional, default `Super`)
- `DEFAULT_SUPER_ADMIN_LAST_NAME` (optional, default `Admin`)
- `DEFAULT_SUPER_ADMIN_MIDDLE_NAME` (optional)
- `DEFAULT_SUPER_ADMIN_BIRTH_DATE` (optional, `YYYY-MM-DD`)
- `DEFAULT_SUPER_ADMIN_GROUP_NUMBER` (optional)
- `DEFAULT_SUPER_ADMIN_POSITION` (optional, default `Super Administrator`)

`api/server.js` calls `ensureDefaultSuperAdmin()` during startup: if the login already exists, nothing happens; if login or password is missing, a warning is printed and the seed step is skipped.

## Auth Flow Overview
- `POST /api/auth/login` — принимает `login` и `password`, сверяет с таблицей `users`, возвращает `token` (JWT) и публичные данные пользователя.
- `GET /api/auth/me` — требует заголовок `Authorization: Bearer <token>`, возвращает свежий профиль пользователя.
- Фронтенд (`app.js`) хранит токен и профиль в `localStorage`, показывает форму входа (`index.html`) и не загружает задачи, пока пользователь не авторизован.
- Кнопка «Выйти» очищает локальное состояние. Позже можно навесить middleware `authenticate` на любые API-роуты, когда понадобятся ограничения доступа.
