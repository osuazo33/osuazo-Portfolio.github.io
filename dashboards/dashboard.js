/*
 * Operations Monitor — UI.
 * One store holds the transient state (snapshot, records, notifications, paused);
 * persistent preferences (KPI order, sidebar, interval, page size) live in localStorage.
 */
(function () {
  "use strict";

  var D = window.OpsData, C = window.Charts;
  if (!D || !C) return;
  var fmt = D.fmt;
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  var root = document.documentElement;
  var reduced = C.reduced;
  var desktop = window.matchMedia("(min-width: 1024px)");

  /* ---------------- Preferences (validated on read) ---------------- */
  var prefs = {
    get: function (key, valid, fallback) {
      try { var raw = localStorage.getItem(key); if (raw == null) return fallback; var v = JSON.parse(raw); return valid(v) ? v : fallback; }
      catch (e) { return fallback; }
    },
    set: function (key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked */ } }
  };

  var KPI_IDS = ["orders", "revenue", "success", "aov"];
  var INTERVALS = [3000, 4000, 5000];

  var state = {
    interval: prefs.get("ops-interval", function (v) { return INTERVALS.indexOf(v) >= 0; }, 4000),
    paused: false,
    lastUpdate: 0,
    snapshot: null,
    records: [],
    source: "loading",          // loading | api | local
    online: navigator.onLine !== false,
    notifications: [],
    notifQueue: [],
    table: {
      sortKey: "t", sortDir: "desc", page: 1, filter: "all",
      pageSize: prefs.get("ops-page-size", function (v) { return [10, 25, 50].indexOf(v) >= 0; }, 10),
      expanded: {}
    }
  };

  var sim = D.createSimulation({ tickMs: state.interval });
  sim.init(Date.now());

  /* ---------------- Small helpers ---------------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var announcer = $("[data-announce]");
  function announce(msg) { announcer.textContent = ""; window.setTimeout(function () { announcer.textContent = msg; }, 30); }

  var ICONS = {
    large: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
    failed: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
    refund: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    queue: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    digest: '<path d="M3 3v18h18"/><path d="M8 17v-4M13 17V9M18 17v-7"/>',
    system: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>'
  };
  function icon(name, cls) {
    return '<svg class="' + (cls || "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + "</svg>";
  }

  // FLIP: animate elements from their previous positions to the new layout (0.3 s).
  function flip(elements, mutate, duration) {
    if (reduced()) { mutate(); return; }
    var before = elements.map(function (el) { return el.getBoundingClientRect(); });
    mutate();
    elements.forEach(function (el, i) {
      var a = before[i], b = el.getBoundingClientRect();
      var dx = a.left - b.left, dy = a.top - b.top;
      if (!dx && !dy) return;
      if (el.animate) el.animate([{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "none" }],
        { duration: duration || 300, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    });
  }

  /* =================================================================
   * KPIs
   * ================================================================= */
  var KPI = {
    orders: { value: function (m) { return m.orders; }, format: fmt.int, kind: "pct", good: "up" },
    revenue: { value: function (m) { return m.revenue; }, format: fmt.money0, kind: "pct", good: "up" },
    success: { value: function (m) { return m.successRate; }, format: function (v) { return fmt.pct(v); }, kind: "pp", good: "up" },
    aov: { value: function (m) { return m.aov; }, format: fmt.money, kind: "pct", good: "up" }
  };

  function deltaText(id, cur, prev) {
    var k = KPI[id];
    if (cur == null || prev == null) return { text: "— vs previous 30 min", tone: "flat" };
    var diff, label;
    if (k.kind === "pp") {
      diff = (cur - prev) * 100;
      label = (diff >= 0 ? "+" : "−") + Math.abs(diff).toFixed(1) + " pp";
    } else {
      if (prev === 0) return { text: "+" + k.format(cur) + " (new) vs previous 30 min", tone: "flat" };
      diff = ((cur - prev) / prev) * 100;
      label = (diff >= 0 ? "+" : "−") + Math.abs(diff).toFixed(1) + "%";
    }
    var tone = Math.abs(diff) < 0.05 ? "flat" : (diff > 0) === (k.good === "up") ? "good" : "bad";
    if (tone === "flat") label = k.kind === "pp" ? "0.0 pp" : "0.0%";
    return { text: label, tone: tone };
  }

  function renderKpis(s) {
    KPI_IDS.forEach(function (id) {
      var k = KPI[id];
      var valEl = $("[data-value-for='" + id + "']");
      if (valEl.querySelector(".skeleton")) { valEl.textContent = ""; valEl.classList.add("is-ready"); }
      C.countTo(valEl, k.value(s.current), k.format);
      var d = deltaText(id, k.value(s.current), k.value(s.previous));
      var dEl = $("[data-delta-for='" + id + "']");
      dEl.className = "kpi-delta is-" + d.tone;
      if (d.text.indexOf("vs previous") >= 0) dEl.textContent = d.text;
      else dEl.innerHTML = '<span class="num">' + esc(d.text) + "</span> vs previous 30 min";
    });
  }

  /* ----- Reordering: pointer drag (mouse/pen), menu (touch), arrow keys (keyboard) ----- */
  var grid = $("[data-kpi-grid]");
  function cards() { return $$(".kpi", grid); }
  function currentOrder() { return cards().map(function (c) { return c.getAttribute("data-kpi"); }); }
  function validOrder(v) {
    return Array.isArray(v) && v.length === KPI_IDS.length &&
      KPI_IDS.every(function (id) { return v.indexOf(id) >= 0; });
  }
  function applyOrder(order, animate) {
    var els = cards();
    var byId = {};
    els.forEach(function (c) { byId[c.getAttribute("data-kpi")] = c; });
    var mutate = function () { order.forEach(function (id) { grid.appendChild(byId[id]); }); };
    if (animate) flip(els, mutate); else mutate();
  }
  function saveOrder() { prefs.set("ops-kpi-order", currentOrder()); }
  applyOrder(prefs.get("ops-kpi-order", validOrder, KPI_IDS), false);

  function moveCard(card, to, keepFocus) {
    var els = cards(), from = els.indexOf(card);
    to = Math.max(0, Math.min(els.length - 1, to));
    if (to === from) return;
    flip(els, function () {
      var ref = els[to];
      grid.insertBefore(card, to > from ? ref.nextSibling : ref);
    });
    saveOrder();
    if (keepFocus) $(".kpi-handle", card).focus();
    announce(card.querySelector("h3").textContent + " moved to position " + (to + 1) + " of " + els.length);
  }

  grid.addEventListener("keydown", function (e) {
    var handle = e.target.closest(".kpi-handle");
    if (!handle) return;
    var card = handle.closest(".kpi"), idx = cards().indexOf(card);
    var map = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
    if (map[e.key]) { e.preventDefault(); moveCard(card, idx + map[e.key], true); }
    else if (e.key === "Home") { e.preventDefault(); moveCard(card, 0, true); }
    else if (e.key === "End") { e.preventDefault(); moveCard(card, cards().length - 1, true); }
  });

  var drag = null;
  grid.addEventListener("pointerdown", function (e) {
    var handle = e.target.closest(".kpi-handle");
    if (!handle || e.button !== 0 || e.pointerType === "touch") return;
    var card = handle.closest(".kpi");
    drag = { card: card, handle: handle, id: e.pointerId, sx: e.clientX, sy: e.clientY, active: false,
      gx: e.clientX - card.getBoundingClientRect().left, gy: e.clientY - card.getBoundingClientRect().top };
    handle.setPointerCapture(e.pointerId);
  });
  grid.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
      drag.active = true;
      closeMenu();
      drag.card.classList.add("is-dragging");
      grid.classList.add("is-sorting");
    }
    var g = grid.getBoundingClientRect();
    var x = e.clientX - g.left - drag.gx - drag.card.offsetLeft;
    var y = e.clientY - g.top - drag.gy - drag.card.offsetTop;
    drag.card.style.transform = "translate(" + x + "px," + y + "px) scale(1.03)";
    // Swap with the card under the pointer.
    var others = cards().filter(function (c) { return c !== drag.card; });
    // Hit-test against layout boxes, not animated rects, so swaps stay correct mid-FLIP.
    var px = e.clientX - g.left, py = e.clientY - g.top;
    for (var i = 0; i < others.length; i++) {
      var o = others[i];
      if (px > o.offsetLeft && px < o.offsetLeft + o.offsetWidth && py > o.offsetTop && py < o.offsetTop + o.offsetHeight) {
        var all = cards(), to = all.indexOf(others[i]), from = all.indexOf(drag.card);
        flip(others, function () { grid.insertBefore(drag.card, to > from ? others[i].nextSibling : others[i]); });
        x = e.clientX - g.left - drag.gx - drag.card.offsetLeft;
        y = e.clientY - g.top - drag.gy - drag.card.offsetTop;
        drag.card.style.transform = "translate(" + x + "px," + y + "px) scale(1.03)";
        break;
      }
    }
  });
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    var d = drag; drag = null;
    if (!d.active) return;
    d.card.classList.remove("is-dragging");
    d.card.classList.add("is-dropping");
    d.card.style.transform = "";
    grid.classList.remove("is-sorting");
    window.setTimeout(function () { d.card.classList.remove("is-dropping"); }, 220);
    d.handle.dataset.dragged = "1";
    saveOrder();
    announce(d.card.querySelector("h3").textContent + " moved to position " + (cards().indexOf(d.card) + 1));
  }
  grid.addEventListener("pointerup", endDrag);
  grid.addEventListener("pointercancel", endDrag);

  // Menu for touch and click users.
  var menu = $("[data-kpi-menu]"), menuCard = null;
  function openMenu(card, handle) {
    menuCard = card;
    menu.hidden = false;
    var r = handle.getBoundingClientRect();
    var left = Math.min(window.innerWidth - menu.offsetWidth - 12, r.right - menu.offsetWidth);
    menu.style.left = Math.max(12, left) + "px";
    menu.style.top = (r.bottom + window.scrollY + 6) + "px";
    var idx = cards().indexOf(card), last = cards().length - 1;
    $$("[data-move]", menu).forEach(function (b) {
      var m = b.getAttribute("data-move");
      b.disabled = (idx === 0 && (m === "first" || m === "-1")) || (idx === last && (m === "last" || m === "1"));
    });
    handle.setAttribute("aria-expanded", "true");
    var first = $("[data-move]:not(:disabled)", menu);
    if (first) first.focus();
  }
  function closeMenu(restore) {
    if (menu.hidden) return;
    menu.hidden = true;
    if (menuCard) {
      var h = $(".kpi-handle", menuCard);
      h.setAttribute("aria-expanded", "false");
      if (restore) h.focus();
    }
    menuCard = null;
  }
  grid.addEventListener("click", function (e) {
    var handle = e.target.closest(".kpi-handle");
    if (!handle) return;
    if (handle.dataset.dragged) { delete handle.dataset.dragged; return; }
    var card = handle.closest(".kpi");
    if (menuCard === card) closeMenu(true); else { closeMenu(); openMenu(card, handle); }
  });
  menu.addEventListener("click", function (e) {
    var b = e.target.closest("[data-move]");
    if (!b || !menuCard) return;
    var card = menuCard, m = b.getAttribute("data-move"), idx = cards().indexOf(card);
    var to = m === "first" ? 0 : m === "last" ? cards().length - 1 : idx + parseInt(m, 10);
    closeMenu();
    moveCard(card, to, true);
  });
  menu.addEventListener("keydown", function (e) {
    var items = $$("[data-move]:not(:disabled)", menu), i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); closeMenu(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === "Tab") closeMenu();
  });
  document.addEventListener("pointerdown", function (e) {
    if (!menu.hidden && !menu.contains(e.target) && !e.target.closest(".kpi-handle")) closeMenu();
  });

  $("[data-reset-layout]").addEventListener("click", function () {
    applyOrder(KPI_IDS, true);
    saveOrder();
    announce("Card order reset");
  });

  /* =================================================================
   * Charts
   * ================================================================= */
  function clearSkeleton(el) { var s = $(".skeleton-chart", el); if (s) s.remove(); return el; }
  var lineChart = C.line(clearSkeleton($("[data-chart='line']")), {
    points: 40, xLabels: 5, label: "Order value placed in the rolling last 5 minutes, sampled at every update. Simulated data.",
    formatY: fmt.compactMoney,
    formatX: function (d) { return fmt.time(d.t, true); },
    formatTip: function (d) { return "<b>" + fmt.money(d.v) + "</b> · " + fmt.time(d.t, true); }
  });
  var areaChart = C.line(clearSkeleton($("[data-chart='area']")), {
    area: true, points: 40, xLabels: 4, integer: true, pad: { l: 34 },
    label: "Open orders waiting for payment confirmation at each update. Simulated data.",
    formatY: function (v) { return String(Math.round(v)); },
    formatX: function (d) { return fmt.time(d.t, true); },
    formatTip: function (d) { return "<b>" + d.v + " open</b> · " + fmt.time(d.t, true); }
  });
  var columnChart = C.columns(clearSkeleton($("[data-chart='columns']")), {
    integer: true, labelEvery: 3, label: "Orders placed per 5-minute bucket over the last hour. Simulated data.",
    formatY: function (v) { return String(Math.round(v)); },
    formatTip: function (d) { return "<b>" + d.v + " orders</b> · " + fmt.time(d.start) + "–" + fmt.time(d.end) + (d.partial ? " (filling)" : ""); }
  });
  var ringChart = C.ring($("[data-chart='ring']"), { label: "Share of orders by status, last 30 minutes" });

  function renderCharts(s) {
    lineChart.update(s.series.map(function (p) { return { key: p.key, t: p.t, v: p.value }; }));
    areaChart.update(s.series.map(function (p) { return { key: p.key, t: p.t, v: p.pending }; }));
    columnChart.update(s.buckets.map(function (b) { return { key: b.key, label: fmt.time(b.start), v: b.v, start: b.start, end: b.end, partial: b.partial }; }));
    ringChart.update(s.status);

    var last = s.series[s.series.length - 1];
    $("[data-line-last]").textContent = last ? fmt.money0(last.value) + " now" : "";
    $("[data-open-now]").textContent = s.openNow + " open now";

    var total = s.current.orders;
    C.countTo($("[data-ring-total]"), total, fmt.int);
    $("[data-ring-legend]").innerHTML = "<tbody>" + s.status.map(function (d) {
      return '<tr><th scope="row"><span class="swatch seg-bg-' + d.key + '"></span>' + esc(d.label) + "</th>" +
        '<td class="num">' + fmt.int(d.v) + '</td><td class="num muted">' + (total ? fmt.pct(d.v / total) : "—") + "</td></tr>";
    }).join("") + "</tbody>";
    renderCategories(s.categories);
  }

  var catList = $("[data-categories]"), catRows = {}, catStarted = false;
  function renderCategories(list) {
    if (!list.length) {
      catList.innerHTML = '<li class="empty-line">No completed orders in the last 30 minutes.</li>';
      catRows = {};
      return;
    }
    var empty = $(".empty-line", catList);
    if (empty) empty.remove();
    var max = list[0].v || 1;
    var keys = {};
    list.forEach(function (c, i) {
      keys[c.key] = 1;
      var row = catRows[c.key];
      if (!row) {
        row = document.createElement("li");
        row.innerHTML = '<span class="cat-name"></span><span class="cat-track"><span class="cat-bar"></span></span><span class="cat-val num"></span>';
        catRows[c.key] = row;
        if (!catStarted && !reduced()) row.style.setProperty("--d", (i * 0.1) + "s");
      }
      row.querySelector(".cat-name").textContent = c.label;
      row.querySelector(".cat-val").textContent = fmt.money0(c.v);
      row.querySelector(".cat-bar").style.transform = "scaleX(" + Math.max(0.002, c.v / max).toFixed(4) + ")";
      row.querySelector(".cat-bar").classList.toggle("is-rest", c.key === "other");
    });
    Object.keys(catRows).forEach(function (k) { if (!keys[k]) { catRows[k].remove(); delete catRows[k]; } });
    var ordered = list.map(function (c) { return catRows[c.key]; });
    var current = $$("li", catList);
    var same = ordered.length === current.length && ordered.every(function (r, i) { return r === current[i]; });
    if (!same) {
      var existing = ordered.filter(function (r) { return r.parentNode; });
      flip(existing, function () { ordered.forEach(function (r) { catList.appendChild(r); }); });
    }
    if (!catStarted) {
      catStarted = true;
      catList.classList.add("is-entering");
      requestAnimationFrame(function () { requestAnimationFrame(function () { catList.classList.remove("is-entering"); }); });
      // The stagger applies to the entrance only; later updates move together.
      window.setTimeout(function () { $$("li", catList).forEach(function (li) { li.style.removeProperty("--d"); }); }, 1600);
    }
  }

  /* =================================================================
   * Finding line: the one thing that needs attention
   * ================================================================= */
  function renderFinding(s) {
    var cur = s.current, prev = s.previous, el = $("[data-finding]"), btn = $("[data-review-failed]");
    var top = s.categories[0];
    var msg, showFailed = false;
    var dpp = cur.successRate != null && prev.successRate != null ? (cur.successRate - prev.successRate) * 100 : 0;
    var dRev = prev.revenue ? (cur.revenue - prev.revenue) / prev.revenue * 100 : 0;
    if (dpp <= -1.5) {
      msg = "Payment success is " + fmt.pct(cur.successRate) + ", " + Math.abs(dpp).toFixed(1) + " pp below the previous 30 minutes, with " + cur.failed + " failed payments to review.";
      showFailed = cur.failed > 0;
    } else if (s.openNow >= 6) {
      msg = s.openNow + " orders are waiting for payment confirmation, above the usual queue of 2–4.";
    } else if (Math.abs(dRev) >= 8) {
      msg = "Completed revenue is " + (dRev > 0 ? "up " : "down ") + Math.abs(dRev).toFixed(1) + "% on the previous 30 minutes" + (top ? ", led by " + top.label.toLowerCase() + " at " + fmt.money0(top.v) + "." : ".");
    } else {
      msg = "Orders are steady: " + fmt.int(cur.orders) + " in the last 30 minutes at " + fmt.pct(cur.successRate) + " payment success" + (top ? "; " + top.label.toLowerCase() + " brings the most revenue." : ".");
      showFailed = cur.failed >= 4;
    }
    el.textContent = msg;
    btn.hidden = !showFailed;
  }
  $("[data-review-failed]").addEventListener("click", function () {
    setFilter("failed");
    $("#orders").scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
  });

  /* =================================================================
   * Orders table
   * ================================================================= */
  var tbody = $("[data-rows]");
  var rowMap = {};             // id -> { tr, detail }
  var tableStarted = false;
  var STATUS_CLASS = { completed: "is-positive", pending: "is-pending", failed: "is-high", refunded: "" };

  function sortedFiltered() {
    var t = state.table;
    var rows = t.filter === "all" ? state.records.slice() : state.records.filter(function (r) { return r.status === t.filter; });
    var k = t.sortKey, dir = t.sortDir === "asc" ? 1 : -1;
    rows.sort(function (a, b) {
      var x = a[k], y = b[k];
      if (typeof x === "string") { var c = x.localeCompare(y); return c ? c * dir : (b.t - a.t); }
      return x === y ? (b.t - a.t) : (x < y ? -1 : 1) * dir;
    });
    return rows;
  }

  function statusPill(s) {
    return '<span class="pill ' + (STATUS_CLASS[s] || "") + '">' + (s === "pending" ? '<i class="pulse-dot" aria-hidden="true"></i>' : "") + esc(D.STATUS_META[s].label) + "</span>";
  }

  function buildRow(r) {
    var tr = document.createElement("tr");
    tr.className = "order-row";
    tr.dataset.id = r.id;
    tr.innerHTML =
      '<td class="cell-id">' + esc(r.id) + "</td>" +
      '<td class="num cell-time">' + fmt.time(r.t, true) + "</td>" +
      '<td class="cell-customer"><span>' + esc(r.customer) + "</span><small>" + esc(r.product) + "</small></td>" +
      '<td class="col-cat">' + esc(r.categoryLabel) + "</td>" +
      '<td class="cell-status"></td>' +
      '<td class="num cell-amount">' + fmt.money(r.amount) + "</td>" +
      '<td class="col-action"><button class="row-toggle" type="button" aria-expanded="false" aria-controls="detail-' + r.id + '" aria-label="Show details for ' + r.id + '">' + icon("chevron") + "</button></td>";
    var detail = document.createElement("tr");
    detail.className = "detail-row";
    detail.id = "detail-" + r.id;
    detail.hidden = true;
    detail.innerHTML = '<td colspan="7"><div class="detail-grid"></div></td>';
    return { tr: tr, detail: detail, status: null };
  }

  function fillDetail(entry, r) {
    entry.detail.querySelector(".detail-grid").innerHTML =
      "<div><small>Product</small><span>" + esc(r.product) + "</span></div>" +
      "<div><small>Quantity × unit price</small><span class=\"num\">" + r.qty + " × " + fmt.money(r.unitPrice) + "</span></div>" +
      "<div><small>Channel</small><span>" + esc(r.channel) + "</span></div>" +
      "<div><small>Payment method</small><span>" + esc(r.payment) + "</span></div>" +
      "<div><small>Placed</small><span class=\"num\">" + fmt.time(r.t, true) + "</span></div>" +
      "<div><small>" + (r.status === "pending" ? "Status" : "Resolved") + "</small><span class=\"num\">" +
        (r.resolvedAt ? fmt.time(r.resolvedAt, true) : "Waiting for payment confirmation") + "</span></div>";
  }

  function renderTable(cause) {
    var t = state.table;
    var rows = sortedFiltered();
    var pages = Math.max(1, Math.ceil(rows.length / t.pageSize));
    if (t.page > pages) t.page = pages;
    var start = (t.page - 1) * t.pageSize;
    var view = rows.slice(start, start + t.pageSize);

    // Header state
    $$(".orders-table th[data-sort]").forEach(function (th) {
      var key = th.getAttribute("data-sort");
      if (key === t.sortKey) th.setAttribute("aria-sort", t.sortDir === "asc" ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    });

    var focused = tbody.contains(document.activeElement) ? document.activeElement : null;
    $$(".skeleton-row", tbody).forEach(function (r) { r.remove(); });

    var seen = {}, ordered = [], fresh = [];
    view.forEach(function (r) {
      var entry = rowMap[r.id];
      if (!entry) { entry = rowMap[r.id] = buildRow(r); fresh.push(entry.tr); }
      seen[r.id] = 1;
      if (entry.status !== r.status) {
        entry.tr.querySelector(".cell-status").innerHTML = statusPill(r.status);
        if (entry.status && cause === "tick" && !reduced()) {
          entry.tr.classList.remove("is-changed"); void entry.tr.offsetWidth; entry.tr.classList.add("is-changed");
        }
        entry.status = r.status;
      }
      var open = !!t.expanded[r.id];
      entry.detail.hidden = !open;
      entry.tr.classList.toggle("is-open", open);
      entry.tr.querySelector(".row-toggle").setAttribute("aria-expanded", String(open));
      if (open) fillDetail(entry, r);
      ordered.push(entry.tr, entry.detail);
    });
    Object.keys(rowMap).forEach(function (id) {
      if (!seen[id]) { rowMap[id].tr.remove(); rowMap[id].detail.remove(); if (!state.records.some(function (r) { return r.id === id; })) delete rowMap[id]; }
    });

    var current = $$("tr", tbody);
    var same = ordered.length === current.length && ordered.every(function (r, i) { return r === current[i]; });
    if (!same) {
      var place = function () { ordered.forEach(function (r) { tbody.appendChild(r); }); };
      if (cause === "sort") {
        var moving = ordered.filter(function (r) { return r.parentNode && r.classList.contains("order-row"); });
        flip(moving, place, 300);
      } else place();
    }
    if (focused && document.activeElement !== focused && document.contains(focused)) focused.focus();

    if (!reduced()) {
      if (!tableStarted) {
        // Initial entrance: 50 ms stagger, capped so a long page does not crawl in.
        view.slice(0, 12).forEach(function (r, i) {
          var tr = rowMap[r.id].tr;
          if (tr.animate) tr.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
            { duration: 300, delay: i * 50, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "backwards" });
        });
      } else if (cause === "page" || cause === "filter" || cause === "size") {
        if (tbody.animate) tbody.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }],
          { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
      } else if (cause === "tick") {
        fresh.forEach(function (tr) { tr.classList.add("is-new"); window.setTimeout(function () { tr.classList.remove("is-new"); }, 1600); });
      }
    }
    tableStarted = true;

    // Empty state and footer
    var emptyBox = $("[data-table-empty]");
    emptyBox.hidden = rows.length > 0;
    if (!rows.length) {
      $("[data-empty-text]").textContent = t.filter === "all" ? "No orders yet. New orders appear at the next update."
        : "No " + D.STATUS_META[t.filter].label.toLowerCase() + " orders in the last 70 minutes.";
      $("[data-filter-reset]").hidden = t.filter === "all";
    }
    $("[data-page-info]").textContent = rows.length
      ? (start + 1) + "–" + (start + view.length) + " of " + fmt.int(rows.length)
      : "0 orders";
    $("[data-page='-1']").disabled = t.page <= 1;
    $("[data-page='1']").disabled = t.page >= pages;
    $("[data-table-summary]").textContent = fmt.int(state.records.length) + " orders in the last 70 minutes · simulated";
  }

  $(".orders-table thead").addEventListener("click", function (e) {
    var th = e.target.closest("th[data-sort]");
    if (!th) return;
    var key = th.getAttribute("data-sort"), t = state.table;
    if (t.sortKey === key) t.sortDir = t.sortDir === "asc" ? "desc" : "asc";
    else { t.sortKey = key; t.sortDir = key === "t" || key === "amount" ? "desc" : "asc"; }
    t.page = 1;
    renderTable("sort");
    announce("Sorted by " + th.textContent.trim() + ", " + (t.sortDir === "asc" ? "ascending" : "descending"));
  });
  tbody.addEventListener("click", function (e) {
    var btn = e.target.closest(".row-toggle");
    if (!btn) return;
    var id = btn.closest("tr").dataset.id, open = !state.table.expanded[id];
    if (open) state.table.expanded[id] = true; else delete state.table.expanded[id];
    renderTable("expand");
    var detail = rowMap[id] && rowMap[id].detail;
    if (open && detail && !reduced() && detail.animate) {
      detail.querySelector(".detail-grid").animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }],
        { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    }
  });
  $$("[data-page]").forEach(function (b) {
    b.addEventListener("click", function () { state.table.page += parseInt(b.getAttribute("data-page"), 10); renderTable("page"); });
  });
  var sizeSelect = $("[data-page-size]");
  sizeSelect.value = String(state.table.pageSize);
  sizeSelect.addEventListener("change", function () {
    state.table.pageSize = parseInt(sizeSelect.value, 10);
    state.table.page = 1;
    prefs.set("ops-page-size", state.table.pageSize);
    renderTable("size");
  });
  function setFilter(f) {
    state.table.filter = f;
    state.table.page = 1;
    $$("[data-status-filter] button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-filter") === f)); });
    renderTable("filter");
  }
  $("[data-status-filter]").addEventListener("click", function (e) {
    var b = e.target.closest("[data-filter]");
    if (b) setFilter(b.getAttribute("data-filter"));
  });
  $("[data-filter-reset]").addEventListener("click", function () { setFilter("all"); });

  /* =================================================================
   * Notifications
   * ================================================================= */
  var notifBtn = $("[data-notif-toggle]"), notifPanel = $("#notif-panel"), notifList = $("[data-notif-list]");
  var notifCount = $("[data-notif-count]"), nid = 0, notifTimer = 0;

  function pushNotification(n, unread) {
    state.notifications.unshift({ id: ++nid, type: n.type, title: n.title, body: n.body, t: n.t, unread: unread !== false });
    if (state.notifications.length > 30) state.notifications.length = 30;
  }
  function unreadCount() { return state.notifications.filter(function (n) { return n.unread; }).length; }

  function renderBadge(pop) {
    var n = unreadCount();
    notifCount.hidden = n === 0;
    notifCount.textContent = n > 99 ? "99+" : String(n);
    notifBtn.setAttribute("aria-label", n ? "Notifications, " + n + " unread" : "Notifications");
    if (pop && n && !reduced() && notifCount.animate) {
      notifCount.animate([{ transform: "scale(.6)", opacity: 0.4 }, { transform: "scale(1)", opacity: 1 }],
        { duration: 220, easing: "cubic-bezier(0.34, 1.3, 0.64, 1)" });
    }
  }

  function renderNotifications() {
    var now = Date.now();
    if (!state.notifications.length) {
      notifList.innerHTML = '<li class="notif-empty"><p>No notifications</p><span>' +
        (state.paused ? "Updates are paused, so no new events will arrive." : "Demo events appear every 10–30 seconds while updates run.") + "</span></li>";
      return;
    }
    notifList.innerHTML = state.notifications.map(function (n) {
      return '<li class="notif-item' + (n.unread ? " is-unread" : "") + '" data-nid="' + n.id + '">' +
        '<span class="notif-icon is-' + n.type + '">' + icon(n.type) + "</span>" +
        '<div class="notif-text"><strong>' + esc(n.title) + "</strong><p>" + esc(n.body) + "</p>" +
        '<time datetime="' + new Date(n.t).toISOString() + '">' + fmt.ago(n.t, now) + " · " + fmt.time(n.t) + "</time></div>" +
        '<button class="notif-dismiss" type="button" aria-label="Dismiss: ' + esc(n.title) + '">' + icon("x") + "</button></li>";
    }).join("");
  }

  function openNotifications() {
    notifPanel.hidden = false;
    notifBtn.setAttribute("aria-expanded", "true");
    renderNotifications();
    if (!reduced() && notifPanel.animate) {
      notifPanel.animate([{ opacity: 0, transform: "translateY(-6px) scale(.98)" }, { opacity: 1, transform: "none" }],
        { duration: 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    }
    var first = $(".notif-dismiss, [data-notif-clear]", notifPanel);
    if (first) first.focus();
    // Seen once the panel has been open for a moment.
    window.setTimeout(function () {
      if (notifPanel.hidden) return;
      state.notifications.forEach(function (n) { n.unread = false; });
      renderBadge(false);
    }, 1200);
  }
  function closeNotifications(restore) {
    if (notifPanel.hidden) return;
    notifPanel.hidden = true;
    notifBtn.setAttribute("aria-expanded", "false");
    renderNotifications();
    if (restore) notifBtn.focus();
  }
  notifBtn.addEventListener("click", function () { notifPanel.hidden ? openNotifications() : closeNotifications(false); });
  notifPanel.addEventListener("click", function (e) {
    var d = e.target.closest(".notif-dismiss");
    if (d) {
      var item = d.closest(".notif-item"), id = +item.dataset.nid;
      var next = item.nextElementSibling || item.previousElementSibling;
      var remove = function () {
        state.notifications = state.notifications.filter(function (n) { return n.id !== id; });
        renderNotifications(); renderBadge(false);
        var target = next && $(".notif-dismiss", notifList.querySelector("[data-nid='" + next.dataset.nid + "']") || notifList);
        (target || $("[data-notif-clear]")).focus();
      };
      if (!reduced() && item.animate) {
        item.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(12px)" }],
          { duration: 160, easing: "ease-out" }).onfinish = remove;
      } else remove();
      return;
    }
    if (e.target.closest("[data-notif-clear]")) {
      state.notifications = [];
      renderNotifications(); renderBadge(false);
      $("[data-notif-clear]").focus();
    }
  });
  document.addEventListener("pointerdown", function (e) {
    if (!notifPanel.hidden && !notifPanel.contains(e.target) && !notifBtn.contains(e.target)) closeNotifications(false);
  });

  function scheduleNotification() {
    window.clearTimeout(notifTimer);
    if (state.paused) return;
    notifTimer = window.setTimeout(function () {
      if (!state.paused && !document.hidden) {
        var now = Date.now();
        var next = state.notifQueue.length ? state.notifQueue.splice(0, 2) : [sim.digest(now)];
        next.reverse().forEach(function (n) { pushNotification(n); });
        if (state.notifQueue.length > 10) state.notifQueue.length = 10;
        renderBadge(true);
        if (!notifPanel.hidden) renderNotifications();
      }
      scheduleNotification();
    }, 10000 + Math.random() * 20000);
  }

  sim.historyEvents(Date.now(), 6).reverse().forEach(function (n, i, arr) { pushNotification(n, i >= arr.length - 3); });

  /* =================================================================
   * Data status line
   * ================================================================= */
  var statusEl = $("#data-status");
  function renderStatus() {
    var now = Date.now();
    var mode, tone;
    if (state.source === "loading") { mode = "Connecting to the catalog API…"; tone = "loading"; }
    else if (state.source === "api") { mode = "Mixed data: API catalog, simulated orders"; tone = "live"; }
    else { mode = "Simulated data: local catalog, simulated orders"; tone = "live"; }
    var stale = !state.paused && state.lastUpdate && now - state.lastUpdate > state.interval * 3;
    if (!state.online) { mode = "Offline · simulated orders continue"; tone = "warn"; }
    if (state.paused) tone = "paused";
    else if (stale) tone = "warn";
    statusEl.className = "data-status is-" + tone;
    $("[data-status-mode]", statusEl).textContent = mode;
    var time = state.lastUpdate ? fmt.time(state.lastUpdate, true) : "";
    $("[data-status-time]", statusEl).textContent = state.paused ? "Paused · last update " + time
      : stale ? "Stale · last update " + fmt.ago(state.lastUpdate, now) : "Updated " + time;
  }
  window.addEventListener("online", function () { state.online = true; renderStatus(); if (state.source === "local") loadCatalog(); });
  window.addEventListener("offline", function () { state.online = false; renderStatus(); });

  /* =================================================================
   * Catalog from DummyJSON (single request, timeout, fallback, retry)
   * ================================================================= */
  var loadingCatalog = false;
  function renderSource(info, failed) {
    var pill = $("[data-source-pill]"), list = $("[data-source-list]"), err = $("[data-source-error]");
    if (state.source === "loading") {
      pill.textContent = "Loading"; pill.className = "pill";
      list.innerHTML = '<li class="skeleton-line"><span class="skeleton"></span></li><li class="skeleton-line"><span class="skeleton"></span></li><li class="skeleton-line"><span class="skeleton"></span></li>';
      err.hidden = true;
      return;
    }
    pill.textContent = state.source === "api" ? "DummyJSON API · " + info.products + " products" : "Local fallback · " + info.products + " products";
    pill.className = "pill " + (state.source === "api" ? "is-positive" : "is-medium");
    err.hidden = !failed;
    list.innerHTML = info.sample.length ? info.sample.map(function (p) {
      return '<li><span>' + esc(p.title) + "</span><small>" + esc(D.categoryLabel(p.category)) + '</small><span class="num">' + fmt.money(p.price) + "</span></li>";
    }).join("") : '<li class="empty-line">The catalog is empty.</li>';
    if (!reduced() && list.animate) list.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
  }

  function loadCatalog() {
    if (loadingCatalog) return;
    loadingCatalog = true;
    var prevSource = state.source;
    state.source = "loading";
    renderSource(); renderStatus();
    var ctrl = "AbortController" in window ? new AbortController() : null;
    var timeout = window.setTimeout(function () { if (ctrl) ctrl.abort(); }, 7000);
    fetch("https://dummyjson.com/products?limit=0&select=title,category,price", ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
      .then(function (json) {
        var products = (json.products || []).filter(function (p) { return p.category !== "vehicle" && p.category !== "motorcycle"; });
        if (!sim.setCatalog(products)) throw new Error("Unexpected catalog shape");
        state.source = "api";
        renderSource(sim.catalogInfo(), false);
        if (prevSource !== "api") {
          state.notifQueue.unshift({ type: "system", t: Date.now(), title: "Catalog connected",
            body: sim.catalogInfo().products + " products from DummyJSON now feed new simulated orders" });
        }
      })
      .catch(function () {
        state.source = "local";
        renderSource(sim.catalogInfo(), true);
      })
      .then(function () { window.clearTimeout(timeout); loadingCatalog = false; renderStatus(); });
  }
  $("[data-source-retry]").addEventListener("click", loadCatalog);

  /* =================================================================
   * Update loop (polling + simulation)
   * ================================================================= */
  var timer = 0;
  function render(cause) {
    var now = Date.now();
    state.snapshot = sim.snapshot(now);
    state.records = sim.records(now);
    state.lastUpdate = now;
    renderKpis(state.snapshot);
    renderCharts(state.snapshot);
    renderFinding(state.snapshot);
    renderTable(cause);
    renderStatus();
  }
  function step() {
    var r = sim.tick(Date.now());
    if (r.events.length) state.notifQueue = r.events.concat(state.notifQueue);
    render("tick");
  }
  function start() {
    if (timer || state.paused || document.hidden) return;
    timer = window.setInterval(step, state.interval);
  }
  function stop() { window.clearInterval(timer); timer = 0; }

  var pauseBtn = $("[data-pause]");
  function setPaused(p) {
    state.paused = p;
    pauseBtn.setAttribute("aria-pressed", String(p));
    $("[data-pause-label]").textContent = p ? "Resume" : "Pause";
    pauseBtn.classList.toggle("is-paused", p);
    if (p) { stop(); window.clearTimeout(notifTimer); }
    else { step(); start(); scheduleNotification(); }
    renderStatus();
    announce(p ? "Live updates paused" : "Live updates resumed");
  }
  pauseBtn.addEventListener("click", function () { setPaused(!state.paused); });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
    else if (!state.paused) { step(); start(); }
  });

  // Status line ticks its relative times between updates.
  window.setInterval(function () { if (!document.hidden) { renderStatus(); if (!notifPanel.hidden) renderNotifications(); } }, 1000);

  // Interval setting
  $$("[data-interval] button").forEach(function (b) {
    b.setAttribute("aria-pressed", String(+b.getAttribute("data-ms") === state.interval));
    b.addEventListener("click", function () {
      state.interval = +b.getAttribute("data-ms");
      prefs.set("ops-interval", state.interval);
      sim.setTickMs(state.interval);
      $$("[data-interval] button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      stop(); start();
      announce("Updates every " + state.interval / 1000 + " seconds");
    });
  });

  // Theme setting mirrors the header toggle.
  function syncThemeButtons() {
    var mode = window.Theme ? window.Theme.mode() : "system";
    $$("[data-theme-mode] button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-mode") === mode)); });
  }
  $("[data-theme-mode]").addEventListener("click", function (e) {
    var b = e.target.closest("[data-mode]");
    if (b && window.Theme) { window.Theme.setMode(b.getAttribute("data-mode")); syncThemeButtons(); }
  });
  document.addEventListener("themechange", syncThemeButtons);
  syncThemeButtons();

  /* =================================================================
   * Sidebar: compact on desktop, drawer on smaller screens
   * ================================================================= */
  var sidebar = $("#sidebar"), openBtn = $("[data-sidebar-open]");
  var nav = $(".sb-nav"), indicator = $(".sb-indicator");
  var navLinks = $$("a", nav);

  function setCollapsed(c) {
    if (c) root.setAttribute("data-sidebar", "collapsed"); else root.removeAttribute("data-sidebar");
    try { localStorage.setItem("ops-sidebar", c ? "collapsed" : "expanded"); } catch (e) { /* blocked */ }
    $$(".sb-collapse").forEach(function (b) {
      b.setAttribute("aria-expanded", String(!c));
      b.setAttribute("aria-label", c ? "Expand sidebar" : "Collapse sidebar");
    });
    window.setTimeout(moveIndicator, 320);
  }
  $$("[data-sidebar-collapse]").forEach(function (b) {
    b.addEventListener("click", function () { setCollapsed(root.getAttribute("data-sidebar") !== "collapsed"); });
  });
  setCollapsed(root.getAttribute("data-sidebar") === "collapsed");

  function drawerOpen() { return root.classList.contains("drawer-open"); }
  function syncInert() {
    var hide = !desktop.matches && !drawerOpen();
    if (hide) sidebar.setAttribute("inert", ""); else sidebar.removeAttribute("inert");
    sidebar.setAttribute("aria-hidden", String(hide));
  }
  function openDrawer() {
    root.classList.add("drawer-open");
    openBtn.setAttribute("aria-expanded", "true");
    syncInert();
    var active = $("a[aria-current='true']", nav) || navLinks[0];
    window.setTimeout(function () { active.focus(); }, 50);
  }
  function closeDrawer(restore) {
    if (!drawerOpen()) return;
    root.classList.remove("drawer-open");
    openBtn.setAttribute("aria-expanded", "false");
    syncInert();
    if (restore) openBtn.focus();
  }
  openBtn.addEventListener("click", openDrawer);
  $$("[data-sidebar-close]").forEach(function (b) { b.addEventListener("click", function () { closeDrawer(true); }); });
  sidebar.addEventListener("click", function (e) { if (e.target.closest(".sb-nav a") && !desktop.matches) closeDrawer(false); });
  sidebar.addEventListener("keydown", function (e) {
    if (!drawerOpen() || e.key !== "Tab") return;
    var f = $$("a, button", sidebar).filter(function (el) { return el.offsetParent !== null; });
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  var onBreakpoint = function () { if (desktop.matches) closeDrawer(false); syncInert(); moveIndicator(); };
  if (desktop.addEventListener) desktop.addEventListener("change", onBreakpoint); else desktop.addListener(onBreakpoint);
  syncInert();

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!notifPanel.hidden) closeNotifications(true);
    else if (!menu.hidden) closeMenu(true);
    else if (drawerOpen()) closeDrawer(true);
  });

  // Active section indicator follows the scroll position.
  function moveIndicator() {
    var active = $("a[aria-current='true']", nav);
    if (!active) return;
    indicator.style.transform = "translateY(" + active.offsetTop + "px)";
    indicator.style.height = active.offsetHeight + "px";
  }
  function setActive(id) {
    navLinks.forEach(function (a) {
      if (a.getAttribute("href") === "#" + id) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
    moveIndicator();
  }
  if ("IntersectionObserver" in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) setActive(en.target.id); });
    }, { rootMargin: "-30% 0px -60% 0px" });
    navLinks.forEach(function (a) { var s = document.getElementById(a.getAttribute("href").slice(1)); if (s) spy.observe(s); });
  }
  moveIndicator();
  requestAnimationFrame(function () { indicator.classList.add("is-ready"); });

  /* ---------------- Boot ---------------- */
  render("init");
  renderBadge(false);
  renderNotifications();
  start();
  scheduleNotification();
  loadCatalog();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveIndicator);
})();
