// התראות - the in-app reminder list behind the bell (deadlines and a backup reminder).
import { h, ic, empty } from '../ui.js';
import { S } from '../app.js';
import { computeAlerts } from '../engine/alerts.js';

export function render(main, args, ctx) {
  const alerts = computeAlerts(S(), ctx.date, { nowIso: ctx.nowIso });
  main.replaceChildren(h('div.page',
    alerts.length ? h('div.list', alerts.map((a) => h('a.item.link-row', { href: a.route },
      ic(a.level === 'info' ? 'bell' : 'alert', 20), h('div.body', h('div.title', a.title), h('div.meta', a.detail)), ic('left', 18))))
      : empty('אין התראות', 'bell')));
}
