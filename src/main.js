import "./style.css";
import clientStore from "@x-labs-myid/omnistorage";

document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const engineSelector = document.getElementById("engineSelector");
  const dbNameText = document.getElementById("dbNameText");
  const activeEngineText = document.getElementById("activeEngineText");
  const totalTodosText = document.getElementById("totalTodosText");
  const storageSizeText = document.getElementById("storageSizeText");
  const todoForm = document.getElementById("todoForm");
  const todoTitle = document.getElementById("todoTitle");
  const todoDescription = document.getElementById("todoDescription");
  const todoList = document.getElementById("todoList");
  const searchTodo = document.getElementById("searchTodo");
  const refreshBtn = document.getElementById("refreshBtn");
  const clearBtn = document.getElementById("clearBtn");
  const logsTableBody = document.getElementById("logsTableBody");
  const clearLogsBtn = document.getElementById("clearLogsBtn");
  const storageLabel = document.getElementById("storageLabel");
  const logsLabel = document.getElementById("logsLabel");

  // Toast bootstrap setup
  const toastEl = document.getElementById("liveToast");
  let toast;
  try {
    toast = new bootstrap.Toast(toastEl, { delay: 3000 });
  } catch (e) {
    // fallback if bootstrap object is not globally ready yet
    toast = { show: () => console.log("Toast show") };
  }
  const toastMsg = document.getElementById("toastMsg");
  const toastIcon = document.getElementById("toastIcon");

  const DB_NAME = "omnistorage_crud";

  // Local state
  let allTodos = [];
  let clientLogs = [];

  // Mode state: 'client' or 'server'
  let activeMode = "server"; // default select value is 'file' (server)
  let activeEngine = "file";

  function unwrapData(result, fallback = null) {
    if (result && typeof result === "object" && "data" in result) {
      return result.data ?? fallback;
    }

    return result ?? fallback;
  }

  function normalizeEntries(data) {
    if (Array.isArray(data)) {
      return data.map((item) => {
        if (Array.isArray(item)) return item;
        const key = item?.key ?? item?.id;
        const value = item?.value ?? item?.data ?? item;
        return [key, value];
      });
    }

    return Object.entries(data ?? {});
  }

  async function getClientAllValues() {
    try {
      return unwrapData(await clientStore.findAll(), {});
    } catch (error) {
      if (typeof clientStore.defaultEngine?.getAll === "function") {
        return clientStore.defaultEngine.getAll();
      }

      throw error;
    }
  }

  async function getClientStatistics() {
    try {
      return unwrapData(await clientStore.getStatistics(), {});
    } catch (error) {
      if (typeof clientStore.defaultEngine?.getStats === "function") {
        return clientStore.defaultEngine.getStats();
      }

      throw error;
    }
  }

  async function getClientTodoEntries() {
    const data = await getClientAllValues();
    return normalizeEntries(data).filter(
      ([key]) => typeof key === "string" && key.startsWith("todo_"),
    );
  }

  async function configureClientStore(engine) {
    await clientStore.init({
      db: {
        name: DB_NAME,
        engine,
      },
      logs: "client",
    });

    clientStore.db(DB_NAME).use(engine);
  }

  function syncServerEngineOptions(availableEngines = []) {
    const serverOptionMap = {
      file: "file",
      "sqlite-server": "sqlite-server",
      "memory-server": "memory",
    };

    for (const [optionValue, engineName] of Object.entries(serverOptionMap)) {
      const option = engineSelector.querySelector(
        `option[value="${optionValue}"]`,
      );
      if (option) option.disabled = !availableEngines.includes(engineName);
    }
  }

  // Hook up client store logs
  function addClientLog(operation, key, status, message = "") {
    clientLogs.unshift({
      timestamp: Date.now(),
      operation,
      engine: activeEngine === "memory-client" ? "memory" : activeEngine,
      status,
      key,
      message,
    });
    // Limit to 50 logs
    if (clientLogs.length > 50) {
      clientLogs.pop();
    }
  }

  // Monitor clientStore actions using hooks
  clientStore.on("onSet", (data) => {
    addClientLog(data.mode || "set", data.key, "success");
  });
  clientStore.on("onGet", (data) => {
    addClientLog(
      "get",
      data.key,
      "success",
      data.isValid === false ? "Validation failed" : "",
    );
  });
  clientStore.on("onDelete", (data) => {
    addClientLog("delete", data.key, "success");
  });
  clientStore.on("onClear", (data) => {
    addClientLog("truncate", "*", "success");
  });

  // Show Toast Helper
  function showToast(message, type = "info") {
    if (!toastMsg) return;
    toastMsg.textContent = message;
    toastIcon.className = "fa-solid me-2 ";

    if (type === "success") {
      toastIcon.classList.add("fa-circle-check", "text-success");
      toastEl.className =
        "toast align-items-center text-white bg-dark border border-success";
    } else if (type === "error") {
      toastIcon.classList.add("fa-triangle-exclamation", "text-danger");
      toastEl.className =
        "toast align-items-center text-white bg-dark border border-danger";
    } else {
      toastIcon.classList.add("fa-circle-info", "text-info");
      toastEl.className =
        "toast align-items-center text-white bg-dark border border-info";
    }

    try {
      toast.show();
    } catch (e) {}
  }

  // Load Configurations and Stats
  async function updateDashboardStats() {
    if (activeMode === "client") {
      storageLabel.textContent = "Client";
      storageLabel.className = "badge bg-info fs-6 ms-2";
      logsLabel.textContent = "";
      logsLabel.className = "d-none";

      dbNameText.textContent = DB_NAME;
      activeEngineText.textContent = `${activeEngine === "memory-client" ? "memory" : activeEngine} (client)`;
      activeEngineText.className = "fw-bold m-0 text-capitalize text-info";

      // Get stats
      try {
        const stats = await getClientStatistics();
        storageSizeText.textContent =
          stats.totalSizeFormatted || stats.sizeFormatted || "0.00 KB";
      } catch (err) {
        storageSizeText.textContent = "N/A";
      }
    } else {
      storageLabel.textContent = "Server";
      storageLabel.className = "badge bg-primary fs-6 ms-2";
      logsLabel.textContent = "";
      logsLabel.className = "d-none";

      try {
        const res = await fetch("/api/config");
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        dbNameText.textContent = data.dbName || "MyStoreDB";
        activeEngineText.textContent = `${data.activeEngine} (server)`;
        activeEngineText.className = "fw-bold m-0 text-capitalize text-success";
        syncServerEngineOptions(data.availableEngines || []);

        if (activeMode === "server") {
          const selectorValue =
            data.activeEngine === "memory"
              ? "memory-server"
              : data.activeEngine;
          if (engineSelector.value !== selectorValue) {
            engineSelector.value = selectorValue;
            activeEngine = selectorValue;
          }
        }

        if (data.stats && !data.stats.error) {
          storageSizeText.textContent =
            data.stats.totalSizeFormatted ||
            data.stats.sizeFormatted ||
            "0.00 KB";
        } else {
          storageSizeText.textContent = "N/A";
        }
      } catch (err) {
        console.error("Error loading config:", err);
        showToast("Error loading stats from server", "error");
      }
    }
  }

  // Switch Storage Engine
  async function handleSwitchEngine(selectedVal) {
    activeEngine = selectedVal;

    if (
      ["local", "session", "cookie", "indexeddb", "memory-client"].includes(
        selectedVal,
      )
    ) {
      activeMode = "client";
      const engineName =
        selectedVal === "memory-client" ? "memory" : selectedVal;
      try {
        await configureClientStore(engineName);
        showToast(
          `Switched storage to client-side "${engineName}" engine.`,
          "success",
        );
      } catch (err) {
        showToast(`Client engine error: ${err.message}`, "error");
      }
    } else {
      activeMode = "server";
      const serverEngineName =
        selectedVal === "memory-server" ? "memory" : selectedVal;
      try {
        const res = await fetch("/api/config/engine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ engine: serverEngineName }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        showToast(
          `Switched storage to server-side "${serverEngineName}" engine.`,
          "success",
        );
      } catch (err) {
        showToast(`Server engine error: ${err.message}`, "error");
      }
    }

    await updateDashboardStats();
    await fetchTodos();
    await fetchLogs();
  }

  // Fetch Todos
  async function fetchTodos() {
    try {
      if (activeMode === "client") {
        const entries = await getClientTodoEntries();
        const todos = [];
        for (const [key, val] of entries) {
          try {
            const parsed = typeof val === "string" ? JSON.parse(val) : val;
            todos.push(parsed);
          } catch (e) {
            console.error(`Failed parsing key ${key}:`, e);
          }
        }
        todos.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        allTodos = todos;
      } else {
        const res = await fetch("/api/todos");
        allTodos = await res.json();
      }

      totalTodosText.textContent = allTodos.length;
      renderTodos(allTodos);
    } catch (err) {
      console.error(err);
      showToast("Error retrieving todos", "error");
    }
  }

  // Render Todos list
  function renderTodos(todosToRender) {
    todoList.innerHTML = "";

    if (todosToRender.length === 0) {
      todoList.innerHTML = `
        <div class="text-center py-5 text-secondary">
          <i class="fa-solid fa-face-smile fs-1 mb-3"></i>
          <p class="m-0">No tasks found. Add a task above!</p>
        </div>
      `;
      return;
    }

    todosToRender.forEach((todo) => {
      const card = document.createElement("div");
      card.className = `glass-panel p-3 hover-card log-item d-flex align-items-center justify-content-between`;

      if (todo.priority === "high") {
        card.style.borderLeft = "4px solid var(--danger-color)";
      } else if (todo.priority === "medium") {
        card.style.borderLeft = "4px solid var(--warning-color)";
      } else {
        card.style.borderLeft = "4px solid var(--success-color)";
      }

      const isCompleted = todo.completed;

      card.innerHTML = `
        <div class="d-flex align-items-center gap-3">
          <input type="checkbox" class="todo-checkbox" ${isCompleted ? "checked" : ""} data-id="${todo.id}">
          <div>
            <h5 class="m-0 fw-bold ${isCompleted ? "completed-todo-title" : ""}">${todo.title}</h5>
            <p class="m-0 small text-secondary">${todo.description || "No description"}</p>
            <span class="badge badge-priority-${todo.priority} small mt-1 text-uppercase text-xs" style="font-size: 0.7rem;">${todo.priority}</span>
            <span class="text-secondary small ms-2" style="font-size: 0.75rem;">${new Date(todo.createdAt).toLocaleString()}</span>
          </div>
        </div>
        <div>
          <button class="btn btn-outline-danger btn-sm border-0 delete-btn" data-id="${todo.id}">
            <i class="fa-regular fa-trash-can fs-5"></i>
          </button>
        </div>
      `;

      todoList.appendChild(card);
    });

    // Event listeners
    document.querySelectorAll(".todo-checkbox").forEach((cb) => {
      cb.addEventListener("change", async (e) => {
        const id = e.target.getAttribute("data-id");
        const completed = e.target.checked;
        await updateTodoStatus(id, completed);
      });
    });

    document.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = e.currentTarget.getAttribute("data-id");
        if (confirm("Delete this task?")) {
          await deleteTodo(id);
        }
      });
    });
  }

  // Create Todo
  todoForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = todoTitle.value.trim();
    const description = todoDescription.value.trim();
    const priority = document.querySelector(
      'input[name="priority"]:checked',
    ).value;

    if (!title) return;

    const id = `todo_${Date.now()}`;
    const todo = {
      id,
      title,
      description,
      priority,
      completed: false,
      createdAt: Date.now(),
    };

    try {
      if (activeMode === "client") {
        const res = await clientStore.create(id, todo);
        if (!res.ok) throw new Error(res.message);
        showToast("Task added to client storage!", "success");
      } else {
        const res = await fetch("/api/todos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, description, priority }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        showToast("Task added to server storage!", "success");
      }

      todoTitle.value = "";
      todoDescription.value = "";
      document.getElementById("prioMedium").checked = true;

      await fetchTodos();
      await updateDashboardStats();
      await fetchLogs();
    } catch (err) {
      showToast("Error saving task: " + err.message, "error");
    }
  });

  // Update Status
  async function updateTodoStatus(id, completed) {
    try {
      if (activeMode === "client") {
        const currentRes = await clientStore.find(id);
        if (!currentRes.ok) throw new Error(currentRes.message);
        const updated = {
          ...currentRes.data,
          completed,
          updatedAt: Date.now(),
        };
        const res = await clientStore.update(id, updated);
        if (!res.ok) throw new Error(res.message);
      } else {
        const res = await fetch(`/api/todos/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
      }

      showToast(
        completed ? "Task completed!" : "Task active again.",
        "success",
      );
      await fetchTodos();
      await updateDashboardStats();
      await fetchLogs();
    } catch (err) {
      showToast("Error updating status: " + err.message, "error");
    }
  }

  // Delete Todo
  async function deleteTodo(id) {
    try {
      if (activeMode === "client") {
        const res = await clientStore.destroy(id);
        if (!res.ok) throw new Error(res.message);
      } else {
        const res = await fetch(`/api/todos/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
      }

      showToast("Task deleted.", "success");
      await fetchTodos();
      await updateDashboardStats();
      await fetchLogs();
    } catch (err) {
      showToast("Error deleting task: " + err.message, "error");
    }
  }

  // Clear Todos
  clearBtn.addEventListener("click", async () => {
    if (!confirm("Clear all tasks in the current engine?")) return;

    try {
      if (activeMode === "client") {
        const todoKeys = (await getClientTodoEntries()).map(([key]) => key);
        if (todoKeys.length > 0) {
          const res = await clientStore.destroyMany(todoKeys);
          if (res && res.ok === false) throw new Error(res.message);
        }
        showToast("Client tasks cleared.", "success");
      } else {
        const res = await fetch("/api/todos/clear", { method: "POST" });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        showToast("Server tasks cleared.", "success");
      }

      await fetchTodos();
      await updateDashboardStats();
      await fetchLogs();
    } catch (err) {
      showToast("Error clearing tasks: " + err.message, "error");
    }
  });

  function getLogTime(log) {
    if (typeof log.timestamp === "number") return log.timestamp;
    const normalized = String(log.timestamp || "").replace(" ", "T");
    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  async function getClientActivityLogs() {
    try {
      const result = await clientStore.getActivityLogs(50);
      const logs = unwrapData(result, []);
      return Array.isArray(logs) ? logs : [];
    } catch (error) {
      return clientLogs;
    }
  }

  async function getServerActivityLogs() {
    const res = await fetch("/api/logs");
    const logs = await res.json();
    return Array.isArray(logs) ? logs : [];
  }

  async function getMergedActivityLogs(limit = 50) {
    const [serverLogs, clientDbLogs] = await Promise.all([
      getServerActivityLogs(),
      getClientActivityLogs(),
    ]);

    const merged = [...serverLogs, ...clientDbLogs, ...clientLogs];
    const seen = new Set();

    return merged
      .filter((log) => {
        const signature = [
          log.source || "unknown",
          log.id || "",
          log.timestamp || "",
          log.operation || "",
          log.engine || "",
          log.key || "",
          log.status || "",
        ].join("|");

        if (seen.has(signature)) return false;
        seen.add(signature);
        return true;
      })
      .sort((a, b) => getLogTime(b) - getLogTime(a))
      .slice(0, limit);
  }

  // Fetch Logs
  async function fetchLogs() {
    try {
      logsTableBody.innerHTML = "";
      const logs = await getMergedActivityLogs(50);

      if (logs.length === 0) {
        logsTableBody.innerHTML = `
          <tr>
            <td colspan="5" class="text-center py-4 text-secondary">No logs recorded.</td>
          </tr>
        `;
        return;
      }

      logs.forEach((log) => {
        const row = document.createElement("tr");
        row.className =
          log.status === "success" ? "log-row-success" : "log-row-error";

        row.innerHTML = `
          <td><small class="text-secondary">${new Date(log.timestamp).toLocaleTimeString()}</small></td>
          <td><span class="badge bg-secondary text-uppercase">${log.operation}</span></td>
          <td><code class="text-info">${log.engine}</code></td>
          <td>
            <span class="text-${log.status === "success" ? "success" : "danger"} fw-semibold">
              <i class="fa-solid ${log.status === "success" ? "fa-circle-check" : "fa-circle-xmark"} me-1"></i>
              ${log.status}
            </span>
          </td>
          <td><code class="text-light-subtle">${log.key || "*"}</code> ${log.message ? `<span class="small text-secondary">- ${log.message}</span>` : ""}</td>
        `;
        logsTableBody.appendChild(row);
      });
    } catch (err) {
      console.error(err);
    }
  }

  // Clear Logs
  clearLogsBtn.addEventListener("click", async () => {
    try {
      await Promise.all([
        fetch("/api/logs/clear", { method: "POST" }),
        clientStore.clearActivityLogs(),
      ]);
      clientLogs = [];
      showToast("All server and client activity logs cleared.");
      await fetchLogs();
    } catch (err) {
      console.error(err);
    }
  });

  // Search filter
  searchTodo.addEventListener("input", (e) => {
    const searchVal = e.target.value.toLowerCase().trim();
    if (!searchVal) {
      renderTodos(allTodos);
      return;
    }
    const filtered = allTodos.filter(
      (todo) =>
        todo.title.toLowerCase().includes(searchVal) ||
        todo.description.toLowerCase().includes(searchVal),
    );
    renderTodos(filtered);
  });

  // Engine Switch listener
  engineSelector.addEventListener("change", (e) => {
    handleSwitchEngine(e.target.value);
  });

  // Refresh manual
  refreshBtn.addEventListener("click", async () => {
    showToast("Refreshing dashboard...");
    await updateDashboardStats();
    await fetchTodos();
    await fetchLogs();
  });

  // Initialize
  async function init() {
    await configureClientStore("local");
    await updateDashboardStats();
    await fetchTodos();
    await fetchLogs();
  }

  init();
});
