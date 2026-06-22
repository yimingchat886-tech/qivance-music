ALTER TABLE "scheduler_runs"
  ADD COLUMN "locked_inputs_json" TEXT;

UPDATE "project_inputs"
SET "status" = 'superseded'
WHERE "status" = 'active'
  AND EXISTS (
    SELECT 1
    FROM "project_inputs" AS "newer"
    WHERE "newer"."project_id" = "project_inputs"."project_id"
      AND "newer"."kind" = "project_inputs"."kind"
      AND "newer"."status" = 'active'
      AND (
        "newer"."created_at" > "project_inputs"."created_at"
        OR (
          "newer"."created_at" = "project_inputs"."created_at"
          AND "newer"."id" > "project_inputs"."id"
        )
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS "project_inputs_one_active_per_kind_idx"
  ON "project_inputs" ("project_id", "kind")
  WHERE "status" = 'active';
