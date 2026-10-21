/*
 * Operations Monitor — data layer.
 *
 * Every order decides its own outcome when it is created (final status and the
 * moment it resolves), so any metric can be computed for any point in time from
 * the same rows. KPIs, charts, table and notifications therefore always agree.
 *
 * Orders are SIMULATED in the browser. The product catalog can be replaced by
 * the public DummyJSON API (https://dummyjson.com) when it is reachable.
 */
(function (global) {
  "use strict";

  var MIN = 60 * 1000;
  var WINDOW = 30 * MIN;          // KPI window, compared with the 30 minutes before it
  var BUCKET = 5 * MIN;           // column chart bucket
  var BUCKETS = 12;               // one hour of buckets
  var ROLLING = 5 * MIN;          // line chart: order value placed in the last 5 minutes
  var SERIES_POINTS = 40;         // fixed window for the time series
  var KEEP = 70 * MIN;            // history kept in memory
  var LARGE_ORDER = 1500;         // notification threshold, USD
  var QUEUE_ALERT = 6;            // open orders before a queue notification

  // Local fallback catalog. Same category slugs as DummyJSON so both sources mix cleanly.
  var LOCAL_CATALOG = [
    { title: "Hydrating face serum", category: "beauty", price: 19.99 },
    { title: "Matte lipstick set", category: "beauty", price: 12.99 },
    { title: "Eau de parfum 50 ml", category: "fragrances", price: 69.99 },
    { title: "Citrus cologne 100 ml", category: "fragrances", price: 54.0 },
    { title: "Oak bedside table", category: "furniture", price: 149.99 },
    { title: "Three-seat fabric sofa", category: "furniture", price: 899.99 },
    { title: "Office chair, mesh back", category: "furniture", price: 229.0 },
    { title: "Organic coffee beans 1 kg", category: "groceries", price: 18.5 },
    { title: "Extra virgin olive oil", category: "groceries", price: 11.99 },
    { title: "Green tea, 50 bags", category: "groceries", price: 6.49 },
    { title: "Linen cushion cover", category: "home-decoration", price: 24.99 },
    { title: "Ceramic table lamp", category: "home-decoration", price: 79.0 },
    { title: "Chef's knife 20 cm", category: "kitchen-accessories", price: 45.0 },
    { title: "Cast iron skillet", category: "kitchen-accessories", price: 39.99 },
    { title: "Electric kettle 1.7 L", category: "kitchen-accessories", price: 34.99 },
    { title: "14-inch ultrabook, 16 GB", category: "laptops", price: 1299.0 },
    { title: "16-inch creator laptop", category: "laptops", price: 1899.0 },
    { title: "Chromebook 11", category: "laptops", price: 329.0 },
    { title: "Smartphone 128 GB", category: "smartphones", price: 699.0 },
    { title: "Smartphone Pro 256 GB", category: "smartphones", price: 1099.0 },
    { title: "Budget smartphone 64 GB", category: "smartphones", price: 189.0 },
    { title: "10-inch tablet, Wi-Fi", category: "tablets", price: 449.0 },
    { title: "Wireless earbuds", category: "mobile-accessories", price: 129.0 },
    { title: "USB-C fast charger", category: "mobile-accessories", price: 24.99 },
    { title: "Yoga mat, 6 mm", category: "sports-accessories", price: 29.99 },
    { title: "Adjustable dumbbells", category: "sports-accessories", price: 189.0 },
    { title: "Automatic steel watch", category: "mens-watches", price: 349.0 },
    { title: "Leather tote bag", category: "womens-bags", price: 159.0 },
    { title: "Running shoes", category: "mens-shoes", price: 119.0 },
    { title: "Polarised sunglasses", category: "sunglasses", price: 89.0 }
  ];

  var CUSTOMERS = [
    "Lucía Márquez", "Daniel Ortega", "Aisha Bello", "Mateo Rivas", "Hannah Weber", "Kenji Sato",
    "Valentina Cruz", "Omar Haddad", "Priya Nair", "Tomás Herrera", "Chloé Martin", "Samuel Owusu",
    "Elena Popescu", "Rafael Lima", "Grace Kim", "Andrés Molina", "Fatima Zahra", "Lukas Novak",
    "Camila Torres", "Ibrahim Diallo", "Sofia Rossi", "Noah Fischer", "Mariana Silva", "Arjun Mehta",
    "Isabel Navarro", "Yusuf Kaya", "Julia Lindqvist", "Diego Castillo", "Mei Chen", "Pablo Ruiz"
  ];
  var CHANNELS = [["Web", 0.52], ["Mobile app", 0.33], ["Marketplace", 0.15]];
  var PAYMENTS = [["Card", 0.64], ["PayPal", 0.22], ["Bank transfer", 0.14]];

  var STATUS_META = {
    completed: { label: "Completed" },
    pending: { label: "Pending" },
    failed: { label: "Payment failed" },
    refunded: { label: "Refunded" }
  };

  function categoryLabel(slug) {
    var s = String(slug || "other").replace(/-/g, " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Small, fast seeded PRNG so the starting history is identical on every load.
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function round2(v) { return Math.round(v * 100) / 100; }

  function pickWeighted(rand, pairs) {
    var r = rand(), acc = 0;
    for (var i = 0; i < pairs.length; i++) { acc += pairs[i][1]; if (r <= acc) return pairs[i][0]; }
    return pairs[pairs.length - 1][0];
  }

  function statusAt(order, t) {
    if (t < order.t) return null;
    return t < order.resolvedAt ? "pending" : order.final;
  }

  function createSimulation(options) {
    options = options || {};
    var rand = mulberry32(options.seed || 20240611);
    var tickMs = options.tickMs || 4000;
    var catalog = LOCAL_CATALOG.slice();
    var catalogSource = "local";
    var orders = [];
    var samples = [];
    var seq = 48210;
    var rate = 5.5;               // orders per minute; drifts slowly
    var nextArrival = 0;
    var lastTick = 0;
    var cooldowns = {};

    function makeOrder(t) {
      var p = catalog[Math.floor(rand() * catalog.length)];
      var qty = p.price > 600 ? 1 : pickWeighted(rand, [[1, 0.72], [2, 0.21], [3, 0.07]]);
      var r = rand();
      var final = r < 0.9 ? "completed" : r < 0.955 ? "failed" : "refunded";
      var delaySec = final === "completed" ? 6 + rand() * 50
        : final === "failed" ? 4 + rand() * 20
        : 90 + rand() * 300;
      return {
        id: "ORD-" + (++seq),
        t: t,
        resolvedAt: t + Math.round(delaySec * 1000),
        final: final,
        customer: CUSTOMERS[Math.floor(rand() * CUSTOMERS.length)],
        product: p.title,
        category: p.category,
        unitPrice: p.price,
        qty: qty,
        amount: round2(p.price * qty),
        channel: pickWeighted(rand, CHANNELS),
        payment: pickWeighted(rand, PAYMENTS)
      };
    }

    function arrivalsUntil(now) {
      var created = [];
      while (nextArrival <= now) {
        created.push(makeOrder(nextArrival));
        // Rate drifts as a bounded random walk; gives the ±1–5 % movement in KPIs.
        rate = Math.min(7.5, Math.max(4, rate + (rand() - 0.5) * 0.25));
        nextArrival += (-Math.log(1 - rand()) / rate) * MIN;
      }
      return created;
    }

    function prune(now) {
      var cut = now - KEEP;
      var i = 0;
      while (i < orders.length && orders[i].t < cut) i++;
      if (i) orders.splice(0, i);
    }

    function rollingValue(t) {
      var sum = 0;
      for (var i = orders.length - 1; i >= 0; i--) {
        var o = orders[i];
        if (o.t > t) continue;
        if (o.t <= t - ROLLING) break;
        sum += o.amount;
      }
      return round2(sum);
    }

    function pendingAt(t) {
      var n = 0;
      for (var i = orders.length - 1; i >= 0; i--) {
        var o = orders[i];
        if (o.t < t - 10 * MIN) break;
        if (statusAt(o, t) === "pending") n++;
      }
      return n;
    }

    function sampleAt(t) {
      return { key: t, t: t, value: rollingValue(t), pending: pendingAt(t) };
    }

    // --- Seed one hour of history (deterministic), then the series window behind "now".
    function init(now) {
      nextArrival = now - KEEP;
      orders = arrivalsUntil(now);
      samples = [];
      for (var k = SERIES_POINTS - 1; k >= 0; k--) samples.push(sampleAt(now - k * tickMs));
      lastTick = now;
    }

    function tick(now) {
      // After a long pause (hidden tab, sleep) restart the window instead of replaying hours of orders.
      if (now - lastTick > 10 * MIN) { init(now); return { created: [], resolved: [], events: [], restarted: true }; }
      var created = arrivalsUntil(now);
      for (var i = 0; i < created.length; i++) orders.push(created[i]);
      var resolved = orders.filter(function (o) { return o.resolvedAt > lastTick && o.resolvedAt <= now; });
      prune(now);
      samples.push(sampleAt(now));
      while (samples.length > SERIES_POINTS) samples.shift();
      var events = detectEvents(created, resolved, now);
      lastTick = now;
      return { created: created, resolved: resolved, events: events };
    }

    function windowMetrics(from, to, at) {
      var m = { orders: 0, completed: 0, failed: 0, refunded: 0, pending: 0, revenue: 0 };
      for (var i = 0; i < orders.length; i++) {
        var o = orders[i];
        if (o.t <= from || o.t > to) continue;
        m.orders++;
        var s = statusAt(o, at);
        m[s]++;
        if (s === "completed") m.revenue += o.amount;
      }
      m.revenue = round2(m.revenue);
      var resolved = m.completed + m.failed + m.refunded;
      m.successRate = resolved ? m.completed / resolved : null;
      m.aov = m.completed ? round2(m.revenue / m.completed) : null;
      return m;
    }

    function snapshot(now) {
      var cur = windowMetrics(now - WINDOW, now, now);
      var prev = windowMetrics(now - 2 * WINDOW, now - WINDOW, now);

      var end = Math.ceil(now / BUCKET) * BUCKET;
      var buckets = [];
      for (var b = BUCKETS; b >= 1; b--) {
        var start = end - b * BUCKET;
        buckets.push({ key: start, start: start, end: start + BUCKET, v: 0, partial: start + BUCKET > now });
      }
      var first = buckets[0].start;
      var cats = {};
      for (var i = 0; i < orders.length; i++) {
        var o = orders[i];
        if (o.t > first) buckets[Math.min(BUCKETS - 1, Math.floor((o.t - first) / BUCKET))].v++;
        if (o.t > now - WINDOW && statusAt(o, now) === "completed") {
          cats[o.category] = (cats[o.category] || 0) + o.amount;
        }
      }
      var categories = Object.keys(cats).map(function (k) {
        return { key: k, label: categoryLabel(k), v: round2(cats[k]) };
      }).sort(function (a, b) { return b.v - a.v; });
      if (categories.length > 6) {
        var rest = categories.slice(5).reduce(function (s, c) { return s + c.v; }, 0);
        categories = categories.slice(0, 5).concat([{ key: "other", label: "Other categories", v: round2(rest) }]);
      }

      return {
        now: now,
        current: cur,
        previous: prev,
        series: samples.slice(),
        buckets: buckets,
        status: [
          { key: "completed", label: STATUS_META.completed.label, v: cur.completed },
          { key: "pending", label: STATUS_META.pending.label, v: cur.pending },
          { key: "failed", label: STATUS_META.failed.label, v: cur.failed },
          { key: "refunded", label: STATUS_META.refunded.label, v: cur.refunded }
        ],
        categories: categories,
        openNow: pendingAt(now)
      };
    }

    function records(now) {
      return orders.map(function (o) {
        return {
          id: o.id, t: o.t, customer: o.customer, product: o.product, category: o.category,
          categoryLabel: categoryLabel(o.category), qty: o.qty, unitPrice: o.unitPrice, amount: o.amount,
          channel: o.channel, payment: o.payment, status: statusAt(o, now),
          resolvedAt: o.resolvedAt <= now ? o.resolvedAt : null
        };
      });
    }

    function cooled(key, now, ms) {
      if (cooldowns[key] && now - cooldowns[key] < ms) return false;
      cooldowns[key] = now;
      return true;
    }

    function detectEvents(created, resolved, now) {
      var out = [];
      created.forEach(function (o) {
        if (o.amount >= LARGE_ORDER) {
          out.push({ type: "large", t: o.t, ref: o.id, title: "Large order placed",
            body: o.id + " · " + fmtMoney(o.amount) + " · " + categoryLabel(o.category) });
        }
      });
      resolved.forEach(function (o) {
        if (o.final === "refunded") {
          out.push({ type: "refund", t: o.resolvedAt, ref: o.id, title: "Refund issued",
            body: o.id + " · " + fmtMoney(o.amount) + " returned to " + o.customer.split(" ")[0] });
        }
      });
      var failed5 = orders.filter(function (o) { return o.final === "failed" && o.resolvedAt > now - 5 * MIN && o.resolvedAt <= now; }).length;
      if (failed5 >= 3 && cooled("failed", now, 3 * MIN)) {
        out.push({ type: "failed", t: now, title: "Payment failures rising",
          body: failed5 + " failed payments in the last 5 minutes" });
      }
      var open = pendingAt(now);
      if (open >= QUEUE_ALERT && cooled("queue", now, 3 * MIN)) {
        out.push({ type: "queue", t: now, title: "Order queue above threshold",
          body: open + " orders waiting for payment confirmation (threshold " + QUEUE_ALERT + ")" });
      }
      return out;
    }

    // Recent events found in the seeded history, used to fill the notification panel on load.
    function historyEvents(now, limit) {
      var out = [];
      for (var i = orders.length - 1; i >= 0 && out.length < limit; i--) {
        var o = orders[i];
        if (o.amount >= LARGE_ORDER) {
          out.push({ type: "large", t: o.t, ref: o.id, title: "Large order placed",
            body: o.id + " · " + fmtMoney(o.amount) + " · " + categoryLabel(o.category) });
        } else if (o.final === "failed" && o.resolvedAt <= now) {
          out.push({ type: "failed", t: o.resolvedAt, ref: o.id, title: "Payment failed",
            body: o.id + " · " + fmtMoney(o.amount) + " · " + o.payment });
        } else if (o.final === "refunded" && o.resolvedAt <= now) {
          out.push({ type: "refund", t: o.resolvedAt, ref: o.id, title: "Refund issued",
            body: o.id + " · " + fmtMoney(o.amount) + " returned to " + o.customer.split(" ")[0] });
        }
      }
      return out.sort(function (a, b) { return b.t - a.t; });
    }

    function digest(now) {
      var m = windowMetrics(now - WINDOW, now, now);
      return { type: "digest", t: now, title: "30-minute summary",
        body: m.orders + " orders · " + fmtMoney(m.revenue) + " completed revenue · " +
          (m.successRate == null ? "—" : (m.successRate * 100).toFixed(1) + "%") + " success" };
    }

    function setCatalog(products) {
      var clean = (products || []).filter(function (p) {
        return p && p.title && p.category && typeof p.price === "number" && p.price > 0 && p.price < 5000;
      }).map(function (p) { return { title: String(p.title), category: String(p.category), price: round2(p.price) }; });
      if (clean.length < 10) return false;
      catalog = clean;
      catalogSource = "api";
      return true;
    }

    return {
      init: init,
      tick: tick,
      snapshot: snapshot,
      records: records,
      historyEvents: historyEvents,
      digest: digest,
      setCatalog: setCatalog,
      setTickMs: function (ms) { tickMs = ms; },
      catalogInfo: function () {
        var cats = {};
        catalog.forEach(function (p) { cats[p.category] = 1; });
        return { source: catalogSource, products: catalog.length, categories: Object.keys(cats).length, sample: catalog.slice(0, 6) };
      }
    };
  }

  // --- Formatting shared by every view.
  var moneyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  var moneyFmt0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  var intFmt = new Intl.NumberFormat("en-US");
  function fmtMoney(v) { return v == null ? "—" : moneyFmt.format(v); }
  function fmtMoney0(v) { return v == null ? "—" : moneyFmt0.format(v); }
  function fmtCompactMoney(v) {
    if (v == null) return "—";
    if (Math.abs(v) >= 1000) return "$" + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k";
    return "$" + Math.round(v);
  }
  function fmtInt(v) { return v == null ? "—" : intFmt.format(v); }
  function fmtPct(v, digits) { return v == null ? "—" : (v * 100).toFixed(digits == null ? 1 : digits) + "%"; }
  function fmtTime(t, withSeconds) {
    var d = new Date(t);
    var hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
    return withSeconds ? hh + ":" + mm + ":" + String(d.getSeconds()).padStart(2, "0") : hh + ":" + mm;
  }
  function fmtAgo(t, now) {
    var s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 10) return "just now";
    if (s < 60) return s + " s ago";
    var m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    return Math.round(m / 60) + " h ago";
  }

  global.OpsData = {
    createSimulation: createSimulation,
    STATUS_META: STATUS_META,
    WINDOW_MIN: WINDOW / MIN,
    ROLLING_MIN: ROLLING / MIN,
    BUCKET_MIN: BUCKET / MIN,
    LARGE_ORDER: LARGE_ORDER,
    categoryLabel: categoryLabel,
    fmt: { money: fmtMoney, money0: fmtMoney0, compactMoney: fmtCompactMoney, int: fmtInt, pct: fmtPct, time: fmtTime, ago: fmtAgo }
  };
})(window);
