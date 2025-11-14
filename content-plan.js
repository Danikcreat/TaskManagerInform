
(() => {
  const STORAGE_KEYS = {
    user: "inform_user_v1",
    token: "inform_token_v1",
  };

  const API_BASE_URL = globalThis.APP_API_BASE_URL || "/api";

  const TABS = [
    { id: "events", label: "Мероприятия" },
    { id: "instagram", label: "КП Инста" },
    { id: "telegram", label: "КП Телега" },
  ];

  const TAB_BADGE_CLASS = {
    events: "chip--events",
    instagram: "chip--instagram",
    telegram: "chip--telegram",
  };

  const ROLE_PERMISSIONS = {
    events: new Set(["super_admin", "admin"]),
    instagram: new Set(["super_admin", "admin", "content_manager"]),
    telegram: new Set(["super_admin", "admin", "content_manager"]),
  };

  const CONTENT_STATUSES = [
    { value: "draft", label: "Черновик" },
    { value: "ready", label: "Готово" },
    { value: "scheduled", label: "Запланировано" },
    { value: "published", label: "Опубликовано" },
  ];

  const CONTENT_TYPE_OPTIONS = [
    { value: "Пост", label: "Пост" },
    { value: "Карусель", label: "Карусель" },
    { value: "Сторис", label: "Сторис" },
    { value: "Рилс", label: "Рилс" },
  ];

  const TASK_PRIORITY_OPTIONS = [
    { value: "high", label: "Высокий" },
    { value: "medium", label: "Средний" },
    { value: "low", label: "Низкий" },
  ];

  const TASK_STATUS_OPTIONS = [
    { value: "pending", label: "В ожидании" },
    { value: "in_progress", label: "В работе" },
    { value: "done", label: "Готово" },
  ];

  const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const TODAY_ISO = formatISODate(new Date());

  const now = new Date();
  const initialYear = now.getFullYear();
  const initialMonth = now.getMonth();

  const state = {
    tab: TABS[0].id,
    year: initialYear,
    month: initialMonth,
    selectedDate: TODAY_ISO,
    data: {
      events: [],
      instagram: [],
      telegram: [],
    },
    range: null,
    loading: false,
    error: "",
    user: loadStoredUser(),
    token: loadStoredToken(),
    extras: new Map(),
  };

  const refs = {
    tabs: document.querySelector(".content-plan__tabs"),
    calendar: document.getElementById("calendarGrid"),
    monthLabel: document.getElementById("monthLabel"),
    list: document.getElementById("monthList"),
    selectedDayLabel: document.getElementById("selectedDayLabel"),
    selectedDayList: document.getElementById("selectedDayList"),
    addBtn: document.getElementById("addEntryBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    error: document.getElementById("contentPlanError"),
    userChip: document.getElementById("userChip"),
  };

  init();

  function init() {
    ensureModalRoot();
    bindUI();
    renderAll();
    ensureFreshUserProfile();
    loadMonthData();
  }

  function bindUI() {
    if (refs.tabs) {
      refs.tabs.addEventListener("click", (event) => {
        const btn = event.target.closest(".content-plan__tab");
        if (!btn) return;
        const tab = btn.dataset.tab;
        if (tab && tab !== state.tab) {
          state.tab = tab;
          renderAll();
        }
      });
    }

    document.querySelectorAll("[data-role='month-prev']").forEach((btn) => {
      btn.addEventListener("click", () => changeMonth(-1));
    });
    document.querySelectorAll("[data-role='month-next']").forEach((btn) => {
      btn.addEventListener("click", () => changeMonth(1));
    });

    if (refs.refreshBtn) {
      refs.refreshBtn.addEventListener("click", () => loadMonthData());
    }

    if (refs.addBtn) {
      refs.addBtn.addEventListener("click", () => {
        if (!canMutateActiveTab()) return;
        openEditorModal("create");
      });
    }

    if (refs.calendar) {
      refs.calendar.addEventListener("click", (event) => {
        const chip = event.target.closest(".calendar-chip");
        if (chip) {
          const item = findItemById(chip.dataset.id, state.tab);
          if (item) {
            openDetailsModal(item);
          }
          event.stopPropagation();
          return;
        }
        const dayBtn = event.target.closest(".calendar-day");
        if (dayBtn && dayBtn.dataset.date) {
          state.selectedDate = dayBtn.dataset.date;
          renderSidebar();
          renderCalendar();
        }
      });
    }

    if (refs.list) {
      refs.list.addEventListener("click", (event) => {
        const card = event.target.closest(".content-plan-card");
        if (!card) return;
        const id = card.dataset.id;
        const date = card.dataset.date;
        if (event.target.closest("[data-role='card-details']")) {
          const item = findItemById(id, state.tab);
          if (item) openDetailsModal(item);
          return;
        }
        if (date) {
          state.selectedDate = date;
          renderSidebar();
          renderCalendar();
        }
      });
    }

    if (refs.selectedDayList) {
      refs.selectedDayList.addEventListener("click", (event) => {
        const card = event.target.closest(".day-card");
        if (!card) return;
        const id = card.dataset.id;
        const toggleBtn = event.target.closest("[data-role='toggle-card']");
        if (toggleBtn) {
          const body = card.querySelector(".day-card__body");
          if (body) {
            const nextHidden = !body.hidden;
            body.hidden = nextHidden;
            toggleBtn.setAttribute("aria-expanded", String(!nextHidden));
            card.classList.toggle("is-expanded", !nextHidden);
          }
          return;
        }
        if (event.target.closest("[data-role='detail']")) {
          const item = findItemById(id, state.tab);
          if (item) openDetailsModal(item);
          return;
        }
        if (event.target.closest("[data-role='edit']")) {
          const item = findItemById(id, state.tab);
          if (item && canMutateActiveTab()) {
            openEditorModal("edit", item);
          }
        }
      });
    }

    window.addEventListener("storage", (event) => {
      if (!event || !event.key) return;
      if (event.key === STORAGE_KEYS.user || event.key === STORAGE_KEYS.token) {
        refreshAuthState();
      }
    });
  }

  function changeMonth(delta) {
    let nextMonth = state.month + delta;
    let nextYear = state.year;
    if (nextMonth < 0) {
      nextMonth = 11;
      nextYear -= 1;
    } else if (nextMonth > 11) {
      nextMonth = 0;
      nextYear += 1;
    }
    state.month = nextMonth;
    state.year = nextYear;
    state.selectedDate = formatISODate(new Date(nextYear, nextMonth, 1));
    renderMonthLabel();
    renderCalendar();
    renderList();
    renderSidebar();
    loadMonthData();
  }

  async function loadMonthData(options = {}) {
    const silent = Boolean(options.silent);
    state.error = "";
    if (!silent) {
      state.loading = true;
      renderCalendar();
      renderList();
    }
    const params = new URLSearchParams({
      month: String(state.month + 1),
      year: String(state.year),
    });
    try {
      const payload = await requestJson(`/content-plan?${params.toString()}`, { auth: false });
      state.data.events = mapCollection(payload?.events, "events");
      state.data.instagram = mapCollection(payload?.instagram, "instagram");
      state.data.telegram = mapCollection(payload?.telegram, "telegram");
      state.range = payload?.range || null;
    } catch (error) {
      state.error = getErrorMessage(error, "Не удалось загрузить контент-план.");
      if (error.status === 401) {
        clearStoredSession();
        refreshAuthState();
      }
    } finally {
      state.loading = false;
      renderAll();
    }
  }

  function mapCollection(items, fallbackChannel) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
      id: String(item.id),
      title: item.title || "Без названия",
      description: item.description || "",
      date: item.date,
      time: item.time || "",
      type: item.type || "",
      status: item.status || "",
      location: item.location || "",
      eventId: item.eventId || null,
      channel: item.channel || fallbackChannel || state.tab,
    }));
  }

  function renderAll() {
    renderUserChip();
    renderTabs();
    renderMonthLabel();
    renderError();
    renderCalendar();
    renderList();
    renderSidebar();
    updateAddButton();
  }

  function renderTabs() {
    if (!refs.tabs) return;
    refs.tabs.querySelectorAll(".content-plan__tab").forEach((btn) => {
      const isActive = btn.dataset.tab === state.tab;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  function renderMonthLabel() {
    if (!refs.monthLabel) return;
    const date = new Date(state.year, state.month, 1);
    const formatted = new Intl.DateTimeFormat("ru-RU", {
      month: "long",
      year: "numeric",
    }).format(date);
    refs.monthLabel.textContent = capitalize(formatted.replace(" г.", ""));
  }

  function renderError() {
    if (!refs.error) return;
    refs.error.textContent = state.error || "";
    refs.error.hidden = !state.error;
  }

  function renderCalendar() {
    if (!refs.calendar) return;
    if (state.loading) {
      refs.calendar.innerHTML = `<div class="content-plan__placeholder">Загружаем календарь...</div>`;
      return;
    }
    const days = buildCalendarDays(state.year, state.month);
    const weekdayRow = WEEKDAYS.map(
      (label) => `<div class="calendar-grid__weekday" aria-hidden="true">${label}</div>`
    ).join("");
    const dayCells = days
      .map((day) => {
        const classes = ["calendar-day"];
        if (!day.currentMonth) classes.push("is-muted");
        if (day.isToday) classes.push("is-today");
        if (day.isSelected) classes.push("is-selected");
        return `
          <button class="${classes.join(" ")}" type="button" data-date="${day.iso}">
            <span class="calendar-day__number">${day.day}</span>
            <div class="calendar-day__chips">
              ${renderDayChips(day.items)}
            </div>
          </button>
        `;
      })
      .join("");
    refs.calendar.innerHTML = weekdayRow + dayCells;
  }

  function buildCalendarDays(year, month) {
    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
    const startDate = new Date(year, month, 1 - startOffset);
    const result = [];
    for (let i = 0; i < totalCells; i += 1) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      const iso = formatISODate(date);
      result.push({
        iso,
        day: date.getDate(),
        currentMonth: date.getMonth() === month,
        isToday: iso === TODAY_ISO,
        isSelected: iso === state.selectedDate,
        items: getItemsByDate(iso, state.tab),
      });
    }
    return result;
  }

  function renderDayChips(items) {
    if (!items.length) return "";
    const visible = items.slice(0, 3);
    const chips = visible
      .map(
        (item) => `
          <span class="calendar-chip ${TAB_BADGE_CLASS[item.channel] || ""}" data-id="${item.id}">
            ${escapeHtml(item.title)}
          </span>
        `
      )
      .join("");
    const extra =
      items.length > visible.length
        ? `<span class="calendar-chip calendar-chip__more">+${items.length - visible.length}</span>`
        : "";
    return chips + extra;
  }

  function renderList() {
    if (!refs.list) return;
    if (state.loading) {
      refs.list.innerHTML = `<div class="content-plan__placeholder">Обновляем список...</div>`;
      return;
    }
    const items = getSortedItems(state.tab);
    if (!items.length) {
      refs.list.innerHTML = `
        <div class="content-plan__empty">
          <p>На этот месяц еще нет записей.</p>
          ${canMutateActiveTab() ? "<p>Выберите день и добавьте первую запись.</p>" : ""}
        </div>
      `;
      return;
    }
    refs.list.innerHTML = items
      .map((item) => {
        const weekday = formatWeekday(item.date);
        const badgeClass = TAB_BADGE_CLASS[item.channel] || "";
        return `
          <article class="content-plan-card" data-id="${item.id}" data-date="${item.date}">
            <div class="content-plan-card__date">
              <span>${formatDay(item.date)}</span>
              <small>${weekday}</small>
            </div>
            <div class="content-plan-card__body">
              <p class="content-plan-card__title">${escapeHtml(item.title)}</p>
              <p class="content-plan-card__meta">${formatMeta(item)}</p>
              <div class="content-plan-card__tags">
                ${item.type ? `<span class="tag-pill ${badgeClass}">${escapeHtml(item.type)}</span>` : ""}
                ${renderStatusTag(item)}
              </div>
            </div>
            <button class="ghost-btn" type="button" data-role="card-details">Подробнее</button>
          </article>
        `;
      })
      .join("");
  }

  function renderSidebar() {
    if (!refs.selectedDayLabel || !refs.selectedDayList) return;
    refs.selectedDayLabel.textContent = formatFullDate(state.selectedDate);
    const items = getItemsByDate(state.selectedDate, state.tab).sort(compareItems);
    if (!items.length) {
      refs.selectedDayList.innerHTML = `
        <div class="content-plan__empty">
          <p>Нет записей на эту дату.</p>
          ${
            canMutateActiveTab()
              ? "<p>Используйте кнопку «+», чтобы добавить мероприятие или публикацию.</p>"
              : ""
          }
        </div>
      `;
      return;
    }
    refs.selectedDayList.innerHTML = items
      .map((item, index) => {
        const expanded = index === 0;
        return `
          <article class="day-card ${expanded ? "is-expanded" : ""}" data-id="${item.id}">
            <header class="day-card__header">
              <div>
                <p class="day-card__title">${escapeHtml(item.title)}</p>
                <p class="day-card__meta">${formatMeta(item)}</p>
              </div>
              <button
                class="ghost-icon-btn"
                type="button"
                data-role="toggle-card"
                aria-expanded="${expanded}"
                aria-label="Показать подробности"
              >
                ˅
              </button>
            </header>
            <div class="day-card__body" ${expanded ? "" : "hidden"}>
              ${renderItemDetails(item)}
              <div class="day-card__actions">
                <button class="ghost-btn" type="button" data-role="detail">Подробнее</button>
                ${
                  canMutateActiveTab()
                    ? '<button class="primary-btn" type="button" data-role="edit">Редактировать</button>'
                    : ""
                }
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderItemDetails(item) {
    const linkedEvent =
      item.channel !== "events" && item.eventId
        ? state.data.events.find((evt) => evt.id === String(item.eventId))
        : null;
    return `
      <dl class="item-details">
        ${item.time ? `<div><dt>Время</dt><dd>${escapeHtml(item.time)}</dd></div>` : ""}
        ${item.type ? `<div><dt>Тип</dt><dd>${escapeHtml(item.type)}</dd></div>` : ""}
        ${
          item.channel === "events" && item.location
            ? `<div><dt>Локация</dt><dd>${escapeHtml(item.location)}</dd></div>`
            : ""
        }
        ${item.status ? `<div><dt>Статус</dt><dd>${formatStatusLabel(item.status)}</dd></div>` : ""}
        ${
          linkedEvent
            ? `<div><dt>Мероприятие</dt><dd>${escapeHtml(linkedEvent.title)}</dd></div>`
            : ""
        }
      </dl>
      ${
        item.description
          ? `<p class="day-card__description">${escapeHtml(item.description)}</p>`
          : ""
      }
    `;
  }

  function updateAddButton() {
    if (!refs.addBtn) return;
    const allowed = canMutateActiveTab();
    refs.addBtn.disabled = !allowed;
    refs.addBtn.title = allowed ? "Добавить запись" : "Недостаточно прав";
  }

  function canMutateActiveTab() {
    return canManageTab(state.tab, state.user);
  }

  function getItemsByDate(dateIso, tab) {
    const items = state.data[tab] || [];
    return items.filter((item) => item.date === dateIso);
  }

  function getSortedItems(tab) {
    const items = [...(state.data[tab] || [])];
    return items.sort(compareItems);
  }

  function compareItems(a, b) {
    if (a.date !== b.date) {
      return a.date < b.date ? -1 : 1;
    }
    if (a.time && b.time && a.time !== b.time) {
      return a.time < b.time ? -1 : 1;
    }
    if (a.title !== b.title) {
      return a.title.localeCompare(b.title);
    }
    return String(a.id).localeCompare(String(b.id));
  }

  function formatMeta(item) {
    const parts = [];
    if (item.time) parts.push(item.time);
    if (item.type) parts.push(item.type);
    if (item.channel !== "events" && item.status) {
      parts.push(formatStatusLabel(item.status));
    }
    if (item.channel === "events" && item.location) {
      parts.push(item.location);
    }
    return parts.join(" • ") || "Без деталей";
  }

  function renderStatusTag(item) {
    if (item.channel === "events" || !item.status) return "";
    return `<span class="tag-pill tag-pill--muted">${formatStatusLabel(item.status)}</span>`;
  }

  function getChannelLabel(channelId) {
    const tab = TABS.find((entry) => entry.id === channelId);
    return tab ? tab.label : channelId;
  }

  function getRelatedContent(eventId) {
    if (!eventId) return [];
    const normalizedId = String(eventId);
    return ["instagram", "telegram"]
      .flatMap((bucket) => state.data[bucket] || [])
      .filter((contentItem) => contentItem.eventId && String(contentItem.eventId) === normalizedId)
      .sort(compareItems);
  }

  function formatStatusLabel(value) {
    const match = CONTENT_STATUSES.find((status) => status.value === value);
    if (match) return match.label;
    return value || "";
  }

  function formatDay(dateIso) {
    return Number.parseInt(dateIso.split("-")[2], 10);
  }

  function formatWeekday(dateIso) {
    const date = new Date(dateIso);
    return new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date);
  }

  function formatFullDate(dateIso) {
    if (!dateIso) return "-";
    const date = new Date(dateIso);
    return capitalize(
      new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date)
    );
  }

  function openDetailsModal(item) {
    if (item.channel === "events") {
      openEventDetailsModal(item);
      return;
    }
    openContentPostModal(item);
  }

  function openEventDetailsModal(item) {
    const relatedContent = getRelatedContent(item.id);
    const body = document.createElement("div");
    body.className = "event-modal";
    body.innerHTML = renderEventDetails(item, relatedContent);
    const footer = document.createElement("div");
    footer.className = "modal-card__footer";
    if (canMutateActiveTab()) {
      const editBtn = document.createElement("button");
      editBtn.className = "primary-btn";
      editBtn.type = "button";
      editBtn.textContent = "Редактировать";
      footer.appendChild(editBtn);
    }
    const modal = openModal({
      title: item.title,
      body,
      footer: footer.childElementCount ? footer : null,
    });
    if (modal.element) {
      const card = modal.element.querySelector(".modal-card");
      if (card) {
        card.classList.add("modal-card--event");
      }
    }
    if (footer.childElementCount) {
      footer.querySelector("button").addEventListener("click", () => {
        modal.close();
        openEditorModal("edit", item);
      });
    }
  }

  function renderEventDetails(item, relatedContent) {
    const statusLabel = item.status ? formatStatusLabel(item.status) : "";
    const descriptionSection = item.description
      ? `
      <section class="event-modal__block">
        <p class="event-modal__section-title">Описание</p>
        <p class="event-modal__description">${escapeHtml(item.description)}</p>
      </section>
    `
      : "";
    return `
      ${
        statusLabel
          ? `<div class="event-modal__status-pill"><span class="tag-pill tag-pill--muted event-modal__status-chip">${escapeHtml(
              statusLabel
            )}</span></div>`
          : ""
      }
      <section class="event-modal__block">
        <p class="event-modal__section-title">Основная информация</p>
        ${renderEventMeta(item)}
      </section>
      ${descriptionSection}
      ${renderRelatedContentSection(relatedContent)}
    `;
  }

  function renderEventMeta(item) {
    const rows = [
      { label: "Дата", value: escapeHtml(formatFullDate(item.date)) },
      { label: "Время", value: item.time ? escapeHtml(item.time) : "" },
      { label: "Тип", value: item.type ? escapeHtml(item.type) : "" },
      { label: "Локация", value: item.location ? escapeHtml(item.location) : "" },
    ].filter((row) => row.value);
    if (!rows.length) {
      return `<p class="event-modal__empty">Нет данных для отображения.</p>`;
    }
    return `
      <dl class="event-modal__meta">
        ${rows
          .map(
            (row) => `
          <div class="event-modal__meta-row">
            <dt>${row.label}</dt>
            <dd>${row.value}</dd>
          </div>
        `
          )
          .join("")}
      </dl>
    `;
  }

  function renderRelatedContentSection(items) {
    if (!items.length) {
      return `
        <section class="event-modal__block">
          <p class="event-modal__section-title">Связанный контент</p>
          <p class="event-modal__empty">Пока нет материалов, связанных с этим мероприятием.</p>
        </section>
      `;
    }
    return `
      <section class="event-modal__block">
        <p class="event-modal__section-title">Связанный контент</p>
        <ul class="event-modal__related-list">
          ${items.map(renderRelatedContentItem).join("")}
        </ul>
      </section>
    `;
  }

  function renderRelatedContentItem(contentItem) {
    const channelLabel = getChannelLabel(contentItem.channel);
    const metaParts = [
      escapeHtml(formatFullDate(contentItem.date)),
      contentItem.time ? escapeHtml(contentItem.time) : "",
      escapeHtml(channelLabel),
    ].filter(Boolean);
    return `
      <li class="event-modal__related-item">
        <div>
          <p class="event-modal__related-title">${escapeHtml(contentItem.title)}</p>
          <p class="event-modal__related-meta">${metaParts.join(" • ")}</p>
        </div>
        ${
          contentItem.status
            ? `<span class="tag-pill tag-pill--muted event-modal__status-chip">${formatStatusLabel(
                contentItem.status
              )}</span>`
            : ""
        }
      </li>
    `;
  }

  function openContentPostModal(item) {
    const extras = ensureContentExtrasEntry(item.channel, item.id);
    const view = buildPostModalView(item, extras);
    const footer = document.createElement("div");
    footer.className = "modal-card__footer";
    if (canMutateActiveTab()) {
      const editBtn = document.createElement("button");
      editBtn.className = "primary-btn";
      editBtn.type = "button";
      editBtn.textContent = "Редактировать";
      footer.appendChild(editBtn);
    }
    const modal = openModal({
      title: item.title,
      body: view.root,
      footer: footer.childElementCount ? footer : null,
    });
    if (footer.childElementCount) {
      footer.querySelector("button").addEventListener("click", () => {
        modal.close();
        openEditorModal("edit", item);
      });
    }

    view.assetsAddBtn.addEventListener("click", () => {
      if (!ensureAuthenticatedUser()) return;
      openAssetFormModal(item, extras, view);
    });
    view.assetsList.addEventListener("click", (event) => {
      const removeBtn = event.target.closest("[data-role='remove-asset']");
      if (removeBtn) {
        handleAssetRemove(item, extras, Number(removeBtn.dataset.assetId), view);
      }
    });

    view.tasksAddBtn.addEventListener("click", () => {
      if (!ensureAuthenticatedUser()) return;
      openTaskCreationModal(item, extras, view);
    });
    view.tasksBody.addEventListener("click", (event) => {
      const openBtn = event.target.closest("[data-role='open-task']");
      if (openBtn) {
        openTaskBoardTab(openBtn.dataset.taskId);
        return;
      }
      const unlinkBtn = event.target.closest("[data-role='unlink-task']");
      if (unlinkBtn) {
        handleTaskUnlink(item, extras, unlinkBtn.dataset.taskId, view);
      }
    });

    loadContentAssets(item, extras, view);
    loadContentTasks(item, extras, view);
  }

  function buildPostModalView(item, extras) {
    const root = document.createElement("div");
    root.className = "post-modal";
    root.appendChild(renderPostInfoSection(item));

    const assetsSection = document.createElement("section");
    assetsSection.className = "post-modal__section";
    assetsSection.innerHTML = `
      <div class="post-modal__section-head">
        <div>
          <p class="post-modal__section-title">Материалы</p>
          <p class="post-modal__section-subtitle">Прикрепите ссылки на дизайн, обложку или видео.</p>
        </div>
        <button class="primary-btn" type="button" data-role="add-asset">+ Добавить контент</button>
      </div>
      <div class="post-modal__list" data-role="assets-list"></div>
    `;
    const assetsList = assetsSection.querySelector("[data-role='assets-list']");
    const assetsAddBtn = assetsSection.querySelector("[data-role='add-asset']");
    root.appendChild(assetsSection);

    const tasksSection = document.createElement("section");
    tasksSection.className = "post-modal__section";
    tasksSection.innerHTML = `
      <div class="post-modal__section-head">
        <div>
          <p class="post-modal__section-title">Задачи</p>
          <p class="post-modal__section-subtitle">Ведите задачи по подготовке публикации.</p>
        </div>
        <button class="primary-btn" type="button" data-role="add-task">+ Добавить задачку</button>
      </div>
      <div class="content-tasks-table">
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th>Ответственный</th>
              <th>Дедлайн</th>
              <th></th>
            </tr>
          </thead>
          <tbody data-role="tasks-body"></tbody>
        </table>
      </div>
    `;
    const tasksBody = tasksSection.querySelector("[data-role='tasks-body']");
    const tasksAddBtn = tasksSection.querySelector("[data-role='add-task']");
    root.appendChild(tasksSection);

    const view = {
      root,
      assetsList,
      assetsAddBtn,
      tasksBody,
      tasksAddBtn,
      updateAssets: () => renderAssetsList(assetsList, extras),
      updateTasks: () => renderTasksTable(tasksBody, extras),
    };
    view.updateAssets();
    view.updateTasks();
    return view;
  }

  function renderPostInfoSection(item) {
    const section = document.createElement("section");
    section.className = "post-modal__section";
    const typeValue = item.type ? escapeHtml(item.type) : "—";
    const statusValue = item.status ? formatStatusLabel(item.status) : "—";
    section.innerHTML = `
      <p class="post-modal__section-title">Основная информация</p>
      <dl class="post-modal__info">
        <div>
          <dt>Тип</dt>
          <dd>${typeValue}</dd>
        </div>
        <div>
          <dt>Дата</dt>
          <dd>${formatFullDate(item.date)}</dd>
        </div>
        <div>
          <dt>Статус</dt>
          <dd>${statusValue}</dd>
        </div>
      </dl>
      ${
        item.description
          ? `<p class="post-modal__description">${escapeHtml(item.description)}</p>`
          : ""
      }
    `;
    return section;
  }

  function renderAssetsList(container, extras) {
    if (extras.assetsLoading) {
      container.innerHTML = `<p class="post-modal__muted">Загружаем материалы…</p>`;
      return;
    }
    if (extras.assetsError) {
      container.innerHTML = `<p class="post-modal__error">${escapeHtml(extras.assetsError)}</p>`;
      return;
    }
    if (!extras.assets.length) {
      container.innerHTML = `<p class="post-modal__muted">Нет прикреплённых материалов.</p>`;
      return;
    }
    container.innerHTML = extras.assets
      .map(
        (asset) => `
        <article class="asset-card">
          <div>
            <p class="asset-card__title">${escapeHtml(asset.title)}</p>
            ${
              asset.url
                ? `<a class="asset-card__link" href="${escapeAttribute(asset.url)}" target="_blank" rel="noopener noreferrer">Открыть</a>`
                : ""
            }
            ${
              asset.notes
                ? `<p class="asset-card__notes">${escapeHtml(asset.notes)}</p>`
                : ""
            }
            <p class="asset-card__meta">${formatDateTimeWithTime(asset.createdAt)}</p>
          </div>
          <button
            class="ghost-icon-btn"
            type="button"
            data-role="remove-asset"
            data-asset-id="${asset.id}"
            aria-label="Удалить материал"
          >
            ×
          </button>
        </article>
      `
      )
      .join("");
  }

  function renderTasksTable(tbody, extras) {
    if (extras.tasksLoading) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="post-modal__muted">Загружаем список задач…</td>
        </tr>
      `;
      return;
    }
    if (extras.tasksError) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="post-modal__error">${escapeHtml(extras.tasksError)}</td>
        </tr>
      `;
      return;
    }
    if (!extras.tasks.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="post-modal__muted">Задачи ещё не добавлены.</td>
        </tr>
      `;
      return;
    }
    tbody.innerHTML = extras.tasks
      .map(
        (task) => `
        <tr>
          <td>
            <p class="task-cell__title">${escapeHtml(task.title)}</p>
            <p class="task-cell__meta">
              ${formatTaskStatusLabel(task.status)} · ${formatTaskPriorityLabel(task.priority)}
            </p>
          </td>
          <td>${task.responsible ? escapeHtml(task.responsible) : "—"}</td>
          <td>${formatTaskDeadline(task.deadline)}</td>
          <td class="task-cell__actions">
            <button
              class="ghost-icon-btn"
              type="button"
              data-role="open-task"
              data-task-id="${task.id}"
              aria-label="Открыть задачу"
            >
              →
            </button>
            <button
              class="ghost-icon-btn"
              type="button"
              data-role="unlink-task"
              data-task-id="${task.id}"
              aria-label="Удалить связь"
            >
              ×
            </button>
          </td>
        </tr>
      `
      )
      .join("");
  }

  function ensureContentExtrasEntry(channel, id) {
    const key = `${channel}:${id}`;
    if (!state.extras.has(key)) {
      state.extras.set(key, {
        assets: [],
        tasks: [],
        assetsLoading: false,
        tasksLoading: false,
        assetsError: "",
        tasksError: "",
      });
    }
    return state.extras.get(key);
  }

  function loadContentAssets(item, extras, view) {
    extras.assetsLoading = true;
    extras.assetsError = "";
    view.updateAssets();
    return requestJson(`${buildContentApiBase(item)}/assets`, { auth: false })
      .then((assets) => {
        extras.assets = Array.isArray(assets) ? assets : [];
      })
      .catch((error) => {
        extras.assetsError = getErrorMessage(error, "Не удалось загрузить материалы.");
      })
      .finally(() => {
        extras.assetsLoading = false;
        view.updateAssets();
      });
  }

  function loadContentTasks(item, extras, view) {
    extras.tasksLoading = true;
    extras.tasksError = "";
    view.updateTasks();
    return requestJson(`${buildContentApiBase(item)}/tasks`, { auth: false })
      .then((tasks) => {
        extras.tasks = Array.isArray(tasks) ? tasks : [];
      })
      .catch((error) => {
        extras.tasksError = getErrorMessage(error, "Не удалось загрузить задачи.");
      })
      .finally(() => {
        extras.tasksLoading = false;
        view.updateTasks();
      });
  }

  function openAssetFormModal(item, extras, view) {
    const form = document.createElement("form");
    form.className = "modal-form";
    form.innerHTML = `
      <div class="form-group form-group--full">
        <label for="assetTitle">Название*</label>
        <input id="assetTitle" name="title" required />
      </div>
      <div class="form-group form-group--full">
        <label for="assetUrl">Ссылка</label>
        <input id="assetUrl" name="url" type="url" placeholder="https://..." />
      </div>
      <div class="form-group form-group--full">
        <label for="assetNotes">Комментарий</label>
        <textarea id="assetNotes" name="notes" rows="3" placeholder="Описание файла или инструкции"></textarea>
      </div>
      <p class="form-error" data-role="form-error"></p>
    `;
    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "primary-btn";
    submitBtn.textContent = "Сохранить";
    const footer = document.createElement("div");
    footer.className = "modal-card__footer";
    footer.appendChild(submitBtn);
    const modal = openModal({
      title: "Добавить материал",
      body: form,
      footer,
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = collectAssetPayload(form);
      if (!payload) {
        showFormError(form, "Заполните обязательные поля.");
        return;
      }
      showFormError(form, "");
      submitBtn.disabled = true;
      try {
        await requestJson(`${buildContentApiBase(item)}/assets`, {
          method: "POST",
          body: payload,
        });
        await loadContentAssets(item, extras, view);
        modal.close();
      } catch (error) {
        showFormError(form, getErrorMessage(error, "Не удалось сохранить материал."));
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  function collectAssetPayload(form) {
    const data = new FormData(form);
    const title = String(data.get("title") || "").trim();
    if (!title) return null;
    const url = String(data.get("url") || "").trim();
    const notes = String(data.get("notes") || "").trim();
    return {
      title,
      url,
      notes,
    };
  }

  async function handleAssetRemove(item, extras, assetId, view) {
    if (!assetId) return;
    if (!ensureAuthenticatedUser()) return;
    const confirmed = window.confirm("Удалить материал?");
    if (!confirmed) return;
    try {
      await requestJson(`${buildContentApiBase(item)}/assets/${assetId}`, {
        method: "DELETE",
      });
      extras.assets = extras.assets.filter((asset) => asset.id !== assetId);
      view.updateAssets();
    } catch (error) {
      extras.assetsError = getErrorMessage(error, "Не удалось удалить материал.");
      view.updateAssets();
    }
  }

  function openTaskCreationModal(item, extras, view) {
    const form = document.createElement("form");
    form.id = "taskForm";
    form.innerHTML = `
      <div class="modal__header">
        <div>
          <p class="workspace__eyebrow">Новая запись</p>
          <h2 class="modal__title">Создание задачи</h2>
        </div>
        <button class="modal__close" type="button" data-close-modal aria-label="Закрыть">×</button>
      </div>

      <div class="form-grid">
        <div class="form-group form-group--full">
          <label for="taskTitleField">Название*</label>
          <input id="taskTitleField" name="title" required />
        </div>
        <div class="form-group">
          <label for="taskResponsibleField">Ответственный*</label>
          <input id="taskResponsibleField" name="responsible" required />
        </div>
        <div class="form-group">
          <label for="taskDeadlineField">Дедлайн*</label>
          <input id="taskDeadlineField" name="deadline" type="datetime-local" required />
        </div>
        <div class="form-group">
          <label for="taskPriorityField">Приоритет</label>
          <select id="taskPriorityField" name="priority">
            ${TASK_PRIORITY_OPTIONS.map(
              (option) => `<option value="${option.value}">${option.label}</option>`
            ).join("")}
          </select>
        </div>
        <div class="form-group">
          <label for="taskStatusField">Статус</label>
          <select id="taskStatusField" name="status">
            ${TASK_STATUS_OPTIONS.map(
              (option) => `<option value="${option.value}">${option.label}</option>`
            ).join("")}
          </select>
        </div>
      </div>

      <div class="form-group form-block">
        <label for="taskDescriptionField">Описание</label>
        <textarea id="taskDescriptionField" name="description" rows="4"></textarea>
      </div>

      <div class="form-group form-block">
        <label>Подзадачи</label>
        <div class="subtasks-list" data-role="subtasks-list"></div>
        <button class="ghost-btn" type="button" data-role="add-subtask">+ Подзадача</button>
      </div>

      <div class="form-group form-block">
        <label>Вложения</label>
        <div class="attachment-list" data-role="attachments-list"></div>
        <button class="ghost-btn" type="button" data-role="add-attachment">+ Материал</button>
      </div>

      <p class="form-error" data-role="form-error"></p>
      <div class="modal__footer">
        <button type="button" class="ghost-btn" data-close-modal>Отмена</button>
        <button type="submit" class="primary-btn">Создать</button>
      </div>
    `;
    const modal = openModal({
      title: "Новая задачка",
      body: form,
    });
    setupTaskFormDynamicLists(form);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const payload = collectTaskFormValues(form);
      if (!payload) {
        showFormError(form, "Проверьте обязательные поля и формат дедлайна.");
        return;
      }
      showFormError(form, "");
      const submitBtn = form.querySelector("button[type='submit']");
      submitBtn.disabled = true;
      try {
        const createdTask = await requestJson("/tasks", {
          method: "POST",
          body: payload,
          auth: false,
        });
        await requestJson(`${buildContentApiBase(item)}/tasks`, {
          method: "POST",
          body: { taskId: createdTask.id },
        });
        modal.close();
        await loadContentTasks(item, extras, view);
      } catch (error) {
        showFormError(form, getErrorMessage(error, "Не удалось сохранить задачку."));
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  function setupTaskFormDynamicLists(form) {
    const subtasksList = form.querySelector("[data-role='subtasks-list']");
    const attachmentsList = form.querySelector("[data-role='attachments-list']");
    form.addEventListener("click", (event) => {
      const addSubtaskBtn = event.target.closest("[data-role='add-subtask']");
      if (addSubtaskBtn) {
        event.preventDefault();
        addSubtaskRow(subtasksList);
        return;
      }
      const removeSubtaskBtn = event.target.closest("[data-role='remove-subtask']");
      if (removeSubtaskBtn) {
        event.preventDefault();
        removeSubtaskBtn.closest(".subtask-item")?.remove();
        return;
      }
      const addAttachmentBtn = event.target.closest("[data-role='add-attachment']");
      if (addAttachmentBtn) {
        event.preventDefault();
        addAttachmentRow(attachmentsList);
        return;
      }
      const removeAttachmentBtn = event.target.closest("[data-role='remove-attachment']");
      if (removeAttachmentBtn) {
        event.preventDefault();
        removeAttachmentBtn.closest(".subtask-item")?.remove();
      }
    });
  }

  function addSubtaskRow(list, value = {}) {
    if (!list) return;
    const row = document.createElement("div");
    row.className = "subtask-item";
    row.innerHTML = `
      <input type="checkbox" ${value.done ? "checked" : ""} />
      <input
        type="text"
        name="subtask-text"
        placeholder="Опишите подзадачу"
        value="${escapeAttribute(value.text || "")}"
      />
      <button type="button" class="ghost-btn" data-role="remove-subtask">×</button>
    `;
    list.appendChild(row);
  }

  function addAttachmentRow(list, value = {}) {
    if (!list) return;
    const row = document.createElement("div");
    row.className = "subtask-item";
    row.innerHTML = `
      <input
        type="text"
        name="attachment-label"
        placeholder="Название"
        value="${escapeAttribute(value.label || "")}"
      />
      <input
        type="url"
        name="attachment-url"
        placeholder="https://..."
        value="${escapeAttribute(value.url || "")}"
      />
      <button type="button" class="ghost-btn" data-role="remove-attachment">×</button>
    `;
    list.appendChild(row);
  }

  function collectTaskFormValues(form) {
    const data = new FormData(form);
    const title = String(data.get("title") || "").trim();
    const responsible = String(data.get("responsible") || "").trim();
    const deadlineRaw = data.get("deadline");
    if (!title || !responsible || !deadlineRaw) {
      return null;
    }
    const deadline = new Date(deadlineRaw);
    if (Number.isNaN(deadline.getTime())) {
      return null;
    }
    const subtasks = collectSubtasksFromForm(form.querySelector("[data-role='subtasks-list']"));
    const attachments = collectAttachmentsFromForm(
      form.querySelector("[data-role='attachments-list']")
    );
    return {
      title,
      responsible,
      deadline: deadline.toISOString(),
      priority: data.get("priority") || "medium",
      status: data.get("status") || "pending",
      description: String(data.get("description") || "").trim(),
      attachments,
      subtasks,
    };
  }

  function collectSubtasksFromForm(list) {
    if (!list) return [];
    return Array.from(list.querySelectorAll(".subtask-item"))
      .map((row) => {
        const textInput = row.querySelector("input[name='subtask-text']");
        if (!textInput) return null;
        const text = textInput.value.trim();
        if (!text) return null;
        const done = row.querySelector("input[type='checkbox']")?.checked || false;
        return { text, done };
      })
      .filter(Boolean);
  }

  function collectAttachmentsFromForm(list) {
    if (!list) return [];
    return Array.from(list.querySelectorAll(".subtask-item"))
      .map((row) => {
        const label = row.querySelector("input[name='attachment-label']")?.value.trim() || "";
        const url = row.querySelector("input[name='attachment-url']")?.value.trim() || "";
        if (!url) return null;
        return { label, url };
      })
      .filter(Boolean);
  }

  async function handleTaskUnlink(item, extras, taskId, view) {
    if (!taskId) return;
    if (!ensureAuthenticatedUser()) return;
    const confirmed = window.confirm("Убрать задачу из публикации?");
    if (!confirmed) return;
    try {
      await requestJson(`${buildContentApiBase(item)}/tasks/${encodeURIComponent(taskId)}`, {
        method: "DELETE",
      });
      extras.tasks = extras.tasks.filter((task) => task.id !== taskId);
      view.updateTasks();
    } catch (error) {
      extras.tasksError = getErrorMessage(error, "Не удалось удалить задачу из списка.");
      view.updateTasks();
    }
  }

  function openTaskBoardTab(taskId) {
    if (!taskId) return;
    const url = `index.html#task=${encodeURIComponent(taskId)}`;
    window.open(url, "_blank", "noreferrer");
  }

  function buildContentApiBase(item) {
    return `/content-plan/${encodeURIComponent(item.channel)}/${encodeURIComponent(item.id)}`;
  }

  function ensureAuthenticatedUser() {
    if (state.token) return true;
    alert("Чтобы выполнить действие, войдите в систему.");
    return false;
  }

  function formatTaskStatusLabel(value) {
    const option = TASK_STATUS_OPTIONS.find((item) => item.value === value);
    return option ? option.label : value || "—";
  }

  function formatTaskPriorityLabel(value) {
    const option = TASK_PRIORITY_OPTIONS.find((item) => item.value === value);
    return option ? option.label : value || "—";
  }

  function formatTaskDeadline(value) {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value));
    } catch {
      return value;
    }
  }

  function formatDateTimeWithTime(value) {
    if (!value) return "";
    try {
      return new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value));
    } catch {
      return value;
    }
  }


  function openEditorModal(mode, item) {
    const isEdit = mode === "edit";
    const form = document.createElement("form");
    form.className = "modal-form";
    const formId = `content-plan-form-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    form.id = formId;
    const defaultDate = isEdit ? item.date : state.selectedDate;
    const defaultTime = isEdit ? item.time : "";
    const defaultTitle = isEdit ? item.title : "";
    const defaultDescription = isEdit ? item.description : "";
    const defaultType = isEdit ? item.type : "";
    const normalizedDefaultType = (defaultType || "").toLowerCase();
    const defaultStatus = isEdit ? item.status : CONTENT_STATUSES[0].value;
    const defaultLocation = isEdit ? item.location : "";
    const defaultEventId = isEdit ? item.eventId : "";
    form.innerHTML = `
      <div class="form-group form-group--full">
        <label for="entryTitle">Название</label>
        <input id="entryTitle" name="title" required value="${escapeAttribute(defaultTitle)}" />
      </div>
      <div class="form-group">
        <label for="entryDate">Дата</label>
        <input id="entryDate" name="date" type="date" required value="${escapeAttribute(defaultDate)}" />
      </div>
      ${
        state.tab === "events"
          ? `
        <div class="form-group">
          <label for="entryTime">Время</label>
          <input
            id="entryTime"
            name="time"
            type="time"
            step="60"
            value="${escapeAttribute(defaultTime)}"
          />
        </div>
      `
          : ""
      }
      ${
        state.tab === "events"
          ? `
        <div class="form-group">
          <label for="entryLocation">Локация</label>
          <input id="entryLocation" name="location" value="${escapeAttribute(defaultLocation)}" />
        </div>
      `
          : `
        <div class="form-group">
          <label for="entryStatus">Статус</label>
          <select id="entryStatus" name="status">
            ${CONTENT_STATUSES.map(
              (status) => `
              <option value="${status.value}" ${status.value === defaultStatus ? "selected" : ""}>
                ${status.label}
              </option>`
            ).join("")}
          </select>
        </div>
        <div class="form-group">
          <label for="entryEvent">Мероприятие</label>
          <select id="entryEvent" name="eventId">
            <option value="">Без привязки</option>
            ${state.data.events
              .map(
                (evt) => `
              <option value="${evt.id}" ${String(defaultEventId) === String(evt.id) ? "selected" : ""}>
                ${escapeHtml(evt.title)}
              </option>`
              )
              .join("")}
          </select>
        </div>
      `
      }
      ${
        state.tab === "events"
          ? `
        <div class="form-group form-group--full">
          <label for="entryType">Тип</label>
          <input id="entryType" name="type" value="${escapeAttribute(defaultType)}" />
        </div>
      `
          : `
        <div class="form-group">
          <label for="entryType">Тип</label>
          <select id="entryType" name="type">
            <option value="" ${normalizedDefaultType ? "" : "selected"}>Не выбрано</option>
            ${CONTENT_TYPE_OPTIONS.map(
              (option) => `
              <option value="${option.value}" ${
                option.value.toLowerCase() === normalizedDefaultType ? "selected" : ""
              }>
                ${option.label}
              </option>`
            ).join("")}
          </select>
        </div>
      `
      }
      <div class="form-group form-group--full">
        <label for="entryDescription">Описание</label>
        <textarea id="entryDescription" name="description" rows="4">${escapeAttribute(defaultDescription)}</textarea>
      </div>
      ${
        state.tab === "events"
          ? ""
          : `<p class="form-hint form-group--full">Чтобы связать пост с событием, выберите его в списке.</p>`
      }
      <p class="form-error" data-role="form-error"></p>
    `;
    const footer = document.createElement("div");
    footer.className = "modal-card__footer";
    if (isEdit) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "ghost-btn ghost-btn--danger";
      deleteBtn.textContent = "Удалить";
      footer.appendChild(deleteBtn);
      deleteBtn.addEventListener("click", async () => {
        if (!confirm("Удалить запись?")) return;
        try {
          deleteBtn.disabled = true;
          await requestJson(`/content-plan/${state.tab}/${item.id}`, {
            method: "DELETE",
          });
          modal.close();
          await loadMonthData({ silent: true });
          renderAll();
        } catch (error) {
          showFormError(form, getErrorMessage(error, "Не удалось удалить запись."));
        } finally {
          deleteBtn.disabled = false;
        }
      });
    }
    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "primary-btn";
    submitBtn.textContent = isEdit ? "Сохранить" : "Создать";
    submitBtn.setAttribute("form", formId);
    footer.appendChild(submitBtn);
    const modal = openModal({
      title: isEdit ? "Редактирование" : "Новая запись",
      body: form,
      footer,
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = collectFormPayload(form, state.tab);
      if (!payload) {
        showFormError(form, "Заполните все обязательные поля.");
        return;
      }
      showFormError(form, "");
      submitBtn.disabled = true;
      try {
        if (isEdit) {
          await requestJson(`/content-plan/${state.tab}/${item.id}`, {
            method: "PUT",
            body: payload,
          });
        } else {
          await requestJson(`/content-plan/${state.tab}`, {
            method: "POST",
            body: payload,
          });
          if (payload.date) {
            state.selectedDate = payload.date;
          }
        }
        modal.close();
        await loadMonthData({ silent: true });
        renderAll();
      } catch (error) {
        if (error.status === 401) {
          clearStoredSession();
          refreshAuthState();
        }
        showFormError(form, getErrorMessage(error, "Не удалось сохранить запись."));
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  function collectFormPayload(form, tab) {
    const data = new FormData(form);
    const payload = {
      title: (data.get("title") || "").toString().trim(),
      date: data.get("date"),
      time: data.get("time") || "",
      type: data.get("type") || "",
      description: data.get("description") || "",
    };
    if (!payload.title || !payload.date) {
      return null;
    }
    if (tab === "events") {
      payload.location = data.get("location") || "";
    } else {
      payload.status = data.get("status") || "";
      const eventId = data.get("eventId");
      payload.eventId = eventId ? Number(eventId) : "";
    }
    return payload;
  }

  function showFormError(form, message) {
    const node = form.querySelector("[data-role='form-error']");
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
  }

  function requestJson(path, options = {}) {
    const { method = "GET", body, headers = {}, auth = true } = options;
    const url = `${API_BASE_URL}${path}`;
    const config = { method, headers: { ...headers } };
    if (body !== undefined) {
      config.body = typeof body === "string" ? body : JSON.stringify(body);
      config.headers["Content-Type"] = "application/json";
    }
    if (auth && state.token) {
      config.headers.Authorization = `Bearer ${state.token}`;
    }
    return fetch(url, config).then(async (response) => {
      const text = await response.text();
      const data = text ? safeJsonParse(text) : null;
      if (!response.ok) {
        const error = new Error(data?.message || "Запрос завершился с ошибкой");
        error.status = response.status;
        throw error;
      }
      return data;
    });
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function canManageTab(tab, user) {
    if (!user || !user.role) return false;
    const allowed = ROLE_PERMISSIONS[tab];
    if (!allowed) return false;
    return allowed.has(user.role);
  }

  function findItemById(id, tab) {
    if (!id) return null;
    const list = state.data[tab] || [];
    return list.find((item) => item.id === String(id)) || null;
  }

  function capitalize(value) {
    if (!value) return "";
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function renderUserChip() {
    if (!refs.userChip) return;
    const user = state.user;
    if (!user) {
      refs.userChip.innerHTML = `
        <span class="user-chip__name">Гость</span>
        <span class="user-chip__role">только просмотр</span>
      `;
      return;
    }
    const name = user.displayName || user.firstName || user.login || "Пользователь";
    refs.userChip.innerHTML = `
      <span class="user-chip__name">${escapeHtml(name)}</span>
      <span class="user-chip__role">${renderRoleLabel(user.role)}</span>
    `;
  }

  function renderRoleLabel(role) {
    switch (role) {
      case "super_admin":
        return "Супер-админ";
      case "admin":
        return "Админ";
      case "content_manager":
        return "Контент-менеджер";
      case "executor":
        return "Исполнитель";
      default:
        return "Пользователь";
    }
  }

  function getErrorMessage(error, fallback) {
    if (!error) return fallback;
    if (typeof error === "string" && error.trim()) {
      return error;
    }
    if (error.message) {
      return error.message;
    }
    return fallback;
  }

  function ensureFreshUserProfile() {
    if (!state.token) {
      clearStoredUser();
      renderUserChip();
      return;
    }
    requestJson("/auth/me")
      .then((payload) => {
        const user = payload?.user || null;
        if (user) {
          saveUserToStorage(user);
          state.user = user;
        } else {
          clearStoredSession();
        }
        renderUserChip();
      })
      .catch((error) => {
        if (error.status === 401) {
          clearStoredSession();
        }
      });
  }

  function refreshAuthState() {
    state.user = loadStoredUser();
    state.token = loadStoredToken();
    renderUserChip();
  }

  function ensureModalRoot() {
    let modalRoot = document.getElementById("modalRoot");
    if (!modalRoot) {
      modalRoot = document.createElement("div");
      modalRoot.id = "modalRoot";
      document.body.appendChild(modalRoot);
    }
    return modalRoot;
  }

  function openModal({ title, body, footer }) {
    const root = ensureModalRoot();
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeAttribute(title)}">
        <div class="modal-card__header">
          <h2>${escapeHtml(title)}</h2>
          <button class="modal__close" type="button" aria-label="Закрыть">×</button>
        </div>
        <div class="modal-card__body"></div>
      </div>
    `;
    const bodyContainer = overlay.querySelector(".modal-card__body");
    if (body) {
      bodyContainer.appendChild(body);
    }
    if (footer) {
      overlay.querySelector(".modal-card").appendChild(footer);
    }
    root.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("is-visible"));
    const close = () => {
      overlay.classList.remove("is-visible");
      setTimeout(() => overlay.remove(), 150);
      document.removeEventListener("keydown", handleEsc);
    };
    const handleEsc = (event) => {
      if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("keydown", handleEsc);
    overlay.addEventListener("click", (event) => {
      if (
        event.target === overlay ||
        event.target.closest(".modal__close") ||
        event.target.closest("[data-close-modal]")
      ) {
        close();
      }
    });
    return { close, element: overlay };
  }

  function formatISODate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(value = "") {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function loadStoredUser() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.user);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveUserToStorage(user) {
    try {
      if (user) {
        localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
      } else {
        localStorage.removeItem(STORAGE_KEYS.user);
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
      return localStorage.getItem(STORAGE_KEYS.token) || "";
    } catch {
      return "";
    }
  }

  function clearStoredToken() {
    try {
      localStorage.removeItem(STORAGE_KEYS.token);
    } catch {
      /* ignore */
    }
  }

  function clearStoredSession() {
    clearStoredToken();
    clearStoredUser();
    refreshAuthState();
  }
})();
