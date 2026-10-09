-- Reminder series, their occurrences and alert delivery claims (Phase 05, D-073).
CREATE TABLE reminders (
  id                        TEXT PRIMARY KEY NOT NULL,
  note_id                   TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  block_id                  TEXT,
  anchor_state              TEXT NOT NULL DEFAULT 'ok' CHECK (anchor_state IN ('ok', 'block_missing')),
  title                     TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  zone_id                   TEXT NOT NULL CHECK (length(zone_id) BETWEEN 1 AND 64),
  start_local_date          TEXT NOT NULL CHECK (start_local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  local_time                TEXT NOT NULL CHECK (local_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  recurrence                TEXT CHECK (recurrence IS NULL OR json_valid(recurrence)),
  fold_preference           TEXT NOT NULL DEFAULT 'earlier' CHECK (fold_preference IN ('earlier', 'later')),
  followup_interval_minutes INTEGER CHECK (followup_interval_minutes IS NULL OR followup_interval_minutes IN (5, 10, 15, 30, 60)),
  max_followups             INTEGER NOT NULL DEFAULT 2 CHECK (max_followups IN (1, 2, 3, 5)),
  enabled                   INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  revision                  INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at                INTEGER NOT NULL,
  updated_at                INTEGER NOT NULL,
  deleted_at                INTEGER,
  CHECK (block_id IS NOT NULL OR anchor_state = 'ok')
) STRICT;
CREATE INDEX reminders_note ON reminders(note_id);

CREATE TABLE occurrences (
  id                        TEXT PRIMARY KEY NOT NULL,
  reminder_id               TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  due_at_utc                INTEGER NOT NULL,
  original_local_date_time  TEXT NOT NULL,            -- 'YYYY-MM-DDTHH:mm' in the reminder zone
  state                     TEXT NOT NULL CHECK (state IN ('pending', 'snoozed', 'completed', 'missed', 'cancelled')),
  snoozed_until_utc         INTEGER,
  next_alert_at_utc         INTEGER,
  alert_sequence            INTEGER NOT NULL DEFAULT 0 CHECK (alert_sequence >= 0),   -- next sequence to claim
  followups_sent            INTEGER NOT NULL DEFAULT 0 CHECK (followups_sent >= 0),
  last_alert_at_utc         INTEGER,
  revision                  INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  completed_at              INTEGER,
  created_at                INTEGER NOT NULL,
  updated_at                INTEGER NOT NULL,
  UNIQUE (reminder_id, due_at_utc),
  CHECK (state IN ('pending', 'snoozed') OR next_alert_at_utc IS NULL),
  CHECK (state <> 'snoozed' OR snoozed_until_utc IS NOT NULL),
  CHECK ((state = 'completed') = (completed_at IS NOT NULL))
) STRICT;
CREATE INDEX occurrences_next_alert ON occurrences(next_alert_at_utc) WHERE next_alert_at_utc IS NOT NULL;
CREATE INDEX occurrences_reminder_due ON occurrences(reminder_id, due_at_utc);
CREATE INDEX occurrences_due ON occurrences(due_at_utc);

CREATE TABLE alert_deliveries (
  id              TEXT PRIMARY KEY NOT NULL,
  occurrence_id   TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE,
  alert_sequence  INTEGER NOT NULL CHECK (alert_sequence >= 0),
  kind            TEXT NOT NULL CHECK (kind IN ('initial', 'followup', 'snooze')),
  presentation    TEXT NOT NULL CHECK (presentation IN ('single', 'summary')),
  batch_id        TEXT NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('timer', 'startup', 'resume', 'clock_jump', 'quiet_end', 'restore', 'write', 'settings', 'test')),
  claimed_at      INTEGER NOT NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('claimed', 'dispatched', 'failed', 'unsupported', 'uncertain', 'skipped')),
  dispatched_at   INTEGER,
  detail          TEXT CHECK (detail IS NULL OR length(detail) <= 200),
  closed_at       INTEGER,
  clicked_at      INTEGER,
  UNIQUE (occurrence_id, alert_sequence)
) STRICT;
CREATE INDEX alert_deliveries_claimed ON alert_deliveries(outcome) WHERE outcome = 'claimed';
CREATE INDEX alert_deliveries_batch ON alert_deliveries(batch_id);
