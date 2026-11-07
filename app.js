/* Sky Over Home — dashboard for the flight Pi */
(() => {
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = new Intl.NumberFormat("en-GB");
const TZ = "Europe/London";  // the Pi groups everything by UK time, so show UK time everywhere (even when viewing abroad)
const ukFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function uk(ms) { const p = Object.fromEntries(ukFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value])); return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute }; }
function ukMidnight(ms = Date.now()) { const p = uk(ms); const off = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ms / 60000) * 60000; return Date.UTC(p.y, p.m - 1, p.d) - off; }
const n = v => v == null ? "–" : nf.format(Math.round(v));
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const flag = iso => iso && /^[A-Z]{2}$/i.test(iso) ? String.fromCodePoint(...[...iso.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : "";
const km = v => v == null ? "–" : v < 10 ? `${v.toFixed(1)} km` : `${n(v)} km`;
const ft = v => v == null ? "–" : `${n(v)} ft`;
const fmtTime = t => t ? new Date(t * 1000).toLocaleString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "–";
const fmtDate = t => t ? new Date(t * 1000).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" }) : "–";
const dur = s => { s = Math.round(s); if (s < 60) return `${s}s`; const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`; };
const ago = t => { const s = Date.now() / 1000 - t; if (s < 90) return "just now"; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`; };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MAKER_SLOT = { Airbus: "--s1", Boeing: "--s2", Embraer: "--s3", ATR: "--s4", Bombardier: "--s5", "De Havilland": "--s6", Cessna: "--s7" };
const makerColor = m => css(MAKER_SLOT[m] || "--other");

function prettyType(desc, code) {
  if (!desc) return code || "Unknown";
  const parts = desc.split(" ");
  const first = parts[0];
  const maker = first.length <= 3 ? first : first[0] + first.slice(1).toLowerCase();
  let rest = parts.slice(1).join(" ").replace(/\bA-(\d)/g, "A$1").replace(/\bERJ-/g, "E").replace(/neo\b/i, "neo");
  if (maker === "Atr" || maker === "ATR") rest = rest.replace(/^ATR-?/, "");
  return `${maker === "Atr" ? "ATR" : maker} ${rest}`.trim();
}
const prettyName = s => !s ? "" : s.replace(/\b(Com|Uk|Usa|Klm|Sas|Tui|Ba)\b/g, m => ({ Com: ".com", Uk: "UK", Usa: "USA", Klm: "KLM", Sas: "SAS", Tui: "TUI", Ba: "BA" }[m])).replace(/ \.com/, ".com");

const state = { period: "all", tsKey: "hour", histKey: "dist", page: 0, q: "", stats: null, ts: null, cov: null };
try { const p = localStorage.getItem("fs-period"); if (p) state.period = p; } catch (e) {}
try { const t = localStorage.getItem("fs-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}

const STATIC = window.FS_STATIC === true;  // public GitHub Pages copy: reads exported JSON files
let VER = "", META = null;
const monthCache = {}, pathCache = {};
let seenAll = null;
async function sget(f) {
  const r = await fetch(`data/${f}?v=${VER}`);
  if (!r.ok) throw new Error(`${f}: ${r.status}`);
  return r.json();
}
function sinceFor(p) {
  const now = Date.now() / 1000;
  if (p === "today") return ukMidnight() / 1000;
  return { "24h": now - 86400, "7d": now - 7 * 86400, "30d": now - 30 * 86400 }[p] || 0;
}
const monthTs = (m, add = 0) => { const [y, mo] = m.split("-").map(Number); return Date.UTC(y, mo - 1 + add, 1) / 1000 - 3600; }; // -1h covers BST
async function loadMonth(m) {   // one file per month; recent months are re-fetched when the data version changes
  const c = monthCache[m];
  const recent = META.months.slice(0, 2).some(x => x.m === m);
  if (c && (!recent || c.ver === VER)) return c.rows;
  const d = await sget(`flights/${m}.json`);
  const rows = d.rows.map(a => {
    const f = {}; d.cols.forEach((k, i) => { if (a[i] != null) f[k] = a[i]; });
    const r = f.callsign && d.routes[f.callsign];
    if (r) Object.assign(f, { o_iata: r.o_iata, d_iata: r.d_iata, o_city: r.o_city, d_city: r.d_city, plausible: r.plausible, _route: r });
    return f;
  });
  monthCache[m] = { ver: VER, rows };
  return rows;
}
async function queryFlights(since, term, off, lim) {
  const t = term.toUpperCase();
  const hit = f => !t || f.hex.startsWith(t.toLowerCase()) || [f.callsign, f.reg, f.type, f.airline_name, f.o_iata, f.d_iata, f.o_city, f.d_city, f.type_desc]
    .some(v => v && String(v).toUpperCase().includes(t));
  const out = []; let total = 0, seen = 0;
  for (const mo of META.months.filter(x => monthTs(x.m, 1) > since)) {
    const whole = monthTs(mo.m) >= since;
    if (!t && whole && (seen + mo.n <= off || out.length >= lim)) { total += mo.n; seen += mo.n; continue; }
    if (t) $("#pageInfo").textContent = `Searching ${mo.m}…`;
    const rows = (await loadMonth(mo.m)).filter(f => f.first_seen >= since && hit(f));
    total += rows.length;
    for (const f of rows) { if (seen >= off && out.length < lim) out.push(f); seen++; }
  }
  return { total, rows: out };
}
async function staticApi(path) {
  const u = new URL(path, location.href), q = Object.fromEntries(u.searchParams), p = u.pathname.replace(/^.*?\/api\//, "");
  if (p === "stats") return sget(`stats-${q.period || "all"}.json`);
  if (p === "timeseries" || p === "coverage" || p === "live") return sget(`${p}.json`);
  if (p === "flights") return queryFlights(sinceFor(q.period || "all"), (q.q || "").trim(), +q.offset || 0, +q.limit || 50);
  let m = p.match(/^flight\/(\d+)$/);
  if (m) {
    const id = +m[1];
    let f = null;
    for (const mo of META.months.filter(x => x.min_id <= id && id <= x.max_id)) {
      f = (await loadMonth(mo.m)).find(x => x.id === id);
      if (f) break;
    }
    if (!f) throw new Error("not found");
    if (!pathCache[f.pd]) pathCache[f.pd] = await sget(`paths/${f.pd}.json`).catch(() => ({}));
    if (!seenAll || seenAll.ver !== VER) seenAll = { ver: VER, map: await sget("aircraft-seen.json").catch(() => ({})) };
    const s = seenAll.map[f.hex] || [1, f.first_seen];
    return { ...f, path: pathCache[f.pd][f.id] || [], route: f._route ? { status: "ok", ...f._route } : null,
      times_seen: s[0], first_ever: s[1] };
  }
  m = p.match(/^aircraft\/([0-9a-f]{6})$/i);
  if (m) {
    const r = await fetch(`https://api.adsbdb.com/v0/aircraft/${m[1]}`);
    if (!r.ok) return {};
    const b = await r.json();
    return (b.response && b.response.aircraft) || {};
  }
  throw new Error("unknown " + path);
}

async function api(path) {
  if (STATIC) return staticApi(path);
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

/* ---------------- tooltip ---------------- */
const tip = $("#tip");
function showTip(e, html) { tip.innerHTML = html; tip.classList.add("on"); moveTip(e); }
function moveTip(e) {
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > innerHeight - 8) y = e.clientY - h - pad;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
function hideTip() { tip.classList.remove("on"); }
document.addEventListener("mousemove", e => { if (tip.classList.contains("on")) moveTip(e); });
function bindTip(el, html) { el.addEventListener("mouseenter", e => showTip(e, html)); el.addEventListener("mouseleave", hideTip); }

/* ---------------- KPIs & facts ---------------- */
function renderKPIs(st) {
  const t = st.totals || {}, r = st.records || {};
  const tiles = [
    ["Flights heard", n(t.flights), `${n(t.with_callsign)} with a callsign`],
    ["Different aircraft", n(t.aircraft), t.flights ? `${(t.flights / Math.max(1, t.aircraft)).toFixed(2)} visits each` : ""],
    ["Airlines", n(t.airlines), st.airlines?.[0] ? `top: ${prettyName(st.airlines[0].name || st.airlines[0].k)}` : ""],
    ["Aircraft types", n(t.types), st.types?.[0] ? `top: ${prettyType(st.types[0].desc, st.types[0].k)}` : ""],
    ["Routes identified", t.flights ? `${pct(t.with_route, t.flights)}%` : "–", `${n(t.origins)} origins · ${n(t.dests)} destinations`],
    ["Furthest contact", r.furthest ? km(r.furthest.max_dist) : "–", r.furthest ? `${r.furthest.callsign || r.furthest.reg || r.furthest.hex}` : ""],
  ];
  $("#kpis").innerHTML = tiles.map(([l, v, s]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div><div class="s">${esc(s)}</div></div>`).join("");
}

function renderFacts(st) {
  const t = st.totals || {}, facts = [];
  const mk = Object.fromEntries((st.makers || []).map(m => [m.k, m.n]));
  if (t.flights) facts.push(`<b>${pct(mk.Airbus || 0, t.flights)}%</b> Airbus vs <b>${pct(mk.Boeing || 0, t.flights)}%</b> Boeing`);
  const byHour = Array(24).fill(0); (st.heatmap || []).forEach(c => byHour[c.hr] += c.n);
  if (t.flights) { const h = byHour.indexOf(Math.max(...byHour)); facts.push(`Busiest hour is <b>${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00</b>`); }
  if (st.peak && st.sample_minutes > 360) facts.push(`Most at once: <b>${st.peak.total} aircraft</b> on ${fmtTime(st.peak.ts)}`);
  if (st.busiest_day) facts.push(`Busiest day: <b>${new Date(st.busiest_day.d + "T12:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })}</b> with ${n(st.busiest_day.n)} flights`);
  if (st.routes?.[0]) { const r = st.routes[0]; facts.push(`Top route: <b>${esc(r.oc || r.o)} → ${esc(r.dc || r.d)}</b> (${r.n}×)`); }
  if (st.frequent?.[0]) { const f = st.frequent[0]; facts.push(`Regular visitor: <b>${esc(f.reg || f.hex)}</b>, heard ${f.n} times`); }
  const lr = st.records?.longest_route; if (lr) facts.push(`Longest route overhead: <b>${esc(lr.o_city || lr.o_iata)} → ${esc(lr.d_city || lr.d_iata)}</b>, ${km(lr.route_km)}`);
  const heavy = (st.heavies || []).reduce((a, b) => a + b.n, 0); if (heavy) facts.push(`<b>${n(heavy)}</b> widebody / heavy jets`);
  const eng = Object.fromEntries((st.engines || []).map(e => [e.k, e.n])); if (eng.Turboprop) facts.push(`<b>${n(eng.Turboprop)}</b> propeller planes`);
  if (t.military) facts.push(`<b>${t.military}</b> military aircraft`);
  $("#facts").innerHTML = facts.map(f => `<div class="fact">${f}</div>`).join("");
}

/* ---------------- live ---------------- */
async function loadLive() {
  try {
    const d = await api("api/live");
    const list = d.aircraft || [];
    $("#liveCount").textContent = list.length;
    $("#liveTs").textContent = STATIC ? (d.now ? `snapshot from ${fmtTime(d.now)}` : "") : list.length ? "nearest first, updates every 10 s" : "";
    const g = $("#liveGrid");
    if (!list.length) { g.innerHTML = `<div class="empty">Quiet sky right now. No aircraft in range.</div>`; return; }
    g.innerHTML = list.slice(0, 24).map(a => {
      const r = a.route && a.route.plausible ? a.route : null;
      const alt = a.alt === "ground" ? "on ground" : a.alt != null ? `${n(a.alt)} ft` : "";
      const vr = a.vrate > 400 ? "↗ climbing" : a.vrate < -400 ? "↘ descending" : "";
      return `<div class="ac" data-hex="${a.hex}">
        <div class="row1"><span class="cs">${esc(a.callsign || a.reg || a.hex.toUpperCase())}${a.military ? '<span class="tag mil">MIL</span>' : ""}</span>
          <span class="muted">${flag(a.country_iso)} ${esc(a.type || "")}</span></div>
        <div class="al">${esc(prettyName(r?.airline_name || a.airline) || prettyType(a.type_desc, a.type))}</div>
        <div class="rt">${r ? `<b>${esc(r.o_iata || "")}</b> ${esc(r.o_city || "")} → <b>${esc(r.d_iata || "")}</b> ${esc(r.d_city || "")}` : `<span class="muted">${esc(prettyType(a.type_desc, a.type))}</span>`}</div>
        <div class="meta">${alt ? `<span>${alt}</span>` : ""}${a.gs ? `<span>${n(a.gs)} kt</span>` : ""}${a.dist != null ? `<span>${n(a.dist)} km away</span>` : ""}${a.track != null ? `<span class="arrow" style="transform:rotate(${a.track}deg)">↑</span>` : ""}${vr ? `<span>${vr}</span>` : ""}</div>
      </div>`;
    }).join("");
    $$(".ac", g).forEach(el => el.onclick = () => openByHex(el.dataset.hex));
  } catch (e) { $("#liveCount").textContent = "?"; }
}

/* ---------------- time series ---------------- */
let tsChart, histChart;
function chartDefaults() {
  Chart.defaults.font.family = css("--font");
  Chart.defaults.color = css("--muted");
  Chart.defaults.borderColor = css("--grid");
}
function fillSeries(key, rows) {
  const m = new Map(rows.map(r => [r.k, r]));
  const pad = x => String(x).padStart(2, "0");
  const dayLabel = (k, o) => new Date(k + "T12:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
  const out = [];
  if (key === "hour") {
    const now = Math.floor(Date.now() / 3600e3) * 3600e3;
    for (let i = 47; i >= 0; i--) {
      const p = uk(now - i * 3600e3);
      const day = `${p.y}-${pad(p.m)}-${pad(p.d)}`, k = `${day} ${pad(p.h)}:00`;
      out.push({ k, n: m.get(k)?.n || 0, u: m.get(k)?.u || 0, label: p.h === 0 ? dayLabel(day, { weekday: "short", day: "numeric" }) : `${pad(p.h)}:00` });
    }
  } else if (key === "day" && rows.length) {
    const t = uk(Date.now()), end = Date.UTC(t.y, t.m - 1, t.d);
    for (let d = Date.parse(rows[0].k + "T00:00:00Z"); d <= end; d += 86400e3) {
      const k = new Date(d).toISOString().slice(0, 10);
      out.push({ k, n: m.get(k)?.n || 0, u: m.get(k)?.u || 0, label: dayLabel(k, { day: "numeric", month: "short" }) });
    }
  } else {
    rows.forEach(r => out.push({ ...r, label: key === "week" ? "w/c " + dayLabel(r.k, { day: "numeric", month: "short" }) : dayLabel(r.k + "-01", { month: "short", year: "numeric" }) }));
  }
  return out;
}
function renderTS() {
  if (!state.ts) return;
  const key = state.tsKey, rows = fillSeries(key, state.ts[key] || []);
  const data = {
    labels: rows.map(r => r.label),
    datasets: [{ label: "Flights", data: rows.map(r => r.n), backgroundColor: css("--s1"), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 42, categoryPercentage: .9, barPercentage: .92 }],
  };
  const opts = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: css("--card"), titleColor: css("--ink"), bodyColor: css("--ink-2"), borderColor: css("--line"), borderWidth: 1, padding: 10,
      callbacks: { title: i => rows[i[0].dataIndex].k + (key === "week" ? " (week)" : ""), label: i => `${n(rows[i.dataIndex].n)} flights · ${n(rows[i.dataIndex].u)} different aircraft` } } },
    scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
      y: { beginAtZero: true, grid: { color: css("--grid") }, border: { display: false }, ticks: { precision: 0 } } },
  };
  if (tsChart) { tsChart.data = data; tsChart.options = opts; tsChart.update(); }
  else tsChart = new Chart($("#tsChart"), { type: "bar", data, options: opts });
  const first = state.stats?.data_since;
  $("#tsNote").textContent = first ? `Collecting since ${fmtTime(first)}. The first ${key === "hour" ? "hours" : key} will look small because recording started partway through.` : "";
}

/* ---------------- heatmap ---------------- */
function renderHeatmap(st) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  (st.heatmap || []).forEach(c => grid[c.dow][c.hr] = c.n);
  const max = Math.max(1, ...grid.flat());
  const order = [1, 2, 3, 4, 5, 6, 0];
  let h = `<div></div>` + Array.from({ length: 24 }, (_, i) => `<div class="hl">${i % 3 === 0 ? i : ""}</div>`).join("");
  order.forEach(d => {
    h += `<div class="lbl">${DOW[d]}</div>`;
    for (let hr = 0; hr < 24; hr++) {
      const v = grid[d][hr], p = v ? 12 + Math.round(88 * Math.sqrt(v / max)) : 0;
      h += `<div class="cell" data-d="${d}" data-h="${hr}" data-v="${v}" style="${v ? `background:color-mix(in srgb, var(--s1) ${p}%, var(--heat0))` : ""}"></div>`;
    }
  });
  const el = $("#heatmap"); el.innerHTML = h;
  el.insertAdjacentHTML("afterend", "");
  $$(".cell", el).forEach(c => bindTip(c, `<b>${DOW[c.dataset.d]} ${String(c.dataset.h).padStart(2, "0")}:00</b><br>${n(+c.dataset.v)} flights`));
  let lg = $("#heatLegend");
  if (!lg) { el.insertAdjacentHTML("afterend", `<div class="heat-legend" id="heatLegend"></div>`); lg = $("#heatLegend"); }
  lg.innerHTML = `fewer <span class="g" style="background:linear-gradient(90deg,var(--heat0),var(--s1))"></span> more (max ${n(max)} in one slot)`;
}

/* ---------------- stacks / bars ---------------- */
function stack(el, items, colors, title) {
  const total = items.reduce((a, b) => a + b.n, 0) || 1;
  el.insertAdjacentHTML("beforeend", `${title ? `<h3>${title}</h3>` : ""}<div class="stack">${items.map((it, i) => `<div data-i="${i}" style="flex:${it.n};background:${colors(it.k, i)}"></div>`).join("")}</div>
    <div class="legend">${items.map((it, i) => `<span><i class="swatch" style="background:${colors(it.k, i)}"></i>${esc(it.label || it.k)} <b>${n(it.n)}</b> <span class="muted">${pct(it.n, total)}%</span></span>`).join("")}</div>`);
  const st = el.lastElementChild.previousElementSibling;
  $$("div", st).forEach(d => { const it = items[d.dataset.i]; bindTip(d, `<b>${esc(it.label || it.k)}</b><br>${n(it.n)} flights · ${pct(it.n, total)}%`); });
}

function renderLocal(st) {
  const ap = st.local_airport;
  const apInfo = (st.airports || []).find(a => a.icao === ap);
  $("#apName").textContent = ap ? `relative to ${ap}, the nearest airport` : "";
  const order = ["Arriving", "Departing", "Cruising overhead", "Other / low level"];
  const col = { Arriving: "--s3", Departing: "--s2", "Cruising overhead": "--s1", "Other / low level": "--other" };
  const items = order.map(k => ({ k, n: (st.local.find(x => x.k === k) || {}).n || 0 })).filter(x => x.n);
  const el = $("#localBar"); el.innerHTML = "";
  if (items.length) stack(el, items, k => css(col[k]), ap ? `Flights by what they were doing near ${ap}` : "What flights were doing");
  const eb = $("#engineBars"); eb.innerHTML = "";
  const eCol = { Jet: "--s1", Turboprop: "--s4", Piston: "--s3", Electric: "--s6", Unknown: "--other" };
  const eng = (st.engines || []).filter(x => x.n);
  if (eng.length) { const d = document.createElement("div"); eb.append(d); stack(d, eng, k => css(eCol[k] || "--other"), "Engine type"); }
  const wl = { L: "Light", M: "Medium (A320, 737…)", H: "Heavy (widebody)", J: "Super (A380)", "?": "Unknown" };
  const wCol = { L: "--s3", M: "--s1", H: "--s2", J: "--s5", "?": "--other" };
  const w = ["L", "M", "H", "J", "?"].map(k => ({ k, label: wl[k], n: ((st.wtc || []).find(x => x.k === k) || {}).n || 0 })).filter(x => x.n);
  if (w.length) { const d = document.createElement("div"); eb.append(d); stack(d, w, k => css(wCol[k]), "Size class (wake category)"); }
}

function bars(el, items, { label, sub, val = it => it.n, color, tipFn, onClick, max } = {}) {
  if (!items.length) { el.innerHTML = `<div class="empty">Nothing yet for this period.</div>`; return; }
  const m = max || Math.max(...items.map(val));
  el.innerHTML = items.map((it, i) => `<div class="bar${onClick ? " clickable" : ""}" data-i="${i}">
      <div class="name">${color ? `<i class="swatch" style="background:${color(it)}"></i>` : ""}${label(it)}${sub ? `<small>${esc(sub(it))}</small>` : ""}</div>
      <div class="val">${n(val(it))}</div>
      <div class="track"><div class="fill" style="width:${(100 * val(it) / m).toFixed(1)}%;${color ? `background:${color(it)}` : ""}"></div></div></div>`).join("");
  $$(".bar", el).forEach(b => {
    const it = items[b.dataset.i];
    if (tipFn) bindTip(b, tipFn(it));
    if (onClick) b.onclick = () => onClick(it);
  });
}

function searchFor(q) { $("#search").value = q; state.q = q; state.page = 0; loadFlights(); $("#log").scrollIntoView({ behavior: "smooth" }); }

function renderWho(st) {
  const total = st.totals?.flights || 1;
  const makers = st.makers || [];
  const top = makers.filter(m => m.k !== "Unknown").slice(0, 7);
  const rest = makers.filter(m => !top.includes(m)).reduce((a, b) => a + b.n, 0);
  const mItems = top.concat(rest ? [{ k: "Other & unknown", n: rest }] : []);
  bars($("#makers"), mItems, { label: it => esc(it.k), color: it => makerColor(it.k), sub: it => `${pct(it.n, total)}%`,
    tipFn: it => `<b>${esc(it.k)}</b><br>${n(it.n)} flights (${pct(it.n, total)}%)` });
  bars($("#types"), (st.types || []).slice(0, 12), { label: it => esc(prettyType(it.desc, it.k)), sub: it => it.k, color: it => makerColor(it.maker),
    tipFn: it => `<b>${esc(prettyType(it.desc, it.k))}</b> (${it.k})<br>${n(it.n)} flights by ${n(it.uniq)} different aircraft`, onClick: it => searchFor(it.k) });
  bars($("#airlines"), (st.airlines || []).slice(0, 12), { label: it => esc(prettyName(it.name) || it.k), sub: it => it.k,
    tipFn: it => `<b>${esc(prettyName(it.name) || it.k)}</b><br>${n(it.n)} flights · ${n(it.fleet)} different aircraft · ${it.types} types`, onClick: it => searchFor(it.k) });
  bars($("#regc"), (st.reg_countries || []).slice(0, 12), { label: it => `${flag(it.iso)} ${esc(it.k)}`, sub: it => `${pct(it.n, total)}%` });
}

/* ---------------- map ---------------- */
let routeMap, tileLayer, routeLayer, homeLayer;
function tilesUrl() {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches ? document.documentElement.dataset.theme !== "light" : document.documentElement.dataset.theme === "dark";
  document.documentElement.classList.toggle("dark-tiles", dark);
  return "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
}
function gc(a, b, steps = 48) { // great-circle points between [lat,lon] pairs
  const r = Math.PI / 180, [la1, lo1] = [a[0] * r, a[1] * r], [la2, lo2] = [b[0] * r, b[1] * r];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
  if (d < 1e-6) return [a, b];
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    pts.push([Math.atan2(z, Math.hypot(x, y)) / r, Math.atan2(y, x) / r]);
  }
  for (let i = 1; i < pts.length; i++) { while (pts[i][1] - pts[i - 1][1] > 180) pts[i][1] -= 360; while (pts[i][1] - pts[i - 1][1] < -180) pts[i][1] += 360; }
  return pts;
}
function initMap() {
  routeMap = L.map("routeMap", { worldCopyJump: true, zoomControl: true, attributionControl: true }).setView([50, 5], 4);
  tileLayer = L.tileLayer(tilesUrl(), { maxZoom: 12, attribution: "© OpenStreetMap contributors" }).addTo(routeMap);
  routeLayer = L.layerGroup().addTo(routeMap);
  homeLayer = L.layerGroup().addTo(routeMap);
}
let routeLines = [];
function renderRoutes(st) {
  if (!routeMap) initMap();
  routeLayer.clearLayers(); routeLines = [];
  const routes = (st.routes || []).filter(r => r.olat != null && r.dlat != null);
  const max = Math.max(1, ...routes.map(r => r.n));
  const accent = css("--s1");
  routes.slice().reverse().forEach(r => {
    const line = L.polyline(gc([r.olat, r.olon], [r.dlat, r.dlon]), { color: accent, weight: 1 + 3 * Math.sqrt(r.n / max), opacity: .25 + .6 * Math.sqrt(r.n / max) })
      .bindTooltip(`<b>${esc(r.o)} ${esc(r.oc || "")} → ${esc(r.d)} ${esc(r.dc || "")}</b><br>${r.n} flights · ${km(r.km)}<br><span style="opacity:.7">${esc((r.airlines || "").split(",").slice(0, 3).join(", "))}</span>`, { sticky: true });
    line.addTo(routeLayer); line._r = r; routeLines.push(line);
  });
  const amax = Math.max(1, ...(st.airports || []).map(a => a.n));
  (st.airports || []).forEach(a => {
    if (a.lat == null) return;
    L.circleMarker([a.lat, a.lon], { radius: 3 + 7 * Math.sqrt(a.n / amax), color: css("--card"), weight: 1.5, fillColor: css("--s2"), fillOpacity: .9 })
      .bindTooltip(`<b>${esc(a.iata || a.icao)}</b> ${esc(a.name || "")}<br>${flag(a.iso)} ${esc(a.city || "")}, ${esc(a.country || "")}<br>${n(a.n)} flights to/from`).addTo(routeLayer);
  });
  if (routes.length) {
    const b = L.latLngBounds(routes.flatMap(r => [[r.olat, r.olon], [r.dlat, r.dlon]]));
    routeMap.fitBounds(b.pad(0.05), { maxZoom: 6 });
  }
  const ol = $("#routes");
  ol.innerHTML = routes.slice(0, 25).map((r, i) => `<li data-i="${i}"><div class="rt">${esc(r.o)} → ${esc(r.d)}<small>${esc(r.oc || "")} → ${esc(r.dc || "")} · ${km(r.km)}</small></div><span class="n">${r.n}×</span></li>`).join("") || `<li class="empty">Route lookups are still running…</li>`;
  $$("li[data-i]", ol).forEach(li => {
    const r = routes[li.dataset.i];
    const line = routeLines.find(l => l._r === r);
    li.onmouseenter = () => { line?.setStyle({ color: css("--s2"), weight: 5, opacity: 1 }); line?.bringToFront(); };
    li.onmouseleave = () => line?.setStyle({ color: accent, weight: 1 + 3 * Math.sqrt(r.n / max), opacity: .25 + .6 * Math.sqrt(r.n / max) });
    li.onclick = () => { if (line) routeMap.fitBounds(line.getBounds().pad(0.2)); searchFor(r.d); };
  });
  const t = st.totals || {};
  $("#routeCover").textContent = t.with_callsign ? `route found for ${pct(t.with_route, t.with_callsign)}% of flights with a callsign` : "";
  bars($("#airports"), (st.airports || []).slice(0, 10), { label: it => `${esc(it.iata || it.icao)} <span class="muted">${esc(it.city || it.name || "")}</span>`, sub: it => flag(it.iso), onClick: it => searchFor(it.iata || it.icao) });
  bars($("#rcountries"), (st.route_countries || []).filter(c => c.k).slice(0, 10), { label: it => `${flag(it.iso)} ${esc(it.k)}` });
}
function renderHome() {
  if (!routeMap || !state.cov) return;
  homeLayer.clearLayers();
  const c = state.cov;
  if (c.home) {
    L.marker(c.home, { icon: L.divIcon({ className: "", html: '<div class="home-marker"></div>', iconSize: [14, 14] }) }).bindTooltip("My antenna").addTo(homeLayer);
    if (c.buckets.length > 8) {
      const pts = c.buckets.map(([b, d]) => dest(c.home, b + 2.5, d));
      L.polygon(pts, { color: css("--radar"), weight: 1.5, fillOpacity: .06, dashArray: "4 4" }).bindTooltip("Reception range so far").addTo(homeLayer);
    }
  }
}
function dest([lat, lon], brg, dkm) {
  const r = Math.PI / 180, d = dkm / 6371, b = brg * r, la = lat * r, lo = lon * r;
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return [la2 / r, lo2 / r];
}

/* ---------------- records / lists ---------------- */
const who = f => esc(f.callsign || f.reg || (f.hex || "").toUpperCase());
const whatType = f => esc(prettyType(f.type_desc, f.type));
function renderRecords(st) {
  const r = st.records || {};
  const cards = [
    ["furthest", "Furthest away", f => km(f.max_dist), f => `${who(f)} · ${whatType(f)}`],
    ["highest", "Highest", f => ft(f.max_alt), f => `${who(f)} · ${whatType(f)}`],
    ["fastest", "Fastest (ground speed)", f => `${n(f.max_gs)} kt`, f => `${who(f)} · ${n(f.max_gs * 1.15078)} mph, tailwind helps`],
    ["closest", "Closest to home", f => km(f.min_dist), f => `${who(f)} · ${whatType(f)}`],
    ["longest_watch", "Tracked the longest", f => dur(f.last_seen - f.first_seen), f => `${who(f)} · ${whatType(f)}`],
    ["longest_route", "Longest route", f => km(f.route_km), f => `${esc(f.o_city || f.o_iata)} → ${esc(f.d_city || f.d_iata)} · ${who(f)}`],
  ];
  $("#records").innerHTML = cards.filter(c => r[c[0]]).map(([k, t, v, d]) => `<div class="rec" data-id="${r[k].id}"><div class="t">${t}</div><div class="v">${v(r[k])}</div><div class="d">${d(r[k])}</div><div class="d muted">${fmtTime(r[k].first_seen)}</div></div>`).join("") || `<div class="empty">No records yet.</div>`;
  $$(".rec", $("#records")).forEach(el => el.onclick = () => openFlight(el.dataset.id));
}
function listItems(el, rows, a, b, onClick) {
  if (!rows.length) { el.innerHTML = `<div class="empty">${el.dataset.empty || "None yet."}</div>`; return; }
  el.innerHTML = rows.map((r, i) => `<div class="li" data-i="${i}"><div class="a">${a(r)}</div><div class="b">${b(r)}</div></div>`).join("");
  $$(".li", el).forEach(x => x.onclick = () => onClick(rows[x.dataset.i]));
}
function renderFrequent(st) {
  listItems($("#frequent"), st.frequent || [],
    f => `<div><b>${esc(f.reg || f.hex.toUpperCase())}</b> · ${whatType(f)}</div><small>${esc(prettyName(f.airline) || "")} ${esc((f.callsigns || "").split(",").slice(0, 4).join(", "))}</small>`,
    f => `<strong>${f.n}×</strong>last ${ago(f.last)}`, f => searchFor(f.hex));
}
function renderSpecial(st) {
  const p = st.privacy || {}, el = $("#special");
  const heavy = (st.heavies || []);
  el.innerHTML = `
    <div><h3>Military</h3><div class="list" id="milList" data-empty="No military aircraft in this period."></div></div>
    <div><h3>Emergency squawks</h3><div class="list" id="emList" data-empty="No emergencies (7500 / 7600 / 7700) heard. Good news."></div></div>
    <div><h3>One of a kind</h3><div class="list" id="rareList" data-empty="Every type here has been seen more than once."></div></div>
    <div><h3>Big jets</h3><div class="list" id="heavyList" data-empty="No widebodies yet."></div>
      <h3 style="margin-top:16px">Privacy &amp; tech</h3>
      <div class="badge-row">
        <div class="mini"><b>${n(p.mlat)}</b><span>located by MLAT (no GPS broadcast)</span></div>
        <div class="mini"><b>${n((p.pia || 0) + (p.ladd || 0))}</b><span>privacy-listed (PIA / LADD)</span></div>
      </div></div>`;
  const line = f => `<div><b>${who(f)}</b> · ${whatType(f)}</div><small>${esc(f.country || prettyName(f.airline_name) || "")} ${f.reg ? "· " + esc(f.reg) : ""}</small>`;
  listItems($("#milList"), st.military || [], line, f => fmtTime(f.first_seen), f => openFlight(f.id));
  listItems($("#emList"), st.emergencies || [], f => `<div><b>${who(f)}</b> · ${esc(f.emergency)}</div><small>squawks: ${esc(f.squawks)}</small>`, f => fmtTime(f.first_seen), f => openFlight(f.id));
  listItems($("#rareList"), st.rare_types || [], f => `<div><b>${whatType(f)}</b></div><small>${who(f)} ${f.reg ? "· " + esc(f.reg) : ""}</small>`, f => fmtTime(f.first_seen), f => openFlight(f.id));
  listItems($("#heavyList"), heavy, h => `<div><b>${esc(prettyType(h.desc, h.k))}</b></div><small>${h.k}</small>`, h => `<strong>${h.n}×</strong>`, h => searchFor(h.k));
}

/* ---------------- polar coverage ---------------- */
function renderPolar() {
  const c = state.cov, el = $("#polar");
  if (!c || !c.buckets.length) { el.innerHTML = `<div class="empty">${c && !c.has_rx ? "Antenna location unknown, so distances can't be measured." : "Not enough positions yet."}</div>`; return; }
  const S = 420, C = S / 2, R = C - 34;
  const maxD = Math.max(...c.buckets.map(b => b[1]));
  const step = maxD > 300 ? 100 : 50, top = Math.ceil(maxD / step) * step;
  const xy = (brg, d) => { const a = (brg - 90) * Math.PI / 180, r = R * d / top; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
  let s = `<svg viewBox="0 0 ${S} ${S}" role="img" aria-label="Reception range by direction">`;
  for (let d = step; d <= top; d += step) { s += `<circle cx="${C}" cy="${C}" r="${R * d / top}" fill="none" stroke="${css("--grid")}"/><text x="${C + 4}" y="${C - R * d / top - 3}" font-size="10" fill="${css("--muted")}">${d} km</text>`; }
  [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(([l, b]) => { const [x, y] = xy(b, top * 1.09); s += `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="${css("--ink-2")}">${l}</text>`; });
  for (let b = 0; b < 360; b += 30) { const [x, y] = xy(b, top); s += `<line x1="${C}" y1="${C}" x2="${x}" y2="${y}" stroke="${css("--grid")}" stroke-width=".6"/>`; }
  const m = new Map(c.buckets.map(([b, d]) => [b, d]));
  const pts = []; for (let b = 0; b < 360; b += 5) pts.push(xy(b + 2.5, m.get(b) || 0));
  s += `<polygon points="${pts.map(p => p.join(",")).join(" ")}" fill="${css("--radar")}" fill-opacity=".18" stroke="${css("--radar")}" stroke-width="2" stroke-linejoin="round"/>`;
  c.buckets.forEach(([b, d]) => { const [x, y] = xy(b + 2.5, d); s += `<circle class="pp" cx="${x}" cy="${y}" r="9" fill="transparent" data-b="${b}" data-d="${d}"/>`; });
  s += `<circle cx="${C}" cy="${C}" r="4" fill="${css("--radar")}"/></svg>`;
  el.innerHTML = s;
  $$(".pp", el).forEach(p => bindTip(p, `<b>${p.dataset.b}°–${+p.dataset.b + 5}°</b><br>furthest: ${km(+p.dataset.d)}`));
}

/* ---------------- histograms ---------------- */
function renderHist(st) {
  const key = state.histKey;
  const rows = key === "dist" ? st.dist_hist || [] : st.alt_hist || [];
  const w = key === "dist" ? 25 : 2500;
  const labels = rows.map(r => key === "dist" ? `${r.b}` : `${(r.b / 1000).toFixed(r.b % 1000 ? 1 : 0)}k`);
  const data = { labels, datasets: [{ data: rows.map(r => r.n), backgroundColor: css(key === "dist" ? "--s3" : "--s7"), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", categoryPercentage: .92, barPercentage: .95 }] };
  const opts = { responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: css("--card"), titleColor: css("--ink"), bodyColor: css("--ink-2"), borderColor: css("--line"), borderWidth: 1, padding: 10,
      callbacks: { title: i => key === "dist" ? `${rows[i[0].dataIndex].b}–${rows[i[0].dataIndex].b + w} km away at furthest` : `${n(rows[i[0].dataIndex].b)}–${n(rows[i[0].dataIndex].b + w)} ft at highest`, label: i => `${n(i.raw)} flights` } } },
    scales: { x: { grid: { display: false }, title: { display: true, text: key === "dist" ? "km from antenna" : "feet" }, ticks: { maxRotation: 0, autoSkip: true } },
      y: { beginAtZero: true, grid: { color: css("--grid") }, border: { display: false }, ticks: { precision: 0 } } } };
  if (histChart) { histChart.data = data; histChart.options = opts; histChart.update(); } else histChart = new Chart($("#histChart"), { type: "bar", data, options: opts });
}

/* ---------------- flight log ---------------- */
const PAGE = 40;
async function loadFlights() {
  const d = await api(`api/flights?period=${state.period}&limit=${PAGE}&offset=${state.page * PAGE}&q=${encodeURIComponent(state.q)}`);
  const tb = $("#flightRows");
  tb.innerHTML = d.rows.map(f => {
    const rt = f.o_iata && f.plausible ? `${esc(f.o_iata)} → ${esc(f.d_iata)} <small>${esc(f.o_city || "")} → ${esc(f.d_city || "")}</small>` : f.o_iata ? `<small title="route probably out of date">${esc(f.o_iata)} → ${esc(f.d_iata)}?</small>` : `<small>–</small>`;
    return `<tr data-id="${f.id}"><td>${fmtTime(f.first_seen)}${f.done ? "" : ' <span class="tag">live</span>'}</td>
      <td><b>${esc(f.callsign || "–")}</b>${f.military ? '<span class="tag mil">MIL</span>' : ""}${f.emergency ? '<span class="tag mil">EMERG</span>' : ""}<br><small>${esc(prettyName(f.airline_name) || "")}</small></td>
      <td>${esc(prettyType(f.type_desc, f.type))}<br><small>${flag(f.country_iso)} ${esc(f.reg || f.hex.toUpperCase())}</small></td>
      <td>${rt}</td><td class="num">${f.max_alt != null ? n(f.max_alt) + " ft" : "–"}</td><td class="num loc">${km(f.min_dist)}</td><td class="num loc">${km(f.max_dist)}</td></tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">No flights match.</td></tr>`;
  $$("tr[data-id]", tb).forEach(tr => tr.onclick = () => openFlight(tr.dataset.id));
  const from = d.total ? state.page * PAGE + 1 : 0, to = Math.min(d.total, (state.page + 1) * PAGE);
  $("#pageInfo").textContent = `${n(from)}–${n(to)} of ${n(d.total)}`;
  $("#prev").disabled = state.page === 0;
  $("#next").disabled = to >= d.total;
}

/* ---------------- modal ---------------- */
let miniMap;
async function openByHex(hex) {
  const d = await api(`api/flights?q=${hex}&limit=1&period=30d`);
  if (d.rows[0]) openFlight(d.rows[0].id);
}
async function openFlight(id) {
  const f = await api(`api/flight/${id}`);
  const r = f.route && f.route.status === "ok" ? f.route : null;
  const dlg = $("#modal"), body = $("#modalBody");
  const routeLine = r ? `${flag(r.o_iso)} ${esc(r.o_city || r.o_name)} (${esc(r.o_iata || r.o_icao)}) → ${flag(r.d_iso)} ${esc(r.d_city || r.d_name)} (${esc(r.d_iata || r.d_icao)})${r.plausible ? "" : ' <span class="tag">probably outdated</span>'}` : "Route unknown";
  const facts = [
    ["Aircraft", prettyType(f.type_desc, f.type)], ["Registration", f.reg || "–"], ["ICAO address", f.hex.toUpperCase()],
    ["Registered in", `${flag(f.country_iso)} ${f.country || "–"}`], ["Airline", prettyName(r?.airline_name || f.airline_name) || "–"],
    ["First heard", fmtTime(f.first_seen)], ["Last heard", fmtTime(f.last_seen)], ["Tracked for", dur(f.last_seen - f.first_seen)],
    ["Highest", ft(f.max_alt)], ["Lowest", ft(f.min_alt)], ["Top ground speed", f.max_gs ? `${n(f.max_gs)} kt` : "–"],
    ["Closest", km(f.min_dist)], ["Furthest", km(f.max_dist)], ["Route length", r?.route_km ? km(r.route_km) : "–"],
    ["Times I've heard it", `${f.times_seen}× since ${fmtDate(f.first_ever)}`], ["Squawk codes", f.squawks || "–"],
    ["Positions received", n(f.positions)], ["Engine / size", [f.engine, { L: "light", M: "medium", H: "heavy", J: "super" }[f.wtc]].filter(Boolean).join(" · ") || "–"],
  ];
  const shown = STATIC ? facts.filter(([k]) => k !== "Closest" && k !== "Furthest") : facts;
  body.innerHTML = `<div class="m-head"><div><h2>${esc(f.callsign || f.reg || f.hex.toUpperCase())}${f.military ? ' <span class="tag mil">MILITARY</span>' : ""}</h2>
      <div class="muted">${routeLine}</div></div></div>
    <div class="photo" id="photo">Looking for a photo…</div>
    <div class="facts-grid">${shown.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
    <div id="miniMap" class="mini-map"></div>
    <p class="note">More: ${f.callsign ? `<a target="_blank" rel="noopener" href="https://flightaware.com/live/flight/${encodeURIComponent(f.callsign)}">FlightAware</a> · ` : ""}${f.reg ? `<a target="_blank" rel="noopener" href="https://www.flightradar24.com/data/aircraft/${encodeURIComponent(f.reg.toLowerCase())}">Flightradar24</a> · ` : ""}<a target="_blank" rel="noopener" href="https://globe.airplanes.live/?icao=${f.hex}">airplanes.live</a></p>`;
  if (!dlg.open) dlg.showModal();
  // mini map
  if (miniMap) { miniMap.remove(); miniMap = null; }
  const path = (f.path || []).map(p => [p[1], p[2]]);
  if (f.last_lat != null) path.push([f.last_lat, f.last_lon]);
  if (path.length || r) {
    miniMap = L.map("miniMap", { attributionControl: false });
    L.tileLayer(tilesUrl(), { maxZoom: 12 }).addTo(miniMap);
    const layers = [];
    if (r && r.o_lat != null && r.d_lat != null) layers.push(L.polyline(gc([r.o_lat, r.o_lon], [r.d_lat, r.d_lon]), { color: css("--muted"), dashArray: "5 6", weight: 1.5 }).addTo(miniMap));
    if (path.length > 1) layers.push(L.polyline(path, { color: css("--s2"), weight: 3 }).addTo(miniMap));
    if (state.cov?.home) L.circleMarker(state.cov.home, { radius: 5, color: css("--radar"), fillOpacity: 1 }).bindTooltip("My antenna").addTo(miniMap);
    const pathLayer = path.length > 1 ? layers[layers.length - 1] : null;
    if (pathLayer) miniMap.fitBounds(pathLayer.getBounds().pad(0.6), { maxZoom: 9 });
    else if (layers[0]) miniMap.fitBounds(layers[0].getBounds().pad(0.1));
    else miniMap.setView(path[0], 8);
    setTimeout(() => miniMap && miniMap.invalidateSize(), 50);
  } else $("#miniMap").remove();
  // photo
  try {
    const a = await api(`api/aircraft/${f.hex}`);
    const ph = $("#photo");
    if (!ph) return;
    if (a.url_photo || a.url_photo_thumbnail) ph.innerHTML = `<img src="${esc(a.url_photo || a.url_photo_thumbnail)}" alt="Photo of ${esc(f.reg || f.hex)}" loading="lazy">`;
    else ph.textContent = "No photo found for this aircraft.";
    if (a.registered_owner) ph.insertAdjacentHTML("afterend", `<p class="muted" style="margin:-6px 0 12px">Owner: ${esc(a.registered_owner)}${a.registered_owner_country_name ? ", " + esc(a.registered_owner_country_name) : ""}</p>`);
  } catch (e) { const ph = $("#photo"); if (ph) ph.textContent = "Photo lookup failed."; }
}
$("#closeModal").onclick = () => $("#modal").close();
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") $("#modal").close(); });

/* ---------------- wiring ---------------- */
async function loadStats() {
  if (STATIC) {
    const meta = await fetch(`data/meta.json?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json());
    VER = String(meta.updated); META = meta;
    $("#updated").textContent = `· updated ${fmtTime(meta.updated)}, refreshes every ~20 min`;
  }
  const [st, ts, cov] = await Promise.all([api(`api/stats?period=${state.period}`), api("api/timeseries"), api("api/coverage")]);
  state.stats = st; state.ts = ts; state.cov = cov;
  $("#since").textContent = st.data_since ? `since ${fmtDate(st.data_since)}` : "";
  renderKPIs(st); renderFacts(st); renderTS(); renderHeatmap(st); renderLocal(st); renderWho(st);
  renderRoutes(st); renderHome(); renderRecords(st); renderFrequent(st); renderSpecial(st); renderPolar(); renderHist(st);
}
function renderAll() { if (!state.stats) return; chartDefaults(); if (tsChart) { tsChart.destroy(); tsChart = null; } if (histChart) { histChart.destroy(); histChart = null; }
  if (tileLayer) tileLayer.setUrl(tilesUrl()); loadStats(); }

$$(".periods button").forEach(b => {
  b.classList.toggle("on", b.dataset.p === state.period);
  b.onclick = () => {
    state.period = b.dataset.p; state.page = 0;
    try { localStorage.setItem("fs-period", state.period); } catch (e) {}
    $$(".periods button").forEach(x => x.classList.toggle("on", x === b));
    loadStats(); loadFlights();
  };
});
$$("#tsSeg button").forEach(b => b.onclick = () => { state.tsKey = b.dataset.k; $$("#tsSeg button").forEach(x => x.classList.toggle("on", x === b)); renderTS(); });
$$("#histSeg button").forEach(b => b.onclick = () => { state.histKey = b.dataset.k; $$("#histSeg button").forEach(x => x.classList.toggle("on", x === b)); renderHist(state.stats); });
let st_;
$("#search").addEventListener("input", e => { clearTimeout(st_); st_ = setTimeout(() => { state.q = e.target.value.trim(); state.page = 0; loadFlights(); }, 250); });
$("#prev").onclick = () => { state.page = Math.max(0, state.page - 1); loadFlights(); };
$("#next").onclick = () => { state.page++; loadFlights(); };
$("#themeBtn").onclick = () => {
  const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const nx = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = nx;
  try { localStorage.setItem("fs-theme", nx); } catch (e) {}
  renderAll();
};
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
if (STATIC) {
  document.body.classList.add("static");
  $("#mapLink").remove();
  $("#live h2").textContent = "Overhead at the last update";
  $("#liveWord").textContent = "overhead at last update";
} else $("#mapLink").href = `${location.protocol}//${location.hostname}:8080/`;

chartDefaults();
if (!STATIC) loadStats().catch(e => console.error(e));
if (STATIC) loadStats().then(() => { loadFlights(); loadLive(); }).catch(e => console.error(e));
else { loadFlights().catch(e => console.error(e)); loadLive(); setInterval(loadLive, 10000); }
setInterval(() => { loadStats().then(() => STATIC && loadLive()).catch(() => {}); if (state.page === 0 && !state.q) loadFlights().catch(() => {}); }, 60000);
})();
