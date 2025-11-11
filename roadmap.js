(() => {
  const STORAGE_KEYS = {
    votes: "inform_roadmap_votes",
    ideas: "inform_roadmap_ideas",
    features: "inform_roadmap_features",
  };

  const USER_STORAGE_KEY = "inform_user_v1";
  const TOKEN_STORAGE_KEY = "inform_token_v1";
  const SUPER_ADMIN_ROLE = "super_admin";

  const API_BASE_URL = globalThis.APP_API_BASE_URL || "/api";

  const STATUS_META = {
    in_progress: { label: "В работе", className: "status-chip status-in-progress", order: 0 },
    planned: { label: "Запланировано", className: "status-chip status-pending", order: 1 },
    research: { label: "Исследуем", className: "status-chip status-research", order: 2 },
    shipped: { label: "Выпущено", className: "status-chip status-done", order: 3 },
  };

  const votesState = loadVotes();
  const ideasState = loadIdeas();
  let featureState = [];
  let isLoadingFeatures = true;
  let featuresError = null;
  let authToken = loadStoredToken();
  let currentUser = loadStoredUser();
  let isAdmin = false;
  let editingFeatureId = null;

  const roadmapList = document.getElementById("roadmapList");
  const adminPanel = document.getElementById("adminPanel");
  const featureForm = document.getElementById("featureForm");
  const adminFeatureList = document.getElementById("adminFeatureList");
  const featureIdInput = document.getElementById("featureId");
  const featureSubmitBtn = document.getElementById("featureSubmitBtn");
  const featureCancelEditBtn = document.getElementById("featureCancelEditBtn");
  const featureStatusSelect = document.querySelector(".custom-select[data-select='feature-status']");
  let customSelectGlobalHandlersBound = false;

  init();

  function init() {
    renderHeroDate();
    renderStats();
    renderFeatures();
    bindVotes();
    bindAdminControls();
    bindAdminAccessWatcher();
    refreshAdminAccess();
    ensureFreshUserProfile();
    initFeatureStatusSelect();
    loadFeaturesFromServer();
  }

  function renderHeroDate() {
    const badge = document.getElementById("heroBadgeDate");
    if (!badge) return;
    badge.textContent = new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "long",
    }).format(new Date());
  }

  function renderStats() {
    const inProgress = featureState.filter((item) => item.status === "in_progress").length;
    const planned = featureState.filter((item) => item.status === "planned").length;
    const research = featureState.filter((item) => item.status === "research").length;
    document.getElementById("statInProgress").textContent = inProgress;
    document.getElementById("statPlanned").textContent = planned;
    const researchNode = document.getElementById("statResearch");
    if (researchNode) {
      researchNode.textContent = research;
    }
  }

  function renderFeatures() {
    if (!roadmapList) return;

    if (isLoadingFeatures) {
      roadmapList.innerHTML = `
        <div class="roadmap-empty">
          <h3>Загружаем фичи...</h3>
          <p>Подождите немного, данные подтягиваются из общей базы.</p>
        </div>
      `;
      return;
    }

    if (featuresError && !featureState.length) {
      roadmapList.innerHTML = `
        <div class="roadmap-empty">
          <h3>Не удалось загрузить фичи</h3>
          <p>${escapeHtml(featuresError)}</p>
          <button class="primary-btn" type="button" data-role="reload-features">Повторить</button>
        </div>
      `;
      const retryBtn = roadmapList.querySelector("[data-role='reload-features']");
      if (retryBtn) retryBtn.addEventListener("click", () => loadFeaturesFromServer());
      return;
    }

    if (!featureState.length) {
      roadmapList.innerHTML = `
        <div class="roadmap-empty">
          <h3>Пока нет ни одной фичи</h3>
          <p>Зайдите в режим администратора, чтобы добавить первую идею.</p>
        </div>
      `;
      if (isAdmin) {
        renderAdminFeatureList();
      }
      return;
    }

    const items = [...featureState].sort((a, b) => {
      const orderA = STATUS_META[a.status]?.order ?? 99;
      const orderB = STATUS_META[b.status]?.order ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return getVotes(b) - getVotes(a);
    });

    roadmapList.innerHTML = items
      .map((feature) => {
        const status = STATUS_META[feature.status];
        const voted = Boolean(votesState.choices[feature.id]);
        return `
        <article class="feature-card" data-id="${feature.id}">
          <div class="feature-card__head">
            <span class="${status?.className || "status-chip"}">${status?.label || "Статус"}</span>
            <span class="feature-card__eta">${escapeHtml(feature.eta || "TBA")}</span>
          </div>
          <h3>${escapeHtml(feature.title)}</h3>
          <p>${escapeHtml(feature.description)}</p>
          <div class="feature-card__meta">
            <span class="feature-card__category">${escapeHtml(feature.category || "Продукт")}</span>
            <div class="feature-card__tags">
              ${(feature.tags || [])
                .map((tag) => `<span class="feature-tag">${escapeHtml(tag)}</span>`)
                .join("")}
            </div>
          </div>
          <div class="feature-card__footer">
            <button
              class="vote-btn ${voted ? "vote-btn--active" : ""}"
              data-action="vote"
              data-id="${feature.id}"
            >
              ${voted ? "Вы голосовали" : "Поддержать"}
            </button>
            <span class="vote-count">
              ${getVotes(feature)} голос${pluralize(getVotes(feature))}
            </span>
          </div>
        </article>
      `;
      })
      .join("");

    if (isAdmin) {
      renderAdminFeatureList();
    }
  }

  function bindVotes() {
    if (!roadmapList) return;
    roadmapList.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-action='vote']");
      if (!btn) return;
      const featureId = btn.dataset.id;
      toggleVote(featureId);
      renderStats();
      renderFeatures();
    });
  }

  function toggleVote(featureId) {
    if (!featureId) return;
    const alreadyVoted = Boolean(votesState.choices[featureId]);
    votesState.counts[featureId] = votesState.counts[featureId] || 0;

    if (alreadyVoted) {
      votesState.counts[featureId] = Math.max(0, votesState.counts[featureId] - 1);
      delete votesState.choices[featureId];
    } else {
      votesState.counts[featureId] += 1;
      votesState.choices[featureId] = true;
    }

    persistVotes();
  }

  function bindAdminControls() {
    if (featureForm) {
      featureForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(featureForm);
        const title = formData.get("title")?.trim();
        const description = formData.get("description")?.trim();
        if (!title || !description) return;
        const payload = {
          title,
          description,
          status: formData.get("status")?.trim() || "planned",
          eta: formData.get("eta")?.trim() || "TBA",
          category: formData.get("category")?.trim() || "Категория",
          tags: (formData.get("tags") || "")
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          baseVotes: Number.isNaN(Number(formData.get("votes")))
            ? 0
            : Math.max(0, Number(formData.get("votes")) || 0),
        };
        const existingId = formData.get("featureId")?.trim();
        const originalLabel = featureSubmitBtn?.textContent;
        if (featureSubmitBtn) {
          featureSubmitBtn.disabled = true;
          featureSubmitBtn.textContent = existingId ? "Сохраняем..." : "Добавляем...";
        }
        try {
          if (existingId) {
            await handleFeatureUpdate(existingId, payload);
          } else {
            await handleFeatureCreate(payload);
          }
          resetFeatureEditor();
        } catch (error) {
          showErrorMessage(
            getErrorMessage(
              error,
              existingId ? "Не удалось обновить фичу" : "Не удалось создать фичу"
            )
          );
        } finally {
          if (featureSubmitBtn) {
            featureSubmitBtn.disabled = false;
            featureSubmitBtn.textContent = originalLabel || "Сохранить";
          }
        }
      });
    }



    if (featureCancelEditBtn) {

      featureCancelEditBtn.addEventListener("click", () => {

        resetFeatureEditor();

      });

    }



        if (adminFeatureList) {
      adminFeatureList.addEventListener("change", async (event) => {
        const select = event.target.closest("[data-role='status']");
        if (!select) return;
        const row = select.closest(".admin-feature-row");
        if (!row) return;
        const featureId = row.dataset.id;
        const prevStatus = featureState.find((item) => item.id === featureId)?.status || select.value;
        select.disabled = true;
        try {
          await updateFeatureStatus(featureId, select.value);
        } catch (error) {
          showErrorMessage(getErrorMessage(error, "Не удалось обновить статус фичи"));
          select.value = prevStatus;
        } finally {
          select.disabled = false;
        }
      });

      adminFeatureList.addEventListener("click", async (event) => {
        const editBtn = event.target.closest("[data-role='edit']");
        if (editBtn) {
          const row = editBtn.closest(".admin-feature-row");
          if (row) {
            startFeatureEdit(row.dataset.id);
          }
          return;
        }

        const removeBtn = event.target.closest("[data-role='remove']");
        if (!removeBtn) return;
        const row = removeBtn.closest(".admin-feature-row");
        if (!row) return;
        if (!confirm("Удалить фичу?")) return;
        try {
          await removeFeature(row.dataset.id);
        } catch (error) {
          showErrorMessage(getErrorMessage(error, "Не удалось удалить фичу"));
        }
      });
    }


    updateAdminUI();
  }

  function bindAdminAccessWatcher() {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    window.addEventListener("storage", (event) => {
      if (
        event &&
        event.key &&
        event.key !== USER_STORAGE_KEY &&
        event.key !== TOKEN_STORAGE_KEY
      ) {
        return;
      }
      refreshAdminAccess();
    });
  }

  function refreshAdminAccess() {
    const nextUser = loadStoredUser();
    const nextToken = loadStoredToken();
    const nextIsAdmin = canManageRoadmap(nextUser, nextToken);
    currentUser = nextUser;
    authToken = nextToken;
    if (!nextIsAdmin) {
      resetFeatureEditor();
    }
    if (nextIsAdmin !== isAdmin) {
      isAdmin = nextIsAdmin;
      updateAdminUI();
    } else if (!nextIsAdmin) {
      updateAdminUI();
    }
  }

  function ensureFreshUserProfile() {
    authToken = loadStoredToken();
    if (!authToken) {
      clearStoredUser();
      refreshAdminAccess();
      return;
    }
    requestJson("/auth/me", {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((payload) => {
        const user = payload?.user ?? null;
        if (user) {
          saveUserToStorage(user);
        } else {
          clearStoredUser();
        }
      })
      .catch((error) => {
        if (isUnauthorizedError(error)) {
          clearStoredSession();
        } else {
          console.warn("Не удалось обновить сведения о пользователе", error);
        }
      })
      .finally(() => refreshAdminAccess());
  }

  function updateAdminUI() {
    if (adminPanel) {
      adminPanel.hidden = !isAdmin;
    }
    renderAdminFeatureList();
  }

  function renderAdminFeatureList() {

    if (!isAdmin || !adminFeatureList) {

      if (adminFeatureList) adminFeatureList.innerHTML = "";

      return;

    }

    if (isLoadingFeatures) {
      adminFeatureList.innerHTML = "<p>Загружаем список...</p>";
      return;
    }

    if (featuresError) {
      adminFeatureList.innerHTML = `<p class="text-danger">${escapeHtml(featuresError)}</p>`;
      return;
    }

    if (!featureState.length) {
      adminFeatureList.innerHTML = "<p>Фич пока нет.</p>";
      return;
    }

    adminFeatureList.innerHTML = featureState

      .map(

        (feature) => `

        <div class="admin-feature-row" data-id="${feature.id}">

          <div class="admin-feature-row__info">

            <h4>${escapeHtml(feature.title)}</h4>

            <p>${escapeHtml(feature.category || "Категория")} • ${escapeHtml(feature.eta || "TBA")}</p>

          </div>

          <div class="admin-feature-row__controls">

            <select data-role="status">

              ${Object.entries(STATUS_META)

                .map(

                  ([value, meta]) =>

                    `<option value="${value}" ${feature.status === value ? "selected" : ""}>${meta.label}</option>`

                )

                .join("")}

            </select>

            <button class="ghost-btn" type="button" data-role="edit">Редактировать</button>

            <button class="ghost-btn" type="button" data-role="remove">Удалить</button>

          </div>

        </div>

      `

      )

      .join("");

  }



  function startFeatureEdit(featureId) {

    if (!featureForm || !featureId) return;

    const feature = featureState.find((item) => item.id === featureId);

    if (!feature) return;



    editingFeatureId = feature.id;

    if (featureIdInput) {

      featureIdInput.value = feature.id;

    }



    const controls = featureForm.elements;

    const setValue = (name, value = "") => {

      const control = controls.namedItem(name);

      if (control && "value" in control) {

        control.value = value;

      }

    };



    setValue("title", feature.title || "");

    setValue("description", feature.description || "");

    setValue("status", feature.status || "planned");
    syncFeatureStatusSelect(feature.status || "planned");

    setValue("eta", feature.eta || "TBA");

    setValue("category", feature.category || "");

    setValue(

      "tags",

      Array.isArray(feature.tags) ? feature.tags.join(", ") : feature.tags || ""

    );

    setValue("votes", String(typeof feature.baseVotes === "number" ? feature.baseVotes : 0));



    if (featureSubmitBtn) {

      featureSubmitBtn.textContent = "Сохранить изменения";

    }

    if (featureCancelEditBtn) {

      featureCancelEditBtn.hidden = false;

    }

    if (typeof featureForm.scrollIntoView === "function") {

      featureForm.scrollIntoView({ behavior: "smooth", block: "start" });

    }

  }



  function resetFeatureEditor() {

    if (!featureForm) return;

    featureForm.reset();
    syncFeatureStatusSelect("planned");

    editingFeatureId = null;

    if (featureIdInput) {

      featureIdInput.value = "";

    }

    if (featureSubmitBtn) {

      featureSubmitBtn.textContent = "Добавить фичу";

    }

    if (featureCancelEditBtn) {

      featureCancelEditBtn.hidden = true;

    }

  }

  function initFeatureStatusSelect() {
    if (!featureStatusSelect) return;
    initCustomSelect(featureStatusSelect, (value) => {
      const hiddenInput = featureStatusSelect.querySelector('input[name="status"]');
      if (hiddenInput) hiddenInput.value = value;
    });
    const currentValue =
      featureStatusSelect.dataset.value ||
      featureForm?.elements?.namedItem("status")?.value ||
      "planned";
    syncFeatureStatusSelect(currentValue);
  }

  function syncFeatureStatusSelect(value) {
    if (!featureStatusSelect) return;
    const optionNode = featureStatusSelect.querySelector(
      `.custom-select__option[data-value="${value}"]`
    );
    const label = optionNode ? optionNode.textContent.trim() : value;
    setCustomSelectValue(featureStatusSelect, value, label);
  }

  function initCustomSelect(selectEl, onChange) {
    if (!selectEl || selectEl.dataset.bound === "true") return;
    selectEl.dataset.bound = "true";
    const trigger = selectEl.querySelector(".custom-select__trigger");
    if (trigger) {
      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const alreadyOpen = selectEl.classList.contains("is-open");
        closeAllCustomSelects();
        if (!alreadyOpen) {
          openCustomSelect(selectEl);
        }
      });
    }

    selectEl.querySelectorAll(".custom-select__option").forEach((optionBtn) => {
      optionBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const value = optionBtn.dataset.value;
        const label = optionBtn.textContent.trim();
        setCustomSelectValue(selectEl, value, label);
        if (typeof onChange === "function") {
          onChange(value, label);
        }
        closeAllCustomSelects();
      });
    });

    ensureCustomSelectGlobalHandlers();
  }

  function ensureCustomSelectGlobalHandlers() {
    if (customSelectGlobalHandlersBound) return;
    customSelectGlobalHandlersBound = true;
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".custom-select")) {
        closeAllCustomSelects();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeAllCustomSelects();
      }
    });
  }

  function openCustomSelect(selectEl) {
    selectEl.classList.add("is-open");
    const trigger = selectEl.querySelector(".custom-select__trigger");
    if (trigger) trigger.setAttribute("aria-expanded", "true");
  }

  function closeAllCustomSelects() {
    document.querySelectorAll(".custom-select.is-open").forEach((selectEl) => {
      selectEl.classList.remove("is-open");
      const trigger = selectEl.querySelector(".custom-select__trigger");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  function setCustomSelectValue(selectEl, value, label) {
    if (!selectEl) return;
    selectEl.dataset.value = value;
    const valueNode = selectEl.querySelector(".custom-select__value");
    if (valueNode) valueNode.textContent = label;
    selectEl.querySelectorAll(".custom-select__option").forEach((optionNode) => {
      optionNode.classList.toggle("is-selected", optionNode.dataset.value === value);
    });
    const hiddenInput = selectEl.querySelector('input[type="hidden"]');
    if (hiddenInput) hiddenInput.value = value;
  }



  async function updateFeatureStatus(featureId, status) {
    if (!featureId) return;
    await handleFeatureUpdate(featureId, { status });
  }

  async function removeFeature(featureId) {
    if (!featureId) return;
    await handleFeatureDelete(featureId);
    if (editingFeatureId === featureId) {
      resetFeatureEditor();
    }
    delete votesState.counts[featureId];
    delete votesState.choices[featureId];
    persistVotes();
  }

  function getVotes(feature) {
    return (feature.baseVotes || 0) + (votesState.counts[feature.id] || 0);
  }

  function loadVotes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.votes);
      if (!raw) return { counts: {}, choices: {} };
      const parsed = JSON.parse(raw);
      return {
        counts: parsed.counts || {},
        choices: parsed.choices || {},
      };
    } catch {
      return { counts: {}, choices: {} };
    }
  }

  function persistVotes() {
    try {
      localStorage.setItem(STORAGE_KEYS.votes, JSON.stringify(votesState));
    } catch {
      /* ignore */
    }
  }

  function loadIdeas() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ideas);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function loadStoredUser() {
    try {
      const raw = localStorage.getItem(USER_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed ? parsed : null;
    } catch {
      return null;
    }
  }

  function saveUserToStorage(user) {
    try {
      if (user) {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(USER_STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
  }

  function clearStoredUser() {
    saveUserToStorage(null);
  }

  function loadStoredToken() {
    try {
      return localStorage.getItem(TOKEN_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  }

  function clearStoredToken() {
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  function clearStoredSession() {
    clearStoredToken();
    clearStoredUser();
  }

  function canManageRoadmap(user, token) {
    return Boolean(token && user && user.role === SUPER_ADMIN_ROLE);
  }

  async function loadFeaturesFromServer() {
    isLoadingFeatures = true;
    featuresError = null;
    renderFeatures();
    try {
      const remoteFeatures = await apiFetchFeatures();
      isLoadingFeatures = false;
      applyFeatureState(Array.isArray(remoteFeatures) ? remoteFeatures : []);
    } catch (error) {
      featuresError = getErrorMessage(error, "Не удалось загрузить фичи");
      isLoadingFeatures = false;
      renderFeatures();
    }
  }

  function applyFeatureState(nextFeatures) {
    featureState = nextFeatures;
    featuresError = null;
    renderStats();
    renderFeatures();
  }

  async function handleFeatureCreate(payload) {
    const created = await apiCreateFeature(payload);
    const next = [created, ...featureState.filter((item) => item.id !== created.id)];
    applyFeatureState(next);
    return created;
  }

  async function handleFeatureUpdate(featureId, updates) {
    const updated = await apiUpdateFeature(featureId, updates);
    applyFeatureState(
      featureState.map((feature) => (feature.id === updated.id ? updated : feature))
    );
    return updated;
  }

  async function handleFeatureDelete(featureId) {
    await apiDeleteFeature(featureId);
    applyFeatureState(featureState.filter((feature) => feature.id !== featureId));
  }

  async function apiFetchFeatures() {
    return requestJson("/features");
  }

  async function apiCreateFeature(payload) {
    return requestJson("/features", { method: "POST", body: payload });
  }

  async function apiUpdateFeature(featureId, updates) {
    return requestJson(`/features/${encodeURIComponent(featureId)}`, {
      method: "PUT",
      body: updates,
    });
  }

  async function apiDeleteFeature(featureId) {
    await requestJson(`/features/${encodeURIComponent(featureId)}`, { method: "DELETE" });
  }

  async function requestJson(endpoint, options = {}) {
    const url = buildApiUrl(endpoint);
    const config = {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    };
    if (options.body !== undefined) {
      config.headers["Content-Type"] = "application/json";
      config.body =
        typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }
    const response = await fetch(url, config);
    const text = await response.text();
    const payload = text ? safeJsonParse(text) : null;
    if (!response.ok) {
      const message =
        (payload && (payload.message || payload.error)) ||
        `Запрос завершился с ошибкой (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function buildApiUrl(pathname) {
    const base = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
    const suffix = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return `${base}${suffix}`;
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function enhanceError(error, fallback) {
    if (error instanceof Error) {
      if (!error.message && fallback) error.message = fallback;
      return error;
    }
    if (typeof error === "string") return new Error(error);
    if (error && typeof error === "object" && "message" in error && error.message) {
      return new Error(String(error.message));
    }
    return new Error(fallback || "Неизвестная ошибка");
  }

  function getErrorMessage(error, fallback) {
    return enhanceError(error, fallback).message;
  }

  function isUnauthorizedError(error) {
    return Boolean(error && typeof error === "object" && "status" in error && error.status === 401);
  }

  function showErrorMessage(message) {
    window.alert(message);
  }

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function pluralize(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return "";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "а";
    return "ов";
  }
})();
