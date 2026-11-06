import { openDatabase, type DB } from '../src/main/db/connection';
import { migrations } from '../src/main/db/migrations';
import { migrate } from '../src/main/db/migrator';

/** Fresh in-memory database at the latest schema. */
export function freshDb(): DB {
  const db = openDatabase(':memory:');
  migrate(db, migrations);
  return db;
}

export const insertClub = (db: DB, label = '7 Iron', kind = 'iron'): number =>
  Number(db.prepare('INSERT INTO club (kind, label) VALUES (?, ?)').run(kind, label).lastInsertRowid);

export function insertCourse(db: DB): { courseId: number; holeIds: number[] } {
  const courseId = Number(db.prepare("INSERT INTO course (name) VALUES ('Test Links')").run().lastInsertRowid);
  const holeIds = [1, 2, 3].map((n) =>
    Number(
      db.prepare('INSERT INTO hole (course_id, number, par) VALUES (?, ?, 4)').run(courseId, n).lastInsertRowid,
    ),
  );
  return { courseId, holeIds };
}
