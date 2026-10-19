-- Rebuild the identity directory kind constraint without losing existing room or member rows.
PRAGMA defer_foreign_keys = ON;
ALTER TABLE room_members RENAME TO room_members_legacy;
DROP INDEX IF EXISTS room_members_room_idx;
ALTER TABLE rooms RENAME TO rooms_legacy;
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('invoice', 'teaching', 'encounter', 'table')),
  created_at INTEGER NOT NULL
);
INSERT INTO rooms(id, owner_id, kind, created_at)
SELECT id, owner_id, kind, created_at FROM rooms_legacy;
CREATE TABLE room_members (
  user_id TEXT NOT NULL REFERENCES users(id),
  room_id TEXT NOT NULL REFERENCES rooms(id),
  epoch INTEGER NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  directory_sequence INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, room_id)
);
INSERT INTO room_members(user_id, room_id, epoch, active, directory_sequence)
SELECT user_id, room_id, epoch, active, directory_sequence FROM room_members_legacy;
DROP TABLE room_members_legacy;
DROP TABLE rooms_legacy;
CREATE INDEX room_members_room_idx ON room_members(room_id, active);
