(() => {
  const STORAGE_KEYS = {
    user: "inform_user_v1",
    token: "inform_token_v1",
  };
  const API_BASE_URL = globalThis.APP_API_BASE_URL || "/api";

  const ROLE_LABELS = {
    super_admin: "Супер-админ",
    admin: "Админ",
    content_manager: "Контент-менеджер",
    executor: "Исполнитель",
  };

  const tableRoot = document.getElementById("teamTableRoot");
  const modalRoot = document.getElementById("teamModalRoot");
  const addUserBtn = document.getElementById("openCreateUserBtn");
  const logoutBtn = document.querySelector("[data-action='logout']");

  let currentUser = null;
  let authToken = null;
  let usersState = [];
  let isLoading = true;
  let loadError = "";
  const passwordVisibility = new Set();
  let openedActionMenuId = null;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    restoreSession();
    bindEventListeners();
    if (!authToken) {
      redirectToLogin();
      return;
    }
    fetchCurrentUser()
      .then(() => {
        updateControlsVisibility();
        return loadUsers();
      })
      .catch((error) => {
        console.error("Не удалось загрузить профиль", error);
        redirectToLogin();
      });
  }

  function bindEventListeners() {
    if (addUserBtn) {
      addUserBtn.addEventListener("click", () => openUserModal("create"));
    }
    if (logoutBtn) {
      logoutBtn.addEventListener("click", (event) => {
        event.preventDefault();
        handleLogout();
      });
    }
    tableRoot?.addEventListener("click", handleTableClick);
    document.addEventListener("click", handleDocumentClick);
  }

  function handleTableClick(event) {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const userId = action.dataset.userId;
    switch (action.dataset.action) {
      case "toggle-password":
        togglePassword(userId);
        break;
      case "toggle-actions":
        toggleActionMenu(userId, action);
        break;
      case "edit-user":
        closeActionMenu();
        openUserModal("edit", getUserById(userId));
        break;
      case "delete-user":
        closeActionMenu();
        confirmDeleteUser(getUserById(userId));
        break;
      case "reset-password":
        closeActionMenu();
        resetUserPassword(getUserById(userId));
        break;
      case "change-role":
        closeActionMenu();
        openRoleModal(getUserById(userId));
        break;
      case "open-create-inline":
        openUserModal("create");
        break;
      case "retry-load":
        loadUsers();
        break;
      default:
        break;
    }
  }

  function handleDocumentClick(event) {
    if (!openedActionMenuId) return;
    const menu = tableRoot?.querySelector(`[data-menu-id="${openedActionMenuId}"]`);
    if (!menu) return;
    if (menu.contains(event.target)) return;
    const toggleBtn = tableRoot?.querySelector(
      `[data-action="toggle-actions"][data-user-id="${openedActionMenuId}"]`
    );
    if (toggleBtn && toggleBtn.contains(event.target)) return;
    closeActionMenu();
  }

  function togglePassword(userId) {
    if (!userId) return;
    if (passwordVisibility.has(userId)) {
      passwordVisibility.delete(userId);
    } else {
      passwordVisibility.add(userId);
    }
    renderUsers();
  }

  function toggleActionMenu(userId, triggerBtn) {
    if (!userId) return;
    if (openedActionMenuId === userId) {
      closeActionMenu();
      return;
    }
    closeActionMenu();
    const menu = tableRoot?.querySelector(`[data-menu-id="${userId}"]`);
    if (menu) {
      menu.hidden = false;
      openedActionMenuId = userId;
      triggerBtn?.setAttribute("aria-expanded", "true");
    }
  }

  function closeActionMenu() {
    if (!openedActionMenuId) return;
    const prevMenu = tableRoot?.querySelector(`[data-menu-id="${openedActionMenuId}"]`);
    if (prevMenu) prevMenu.hidden = true;
    const triggerBtn = tableRoot?.querySelector(
      `[data-action="toggle-actions"][data-user-id="${openedActionMenuId}"]`
    );
    triggerBtn?.setAttribute("aria-expanded", "false");
    openedActionMenuId = null;
  }

  function restoreSession() {
    authToken = safeStorageGet(STORAGE_KEYS.token);
    try {
      currentUser = JSON.parse(safeStorageGet(STORAGE_KEYS.user) || "null");
    } catch {
      currentUser = null;
    }
  }

  async function fetchCurrentUser() {
    const payload = await requestJson("/auth/me");
    currentUser = payload?.user ?? null;
    if (currentUser) {
      safeStorageSet(STORAGE_KEYS.user, JSON.stringify(currentUser));
    } else {
      safeStorageRemove(STORAGE_KEYS.user);
    }
    return currentUser;
  }

  function updateControlsVisibility() {
    if (!addUserBtn) return;
    addUserBtn.hidden = !canCurrentUserManageUsers();
  }

  async function loadUsers() {
    isLoading = true;
    loadError = "";
    renderUsers();
    try {
      const payload = await requestJson("/users");
      usersState = Array.isArray(payload?.users) ? payload.users : [];
      isLoading = false;
      renderUsers();
    } catch (error) {
      isLoading = false;
      loadError = getErrorMessage(error, "Не удалось загрузить пользователей");
      renderUsers();
    }
  }

  function renderUsers() {
    if (!tableRoot) return;
    if (isLoading) {
      tableRoot.innerHTML = `
        <div class="empty-state">
          <h3>Загружаем команду...</h3>
          <p>Пожалуйста, подождите пару секунд.</p>
        </div>
      `;
      return;
    }
    if (loadError) {
      tableRoot.innerHTML = `
        <div class="empty-state empty-state--error">
          <h3>Не удалось загрузить список</h3>
          <p>${escapeHtml(loadError)}</p>
          <button class="primary-btn" type="button" data-action="retry-load">Повторить</button>
        </div>
      `;
      return;
    }
    if (!usersState.length) {
      tableRoot.innerHTML = `
        <div class="empty-state">
          <h3>В базе пока нет пользователей</h3>
          <p>Добавьте первого участника, чтобы начать работу.</p>
          ${
            canCurrentUserManageUsers()
              ? `<button class="primary-btn" type="button" data-action="open-create-inline">Добавить</button>`
              : ""
          }
        </div>
      `;
      const inlineBtn = tableRoot.querySelector("[data-action='open-create-inline']");
      if (inlineBtn) inlineBtn.addEventListener("click", () => openUserModal("create"));
      return;
    }
    if (isPrivilegedView()) {
      renderFullTable();
    } else {
      renderCompactTable();
    }
  }

  function renderFullTable() {
    const rowsHtml = usersState
      .map((user) => {
        const canManage = canManageRole(user.role);
        const canSeePassword = canViewUserPassword(user);
        const showPassword = canSeePassword && passwordVisibility.has(String(user.id));
        const passwordValue =
          canSeePassword && showPassword && user.password
            ? escapeHtml(user.password)
            : "••••••";
        return `
          <tr>
            <td>${escapeHtml(String(user.id))}</td>
            <td>${escapeHtml(user.lastName || "—")}</td>
            <td>${escapeHtml(user.firstName || "—")}</td>
            <td>${escapeHtml(user.middleName || "—")}</td>
            <td>${escapeHtml(user.groupNumber || "—")}</td>
            <td>${escapeHtml(user.birthDate || "—")}</td>
            <td>${escapeHtml(user.login || "—")}</td>
            <td class="team-table__password">
              <span>${passwordValue}</span>
              ${
                canSeePassword && user.password
                  ? `<button class="ghost-btn ghost-btn--inline" type="button" data-action="toggle-password" data-user-id="${user.id}">
                      ${showPassword ? "Скрыть" : "Показать"}
                    </button>`
                  : ""
              }
            </td>
            <td>${escapeHtml(user.position || "—")}</td>
            <td>${escapeHtml(ROLE_LABELS[user.role] || user.role)}</td>
            <td class="team-table__actions">
              ${
                canManage
                  ? renderActionMenu(user.id, [
                      { action: "edit-user", label: "✏️ Редактировать" },
                      { action: "reset-password", label: "♻ Сбросить пароль" },
                      { action: "change-role", label: "🔄 Изменить роль" },
                      { action: "delete-user", label: "🗑 Удалить", danger: true },
                    ])
                  : ""
              }
            </td>
          </tr>
        `;
      })
      .join("");

    tableRoot.innerHTML = `
      <div class="table-scroll">
        <table class="team-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Фамилия</th>
              <th>Имя</th>
              <th>Отчество</th>
              <th>Группа</th>
              <th>Дата рождения</th>
              <th>Логин</th>
              <th>Пароль</th>
              <th>Должность</th>
              <th>Роль</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  }

  function renderCompactTable() {
    const rowsHtml = usersState
      .map(
        (user) => `
        <tr>
          <td>${escapeHtml(user.lastName || "—")}</td>
          <td>${escapeHtml(user.firstName || "—")}</td>
          <td>${escapeHtml(user.position || "—")}</td>
        </tr>
      `
      )
      .join("");
    tableRoot.innerHTML = `
      <div class="table-scroll">
        <table class="team-table team-table--compact">
          <thead>
            <tr>
              <th>Фамилия</th>
              <th>Имя</th>
              <th>Должность</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  }

  function renderActionMenu(userId, items) {
    const buttons = items
      .map(
        (item) => `
        <button
          type="button"
          class="team-action__item ${item.danger ? "team-action__item--danger" : ""}"
          data-action="${item.action}"
          data-user-id="${userId}"
        >
          ${item.label}
        </button>
      `
      )
      .join("");
    return `
      <div class="team-action">
        <button
          class="icon-btn"
          type="button"
          aria-haspopup="true"
          aria-expanded="false"
          data-action="toggle-actions"
          data-user-id="${userId}"
        >
          ⚙
        </button>
        <div class="team-action__menu" data-menu-id="${userId}" hidden>
          ${buttons}
        </div>
      </div>
    `;
  }

  function openUserModal(mode, user = null) {
    if (!modalRoot || !canCurrentUserManageUsers()) return;
    if (mode === "edit" && !user) return;
    const assignableRoles = getAssignableRoles(currentUser?.role);
    if (!assignableRoles.length) return;
    const isEdit = mode === "edit";
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true">
        <header class="modal-card__header">
          <h2>${isEdit ? "Редактировать пользователя" : "Добавить пользователя"}</h2>
          <button class="icon-btn" type="button" data-role="close-modal" aria-label="Закрыть">✕</button>
        </header>
        <form class="modal-form" data-mode="${mode}">
          <div class="form-group">
            <label>Фамилия*</label>
            <input name="lastName" required value="${escapeHtmlInput(user?.lastName)}" />
          </div>
          <div class="form-group">
            <label>Имя*</label>
            <input name="firstName" required value="${escapeHtmlInput(user?.firstName)}" />
          </div>
          <div class="form-group">
            <label>Отчество</label>
            <input name="middleName" value="${escapeHtmlInput(user?.middleName)}" />
          </div>
          <div class="form-group">
            <label>Группа</label>
            <input name="groupNumber" value="${escapeHtmlInput(user?.groupNumber)}" />
          </div>
          <div class="form-group">
            <label>Дата рождения</label>
            <input name="birthDate" type="date" value="${escapeHtmlInput(user?.birthDate)}" />
          </div>
          <div class="form-group">
            <label>Логин*</label>
            <input name="login" required value="${escapeHtmlInput(user?.login)}" />
          </div>
          ${
            isEdit
              ? ""
              : `
          <div class="form-group form-group--inline">
            <label>Пароль*</label>
            <div class="form-group__password">
              <input name="password" required minlength="6" placeholder="Автогенерация" />
              <button type="button" class="ghost-btn" data-role="generate-password">Сгенерировать</button>
            </div>
          </div>`
          }
          <div class="form-group">
            <label>Должность</label>
            <input name="position" value="${escapeHtmlInput(user?.position)}" />
          </div>
          <div class="form-group">
            <label>Роль*</label>
            <select name="role" required>
              ${assignableRoles
                .map(
                  (role) => `
                    <option value="${role}" ${role === user?.role ? "selected" : ""}>
                      ${ROLE_LABELS[role] || role}
                    </option>
                  `
                )
                .join("")}
            </select>
          </div>
          <p class="form-error" data-role="form-error"></p>
          <div class="modal-card__footer">
            <button class="ghost-btn" type="button" data-role="cancel-modal">Отмена</button>
            <button class="primary-btn" type="submit">${isEdit ? "Сохранить" : "Добавить"}</button>
          </div>
        </form>
      </div>
    `;
    modalRoot.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add("is-visible"));

    const closeButtons = modal.querySelectorAll(
      "[data-role='close-modal'], [data-role='cancel-modal']"
    );
    closeButtons.forEach((btn) => btn.addEventListener("click", () => closeModal(modal)));

    const form = modal.querySelector("form");
    const errorNode = modal.querySelector("[data-role='form-error']");
    const submitBtn = form?.querySelector("button[type='submit']");
    const passwordBtn = modal.querySelector("[data-role='generate-password']");
    if (passwordBtn) {
      passwordBtn.addEventListener("click", () => {
        const target = modal.querySelector("input[name='password']");
        if (target) {
          target.value = generatePassword();
          target.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
    }

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form) return;
      errorNode.textContent = "";
      submitBtn.disabled = true;
      try {
        const formData = new FormData(form);
        const payload = collectUserPayload(formData, { includePassword: !isEdit });
        if (isEdit) {
          await requestJson(`/users/${encodeURIComponent(user.id)}`, {
            method: "PUT",
            body: payload,
          });
        } else {
          await requestJson("/users", { method: "POST", body: payload });
        }
        closeModal(modal);
        loadUsers();
      } catch (error) {
        errorNode.textContent = getErrorMessage(
          error,
          isEdit ? "Не удалось обновить пользователя" : "Не удалось создать пользователя"
        );
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  function openRoleModal(user) {
    if (!modalRoot || !user || !canCurrentUserManageUsers() || !canManageRole(user.role)) return;
    const assignableRoles = getAssignableRoles(currentUser?.role);
    if (!assignableRoles.length) return;
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true">
        <header class="modal-card__header">
          <h2>Изменить роль</h2>
          <button class="icon-btn" type="button" data-role="close-modal" aria-label="Закрыть">✕</button>
        </header>
        <form class="modal-form">
          <div class="form-group">
            <label>Роль для ${escapeHtml(user.firstName || user.login || "пользователя")}</label>
            <select name="role" required>
              ${assignableRoles
                .map(
                  (role) => `
                    <option value="${role}" ${role === user.role ? "selected" : ""}>
                      ${ROLE_LABELS[role] || role}
                    </option>
                  `
                )
                .join("")}
            </select>
          </div>
          <p class="form-error" data-role="form-error"></p>
          <div class="modal-card__footer">
            <button class="ghost-btn" type="button" data-role="cancel-modal">Отмена</button>
            <button class="primary-btn" type="submit">Сохранить</button>
          </div>
        </form>
      </div>
    `;
    modalRoot.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add("is-visible"));
    modal
      .querySelectorAll("[data-role='close-modal'], [data-role='cancel-modal']")
      .forEach((btn) => btn.addEventListener("click", () => closeModal(modal)));
    const form = modal.querySelector("form");
    const errorNode = modal.querySelector("[data-role='form-error']");
    const submitBtn = form?.querySelector("button[type='submit']");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const nextRole = formData.get("role");
      if (!nextRole || nextRole === user.role) {
        closeModal(modal);
        return;
      }
      submitBtn.disabled = true;
      try {
        await requestJson(`/users/${encodeURIComponent(user.id)}`, {
          method: "PUT",
          body: { role: nextRole },
        });
        closeModal(modal);
        loadUsers();
      } catch (error) {
        errorNode.textContent = getErrorMessage(error, "Не удалось изменить роль");
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  function collectUserPayload(formData, options = {}) {
    const includePassword = Boolean(options.includePassword);
    const payload = {
      lastName: formData.get("lastName")?.trim(),
      firstName: formData.get("firstName")?.trim(),
      middleName: formData.get("middleName")?.trim(),
      groupNumber: formData.get("groupNumber")?.trim(),
      birthDate: formData.get("birthDate")?.trim(),
      login: formData.get("login")?.trim(),
      position: formData.get("position")?.trim(),
      role: formData.get("role"),
    };
    if (payload.middleName === "") payload.middleName = null;
    if (payload.groupNumber === "") payload.groupNumber = null;
    if (payload.birthDate === "") payload.birthDate = null;
    if (payload.position === "") payload.position = null;
    if (includePassword) {
      payload.password = formData.get("password")?.trim();
    }
    return payload;
  }

  function confirmDeleteUser(user) {
    if (!user) return;
    if (!window.confirm(`Удалить пользователя ${user.firstName || user.login || ""}?`)) {
      return;
    }
    requestJson(`/users/${encodeURIComponent(user.id)}`, { method: "DELETE" })
      .then(() => loadUsers())
      .catch((error) => {
        window.alert(getErrorMessage(error, "Не удалось удалить пользователя"));
      });
  }

  function resetUserPassword(user) {
    if (!user) return;
    requestJson(`/users/${encodeURIComponent(user.id)}/reset-password`, { method: "POST" })
      .then((payload) => {
        loadUsers();
        const newPassword = payload?.password;
        if (newPassword) {
          window.alert(`Новый пароль пользователя: ${newPassword}`);
        } else {
          window.alert("Пароль сброшен");
        }
      })
      .catch((error) => {
        window.alert(getErrorMessage(error, "Не удалось сбросить пароль"));
      });
  }

  function closeModal(node) {
    if (!node) return;
    node.classList.remove("is-visible");
    setTimeout(() => node.remove(), 150);
  }

  function getUserById(userId) {
    if (!userId) return null;
    return usersState.find((user) => String(user.id) === String(userId)) || null;
  }

  function canCurrentUserManageUsers() {
    return currentUser?.role === "super_admin" || currentUser?.role === "admin";
  }

  function isPrivilegedView() {
    return canCurrentUserManageUsers();
  }

  function canManageRole(targetRole) {
    if (!currentUser) return false;
    if (currentUser.role === "super_admin") return true;
    if (currentUser.role === "admin") {
      return targetRole === "content_manager" || targetRole === "executor";
    }
    return false;
  }

  function canViewUserPassword(user) {
    if (!currentUser) return false;
    if (currentUser.role === "super_admin") return true;
    if (currentUser.role === "admin") {
      return user.role !== "super_admin";
    }
    return false;
  }

  function getAssignableRoles(role) {
    if (role === "super_admin") {
      return ["super_admin", "admin", "content_manager", "executor"];
    }
    if (role === "admin") {
      return ["content_manager", "executor"];
    }
    return [];
  }

  function handleLogout() {
    clearStoredSession();
    redirectToLogin();
  }

  function redirectToLogin() {
    window.location.href = "index.html";
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

  function requestJson(endpoint, options = {}) {
    const url = buildApiUrl(endpoint);
    const config = {
      method: options.method || "GET",
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    };
    if (authToken) {
      config.headers.Authorization = `Bearer ${authToken}`;
    }
    if (options.body !== undefined) {
      config.headers["Content-Type"] = "application/json";
      config.body = JSON.stringify(options.body);
    }
    return fetch(url, config).then(async (response) => {
      const text = await response.text();
      const payload = text ? safeJsonParse(text) : null;
      if (!response.ok) {
        if (response.status === 401) {
          handleUnauthorized();
          return Promise.reject(new Error("Требуется повторный вход"));
        }
        const message =
          (payload && (payload.message || payload.error)) ||
          `Запрос завершился с ошибкой (${response.status})`;
        const error = new Error(message);
        error.status = response.status;
        return Promise.reject(error);
      }
      return payload;
    });
  }

  function handleUnauthorized() {
    clearStoredSession();
    redirectToLogin();
  }

  function buildApiUrl(pathname) {
    const base = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
    const suffix = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return `${base}${suffix}`;
  }

  function safeStorageGet(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* ignore */
    }
  }

  function safeStorageRemove(key) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  function clearStoredSession() {
    safeStorageRemove(STORAGE_KEYS.token);
    safeStorageRemove(STORAGE_KEYS.user);
    authToken = null;
    currentUser = null;
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function getErrorMessage(error, fallback) {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error) return error;
    if (error && typeof error === "object" && "message" in error) {
      return String(error.message);
    }
    return fallback || "Неизвестная ошибка";
  }

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeHtmlInput(value = "") {
    return escapeHtml(value || "");
  }
})();
