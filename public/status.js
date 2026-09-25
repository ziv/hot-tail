/* Status dashboard (R3): reads the public, aggregate-only /api/status. */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtMs = (v) => (v == null ? '–' : v >= 1000 ? (v / 1000).toFixed(1) + ' s' : v + ' ms');
async function refresh() {
  try {
    const h = await fetch('./api/health?deep=1');
    const ok = h.ok;
    $('api').innerHTML =
      `<span class="dot" style="background: var(${ok ? '--ok' : '--bad'})"></span>${ok ? 'Up' : 'Degraded'}`;
  } catch {
    $('api').innerHTML = '<span class="dot" style="background: var(--bad)"></span>Down';
  }
  try {
    const s = await (await fetch('./api/status')).json();
    $('load').textContent = `${fmtMs(s.loadP50Ms)} / ${fmtMs(s.loadP95Ms)}`;
    $('errors').textContent = s.errors24h;
    $('errors').style.color = s.errors24h > 50 ? 'var(--warn)' : '';
    $('scores').textContent = s.scores24h;
    $('verified').textContent = s.scores24h ? Math.round((s.verified24h / s.scores24h) * 100) + '%' : '–';
    $('rejected').textContent = s.rejected24h;
    $('pending').textContent = s.pending;
    const labels = {
      stage_start: 'Stages started',
      stage_clear: 'Stages cleared',
      death: 'Deaths',
      game_over: 'Game overs',
      session_length: 'Sessions',
    };
    $('week').tBodies[0].innerHTML = Object.entries(labels)
      .map(([k, l]) => `<tr><td>${l}</td><td class="num">${(s.week[k] ?? 0).toLocaleString()}</td></tr>`)
      .join('');
    $('errlist').innerHTML = s.topErrors.length
      ? s.topErrors
          .map(
            (e) =>
              `<tr><td><code>${esc(e.message)}</code></td><td>${esc(e.version)}</td><td class="num">${e.count}</td><td>${new Date(e.lastSeen).toLocaleString()}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="4">No errors reported 🎉</td></tr>';
  } catch {
    /* status unavailable (API not configured) */
  }
  $('updated').textContent = `Updated ${new Date().toLocaleTimeString()} · refreshes every minute`;
}
refresh();
setInterval(refresh, 60000);
