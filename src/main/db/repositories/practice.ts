import type { DrillSummary, PlanCreate, PlanSummary, PracticeLogInput, PracticeOverview } from '@shared/dto';
import type { DrillCategory } from '@shared/schemas';
import type { DB } from '../connection';
import { DomainError } from '../../errors';

export function listPlans(db: DB): PlanSummary[] {
  const plans = db
    .prepare<
      [],
      { id: number; name: string; focus: string | null; scheduled_for: string | null; status: PlanSummary['status']; source: PlanSummary['source'] }
    >(
      `SELECT id, name, focus, scheduled_for, status, source FROM practice_plan
       ORDER BY status = 'planned' DESC, scheduled_for IS NULL, scheduled_for DESC`,
    )
    .all();
  const items = db.prepare<[number], { drill_id: number; name: string; minutes: number }>(
    `SELECT i.drill_id, d.name, i.minutes FROM practice_plan_item i JOIN drill d ON d.id = i.drill_id
     WHERE i.plan_id = ? ORDER BY i.position`,
  );
  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    focus: p.focus,
    scheduledFor: p.scheduled_for,
    status: p.status,
    source: p.source,
    items: items.all(p.id).map((i) => ({ drillId: i.drill_id, drillName: i.name, minutes: i.minutes })),
  }));
}

export function practiceOverview(db: DB, today: string): PracticeOverview {
  const drills = db
    .prepare<
      [],
      { id: number; name: string; category: DrillCategory; description: string; result_label: string | null; higher_is_better: number; builtin: number }
    >('SELECT id, name, category, description, result_label, higher_is_better, builtin FROM drill ORDER BY category, name')
    .all();
  const history = db.prepare<[number], { performed_on: string; result: number | null; minutes: number; source: DrillSummary['history'][number]['source'] }>(
    'SELECT performed_on, result, minutes, source FROM practice_log WHERE drill_id = ? ORDER BY performed_on, id',
  );
  const byCat = db
    .prepare<[string], { category: DrillCategory; minutes: number }>(
      `SELECT d.category, sum(l.minutes) AS minutes FROM practice_log l JOIN drill d ON d.id = l.drill_id
       WHERE l.performed_on >= date(?, '-60 days') GROUP BY d.category`,
    )
    .all(today);
  const last30 = db
    .prepare<[string], { logs: number; minutes: number | null }>(
      "SELECT count(*) AS logs, sum(minutes) AS minutes FROM practice_log WHERE performed_on >= date(?, '-30 days')",
    )
    .get(today);
  const cats: DrillCategory[] = ['driving', 'full_swing', 'approach', 'short_game', 'putting'];
  return {
    drills: drills.map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      description: d.description,
      resultLabel: d.result_label,
      higherIsBetter: d.higher_is_better === 1,
      builtin: d.builtin === 1,
      history: history.all(d.id).map((h) => ({ performedOn: h.performed_on, result: h.result, minutes: h.minutes, source: h.source })),
    })),
    plans: listPlans(db),
    minutesByCategory: cats.map((category) => ({ category, minutes: byCat.find((c) => c.category === category)?.minutes ?? 0 })),
    logsLast30: last30?.logs ?? 0,
    minutesLast30: last30?.minutes ?? 0,
  };
}

export function logPractice(db: DB, input: PracticeLogInput): void {
  if (!db.prepare('SELECT 1 FROM drill WHERE id = ?').get(input.drillId)) {
    throw new DomainError('NOT_FOUND', 'That drill no longer exists');
  }
  if (input.planId !== null && !db.prepare('SELECT 1 FROM practice_plan WHERE id = ?').get(input.planId)) {
    throw new DomainError('NOT_FOUND', 'That practice plan no longer exists');
  }
  db.prepare(
    'INSERT INTO practice_log (drill_id, plan_id, performed_on, minutes, result, notes) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(input.drillId, input.planId, input.performedOn, input.minutes, input.result, input.notes);
}

export function createPlan(db: DB, input: PlanCreate): void {
  db.transaction(() => {
    const planId = Number(
      db
        .prepare('INSERT INTO practice_plan (name, focus, scheduled_for) VALUES (?, ?, ?)')
        .run(input.name, input.focus, input.scheduledFor).lastInsertRowid,
    );
    const ins = db.prepare('INSERT INTO practice_plan_item (plan_id, drill_id, position, minutes) VALUES (?, ?, ?, ?)');
    input.items.forEach((it, i) => {
      if (!db.prepare('SELECT 1 FROM drill WHERE id = ?').get(it.drillId)) {
        throw new DomainError('NOT_FOUND', 'A drill in this plan no longer exists');
      }
      ins.run(planId, it.drillId, i + 1, it.minutes);
    });
  })();
}

export function setPlanStatus(db: DB, id: number, status: PlanSummary['status']): void {
  const res = db.prepare('UPDATE practice_plan SET status = ? WHERE id = ?').run(status, id);
  if (res.changes === 0) throw new DomainError('NOT_FOUND', 'That practice plan no longer exists');
}
