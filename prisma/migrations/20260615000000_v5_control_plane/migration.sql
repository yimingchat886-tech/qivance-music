CREATE TABLE IF NOT EXISTS "projects" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "content_type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "project_root" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "project_inputs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "original_name" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "stable_path" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_inputs_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "artifacts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "chain_id" TEXT,
  "kind" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "schema_version" TEXT,
  "status" TEXT NOT NULL,
  "created_by_run_id" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "artifacts_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "artifacts_created_by_run_id_fkey"
    FOREIGN KEY ("created_by_run_id") REFERENCES "scheduler_runs" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "chains" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "chain_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "metrics_json" TEXT,
  "last_error" TEXT,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chains_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "scheduler_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "priority" INTEGER NOT NULL,
  "stop_requested" BOOLEAN NOT NULL DEFAULT false,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduler_runs_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "scheduler_tasks" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "run_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "chain_id" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "dependencies_json" TEXT NOT NULL,
  "resource_requirements_json" TEXT NOT NULL,
  "input_artifacts_json" TEXT NOT NULL,
  "output_artifacts_json" TEXT NOT NULL,
  "last_error" TEXT,
  "started_at" DATETIME,
  "finished_at" DATETIME,
  CONSTRAINT "scheduler_tasks_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "scheduler_runs" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "scheduler_tasks_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "scheduler_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "run_id" TEXT,
  "task_id" TEXT,
  "event_type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "details_json" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduler_events_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "scheduler_runs" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "scheduler_events_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "scheduler_tasks" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "chains_project_id_chain_id_key"
  ON "chains" ("project_id", "chain_id");
CREATE INDEX IF NOT EXISTS "project_inputs_project_id_kind_status_idx"
  ON "project_inputs" ("project_id", "kind", "status");
CREATE INDEX IF NOT EXISTS "artifacts_project_id_chain_id_status_idx"
  ON "artifacts" ("project_id", "chain_id", "status");
CREATE INDEX IF NOT EXISTS "artifacts_created_by_run_id_idx"
  ON "artifacts" ("created_by_run_id");
CREATE INDEX IF NOT EXISTS "scheduler_runs_project_id_status_idx"
  ON "scheduler_runs" ("project_id", "status");
CREATE INDEX IF NOT EXISTS "scheduler_runs_status_idx"
  ON "scheduler_runs" ("status");
CREATE INDEX IF NOT EXISTS "scheduler_tasks_run_id_status_idx"
  ON "scheduler_tasks" ("run_id", "status");
CREATE INDEX IF NOT EXISTS "scheduler_tasks_project_id_chain_id_status_idx"
  ON "scheduler_tasks" ("project_id", "chain_id", "status");
CREATE INDEX IF NOT EXISTS "scheduler_events_run_id_created_at_idx"
  ON "scheduler_events" ("run_id", "created_at");
CREATE INDEX IF NOT EXISTS "scheduler_events_task_id_created_at_idx"
  ON "scheduler_events" ("task_id", "created_at");
