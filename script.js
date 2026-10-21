/* Site-wide behaviour: theme, header, scroll reveal, case-study contents, hero preview. */
(function () {
  "use strict";

  var root = document.documentElement;
  var KEY = "pf-theme";
  var systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  /* ---------- Theme: saved choice, otherwise the system preference ---------- */
  function savedMode() {
    try { var v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "system"; }
    catch (e) { return "system"; }
  }
  function resolved(mode) { return mode === "system" ? (systemDark.matches ? "dark" : "light") : mode; }
  function apply(theme, animate) {
    if (root.getAttribute("data-theme") === theme) return;
    if (animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.classList.add("theme-switching");
      window.setTimeout(function () { root.classList.remove("theme-switching"); }, 260);
    }
    root.setAttribute("data-theme", theme);
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      b.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    });
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: theme, mode: savedMode() } }));
  }
  function setMode(mode, animate) {
    try { if (mode === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, mode); } catch (e) { /* storage blocked */ }
    apply(resolved(mode), animate !== false);
  }
  apply(resolved(savedMode()), false);
  var onSystem = function () { if (savedMode() === "system") apply(resolved("system"), true); };
  if (systemDark.addEventListener) systemDark.addEventListener("change", onSystem);
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-theme-toggle]");
    if (btn) setMode(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });
  window.Theme = { setMode: setMode, mode: savedMode, current: function () { return root.getAttribute("data-theme"); } };

  /* ---------- Footer year ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* ---------- Header border once the page scrolls ---------- */
  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () { header.classList.toggle("is-scrolled", window.scrollY > 8); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------- Scroll reveal (content stays visible without JS) ---------- */
  var reveals = document.querySelectorAll(".reveal, .compare");
  if ("IntersectionObserver" in window && reveals.length) {
    reveals.forEach(function (el) { if (el.classList.contains("compare")) el.classList.add("is-armed"); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.remove("is-armed");
        en.target.classList.add("is-visible");
        io.unobserve(en.target);
      });
    }, { rootMargin: "0px 0px -10% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---------- Case-study contents: mark the section being read ---------- */
  var toc = document.querySelector(".case-toc");
  if (toc && "IntersectionObserver" in window) {
    var links = {};
    toc.querySelectorAll("a[href^='#']").forEach(function (a) { links[a.getAttribute("href").slice(1)] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting || !links[en.target.id]) return;
        Object.keys(links).forEach(function (k) { links[k].classList.toggle("is-active", k === en.target.id); });
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    Object.keys(links).forEach(function (k) { var s = document.getElementById(k); if (s) spy.observe(s); });
  }

  /* ---------- Hero: a small live view of the Operations Monitor ---------- */
  var frag = document.getElementById("hero-fragment");
  if (frag && window.OpsData && window.Charts) {
    var fmt = OpsData.fmt;
    var TICK = 4000;
    var sim = OpsData.createSimulation({ tickMs: TICK });
    sim.init(Date.now());
    var chart = Charts.line(frag.querySelector(".fragment-chart"), {
      area: true, points: 40, xLabels: 4, label: "Order value placed in the last 5 minutes, sampled every 4 seconds (simulated)",
      formatY: fmt.compactMoney,
      formatX: function (d) { return fmt.time(d.t, true); },
      formatTip: function (d) { return "<b>" + fmt.money(d.v) + "</b> · " + fmt.time(d.t, true); }
    });
    var els = {
      orders: frag.querySelector("[data-k='orders']"),
      revenue: frag.querySelector("[data-k='revenue']"),
      success: frag.querySelector("[data-k='success']"),
      updated: frag.querySelector("[data-k='updated']"),
      dot: frag.querySelector(".live-dot")
    };
    var paint = function () {
      var s = sim.snapshot(Date.now());
      chart.update(s.series.map(function (p) { return { key: p.key, t: p.t, v: p.value }; }));
      Charts.countTo(els.orders, s.current.orders, fmt.int);
      Charts.countTo(els.revenue, s.current.revenue, fmt.money0);
      Charts.countTo(els.success, s.current.successRate, function (v) { return fmt.pct(v); });
      els.updated.textContent = "Updated " + fmt.time(s.now, true);
    };
    paint();
    var timer = 0, inView = false;
    var start = function () {
      if (timer || !inView || document.hidden) return;
      timer = window.setInterval(function () { sim.tick(Date.now()); paint(); }, TICK);
      els.dot.classList.remove("is-paused");
    };
    var stop = function () { window.clearInterval(timer); timer = 0; els.dot.classList.add("is-paused"); };
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (en) { inView = en[0].isIntersecting; inView ? start() : stop(); }).observe(frag);
    } else { inView = true; start(); }
    document.addEventListener("visibilitychange", function () { document.hidden ? stop() : start(); });
  }
})();
