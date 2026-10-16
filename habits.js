/* =====================================================
   habits.js — streaks for repeating tasks + weekly summary stats
   Pure functions (no DOM) so they can be unit-tested.

   A task with a daily/weekly reminder behaves like a habit:
   completing it logs the day in `doneDates` and moves it to its next occurrence
   instead of closing it for good.
   ===================================================== */

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayDiff = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 864e5);
const weekStart = (d) => addDays(startOfDay(d), -((d.getDay() + 6) % 7)); // Monday

export const isHabit = (t) => !!t && !!t.alarm && (t.alarmRepeat === 'daily' || t.alarmRepeat === 'weekly');

/* "Done" on a repeating task: log today, then jump to the next occurrence (never skips a future one) */
export function completeHabit(t, now = new Date()) {
  const today = ymd(now);
  const step = t.alarmRepeat === 'weekly' ? 7 : 1;
  const doneDates = [...new Set([...(t.doneDates || []), today])].sort().slice(-400);
  const next = new Date(t.alarm);
  while (next <= now || ymd(next) === today) next.setDate(next.getDate() + step);
  return { ...t, doneDates, alarm: next.toISOString(), alarmFired: false, date: ymd(next), completed: false, completedAt: now.toISOString() };
}

/* current / best streak. Daily = consecutive days, weekly = consecutive weeks.
   A streak is still alive if the latest period is today's or the one before (you have time left to continue it). */
export function streakOf(doneDates, repeat, now = new Date()) {
  const dates = [...new Set(doneDates || [])];
  if (!dates.length) return { cur: 0, best: 0 };
  const weekly = repeat === 'weekly';
  const unit = weekly ? 7 : 1;
  const key = (d) => ymd(weekly ? weekStart(d) : startOfDay(d));
  const buckets = new Set(dates.map((s) => key(parse(s))));
  const sorted = [...buckets].sort();
  let best = 1, run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = dayDiff(parse(sorted[i - 1]), parse(sorted[i])) === unit ? run + 1 : 1;
    best = Math.max(best, run);
  }
  let d = parse(key(now));
  if (!buckets.has(ymd(d))) d = addDays(d, -unit);
  let cur = 0;
  while (buckets.has(ymd(d))) { cur++; d = addDays(d, -unit); }
  return { cur, best };
}

/* last 7 days (today included) vs the 7 days before */
export function weekStats(tasks, now = new Date()) {
  const today = startOfDay(now);
  const span = (from, n) => Array.from({ length: n }, (_, i) => ymd(addDays(today, from + i)));
  const days = span(-6, 7), prevDays = span(-13, 7);
  const done = {};
  const bump = (s) => { done[s] = (done[s] || 0) + 1; };
  const onTime = { ok: 0, all: 0 };
  tasks.forEach((t) => {
    if (t.completed && t.completedAt) {
      const when = ymd(new Date(t.completedAt));
      bump(when);
      if (t.date && days.includes(when)) { onTime.all++; if (when <= t.date) onTime.ok++; }
    }
    (t.doneDates || []).forEach(bump); // habit check-ins
  });
  const bars = days.map((date) => { const d = parse(date); return { date, count: done[date] || 0, label: d.toLocaleDateString('en-US', { weekday: 'short' }), today: date === ymd(today) }; });
  const total = bars.reduce((s, b) => s + b.count, 0);
  const prevTotal = prevDays.reduce((s, d) => s + (done[d] || 0), 0);
  const top = bars.reduce((a, b) => (b.count >= a.count ? b : a), bars[0]);
  const td = ymd(today);
  return {
    bars, total, prevTotal, delta: total - prevTotal,
    best: top.count ? { label: top.label, count: top.count } : null,
    created: tasks.filter((t) => t.createdAt && days.includes(ymd(new Date(t.createdAt)))).length,
    overdue: tasks.filter((t) => !t.completed && t.date && t.date < td && !isHabit(t)).length,
    onTimePct: onTime.all ? Math.round((onTime.ok / onTime.all) * 100) : null,
    range: [days[0], days[6]],
    habits: tasks.filter(isHabit).map((t) => ({ id: t.id, title: t.title, repeat: t.alarmRepeat, ...streakOf(t.doneDates, t.alarmRepeat, now) })).sort((a, b) => b.cur - a.cur || b.best - a.best),
  };
}