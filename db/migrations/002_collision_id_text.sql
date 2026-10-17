-- KSI collision_id values are strings like "2026:6001592016", not integers.
ALTER TABLE collisions
  ALTER COLUMN collision_id TYPE TEXT USING collision_id::TEXT;
