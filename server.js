import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import store from "@x-labs-myid/omnistorage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const IS_VERCEL = process.env.VERCEL === "1";
const SERVER_ENGINES = IS_VERCEL
  ? ["memory"]
  : ["memory", "file", "sqlite-server"];
const DEFAULT_SERVER_ENGINE = IS_VERCEL ? "memory" : "file";

app.use(express.json());
// Serve static frontend files when running the Express server locally.
app.use(express.static(path.join(__dirname, "dist")));

const DB_NAME = "omnistorage_crud";
let activeEngine = DEFAULT_SERVER_ENGINE;

function unwrapData(result, fallback = null) {
  if (result && typeof result === "object" && "data" in result) {
    return result.data ?? fallback;
  }

  return result ?? fallback;
}

async function configureStore(engine = activeEngine) {
  await store.init({
    db: {
      name: DB_NAME,
      engine,
    },
    logs: "auto",
  });

  store.db(DB_NAME).use(engine);
  activeEngine = engine;
}

async function getAllValues() {
  try {
    return unwrapData(await store.findAll(), {});
  } catch (error) {
    if (typeof store.defaultEngine?.getAll === "function") {
      return store.defaultEngine.getAll();
    }

    throw error;
  }
}

async function getStorageStatistics() {
  if (IS_VERCEL && typeof store.defaultEngine?.getStats === "function") {
    return store.defaultEngine.getStats();
  }

  try {
    return unwrapData(await store.getStatistics(), {});
  } catch (error) {
    if (typeof store.defaultEngine?.getStats === "function") {
      return store.defaultEngine.getStats();
    }

    throw error;
  }
}

async function getTodoEntries() {
  const data = await getAllValues();

  if (Array.isArray(data)) {
    return data
      .map((item) => {
        if (Array.isArray(item)) return item;
        const key = item?.key ?? item?.id;
        const value = item?.value ?? item?.data ?? item;
        return [key, value];
      })
      .filter(([key]) => typeof key === "string" && key.startsWith("todo_"));
  }

  return Object.entries(data).filter(([key]) => key.startsWith("todo_"));
}

function normalizeTodoValue(value) {
  if (typeof value === "string") {
    return JSON.parse(value);
  }

  return value;
}

// Configure default server storage on startup.
try {
  await configureStore(DEFAULT_SERVER_ENGINE);
  console.log(
    `Using "${DEFAULT_SERVER_ENGINE}" engine as default server storage.`,
  );
} catch (e) {
  await configureStore("memory");
  console.log('Falling back to "memory" engine.');
}

// Get config and stats
app.get("/api/config", async (req, res) => {
  try {
    let stats = {};
    try {
      stats = await getStorageStatistics();
    } catch (err) {
      stats = { error: err.message };
    }

    res.json({
      dbName: DB_NAME,
      activeEngine,
      availableEngines: SERVER_ENGINES,
      stats,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Change active engine
app.post("/api/config/engine", async (req, res) => {
  const { engine } = req.body;
  if (!SERVER_ENGINES.includes(engine)) {
    return res.status(400).json({
      error: IS_VERCEL
        ? 'Vercel serverless deployments only support the "memory" server engine in this example.'
        : "Invalid storage engine type",
    });
  }

  try {
    await configureStore(engine);
    console.log(`Switched default storage engine to: ${engine}`);
    res.json({ success: true, engine: activeEngine });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all todos
app.get("/api/todos", async (req, res) => {
  try {
    const entries = await getTodoEntries();
    const todos = [];

    for (const [key, val] of entries) {
      try {
        todos.push(normalizeTodoValue(val));
      } catch (e) {
        console.error(`Failed parsing key ${key}:`, e);
      }
    }

    // Sort by creation time (newest first)
    todos.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    res.json(todos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create todo
app.post("/api/todos", async (req, res) => {
  const { title, description, priority } = req.body;
  if (!title) {
    return res.status(400).json({ error: "Title is required" });
  }

  const id = `todo_${Date.now()}`;
  const todo = {
    id,
    title,
    description: description || "",
    priority: priority || "medium",
    completed: false,
    createdAt: Date.now(),
  };

  try {
    const result = await store.create(id, todo);
    if (!result.ok) {
      return res.status(400).json({ error: result.message });
    }
    res.status(201).json(todo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update todo
app.put("/api/todos/:id", async (req, res) => {
  const { id } = req.params;
  const { title, description, priority, completed } = req.body;

  try {
    // Retrieve existing first
    const existingRes = await store.find(id);
    if (!existingRes.ok) {
      return res.status(404).json({ error: "Todo not found" });
    }

    const updatedTodo = {
      ...existingRes.data,
      title: title !== undefined ? title : existingRes.data.title,
      description:
        description !== undefined ? description : existingRes.data.description,
      priority: priority !== undefined ? priority : existingRes.data.priority,
      completed:
        completed !== undefined ? completed : existingRes.data.completed,
      updatedAt: Date.now(),
    };

    const result = await store.update(id, updatedTodo);
    if (!result.ok) {
      return res.status(400).json({ error: result.message });
    }
    res.json(updatedTodo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete todo
app.delete("/api/todos/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await store.destroy(id);
    if (!result.ok) {
      return res.status(400).json({ error: result.message });
    }
    res.json({ success: true, message: `Todo with ID ${id} deleted` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Truncate / Clear all todos
app.post("/api/todos/clear", async (req, res) => {
  try {
    // We only want to delete keys starting with 'todo_'
    const todoKeys = (await getTodoEntries()).map(([key]) => key);

    if (todoKeys.length > 0) {
      const result = await store.destroyMany(todoKeys);
      if (result && result.ok === false) {
        return res.status(400).json({ error: result.message });
      }
    }

    res.json({ success: true, message: "All todos cleared" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get activity logs
app.get("/api/logs", async (req, res) => {
  try {
    const result = await store.getActivityLogs(50);
    res.json(result.data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear activity logs
app.post("/api/logs/clear", async (req, res) => {
  try {
    await store.clearActivityLogs();
    res.json({ success: true, message: "Logs cleared" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

if (!IS_VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

export default app;
