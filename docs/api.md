# API Overview

Документация описывает текущее REST API веб‑приложения. Все ответы возвращают JSON. Для защищённых эндпоинтов требуется заголовок `Authorization: Bearer <token>`.

## Auth
### `POST /api/auth/login`
Вход пользователя. Тело запроса: `{ login, password }`. Ответ: `{ token, user }`.

### `GET /api/auth/me`
Возвращает профиль текущего пользователя по JWT. Ответ: `{ user }`.

## Users
### `GET /api/users`
Возвращает `{ users: User[] }`. Пользователи с ролью `super_admin`/`admin` видят поле `password`.

### `POST /api/users`
Создание пользователя (`super_admin` или `admin`). Тело запроса включает ФИО, логин, роль, пароль и т.д.

### `PUT /api/users/:id`
Обновление пользователя. Поля можно передавать частично.

### `DELETE /api/users/:id`
Удаляет запись.

### `POST /api/users/:id/reset-password`
Сбрасывает пароль и возвращает новый пароль в ответе (если роль позволяет видеть).

## Tasks
### `GET /api/tasks`
Список всех задач. Каждая задача — JSON payload с вложениями и подзадачами.

### `GET /api/tasks/:id`
Возвращает одну задачу по id.

### `POST /api/tasks`
Создаёт задачу. Тело включает поля: `title`, `responsible`, `deadline`, `priority`, `status`, `description?`, `attachments?`, `subtasks?`.

### `PUT /api/tasks/:id`
Обновляет задачу.

### `DELETE /api/tasks/:id`
Удаляет задачу (все связи в `content_task_links` удаляются каскадно).

## Features
Для модуля «дорожная карта» предусмотрены CRUD эндпоинты:
- `GET /api/features`
- `POST /api/features`
- `PUT /api/features/:id`
- `DELETE /api/features/:id`

## Content Plan
### `GET /api/content-plan`
Query: `month`, `year`. Ответ: `{ range, events, instagram, telegram }`.

### `POST /api/content-plan/:bucket`
Создание записи. `bucket`: `events | instagram | telegram`. Набор полей определяется таблицей (см. схему ниже). Доступ ограничен в соответствии с `CONTENT_PLAN_PERMISSIONS`.

### `PUT /api/content-plan/:bucket/:id`
Обновление записи.

### `DELETE /api/content-plan/:bucket/:id`
Удаление записи.

### Материалы публикаций
- `GET /api/content-plan/:bucket/:id/assets`
- `POST /api/content-plan/:bucket/:id/assets` — `{ title, url?, notes? }`
- `DELETE /api/content-plan/:bucket/:id/assets/:assetId`

### Связанные задачи
- `GET /api/content-plan/:bucket/:id/tasks`
- `POST /api/content-plan/:bucket/:id/tasks` — `{ taskId }`
- `DELETE /api/content-plan/:bucket/:id/tasks/:taskId`

## Авторизация и роли
- JWT хранится в localStorage (`inform_token_v1`).
- Роли: `super_admin`, `admin`, `content_manager`, `executor`. Доступ к отдельным эндпоинтам описан в `CONTENT_PLAN_PERMISSIONS` (см. `api/server.js`).

## Database Schema

### users
| column | type | notes |
| --- | --- | --- |
| id | bigserial PK | |
| last_name, first_name | text | обязательные |
| middle_name | text | optional |
| birth_date | text | формат `YYYY-MM-DD`, constraint `users_birth_date_check` |
| group_number | text | optional |
| login | text | unique |
| password | text | хранится в явном виде (в зависимости от роли) |
| position | text | optional |
| role | text | enum |
| created_at, updated_at | timestamptz | значения по умолчанию NOW() |

### tasks
| column | type | notes |
| --- | --- | --- |
| id | text PK | UUID/строка |
| payload | jsonb | все поля задачи (title, responsible, attachments, etc.) |
| created_at, updated_at | timestamptz | |

### features
| column | type | notes |
| --- | --- | --- |
| id | text PK | |
| payload | jsonb | данные фич/идей |
| created_at, updated_at | timestamptz | |

### events
| column | type | notes |
| --- | --- | --- |
| id | serial PK | |
| title | text | обязательное |
| description | text | optional |
| date | text | `YYYY-MM-DD` |
| time | text | `HH:MM` |
| location | text | optional |
| type | text | обязательное |
| created_at, updated_at | timestamptz | |

### content_instagram / content_telegram
| column | type | notes |
| --- | --- | --- |
| id | serial PK | |
| title, description | text | описание публикации |
| date | text | `YYYY-MM-DD` |
| time | text | `HH:MM`, шаг 30 минут |
| type | text | формат (пост/сторис/карусель/рилс) |
| status | text | `draft|ready|scheduled|published` |
| event_id | integer FK | `events.id`, ON DELETE SET NULL |
| created_at, updated_at | timestamptz | |

### content_task_links
| column | type | notes |
| --- | --- | --- |
| id | bigserial PK | |
| task_id | text FK | ON DELETE CASCADE |
| channel | text | `'instagram'` или `'telegram'` |
| content_id | integer | id записи в соответствующей таблице |
| created_at, updated_at | timestamptz | |
| unique task/channel/content | защищает от дубликатов |

### content_assets
| column | type | notes |
| --- | --- | --- |
| id | bigserial PK | |
| channel | text | `'instagram'` или `'telegram'` |
| content_id | integer | связан с публикацией |
| title | text | обязательное название |
| url | text | ссылка на файл/видео и т.д. |
| notes | text | комментарий |
| created_at, updated_at | timestamptz | |

### Дополнительно
- `CONTENT_PLAN_BUCKET_CONFIG` в `api/server.js` определяет, какие поля доступны для каждого bucket.
- `CONTENT_PLAN_PERMISSIONS` описывает роли, которые могут управлять соответствующими таблицами.
