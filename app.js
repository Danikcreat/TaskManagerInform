(() => {
  const STORAGE_KEYS = {
    user: "inform_user_v1",
  };

  const API_BASE_URL = globalThis.APP_API_BASE_URL || "/api";

  const DEFAULT_USER = {
    id: "admin",
    name: "Даник",
    login: "danik",
    role: "Администратор",
  };

  const PRIORITY_META = {
    low: {
      label: "Низкий",
      className: "pill--low",
      detailClass: "priority-detail--low",
      itemClass: "priority-detail-bg--low",
    },
    medium: {
      label: "Средний",
      className: "pill--medium",
      detailClass: "priority-detail--medium",
      itemClass: "priority-detail-bg--medium",
    },
    high: {
      label: "Высокий",
      className: "pill--high",
      detailClass: "priority-detail--high",
      itemClass: "priority-detail-bg--high",
    },
  };

  const STATUS_META = {
    pending: { label: "В ожидании", className: "status-pending" },
    in_progress: { label: "В работе", className: "status-in-progress" },
    done: { label: "Готово", className: "status-done" },
  };

  const STATUS_FILTER_OPTIONS = [
    { value: "all", label: "Все статусы" },
    { value: "in_progress", label: "В работе" },
    { value: "pending", label: "В ожидании" },
    { value: "done", label: "Готово" },
  ];

  const PRIORITY_FILTER_OPTIONS = [
    { value: "all", label: "Все приоритеты" },
    { value: "high", label: "Высокий" },
    { value: "medium", label: "Средний" },
    { value: "low", label: "Низкий" },
  ];

  const SORT_OPTIONS = [
    { value: "closest", label: "Ближайший дедлайн" },
    { value: "farthest", label: "Дальний дедлайн" },
    { value: "recentlyCreated", label: "Недавно добавленные" },
  ];

  const uiState = {
    search: "",
    filters: {
      status: "all",
      priority: "all",
      responsible: "all",
    },
    sort: "closest",
  };

  let tasksRoot = null;
  let userChip = null;
  let modalRoot = null;
  let customSelectGlobalHandlersBound = false;

  let allTasks = [];
  let currentUser = null;
  let isLoadingTasks = true;
  let tasksError = null;
  let hashListenerBound = false;
  let pendingTaskHashId = null;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    tasksRoot = document.getElementById("tasksRoot");
    userChip = document.getElementById("userChip");
    modalRoot = document.getElementById("modalRoot");
    if (!modalRoot) {
      modalRoot = document.createElement("div");
      modalRoot.id = "modalRoot";
      document.body.appendChild(modalRoot);
    }

    currentUser = ensureUserProfile();
    renderUserChip();
    renderTasksView();
    bindStaticListeners();
    bindHashChangeListener();
    openTaskFromHash();
    loadTasksFromServer();
  }

  function bindStaticListeners() {
    if (!tasksRoot) return;
    tasksRoot.addEventListener("click", (event) => {
      const actionBtn = event.target.closest("[data-action]");
      if (actionBtn) {
        const { action, id } = actionBtn.dataset;
        if (action === "details") {
          openTaskDetailModal(id);
        } else if (action === "edit") {
          const task = allTasks.find((item) => item.id === id);
          if (task) openTaskFormModal(task);
        }
        return;
      }

      const card = event.target.closest(".task-card");
      if (card && !event.target.closest("button")) {
        const { taskId } = card.dataset;
        if (taskId) openTaskDetailModal(taskId);
      }
    });

    tasksRoot.addEventListener("keydown", (event) => {
      const card = event.target.closest(".task-card");
      if (!card) return;
      const { taskId } = card.dataset;
      if (!taskId) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openTaskDetailModal(taskId);
      }
    });
  }

  function ensureUserProfile() {
    const raw = safeStorageGet(STORAGE_KEYS.user);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed) return parsed;
      } catch {
        /* ignore bad payload */
      }
    }
    safeStorageSet(STORAGE_KEYS.user, JSON.stringify(DEFAULT_USER));
    return DEFAULT_USER;
  }

  async function loadTasksFromServer() {
    isLoadingTasks = true;
    tasksError = null;
    renderTasksView();
    try {
      const remoteTasks = await apiFetchTasks();
      allTasks = Array.isArray(remoteTasks) ? remoteTasks : [];
      openPendingTaskFromHash();
    } catch (error) {
      console.error("Failed to load tasks", error);
      tasksError =
        error instanceof Error ? error.message : "Не удалось загрузить задачи. Попробуйте позже.";
    } finally {
      isLoadingTasks = false;
      renderTasksView();
    }
  }

  function renderUserChip() {
    if (!userChip) return;
    userChip.textContent = `${currentUser.role} • ${currentUser.login}`;
  }

  function renderTasksView() {
    if (!tasksRoot) return;
    const filteredTasks = getVisibleTasks();
    const responsibles = Array.from(new Set(allTasks.map((task) => task.responsible))).sort();
    const stats = summarizeTasks(allTasks);

    tasksRoot.innerHTML = `
      <section class="panel">
        <div class="panel__header">
          <div>
            <h2 class="panel__title">Добрый день, ${escapeHtml(currentUser.name.split(" ")[0])}</h2>
            <p class="panel__subtitle">
              Всего задач: ${allTasks.length}. В работе: ${stats.in_progress}. В ожидании: ${
      stats.pending
    }.
            </p>
          </div>
          <button class="primary-btn" id="addTaskBtn" type="button">
            <span>+ Новая задача</span>
          </button>
        </div>
      </section>

      <section class="panel">
        <div class="controls-bar">
          <input
            type="search"
            id="searchInput"
            class="search-input"
            placeholder="Поиск по названию или описанию"
            value="${escapeHtml(uiState.search)}"
          />
          ${renderCustomSelect({
            id: "status",
            label: "Статус",
            options: STATUS_FILTER_OPTIONS,
            value: uiState.filters.status,
          })}
          ${renderCustomSelect({
            id: "priority",
            label: "Приоритет",
            options: PRIORITY_FILTER_OPTIONS,
            value: uiState.filters.priority,
          })}
          ${renderCustomSelect({
            id: "responsible",
            label: "Ответственный",
            options: buildResponsibleOptions(responsibles),
            value: uiState.filters.responsible,
          })}
          ${renderCustomSelect({
            id: "sort",
            label: "Сортировка",
            options: SORT_OPTIONS,
            value: uiState.sort,
          })}
        </div>
      </section>

      <section id="tasksSection"></section>
    `;

    initCustomSelects(tasksRoot);
    renderTaskCards(filteredTasks);
    bindControlHandlers();
  }

  function bindControlHandlers() {
    const addBtn = document.getElementById("addTaskBtn");
    const searchInput = document.getElementById("searchInput");
    if (addBtn) addBtn.addEventListener("click", () => openTaskFormModal());
    if (searchInput)
      searchInput.addEventListener("input", (event) => {
        const inputEl = event.currentTarget;
        const { selectionStart, selectionEnd } = inputEl;
        uiState.search = inputEl.value.trim();
        updateTaskList();
        requestAnimationFrame(() => {
          inputEl.focus();
          if (selectionStart !== null && selectionEnd !== null) {
            inputEl.setSelectionRange(selectionStart, selectionEnd);
          }
        });
      });
  }

  function updateTaskList() {
    renderTaskCards(getVisibleTasks());
  }

  function renderTaskCards(tasks) {
    const section = document.getElementById("tasksSection");
    if (!section) return;

    if (isLoadingTasks) {
      section.innerHTML = `
        <div class="empty-state">
          <h3>Загружаем задачи...</h3>
          <p>Подождите немного, мы уже тянем данные из общей базы.</p>
        </div>
      `;
      return;
    }

    if (tasksError) {
      section.innerHTML = `
        <div class="empty-state">
          <h3>Не удалось получить список задач</h3>
          <p>${escapeHtml(tasksError)}</p>
          <button class="primary-btn" type="button" data-role="reload-tasks">Повторить попытку</button>
        </div>
      `;
      const retryBtn = section.querySelector("[data-role='reload-tasks']");
      if (retryBtn) retryBtn.addEventListener("click", () => loadTasksFromServer());
      return;
    }

    if (!tasks.length) {
      section.innerHTML = `
        <div class="empty-state">
          <h3>Пока нет задач</h3>
          <p>Самое время создать первую и задать темп команде!</p>
          <button class="primary-btn" type="button" id="emptyStateCreateBtn">+ Новая задача</button>
        </div>
      `;
      const cta = document.getElementById("emptyStateCreateBtn");
      if (cta) cta.addEventListener("click", () => openTaskFormModal());
      return;
    }

    const cards = tasks
      .map(
        (task) => `
        <article class="task-card" data-task-id="${task.id}" tabindex="0">
          <div class="pill ${PRIORITY_META[task.priority]?.className || ""}">
            ${PRIORITY_META[task.priority]?.label || "Приоритет"}
          </div>
          <h3 class="task-card__title">${escapeHtml(task.title)}</h3>
          <div class="task-meta">
            <span>Дедлайн: ${formatDeadline(task.deadline)}</span>
            <span>Ответственный: ${escapeHtml(task.responsible)}</span>
          </div>
          <div class="status-chip ${STATUS_META[task.status]?.className || ""}">
            ${STATUS_META[task.status]?.label || "Статус"}
          </div>
          <div class="card-actions">
            <button class="link-btn" data-action="details" data-id="${task.id}">Подробнее</button>
            <button class="ghost-btn" data-action="edit" data-id="${task.id}">Редактировать</button>
          </div>
        </article>
      `
      )
      .join("");

    section.innerHTML = `<div class="tasks-grid">${cards}</div>`;
  }

  function getVisibleTasks() {
    return [...allTasks]
      .filter((task) => {
        if (uiState.filters.status !== "all" && task.status !== uiState.filters.status) {
          return false;
        }
        if (uiState.filters.priority !== "all" && task.priority !== uiState.filters.priority) {
          return false;
        }
        if (
          uiState.filters.responsible !== "all" &&
          task.responsible !== uiState.filters.responsible
        ) {
          return false;
        }
        if (uiState.search) {
          const haystack = `${task.title} ${task.description ?? ""} ${task.responsible}`.toLowerCase();
          return haystack.includes(uiState.search.toLowerCase());
        }
        return true;
      })
      .sort((a, b) => {
        if (uiState.sort === "recentlyCreated") {
          return new Date(b.createdAt) - new Date(a.createdAt);
        }
        if (uiState.sort === "farthest") {
          return new Date(b.deadline) - new Date(a.deadline);
        }
        return new Date(a.deadline) - new Date(b.deadline);
      });
  }

  function summarizeTasks(tasks) {
    return tasks.reduce(
      (acc, task) => {
        acc[task.status] = (acc[task.status] || 0) + 1;
        return acc;
      },
      { pending: 0, in_progress: 0, done: 0 }
    );
  }

  function openTaskDetailModal(taskId) {
    const modal = createModal();
    pendingTaskHashId = null;
    setTaskHash(taskId);
    const originalClose = modal.close;
    modal.close = () => {
      clearTaskHash(taskId);
      originalClose();
    };

    const rerender = () => {
      const task = allTasks.find((item) => item.id === taskId);
      if (!task) {
        modal.close();
        return;
      }
      modal.setContent(buildTaskDetailMarkup(task));
      initCustomSelects(modal.element);
      bindTaskDetailEvents(modal.element, task, rerender, modal.close);
    };

    rerender();
  }

  function buildTaskDetailMarkup(task) {
    const attachments = task.attachments?.length
      ? `<div class="attachment-list attachment-list--chips">
          ${task.attachments
            .map(
              (file) => {
                const label = escapeHtml(file.label || file.url);
                const href = escapeHtml(file.url);
                return `<a href="${href}" class="attachment-link" target="_blank" rel="noreferrer">${label}</a>`;
              }
            )
            .join("")}
        </div>`
      : "<p>Нет материалов</p>";

    const subtasks = task.subtasks?.length
      ? `<div class="subtasks-list">
          ${task.subtasks
            .map(
              (item) => `
              <label class="subtask-item">
                <input type="checkbox" data-role="subtask-toggle" data-id="${item.id}" ${
                  item.done ? "checked" : ""
                }/>
                <span>${escapeHtml(item.text)}</span>
              </label>
            `
            )
            .join("")}
        </div>`
      : "<p>Нет подзадач</p>";

    return `
      <div class="modal__header modal__header--stacked">
        <div class="modal__actions modal__actions--row">
          <button class="ghost-btn" type="button" data-role="copy-task-link">Скопировать ссылку</button>
          <button class="modal__close" data-close-modal aria-label="Закрыть">×</button>
        </div>
        <div class="modal__title-block">
          <h2 class="modal__title">${escapeHtml(task.title)}</h2>
          <p class="panel__subtitle">Дедлайн: ${formatDeadline(task.deadline)}</p>
        </div>
      </div>

      <div class="detail-meta">
        <div class="detail-meta__item">
          <p class="detail-meta__label">Ответственный</p>
          <p class="detail-meta__value">${escapeHtml(task.responsible || "—")}</p>
        </div>
        <div class="detail-meta__item ${PRIORITY_META[task.priority]?.itemClass || ""}">
          <p class="detail-meta__label">Приоритет</p>
          <p class="detail-meta__value ${PRIORITY_META[task.priority]?.detailClass || ""}">
            ${PRIORITY_META[task.priority]?.label || "—"}
          </p>
        </div>
      </div>

      <div>
        <h4>Описание</h4>
        <p>${escapeHtml(task.description || "Без описания")}</p>
      </div>

      <div>
        <h4>Материалы</h4>
        ${attachments}
      </div>

      <div>
        <h4>Подзадачи</h4>
        ${subtasks}
      </div>

      <form id="statusForm" class="form-grid">
        <div class="form-group">
          <label for="detailStatus-trigger">Статус</label>
          ${renderCustomSelect({
            id: "detailStatus",
            label: "Статус",
            options: Object.entries(STATUS_META).map(([value, meta]) => ({
              value,
              label: meta.label,
            })),
            value: task.status,
            name: "status",
            selectType: "form",
          })}
        </div>
        <div class="form-group" style="align-self: flex-end;">
          <button class="primary-btn" type="submit">Обновить статус</button>
        </div>
      </form>

      <div class="modal__footer modal__footer--split">
        <button class="ghost-btn ghost-btn--danger" type="button" data-role="delete-task" data-id="${task.id}">
          Удалить задачу
        </button>
        <button class="ghost-btn" type="button" data-role="edit-task" data-id="${task.id}">
          Редактировать
        </button>
      </div>
    `;
  }

  function bindTaskDetailEvents(container, task, rerender, closeModal) {
    const statusForm = container.querySelector("#statusForm");

    if (statusForm) {
      statusForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(statusForm);
        const newStatus = formData.get("status");
        if (!newStatus || newStatus === task.status) {
          rerender();
          return;
        }
        try {
          await handleTaskUpdate(task.id, { status: newStatus });
          rerender();
        } catch (error) {
          showErrorMessage(getErrorMessage(error, "Не удалось обновить статус задачи"));
        }
      });
    }

    container.querySelectorAll("[data-role='subtask-toggle']").forEach((checkbox) => {
      checkbox.addEventListener("change", async (event) => {
        const subtaskId = event.target.dataset.id;
        const updatedSubtasks = task.subtasks.map((subtask) =>
          subtask.id === subtaskId ? { ...subtask, done: event.target.checked } : subtask
        );
        try {
          await handleTaskUpdate(task.id, { subtasks: updatedSubtasks });
          rerender();
        } catch (error) {
          event.target.checked = !event.target.checked;
          showErrorMessage(getErrorMessage(error, "Не удалось обновить подзадачу"));
        }
      });
    });

    const copyLinkBtn = container.querySelector("[data-role='copy-task-link']");
    if (copyLinkBtn) {
      copyLinkBtn.addEventListener("click", async () => {
        try {
          await copyTaskLink(task.id);
          window.alert("Ссылка на задачу скопирована");
        } catch (error) {
          showErrorMessage(
            getErrorMessage(error, "Не удалось скопировать ссылку на задачу")
          );
        }
      });
    }

    const editBtn = container.querySelector("[data-role='edit-task']");
    if (editBtn) {
      editBtn.addEventListener("click", () => {
        closeModal();
        openTaskFormModal(task);
      });
    }

    const deleteBtn = container.querySelector("[data-role='delete-task']");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        const confirmed = window.confirm("Удалить эту задачу?");
        if (!confirmed) return;
        try {
          await handleTaskDelete(task.id);
          closeModal();
        } catch (error) {
          showErrorMessage(getErrorMessage(error, "Не удалось удалить задачу"));
        }
      });
    }
  }

  function openTaskFormModal(task) {
    const modal = createModal();
    const isEdit = Boolean(task);

    const rerender = (currentTask = task) => {
      modal.setContent(buildTaskFormMarkup(currentTask, isEdit));
      initCustomSelects(modal.element);
      bindTaskFormEvents(modal.element, currentTask, isEdit, modal.close, rerender);
    };

    rerender(task);
  }

  function buildTaskFormMarkup(task, isEdit) {
    return `
      <form id="taskForm">
        <div class="modal__header">
          <div>
            <p class="workspace__eyebrow">${isEdit ? "Редактирование" : "Новая задача"}</p>
            <h2 class="modal__title">${isEdit ? "Редактировать задачу" : "Создать задачу"}</h2>
          </div>
          <button class="modal__close" data-close-modal aria-label="Закрыть">×</button>
        </div>

        <div class="form-grid">
          <div class="form-group form-group--full">
            <label for="titleField">Заголовок*</label>
            <input id="titleField" name="title" required value="${escapeHtml(task?.title || "")}" />
          </div>
          <div class="form-group">
            <label for="responsibleField">Ответственный*</label>
            <input
              id="responsibleField"
              name="responsible"
              required
              value="${escapeHtml(task?.responsible || "")}"
            />
          </div>
          <div class="form-group">
            <label for="deadlineField">Дедлайн*</label>
            <input
              id="deadlineField"
              type="datetime-local"
              name="deadline"
              required
              value="${task?.deadline ? toDatetimeLocal(task.deadline) : ""}"
            />
          </div>
          <div class="form-group">
            <label for="priorityField-trigger">Приоритет</label>
            ${renderCustomSelect({
              id: "priorityField",
              label: "Приоритет",
              options: Object.entries(PRIORITY_META).map(([value, meta]) => ({
                value,
                label: meta.label,
              })),
              value: task?.priority ?? "medium",
              name: "priority",
              selectType: "form",
            })}
          </div>
          <div class="form-group">
            <label for="statusField-trigger">Статус</label>
            ${renderCustomSelect({
              id: "statusField",
              label: "Статус",
              options: Object.entries(STATUS_META).map(([value, meta]) => ({
                value,
                label: meta.label,
              })),
              value: task?.status ?? "pending",
              name: "status",
              selectType: "form",
            })}
          </div>
        </div>

        <div class="form-group form-block">
          <label for="descriptionField">Описание</label>
          <textarea id="descriptionField" name="description">${escapeHtml(
            task?.description || ""
          )}</textarea>
        </div>

        <div class="form-group form-block">
          <label>Подзадачи</label>
          <div class="subtasks-list" id="subtasksList">
            ${renderSubtaskRows(task?.subtasks || [])}
          </div>
          <button class="ghost-btn" type="button" data-role="add-subtask">+ Подзадача</button>
        </div>

        <div class="form-group form-block">
          <label>Материалы (ссылки)</label>
          <div class="attachment-list" id="attachmentsList">
            ${renderAttachmentRows(task?.attachments || [])}
          </div>
          <button class="ghost-btn" type="button" data-role="add-attachment">+ Материал</button>
        </div>

        <div class="modal__footer">
          <button class="ghost-btn" type="button" data-close-modal>Отмена</button>
          <button class="primary-btn" type="submit">${isEdit ? "Сохранить" : "Создать"}</button>
        </div>
      </form>
    `;
  }

  function renderSubtaskRows(subtasks) {
    if (!subtasks.length) {
      return "";
    }
    return subtasks
      .map(
        (subtask) => `
          <div class="subtask-item" data-id="${subtask.id}">
            <input type="checkbox" ${subtask.done ? "checked" : ""} />
            <input type="text" value="${escapeHtml(subtask.text)}" placeholder="Текст подзадачи" />
            <button type="button" class="ghost-btn" data-role="remove-subtask">×</button>
          </div>
        `
      )
      .join("");
  }

  function renderAttachmentRows(attachments) {
    if (!attachments.length) {
      return "";
    }
    return attachments
      .map(
        (item) => `
          <div class="subtask-item" data-id="${item.id}">
            <input type="text" value="${escapeHtml(item.label || "")}" placeholder="Название" />
            <input type="url" value="${escapeHtml(item.url || "")}" placeholder="https://..." />
            <button type="button" class="ghost-btn" data-role="remove-attachment">×</button>
          </div>
        `
      )
      .join("");
  }

  function bindTaskFormEvents(container, task, isEdit, closeModal, rerender) {
    const form = container.querySelector("#taskForm");
    if (!form) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const formData = new FormData(form);
      const payload = {
        id: task?.id || uid(),
        title: formData.get("title").trim(),
        responsible: formData.get("responsible").trim(),
        deadline: new Date(formData.get("deadline")).toISOString(),
        priority: formData.get("priority"),
        status: formData.get("status"),
        description: formData.get("description")?.trim() || "",
        attachments: collectAttachments(container),
        subtasks: collectSubtasks(container),
        createdAt: task?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      try {
        if (isEdit) {
          await handleTaskUpdate(payload.id, payload);
        } else {
          await handleTaskCreate(payload);
        }
        closeModal();
      } catch (error) {
        const message = getErrorMessage(
          error,
          isEdit ? "Не удалось сохранить задачу" : "Не удалось создать задачу"
        );
        showErrorMessage(message);
      }
    });

    container.querySelectorAll("[data-role='add-subtask']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const list = container.querySelector("#subtasksList");
        list.insertAdjacentHTML(
          "beforeend",
          `
            <div class="subtask-item" data-id="${uid()}">
              <input type="checkbox" />
              <input type="text" placeholder="Текст подзадачи" />
              <button type="button" class="ghost-btn" data-role="remove-subtask">×</button>
            </div>
          `
        );
      });
    });

    container.querySelectorAll("[data-role='add-attachment']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const list = container.querySelector("#attachmentsList");
        list.insertAdjacentHTML(
          "beforeend",
          `
            <div class="subtask-item" data-id="${uid()}">
              <input type="text" placeholder="Название" />
              <input type="url" placeholder="https://..." />
              <button type="button" class="ghost-btn" data-role="remove-attachment">×</button>
            </div>
          `
        );
      });
    });

    container.addEventListener("click", (event) => {
      if (event.target.matches("[data-role='remove-subtask']")) {
        event.target.closest(".subtask-item")?.remove();
      }
      if (event.target.matches("[data-role='remove-attachment']")) {
        event.target.closest(".subtask-item")?.remove();
      }
    });
  }

  function collectSubtasks(container) {
    return Array.from(container.querySelectorAll("#subtasksList .subtask-item"))
      .map((row) => {
        const textField = row.querySelector('input[type="text"]');
        if (!textField) return null;
        const text = textField.value.trim();
        if (!text) return null;
        const checkbox = row.querySelector('input[type="checkbox"]');
        return {
          id: row.dataset.id || uid(),
          text,
          done: checkbox?.checked || false,
        };
      })
      .filter(Boolean);
  }

  function collectAttachments(container) {
    return Array.from(container.querySelectorAll("#attachmentsList .subtask-item"))
      .map((row) => {
        const nameField = row.querySelector('input[type="text"]');
        const urlField = row.querySelector('input[type="url"]');
        const label = nameField?.value.trim();
        const url = urlField?.value.trim();
        if (!url) return null;
        return {
          id: row.dataset.id || uid(),
          label: label || url,
          url,
        };
      })
      .filter(Boolean);
  }

  function createModal() {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modalElement = document.createElement("div");
    modalElement.className = "modal";
    backdrop.appendChild(modalElement);
    if (!modalRoot) {
      modalRoot = document.createElement("div");
      modalRoot.id = "modalRoot";
      document.body.appendChild(modalRoot);
    }
    modalRoot.innerHTML = "";
    modalRoot.appendChild(backdrop);
    document.body.style.overflow = "hidden";

    const handleKey = (event) => {
      if (event.key === "Escape") close();
    };

    const close = () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKey);
      modalRoot.innerHTML = "";
    };

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        close();
      }
    });

    window.addEventListener("keydown", handleKey);

    modalElement.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-modal]")) {
        close();
      }
    });

    return {
      element: modalElement,
      close,
      setContent(html) {
        modalElement.innerHTML = html;
      },
    };
  }

  async function handleTaskCreate(payload) {
    try {
      const created = await apiCreateTask(payload);
      applyTasksState([created, ...allTasks]);
      return created;
    } catch (error) {
      throw enhanceError(error, "Не удалось создать задачу");
    }
  }

  async function handleTaskUpdate(taskId, updates) {
    try {
      const saved = await apiUpdateTask(taskId, updates);
      applyTasksState(allTasks.map((task) => (task.id === saved.id ? saved : task)));
      return saved;
    } catch (error) {
      throw enhanceError(error, "Не удалось обновить задачу");
    }
  }

  async function handleTaskDelete(taskId) {
    try {
      await apiDeleteTask(taskId);
      applyTasksState(allTasks.filter((task) => task.id !== taskId));
    } catch (error) {
      throw enhanceError(error, "Не удалось удалить задачу");
    }
  }

  function applyTasksState(nextTasks) {
    allTasks = nextTasks;
    renderTasksView();
  }

  function bindHashChangeListener() {
    if (hashListenerBound) return;
    hashListenerBound = true;
    window.addEventListener("hashchange", () => {
      openTaskFromHash();
    });
  }

  function openTaskFromHash() {
    const taskId = getTaskIdFromHash();
    if (!taskId) {
      pendingTaskHashId = null;
      return;
    }
    const taskExists = allTasks.some((task) => task.id === taskId);
    if (taskExists) {
      openTaskDetailModal(taskId);
      pendingTaskHashId = null;
    } else {
      pendingTaskHashId = taskId;
    }
  }

  function openPendingTaskFromHash() {
    if (!pendingTaskHashId) return;
    const taskExists = allTasks.some((task) => task.id === pendingTaskHashId);
    if (taskExists) {
      openTaskDetailModal(pendingTaskHashId);
      pendingTaskHashId = null;
    }
  }

  function getTaskIdFromHash() {
    const { hash } = window.location;
    if (!hash || !hash.startsWith("#task=")) return null;
    return decodeURIComponent(hash.slice(6));
  }

  function setTaskHash(taskId) {
    if (!taskId) return;
    const url = new URL(window.location.href);
    url.hash = `task=${encodeURIComponent(taskId)}`;
    history.replaceState(null, "", url);
  }

  function clearTaskHash(taskId) {
    const current = getTaskIdFromHash();
    if (!current) {
      pendingTaskHashId = null;
      return;
    }
    if (!taskId || current === taskId) {
      const url = new URL(window.location.href);
      url.hash = "";
      history.replaceState(null, "", url);
      pendingTaskHashId = null;
    }
  }

  function getTaskShareUrl(taskId) {
    const { origin, pathname, search } = window.location;
    return `${origin}${pathname}${search}#task=${encodeURIComponent(taskId)}`;
  }

  async function copyTaskLink(taskId) {
    const shareUrl = getTaskShareUrl(taskId);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      return;
    }
    const tempInput = document.createElement("textarea");
    tempInput.value = shareUrl;
    tempInput.setAttribute("readonly", "");
    tempInput.style.position = "absolute";
    tempInput.style.left = "-9999px";
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand("copy");
    document.body.removeChild(tempInput);
  }

  async function apiFetchTasks() {
    return requestJson("/tasks");
  }

  async function apiCreateTask(payload) {
    return requestJson("/tasks", { method: "POST", body: payload });
  }

  async function apiUpdateTask(taskId, updates) {
    return requestJson(`/tasks/${encodeURIComponent(taskId)}`, { method: "PUT", body: updates });
  }

  async function apiDeleteTask(taskId) {
    await requestJson(`/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
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
      throw new Error(message);
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

  function showErrorMessage(message) {
    window.alert(message);
  }

  function formatDeadline(isoString) {
    if (!isoString) return "—";
    try {
      const date = new Date(isoString);
      return new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
    } catch {
      return isoString;
    }
  }

  function toDatetimeLocal(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  function uid() {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function buildResponsibleOptions(items) {
    const base = [{ value: "all", label: "Все ответственные" }];
    const unique = [...new Set(items.filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "ru"))
      .map((name) => ({
        value: name,
        label: name,
      }));
    return base.concat(unique);
  }

  function renderCustomSelect({ id, label, options, value, name, selectType = "filter" }) {
    const current = options.find((option) => option.value === value) || options[0];
    const normalizedValue = current?.value ?? value ?? options[0]?.value ?? "";
    const safeId = escapeHtml(id);
    const safeLabel = escapeHtml(label);
    const triggerId = `${safeId}-trigger`;
    const datasetAttrs = [
      `data-select="${safeId}"`,
      `data-select-type="${escapeHtml(selectType)}"`,
      `data-value="${escapeHtml(normalizedValue)}"`,
    ];
    if (name) {
      datasetAttrs.push(`data-name="${escapeHtml(name)}"`);
    }
    return `
      <div class="custom-select" ${datasetAttrs.join(" ")}>
        <button
          type="button"
          class="custom-select__trigger"
          id="${triggerId}"
          aria-haspopup="listbox"
          aria-expanded="false"
          aria-label="${safeLabel}"
        >
          <span class="custom-select__value">${escapeHtml(current?.label || "")}</span>
          <span class="custom-select__chevron" aria-hidden="true">▾</span>
        </button>
        <ul class="custom-select__list" role="listbox">
          ${options
            .map(
              (option) => `
                <li>
                  <button
                    type="button"
                    class="custom-select__option ${option.value === normalizedValue ? "is-selected" : ""}"
                    data-value="${escapeHtml(option.value)}"
                  >
                    ${escapeHtml(option.label)}
                  </button>
                </li>
              `
            )
            .join("")}
        </ul>
        ${name ? `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(normalizedValue)}" />` : ""}
      </div>
    `;
  }

  function initCustomSelects(root = document) {
    const scope = root || document;
    const components = scope.querySelectorAll(".custom-select");
    components.forEach((selectEl) => {
      if (selectEl.dataset.bound === "true") return;
      selectEl.dataset.bound = "true";

      const trigger = selectEl.querySelector(".custom-select__trigger");
      if (trigger) {
        trigger.addEventListener("click", (event) => {
          event.stopPropagation();
          const alreadyOpen = selectEl.classList.contains("is-open");
          closeAllSelects();
          if (!alreadyOpen) {
            openSelect(selectEl);
          }
        });
      }

      selectEl.querySelectorAll(".custom-select__option").forEach((optionBtn) => {
        optionBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          const value = optionBtn.dataset.value;
          const label = optionBtn.textContent.trim();
          setCustomSelectValue(selectEl, value, label);
          handleCustomSelectChange(selectEl.dataset.select, value);
          closeAllSelects();
        });
      });
    });

    ensureCustomSelectGlobalHandlers();
  }

  function ensureCustomSelectGlobalHandlers() {
    if (customSelectGlobalHandlersBound) return;
    customSelectGlobalHandlersBound = true;

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".custom-select")) {
        closeAllSelects();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeAllSelects();
      }
    });
  }

  function openSelect(selectEl) {
    selectEl.classList.add("is-open");
    const trigger = selectEl.querySelector(".custom-select__trigger");
    if (trigger) trigger.setAttribute("aria-expanded", "true");
  }

  function closeAllSelects() {
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

  function handleCustomSelectChange(selectName, value) {
    switch (selectName) {
      case "status":
        uiState.filters.status = value;
        break;
      case "priority":
        uiState.filters.priority = value;
        break;
      case "responsible":
        uiState.filters.responsible = value;
        break;
      case "sort":
        uiState.sort = value;
        break;
      default:
        return;
    }
    updateTaskList();
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
      /* storage might be disabled; keep data in memory only */
    }
  }

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
