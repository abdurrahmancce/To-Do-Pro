/* =====================================================
   quickparse.js — natural-language quick add
   "kal 9 tay Surah Kahf alarm"  ->  { title:'Surah Kahf', date, alarm, ... }
   Understands English, Banglish and Bangla (digits too). Pure function, no DOM.
   ===================================================== */

const L = '\\p{L}\\p{M}\\p{N}_';
const word = (src, flags = 'iu') => new RegExp(`(?<![${L}])(?:${src})(?![${L}])`, flags);

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a, b) => ymd(a) === ymd(b);

const BN = '০১২৩৪৫৬৭৮৯';
const MONTHS = ['jan(?:uary)?', 'feb(?:ruary)?', 'mar(?:ch)?', 'apr(?:il)?', 'may', 'june?', 'july?', 'aug(?:ust)?', 'sep(?:t(?:ember)?)?', 'oct(?:ober)?', 'nov(?:ember)?', 'dec(?:ember)?'];
const MONTH_RE = MONTHS.join('|');
const monthIndex = (s) => MONTHS.findIndex((m) => new RegExp(`^(?:${m})$`, 'i').test(s));

const WEEKDAYS = [
  [0, 'sunday|sun|robibar|robbar|rabibar|রবিবার'],
  [1, 'monday|mon|shombar|sombar|somobar|সোমবার'],
  [2, 'tuesday|tues|tue|mongolbar|mongalbar|মঙ্গলবার'],
  [3, 'wednesday|wed|budhbar|budhbaar|বুধবার'],
  [4, 'thursday|thurs|thur|thu|brihoshpotibar|brihospotibar|brishpotibar|bribar|বৃহস্পতিবার'],
  [5, 'friday|fri|shukrobar|sukrobar|shukrobaar|jumma|jummah|jumuah|শুক্রবার|জুম্মা'],
  [6, 'saturday|sat|shonibar|sonibar|shonibaar|শনিবার'],
];
const WD_MAP = {}; WEEKDAYS.forEach(([d, names]) => names.split('|').forEach((n) => { WD_MAP[n.toLowerCase()] = d; }));
const WD_ALT = Object.keys(WD_MAP).sort((a, b) => b.length - a.length).join('|');
const WD_SHORT = new Set(['sun', 'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat']); // too common as plain words

const PERIODS = {
  morning: 'shokal|sokal|shokale|sokale|fojor|fajr|morning|dawn|সকাল|সকালে|ফজর',
  noon: 'dupur|dupure|noon|দুপুর|দুপুরে',
  afternoon: 'bikel|bikal|bikele|afternoon|বিকাল|বিকেল|বিকেলে',
  evening: 'shondha|sondha|shondhay|sondhay|evening|সন্ধ্যা|সন্ধ্যায়',
  night: 'raat|rat|rate|night|রাত|রাতে',
};
const PERIOD_ALL = Object.values(PERIODS).join('|');
const periodOf = (w) => Object.keys(PERIODS).find((k) => new RegExp(`^(?:${PERIODS[k]})$`, 'iu').test(w));

const to24 = (h, period) => {
  switch (period) {
    case 'morning': return h === 12 ? 0 : h;
    case 'noon': return h === 12 ? 12 : h <= 5 ? h + 12 : h;
    case 'afternoon': case 'evening': return h < 12 ? h + 12 : h;
    case 'night': return h === 12 ? 0 : h >= 6 && h <= 11 ? h + 12 : h;
    default: return h;
  }
};

export function fmtTime(d) {
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}
export function fmtDay(d, now = new Date()) {
  const diff = Math.round((startOfDay(d) - startOfDay(now)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function parseQuick(input, now = new Date()) {
  const raw = String(input ?? '');
  let n = raw.replace(/[০-৯]/g, (c) => String(BN.indexOf(c))); // same length as raw, so spans line up
  let o = raw;
  const base = startOfDay(now);
  const blank = (m) => {
    const sp = ' '.repeat(m[0].length);
    n = n.slice(0, m.index) + sp + n.slice(m.index + m[0].length);
    o = o.slice(0, m.index) + sp + o.slice(m.index + m[0].length);
  };
  const cut = (re) => { const m = re.exec(n); if (m) blank(m); return m; };

  let date = null;            // Date at midnight, or null
  let relAlarm = null;        // "in 30 min"
  let time = null;            // { h, m, mer, period }
  let repeat = 'none';
  let priority = null;
  let heading = '';
  let hintPeriod = null;      // "tonight"
  const alarmWord = /(?<![\p{L}\p{M}\p{N}_])(?:alarm|remind|reminder|এলার্ম|অ্যালার্ম)/iu.test(n);

  /* 1. relative durations: "in 30 min", "2 ghonta por" */
  const unitMin = (num, unit) => (/^(h|hr|hrs|hour|hours|ghonta|ghanta)$/i.test(unit) || unit.startsWith('ঘ') ? num * 60 : num);
  let m = cut(word('in\\s+(?:an?|one)\\s+(?:hour|hr)'));
  if (m) relAlarm = new Date(now.getTime() + 60 * 60e3);
  if (!m && (m = cut(word('in\\s+(\\d+(?:\\.\\d+)?)\\s*(h|hr|hrs|hours?|m|mins?|minutes?)')))) relAlarm = new Date(now.getTime() + unitMin(parseFloat(m[1]), m[2]) * 60e3);
  if (!m && (m = cut(word('(\\d+(?:\\.\\d+)?)\\s*(mins?|minutes?|minit|ghonta|ghanta|hours?|hrs?|ঘণ্টা|ঘন্টা|মিনিট)\\s*(?:por|pore|later|পর|পরে)')))) relAlarm = new Date(now.getTime() + unitMin(parseFloat(m[1]), m[2]) * 60e3);

  /* 2. repeat words + "every monday" */
  const wdRe = new RegExp(`(?<![${L}])(?:(every|protti|prottek|প্রতি)\\s+)?(?:(next|this|on|by|coming|agami|আগামী)\\s+)?(${WD_ALT})(?![${L}])`, 'giu');
  if (!relAlarm) {
    let w;
    while ((w = wdRe.exec(n))) {
      const name = w[3].toLowerCase();
      const every = !!w[1], pre = (w[2] || '').toLowerCase();
      if (WD_SHORT.has(name) && !every && !pre) continue;
      let diff = (WD_MAP[name] - base.getDay() + 7) % 7;
      if (diff === 0 && pre !== 'this') diff = 7; // same weekday = next week, unless "this friday"
      date = addDays(base, diff);
      if (every) repeat = 'weekly';
      blank(w);
      break;
    }
  }
  if (cut(word('every\\s*day|daily|everyday|rojkar|protidin|prottek\\s*din|roj|প্রতিদিন|রোজ'))) repeat = 'daily';
  else if (cut(word('every\\s*week|weekly|protisoptaho|প্রতি\\s*সপ্তাহ'))) repeat = 'weekly';

  /* 3. dates */
  if (!relAlarm) {
    if ((m = cut(/(?<![\d/-])(\d{4})-(\d{1,2})-(\d{1,2})(?![\d-])/))) date = new Date(+m[1], +m[2] - 1, +m[3]);
    else if ((m = /(?<![\d/.:-])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/:])/.exec(n)) && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) {
      blank(m); // day/month (Bangladesh order)
      let y = m[3] ? +m[3] : base.getFullYear(); if (y < 100) y += 2000;
      date = new Date(y, +m[2] - 1, +m[1]);
      if (!m[3] && date < base) date.setFullYear(y + 1);
    } else if ((m = cut(word(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})`)))) {
      date = new Date(base.getFullYear(), monthIndex(m[2]), +m[1]); if (date < base) date.setFullYear(date.getFullYear() + 1);
    } else if ((m = cut(word(`(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?`)))) {
      date = new Date(base.getFullYear(), monthIndex(m[1]), +m[2]); if (date < base) date.setFullYear(date.getFullYear() + 1);
    } else if ((m = cut(word('day\\s+after\\s+tomorrow|porshu|poshu|পরশু')))) date = addDays(base, 2);
    else if ((m = cut(word('tomorrow|tmrw|tmr|kal|kaal|agamikal|agamikaal|কাল|আগামীকাল')))) date = addDays(base, 1);
    else if ((m = cut(word('tonight')))) { date = base; hintPeriod = 'night'; }
    else if ((m = cut(word('today|aj|aaj|ajke|ajk|আজ|আজকে|আজকের')))) date = base;
    else if ((m = cut(word('next\\s+week|agami\\s+shoptah|আগামী\\s+সপ্তাহ')))) date = addDays(base, ((8 - base.getDay()) % 7) || 7); // next Monday
    else if ((m = cut(word('in\\s+(\\d+)\\s*(days?|weeks?)'))) || (m = cut(word('(\\d+)\\s*(din|দিন|days?|soptaho|সপ্তাহ|weeks?)\\s*(?:por|pore|later|পর|পরে)')))) {
      const wk = /^(w|s|সপ্তাহ)/i.test(m[2]);
      date = addDays(base, +m[1] * (wk ? 7 : 1));
    }
  }

  /* 4. time of day */
  if (!relAlarm) {
    const found = (re, g) => { const mm = re.exec(n); return mm ? { mm, h: +mm[g.h], min: g.m ? +mm[g.m] || 0 : 0, mer: g.mer && mm[g.mer] ? mm[g.mer].toLowerCase().replace(/\./g, '') : '' } : null; };
    let t = found(/(?<![\d:])(\d{1,2}):(\d{2})(?!\d)\s*(am|pm|a\.m\.|p\.m\.)?(?![\p{L}])/iu, { h: 1, m: 2, mer: 3 })
      || found(/(?<![\d:])(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)(?![\p{L}])/iu, { h: 1, mer: 2 })
      || found(/(?<![\p{L}\d])(?:at|@|by)\s*(\d{1,2})(?![\d:])(?!\s*(?:min|hour|day|week|%))/iu, { h: 1 })
      || found(/(?<![\d:/.])(\d{1,2})\s*(?:tay|tar|টায়|টার|ঘটিকায়|ঘটিকার)(?![\p{L}\p{M}])/iu, { h: 1 })
      || ((date || alarmWord) ? found(/(?<![\d:/.])(\d{1,2})\s*(?:ta|টা)(?![\p{L}\p{M}])/iu, { h: 1 }) : null);
    if (t && t.min < 60 && (t.mer ? t.h >= 1 && t.h <= 12 : t.h <= 23)) {
      blank(t.mm);
      // a period word right next to the time: "rat 10 tay", "9 tay shokal", "in the evening"
      let period = null;
      const before = new RegExp(`(?<![${L}])(${PERIOD_ALL})\\s*$`, 'iu').exec(n.slice(0, t.mm.index));
      const after = new RegExp(`^\\s*(?:(?:in|at|e|er)\\s+)*(?:the\\s+)?(${PERIOD_ALL})(?![${L}])`, 'iu').exec(n.slice(t.mm.index + t.mm[0].length));
      if (!t.mer && before) { period = periodOf(before[1]); blank({ index: before.index, 0: before[0] }); }
      else if (!t.mer && after) { period = periodOf(after[1]); const idx = t.mm.index + t.mm[0].length + after[0].length - after[1].length; blank({ index: idx, 0: after[1] }); }
      period = period || hintPeriod;

      let h = t.h;
      if (t.mer === 'pm') { if (h < 12) h += 12; }
      else if (t.mer === 'am') { if (h === 12) h = 0; }
      else if (period) h = to24(h, period);
      else if (h >= 1 && h <= 12) {
        const today = !date || sameDay(date, base);
        const at = (x) => { const d = new Date(base); d.setHours(x, t.min, 0, 0); return d; };
        const fut = today && [h % 12, (h % 12) + 12].map(at).find((d) => d > now);
        h = fut ? fut.getHours() : h === 12 ? 12 : h >= 7 && h <= 11 ? h : h <= 6 ? h + 12 : h;
      }
      time = { h: h % 24, m: t.min };
    }
  }

  /* 5. priority, heading */
  const hi1 = cut(/(?<=^|\s)!(?:!!?|high|h|1)(?=\s|$)/i), hi2 = cut(word('urgent|joruri|jaruri|জরুরি|জরুরী'));
  if (hi1 || hi2) priority = 'high';
  else if (cut(/(?<=^|\s)!(?:low|l|3)(?=\s|$)/i)) priority = 'low';
  else if (cut(/(?<=^|\s)!(?:medium|med|m|2)(?=\s|$)/i)) priority = 'medium';
  if ((m = cut(/(?<=^|\s)#([\p{L}\p{N}_-]+)(?=\s|$)/u))) heading = m[1].replace(/_/g, ' ');

  /* 6. alarm */
  let alarm = null, dueDate = null;
  if (relAlarm) { alarm = relAlarm; dueDate = ymd(alarm); }
  else if (time) {
    const d = date ? new Date(date) : new Date(base);
    d.setHours(time.h, time.m, 0, 0);
    if (!date && d <= now) d.setDate(d.getDate() + 1); // "9pm" said at 10pm = tomorrow
    alarm = d; dueDate = ymd(d);
  } else if ((alarmWord || repeat !== 'none') && (date || repeat !== 'none')) {
    let d = date ? new Date(date) : new Date(base);
    d.setHours(9, 0, 0, 0);
    if (d <= now) d = addDays(d, 1);
    alarm = d; dueDate = ymd(d);
  } else if (date) dueDate = ymd(date);
  if (!alarm) repeat = 'none';

  if (alarm) { cut(word('remind\\s+me(?:\\s+(?:to|about|of))?|reminder|remind')); cut(word('alarm(?:\\s+(?:set|dao|de|koro|rakho|রাখো|দাও))?|অ্যালার্ম|এলার্ম')); }

  /* 7. title cleanup */
  const changed = !!(alarm || dueDate || priority || heading || repeat !== 'none');
  let title = o.replace(/\s+/g, ' ').trim();
  if (changed) {
    const conn = '(?:at|on|by|for|er|e|tay|ta|in|the|of|about|to|@|-|,|:)';
    title = title.replace(new RegExp(`^(?:${conn}\\s+)+`), '').replace(new RegExp(`(?:\\s+${conn})+$`), '').replace(/^[\s,;:.\-–]+|[\s,;:.\-–]+$/g, '');
    if (!title) title = alarm ? 'Reminder' : raw.trim();
  }

  const chips = [];
  if (dueDate) { const d = alarm ? alarm : date; chips.push({ k: 'date', text: fmtDay(d, now) }); }
  if (alarm) chips.push({ k: 'alarm', text: fmtTime(alarm) });
  if (repeat !== 'none') chips.push({ k: 'repeat', text: repeat === 'daily' ? 'Every day' : 'Every week' });
  if (priority) chips.push({ k: 'priority', text: priority === 'high' ? 'High priority' : priority === 'low' ? 'Low priority' : 'Medium priority' });
  if (heading) chips.push({ k: 'heading', text: '#' + heading });

  return { title, date: dueDate || '', alarm: alarm ? alarm.toISOString() : null, repeat, priority, heading, chips, changed };
}