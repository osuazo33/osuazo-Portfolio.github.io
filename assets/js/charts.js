/*
 * Small SVG chart kit for the portfolio. No dependencies.
 *
 * Motion rules:
 *  - First render plays an entrance once (line draw 1.5 s, area reveal 1 s,
 *    column growth 0.6 s staggered 0.1 s, ring sweep 1.2 s).
 *  - Data updates tween from the current geometry for 0.8 s; entrances never replay.
 *  - prefers-reduced-motion: no entrances, no tweens, values change in place.
 */
(function (global) {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var uid = 0;
  var motionQuery = global.matchMedia ? global.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reduced() { return !!(motionQuery && motionQuery.matches); }

  var ease = {
    // power2.inOut
    inOutQuad: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    outQuart: function (t) { return 1 - Math.pow(1 - t, 4); }
  };
  var CSS_EASE = {
    inOutQuad: "cubic-bezier(0.455, 0.03, 0.515, 0.955)",
    out: "cubic-bezier(0.23, 1, 0.32, 1)"
  };

  function svgEl(tag, attrs, parent) {
    var node = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function tween(duration, easing, onFrame, onDone) {
    var raf = 0, start = 0, done = false;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / duration);
      onFrame(easing(p));
      if (p < 1) raf = requestAnimationFrame(step);
      else { done = true; if (onDone) onDone(); }
    }
    raf = requestAnimationFrame(step);
    return function cancel() { if (!done) cancelAnimationFrame(raf); };
  }

  function lerp(a, b, p) { return a + (b - a) * p; }

  // Round, even ticks with the top tick above the maximum.
  function niceScale(maxValue, targetTicks, integer) {
    targetTicks = targetTicks || 4;
    if (!(maxValue > 0)) return { max: targetTicks, step: 1 };
    var raw = maxValue / targetTicks;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    if (integer) step = Math.max(1, Math.round(step));
    var max = step * Math.ceil((maxValue * 1.04) / step);
    if (max <= maxValue) max += step;
    return { max: max, step: step };
  }

  function observeSize(el, cb) {
    var last = "";
    if (!("ResizeObserver" in global)) { global.addEventListener("resize", cb); return; }
    new ResizeObserver(function (entries) {
      var r = entries[0].contentRect;
      var sig = Math.round(r.width) + "x" + Math.round(r.height);
      if (sig !== last) { var first = !last; last = sig; if (!first) cb(); }
    }).observe(el);
  }

  function makeTooltip(container) {
    var tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.setAttribute("aria-hidden", "true");
    container.appendChild(tip);
    return {
      show: function (x, y, html) {
        tip.innerHTML = html;
        tip.classList.add("is-visible");
        var w = tip.offsetWidth, cw = container.clientWidth;
        var left = Math.min(Math.max(0, x - w / 2), cw - w);
        tip.style.transform = "translate(" + Math.round(left) + "px," + Math.round(Math.max(0, y - tip.offsetHeight - 12)) + "px)";
      },
      hide: function () { tip.classList.remove("is-visible"); }
    };
  }

  /* ------------------------------------------------------------------------
   * Line chart (optionally an area chart). data: [{ key, t, v }]
   * ---------------------------------------------------------------------- */
  function lineChart(container, opts) {
    opts = opts || {};
    var pad = Object.assign({ t: 10, r: 14, b: 26, l: 52 }, opts.pad || {});
    var fmtY = opts.formatY || String;
    var fmtX = opts.formatX || String;
    var fmtTip = opts.formatTip || function (d) { return fmtY(d.v); };
    var id = "c" + (++uid);
    container.classList.add("chart");

    var svg = svgEl("svg", { class: "chart-svg", role: "img", "aria-label": opts.label || "Line chart" });
    var defs = svgEl("defs", null, svg);
    var clip = svgEl("clipPath", { id: id + "-clip" }, defs);
    var clipRect = svgEl("rect", { x: 0, y: 0 }, clip);
    var reveal = svgEl("clipPath", { id: id + "-reveal" }, defs);
    var revealRect = svgEl("rect", { x: 0, y: 0, height: 0, width: 0 }, reveal);
    var gGrid = svgEl("g", { class: "chart-grid" }, svg);
    var gY = svgEl("g", { class: "chart-ylabels" }, svg);
    var gX = svgEl("g", { class: "chart-xlabels" }, svg);
    var plot = svgEl("g", { "clip-path": "url(#" + id + "-clip)" }, svg);
    var areaPath = opts.area ? svgEl("path", { class: "chart-area" }, plot) : null;
    var linePath = svgEl("path", { class: "chart-line" }, plot);
    var guide = svgEl("line", { class: "chart-guide" }, svg);
    var hoverDot = svgEl("circle", { class: "chart-hover-dot", r: 4 }, svg);
    var ring = svgEl("circle", { class: "chart-ring", r: 4 }, svg);
    var dot = svgEl("circle", { class: "chart-dot", r: 4 }, svg);
    container.appendChild(svg);
    var tip = makeTooltip(container);

    var W = 0, H = 0, data = [], current = [], cancel = null, started = false;
    var exiting = [];

    function measure() {
      W = Math.max(120, container.clientWidth);
      H = Math.max(80, container.clientHeight);
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      clipRect.setAttribute("x", pad.l); clipRect.setAttribute("y", 0);
      clipRect.setAttribute("width", W - pad.l - pad.r + 1); clipRect.setAttribute("height", H);
      revealRect.setAttribute("height", H);
    }

    function geometry(list) {
      var max = 0;
      list.forEach(function (d) { if (d.v > max) max = d.v; });
      var sc = niceScale(max, opts.ticks || 4, opts.integer);
      var n = Math.max(2, opts.points || list.length);
      var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
      var offset = n - list.length;
      var pts = list.map(function (d, i) {
        return { key: d.key, d: d, x: pad.l + ((i + offset) / (n - 1)) * iw, y: pad.t + ih - (d.v / sc.max) * ih };
      });
      return { sc: sc, pts: pts, step: iw / (n - 1) };
    }

    function pathFor(pts) {
      var s = "";
      for (var i = 0; i < pts.length; i++) s += (i ? "L" : "M") + pts[i].x.toFixed(1) + " " + pts[i].y.toFixed(1);
      return s;
    }

    function paint(pts) {
      var all = exiting.concat(pts);
      var d = pathFor(all);
      linePath.setAttribute("d", d);
      if (areaPath && all.length) {
        var base = H - pad.b;
        areaPath.setAttribute("d", d + "L" + all[all.length - 1].x.toFixed(1) + " " + base + "L" + all[0].x.toFixed(1) + " " + base + "Z");
      }
      var last = pts[pts.length - 1];
      if (last) {
        dot.setAttribute("cx", last.x); dot.setAttribute("cy", last.y);
        ring.setAttribute("cx", last.x); ring.setAttribute("cy", last.y);
      }
    }

    function axes(g) {
      gGrid.textContent = ""; gY.textContent = ""; gX.textContent = "";
      var ih = H - pad.t - pad.b;
      for (var v = 0; v <= g.sc.max + 1e-9; v += g.sc.step) {
        var y = pad.t + ih - (v / g.sc.max) * ih;
        svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: v === 0 ? "is-base" : "" }, gGrid);
        var t = svgEl("text", { x: pad.l - 10, y: y + 4, "text-anchor": "end" }, gY);
        t.textContent = fmtY(v);
      }
      var n = g.pts.length, labels = opts.xLabels || 5;
      if (n < 2) return;
      for (var i = 0; i < labels; i++) {
        var idx = Math.round((i / (labels - 1)) * (n - 1));
        var p = g.pts[idx];
        var tx = svgEl("text", { x: p.x, y: H - 6, "text-anchor": i === 0 ? "start" : i === labels - 1 ? "end" : "middle" }, gX);
        tx.textContent = fmtX(p.d);
      }
    }

    function render(list) {
      data = list.slice();
      measure();
      var g = geometry(data);
      axes(g);
      exiting = [];
      current = g.pts;
      paint(current);
    }

    function entrance() {
      if (reduced()) return;
      // Line: stroke-dasharray / dashoffset draw, 1.5 s, power2.inOut.
      var len = linePath.getTotalLength ? linePath.getTotalLength() : 0;
      if (len && linePath.animate) {
        linePath.style.strokeDasharray = len + " " + len;
        var a = linePath.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
          { duration: 1500, easing: CSS_EASE.inOutQuad, fill: "backwards" });
        a.onfinish = a.oncancel = function () { linePath.style.strokeDasharray = ""; };
      }
      if (areaPath) {
        // Area: left-to-right clip reveal plus opacity, 1 s. Values never scale.
        areaPath.setAttribute("clip-path", "url(#" + id + "-reveal)");
        areaPath.style.opacity = 0;
        tween(1000, ease.outQuart, function (p) {
          revealRect.setAttribute("width", W * p);
          areaPath.style.opacity = p;
        }, function () { areaPath.removeAttribute("clip-path"); areaPath.style.opacity = ""; });
      }
      [dot, ring].forEach(function (c) {
        if (c.animate) c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 1300, fill: "backwards" });
      });
    }

    function update(list) {
      if (!started) { render(list); started = true; entrance(); return; }
      var from = {};
      current.forEach(function (p) { from[p.key] = { x: p.x, y: p.y }; });
      exiting.forEach(function (p) { from[p.key] = { x: p.x, y: p.y }; });
      var prevKeys = data.map(function (d) { return d.key; });
      data = list.slice();
      measure();
      var g = geometry(data);
      axes(g);
      var keep = {};
      data.forEach(function (d) { keep[d.key] = 1; });
      // Points leaving on the left slide one step out of the clip, then drop.
      var leaving = prevKeys.filter(function (k) { return !keep[k] && from[k]; }).map(function (k) {
        return { key: k, x0: from[k].x, y0: from[k].y, x1: from[k].x - g.step, y1: from[k].y };
      });
      var lastFrom = current[current.length - 1];
      var moves = g.pts.map(function (p) {
        var f = from[p.key] || { x: p.x + g.step, y: lastFrom ? lastFrom.y : p.y };
        return { key: p.key, d: p.d, x0: f.x, y0: f.y, x1: p.x, y1: p.y };
      });
      if (cancel) cancel();
      var isNew = moves.length && !from[moves[moves.length - 1].key];
      if (reduced()) { exiting = []; current = g.pts; paint(current); return; }
      cancel = tween(800, ease.inOutCubic, function (p) {
        exiting = leaving.map(function (m) { return { key: m.key, x: lerp(m.x0, m.x1, p), y: lerp(m.y0, m.y1, p) }; });
        current = moves.map(function (m) { return { key: m.key, d: m.d, x: lerp(m.x0, m.x1, p), y: lerp(m.y0, m.y1, p) }; });
        paint(current);
      }, function () {
        exiting = [];
        current = g.pts;
        paint(current);
        if (isNew && ring.animate) {
          ring.animate([{ transform: "scale(1)", opacity: 0.5 }, { transform: "scale(3.2)", opacity: 0 }],
            { duration: 900, easing: CSS_EASE.out });
        }
      });
    }

    // Hover / touch inspection.
    function nearest(clientX) {
      var r = svg.getBoundingClientRect();
      var x = ((clientX - r.left) / r.width) * W;
      var best = null, bd = Infinity;
      current.forEach(function (p) { var dd = Math.abs(p.x - x); if (dd < bd) { bd = dd; best = p; } });
      return best;
    }
    svg.addEventListener("pointermove", function (e) {
      var p = nearest(e.clientX);
      if (!p || !p.d) return;
      guide.setAttribute("x1", p.x); guide.setAttribute("x2", p.x);
      guide.setAttribute("y1", pad.t); guide.setAttribute("y2", H - pad.b);
      hoverDot.setAttribute("cx", p.x); hoverDot.setAttribute("cy", p.y);
      svg.classList.add("is-hovering");
      var r = svg.getBoundingClientRect();
      tip.show((p.x / W) * r.width, (p.y / H) * r.height, fmtTip(p.d));
    });
    svg.addEventListener("pointerleave", function () { svg.classList.remove("is-hovering"); tip.hide(); });

    observeSize(container, function () { if (data.length) { if (cancel) cancel(); render(data); } });

    return { update: update };
  }

  /* ------------------------------------------------------------------------
   * Column chart. data: [{ key, label, v, partial }]
   * ---------------------------------------------------------------------- */
  function columnChart(container, opts) {
    opts = opts || {};
    var pad = Object.assign({ t: 10, r: 6, b: 26, l: 40 }, opts.pad || {});
    var fmtY = opts.formatY || String;
    var fmtTip = opts.formatTip || function (d) { return fmtY(d.v); };
    container.classList.add("chart");
    var svg = svgEl("svg", { class: "chart-svg", role: "img", "aria-label": opts.label || "Column chart" });
    var gGrid = svgEl("g", { class: "chart-grid" }, svg);
    var gY = svgEl("g", { class: "chart-ylabels" }, svg);
    var gX = svgEl("g", { class: "chart-xlabels" }, svg);
    var gBars = svgEl("g", { class: "chart-bars" }, svg);
    container.appendChild(svg);
    var tip = makeTooltip(container);
    var W = 0, H = 0, data = [], bars = [], heights = [], cancel = null, started = false, sc = null;

    function measure() {
      W = Math.max(120, container.clientWidth);
      H = Math.max(80, container.clientHeight);
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    }

    function layout() {
      var max = 0;
      data.forEach(function (d) { if (d.v > max) max = d.v; });
      sc = niceScale(max, opts.ticks || 4, opts.integer);
      var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, n = data.length;
      var slot = iw / n, bw = Math.max(4, Math.min(36, slot * 0.62));
      gGrid.textContent = ""; gY.textContent = ""; gX.textContent = "";
      for (var v = 0; v <= sc.max + 1e-9; v += sc.step) {
        var y = pad.t + ih - (v / sc.max) * ih;
        svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: v === 0 ? "is-base" : "" }, gGrid);
        svgEl("text", { x: pad.l - 8, y: y + 4, "text-anchor": "end" }, gY).textContent = fmtY(v);
      }
      var every = opts.labelEvery || 3;
      data.forEach(function (d, i) {
        if (i % every !== 0 && i !== n - 1) return;
        if (i !== n - 1 && n - 1 - i < every) return;
        var x = pad.l + slot * i + slot / 2;
        svgEl("text", { x: x, y: H - 6, "text-anchor": "middle" }, gX).textContent = d.label;
      });
      return { ih: ih, slot: slot, bw: bw };
    }

    function place(i, h, L) {
      var b = bars[i];
      var x = pad.l + L.slot * i + (L.slot - L.bw) / 2;
      b.setAttribute("x", x.toFixed(1));
      b.setAttribute("width", L.bw.toFixed(1));
      b.setAttribute("y", (pad.t + L.ih - h).toFixed(1));
      b.setAttribute("height", Math.max(0, h).toFixed(1));
    }

    function sync() {
      while (bars.length < data.length) {
        var r = svgEl("rect", { class: "chart-bar", rx: 2 }, gBars);
        (function (idx) {
          r.addEventListener("pointerenter", function () {
            var bb = r.getBoundingClientRect(), cb = container.getBoundingClientRect();
            tip.show(bb.left - cb.left + bb.width / 2, bb.top - cb.top, fmtTip(data[idx]));
          });
          r.addEventListener("pointerleave", tip.hide);
        })(bars.length);
        bars.push(r);
        heights.push(0);
      }
      while (bars.length > data.length) { gBars.removeChild(bars.pop()); heights.pop(); }
      data.forEach(function (d, i) {
        bars[i].classList.toggle("is-current", !!d.partial);
        bars[i].setAttribute("aria-label", d.label + ": " + fmtY(d.v));
      });
    }

    function update(list) {
      data = list.slice();
      measure();
      sync();
      var L = layout();
      var targets = data.map(function (d) { return (d.v / sc.max) * L.ih; });
      if (!started || reduced()) {
        targets.forEach(function (h, i) { place(i, h, L); heights[i] = h; });
        if (!started && !reduced()) {
          // Growth from the baseline: 0.6 s per bar, 0.1 s stagger, a small overshoot.
          bars.forEach(function (b, i) {
            if (!b.animate) return;
            b.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }],
              { duration: 600, delay: i * 100, easing: "cubic-bezier(0.34, 1.3, 0.64, 1)", fill: "backwards" });
          });
        }
        started = true;
        return;
      }
      var from = heights.slice();
      if (cancel) cancel();
      cancel = tween(800, ease.inOutCubic, function (p) {
        targets.forEach(function (h, i) { var v = lerp(from[i] || 0, h, p); place(i, v, L); heights[i] = v; });
      });
    }

    observeSize(container, function () { if (data.length) { if (cancel) cancel(); var L; measure(); L = layout(); data.forEach(function (d, i) { var h = (d.v / sc.max) * L.ih; place(i, h, L); heights[i] = h; }); } });
    return { update: update };
  }

  /* ------------------------------------------------------------------------
   * Thin ring for parts of a whole. data: [{ key, label, v }], colours via CSS
   * class "seg-<key>". The total sits in the centre; legend lives outside.
   * ---------------------------------------------------------------------- */
  function ringChart(container, opts) {
    opts = opts || {};
    var size = opts.size || 168, stroke = opts.stroke || 14, gap = 2;
    var r = (size - stroke) / 2, C = 2 * Math.PI * r;
    container.classList.add("ring");
    var svg = svgEl("svg", { viewBox: "0 0 " + size + " " + size, class: "ring-svg", role: "img", "aria-label": opts.label || "Ring chart" });
    var rot = svgEl("g", { class: "ring-rot" }, svg);
    svgEl("circle", { cx: size / 2, cy: size / 2, r: r, class: "ring-track", "stroke-width": stroke }, rot);
    var segs = {};
    container.appendChild(svg);
    var fracs = {}, cancel = null, started = false;

    function draw(state, progress) {
      var acc = 0;
      Object.keys(state).forEach(function (k) {
        var len = state[k] * C * progress;
        var seg = segs[k];
        var vis = Math.max(0, len - (len > gap * 2 ? gap : 0));
        seg.setAttribute("stroke-dasharray", vis.toFixed(2) + " " + (C - vis).toFixed(2));
        seg.setAttribute("stroke-dashoffset", (-acc).toFixed(2));
        acc += len;
      });
    }

    function update(list) {
      var total = list.reduce(function (s, d) { return s + d.v; }, 0) || 1;
      var next = {};
      list.forEach(function (d) {
        if (!segs[d.key]) {
          segs[d.key] = svgEl("circle", { cx: size / 2, cy: size / 2, r: r, class: "ring-seg seg-" + d.key, "stroke-width": stroke, fill: "none" }, rot);
        }
        next[d.key] = d.v / total;
      });
      if (!started) {
        started = true;
        fracs = next;
        if (reduced()) { draw(fracs, 1); return; }
        // Sweep in 1.2 s with a slight rotation into place.
        tween(1200, ease.outCubic, function (p) {
          draw(fracs, p);
          rot.setAttribute("transform", "rotate(" + (-150 + 60 * p) + " " + size / 2 + " " + size / 2 + ")");
        });
        return;
      }
      rot.setAttribute("transform", "rotate(-90 " + size / 2 + " " + size / 2 + ")");
      var from = fracs;
      if (cancel) cancel();
      if (reduced()) { fracs = next; draw(fracs, 1); return; }
      cancel = tween(800, ease.inOutCubic, function (p) {
        var cur = {};
        Object.keys(next).forEach(function (k) { cur[k] = lerp(from[k] || 0, next[k], p); });
        fracs = cur;
        draw(cur, 1);
      });
    }
    return { update: update };
  }

  /* Count a number to its new value (0.6 s). Tabular figures keep width stable. */
  function countTo(el, to, format, duration) {
    var from = parseFloat(el.getAttribute("data-value"));
    el.setAttribute("data-value", to == null ? "" : to);
    if (to == null) { el.textContent = format(null); return; }
    if (isNaN(from) || reduced() || from === to) { el.textContent = format(to); return; }
    if (el._cancel) el._cancel();
    el._cancel = tween(duration || 600, ease.outCubic, function (p) { el.textContent = format(lerp(from, to, p)); });
  }

  global.Charts = { line: lineChart, columns: columnChart, ring: ringChart, countTo: countTo, niceScale: niceScale, reduced: reduced, tween: tween, ease: ease };
})(window);
