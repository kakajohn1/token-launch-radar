"use strict";
(function () {
  var R = window.RADAR;
  if (!R || !Array.isArray(R.rows)) {
    document.getElementById("missing").hidden = false;
    return;
  }
  document.getElementById("app").hidden = false;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var money = function (v) {
    if (v == null || isNaN(v)) return "—";
    var a = Math.abs(v);
    if (a >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
    return "$" + v.toFixed(0);
  };
  var moneyFull = function (v) { return v == null ? "—" : "$" + Math.round(v).toLocaleString("en-US"); };
  var pct = function (v) { return v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1) + "%"; };
  var age = function (d) { return d == null ? "—" : d >= 365 ? (d / 365).toFixed(1) + "y" : d + "d"; };
  var fmt2 = function (v) { return v == null ? "—" : (+v).toFixed(2); };
  var fmt3 = function (v) { return v == null ? "—" : (+v).toFixed(3); };
  var fmt4 = function (v) { return v == null ? "—" : (+v).toFixed(4); };

  /* Header + footer */
  $("meta-date").textContent = "Snapshot " + R.as_of;
  $("meta-model").textContent = R.model_version;
  $("foot-date").textContent = R.as_of;
  $("lim-cv").textContent = fmt2(R.fit.value.cv_median_rel_err) + "x";
  $("lim-base").textContent = fmt2(R.fit.value.cv_baseline_median_rel_err) + "x";
  $("lim-r2").textContent = (+R.fit.value.newer_r2).toFixed(2);

  /* Integrity strip, all from data */
  var h = R.fit.hazard, v = R.fit.value;
  var strip = [
    [R.watchlist_size + "/" + R.watchlist_size, "watchlist covered"],
    [String(R.board_size), "rows on the board"],
    [R.pre_size + " pre-token + " + R.live_size + " live", "split"],
    [String(R.set_aside_size), "set aside, with reasons"],
    [fmt2(v.cv_median_rel_err) + "x vs " + fmt2(v.cv_baseline_median_rel_err) + "x", "CV median error vs baseline"],
    [(+v.newer_r2).toFixed(2), "older-to-newer held-out R²"],
    [fmt2(h.auc) + " (CV " + fmt2(h.cv_auc) + ")", "launch-odds AUC"],
    [fmt2(h.nll) + " vs " + fmt2(h.nll_null), "hazard NLL vs null"],
    ["Deterministic", "two runs, identical bytes"]
  ];
  $("strip").innerHTML = strip.map(function (s) { return "<div><b>" + esc(s[0]) + "</b><span>" + esc(s[1]) + "</span></div>"; }).join("");

  /* Spotlight: top 6 FARM pre-token rows */
  var farms = R.rows.filter(function (r) { return r.token_status === "pre-token" && r.verdict === "FARM"; }).slice(0, 6);
  $("spot-count").textContent = R.farm_count + " protocols clear the $25M farm bar";
  $("cards").innerHTML = farms.map(function (r) {
    return '<button class="card" data-slug="' + esc(r.slug) + '"><h3>' + esc(r.name) + '</h3>' +
      '<div class="val">' + money(r.implied_value_usd) + '</div>' +
      '<p>Launch odds ' + (r.launch_odds == null ? "—" : Math.round(r.launch_odds * 100) + "%") +
      ' · TVL ' + money(r.tvl_usd) + ' · ' + esc(r.category || "Uncategorised") + '</p></button>';
  }).join("");

  /* Model panel */
  $("hazard").innerHTML =
    "<dt>Protocols fitted</dt><dd>" + h.n_fit + "</dd>" +
    "<dt>h0 (baseline hazard)</dt><dd>" + fmt3(h.h0) + "</dd>" +
    "<dt>k (hazard decay)</dt><dd>" + fmt3(h.k) + "</dd>" +
    "<dt>bT (TVL effect)</dt><dd>" + fmt3(h.bT) + "</dd>" +
    "<dt>bG (growth effect)</dt><dd>" + fmt3(h.bG) + "</dd>";
  $("valid").innerHTML =
    "<dt>Value fit, n</dt><dd>" + v.n_train + " live protocols</dd>" +
    "<dt>CV median error</dt><dd>" + fmt2(v.cv_median_rel_err) + "x</dd>" +
    "<dt>CV mean error</dt><dd>" + fmt2(v.cv_mean_rel_err) + "x</dd>" +
    "<dt>Baseline median error</dt><dd>" + fmt2(v.cv_baseline_median_rel_err) + "x</dd>" +
    "<dt>Newer-set median error</dt><dd>" + fmt2(v.newer_median_rel_err) + "x</dd>" +
    "<dt>Older-to-newer R²</dt><dd>" + (+v.newer_r2).toFixed(2) + "</dd>" +
    "<dt>Launch-odds AUC</dt><dd>" + fmt2(h.auc) + " (CV " + fmt2(h.cv_auc) + ")</dd>" +
    "<dt>Hazard NLL</dt><dd>" + fmt2(h.nll) + " vs null " + fmt2(h.nll_null) + "</dd>";
  var cats = Object.keys(v.multiples).sort();
  $("mults").innerHTML = cats.map(function (c) {
    var snap = v.snapshot_multiples[c];
    return "<tr><td>" + esc(c) + "</td><td class=\"num\">" + fmt4(v.multiples[c]) + "</td><td class=\"num\">" +
      (snap == null ? "—" : fmt4(snap)) + "</td></tr>";
  }).join("");

  /* Pre-token position among pre-token rows, by rank */
  var preByRank = R.rows.filter(function (r) { return r.token_status === "pre-token"; }).slice().sort(function (a, b) { return a.rank - b.rank; });
  var radarNo = {};
  preByRank.forEach(function (r, i) { radarNo[r.slug] = i + 1; });

  /* State + hash */
  var state = { tab: "pre", q: "", cat: "", sort: "rank", dir: 1, slug: null };
  function parseHash() {
    var raw = location.hash.replace(/^#/, "");
    var p = {};
    raw.split("&").forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    state.tab = ["pre", "live", "all", "aside"].indexOf(p.tab) >= 0 ? p.tab : "pre";
    state.q = p.q || "";
    state.cat = p.cat || "";
    state.slug = p.p || null;
    if (p.sort) { state.sort = p.sort; state.dir = p.dir === "desc" ? -1 : 1; }
  }
  function writeHash() {
    var parts = ["tab=" + state.tab];
    if (state.q) parts.push("q=" + encodeURIComponent(state.q));
    if (state.cat) parts.push("cat=" + encodeURIComponent(state.cat));
    if (state.sort !== "rank" || state.dir !== 1) parts.push("sort=" + state.sort, "dir=" + (state.dir === 1 ? "asc" : "desc"));
    if (state.slug) parts.push("p=" + encodeURIComponent(state.slug));
    history.replaceState(null, "", "#" + parts.join("&"));
  }

  var VORDER = { FARM: 0, THIN: 1, SKIP: 2, POSITION: 3 };
  function valOf(r, k) {
    if (k === "rank") return r.rank;
    if (k === "name") return (r.name || "").toLowerCase();
    if (k === "category") return (r.category || "").toLowerCase();
    if (k === "tvl") return r.tvl_usd;
    if (k === "chg") return r.change_7d == null ? -Infinity : r.change_7d;
    if (k === "age") return r.age_days == null ? -Infinity : r.age_days;
    if (k === "odds") return r.launch_odds == null ? -Infinity : r.launch_odds;
    if (k === "value") return r.implied_value_usd == null ? -Infinity : r.implied_value_usd;
    if (k === "verdict") return VORDER[r.verdict] == null ? 9 : VORDER[r.verdict];
    return 0;
  }
  function currentRows() {
    var rows = state.tab === "pre" ? R.rows.filter(function (r) { return r.token_status === "pre-token"; })
      : state.tab === "live" ? R.rows.filter(function (r) { return r.token_status === "live"; })
      : state.tab === "all" ? R.rows.slice() : [];
    if (state.q) {
      var q = state.q.toLowerCase();
      rows = rows.filter(function (r) { return (r.name || "").toLowerCase().indexOf(q) >= 0 || (r.slug || "").toLowerCase().indexOf(q) >= 0; });
    }
    if (state.cat) rows = rows.filter(function (r) { return (r.category || "") === state.cat; });
    rows.sort(function (a, b) {
      var x = valOf(a, state.sort), y = valOf(b, state.sort);
      if (x < y) return -1 * state.dir;
      if (x > y) return 1 * state.dir;
      return (a.rank - b.rank) * (state.sort === "rank" ? state.dir : 1);
    });
    return rows;
  }
  function fillCats() {
    var src = state.tab === "aside" ? R.set_aside : currentRowsBase();
    var set = {};
    src.forEach(function (r) { if (r.category) set[r.category] = 1; });
    var list = Object.keys(set).sort();
    var sel = $("cat");
    var cur = state.cat;
    sel.innerHTML = "<option value=\"\">All categories</option>" + list.map(function (c) { return "<option" + (c === cur ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("");
    if (cur && list.indexOf(cur) < 0) { state.cat = ""; }
  }
  function currentRowsBase() {
    return state.tab === "pre" ? R.rows.filter(function (r) { return r.token_status === "pre-token"; })
      : state.tab === "live" ? R.rows.filter(function (r) { return r.token_status === "live"; })
      : R.rows.slice();
  }

  function render() {
    document.querySelectorAll(".tabs button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.tab === state.tab ? "true" : "false"); });
    $("q").value = state.q;
    $("aside-note").hidden = state.tab !== "aside";
    $("board").hidden = state.tab === "aside";
    $("aside-table").hidden = state.tab !== "aside";
    fillCats();
    if (state.tab === "aside") { renderAside(); } else { renderBoard(); }
    renderDetail();
  }
  function renderBoard() {
    var rows = currentRows();
    var total = currentRowsBase().length;
    $("count").textContent = rows.length + " of " + total + " protocols" + (state.cat ? " in " + state.cat : "") + (state.q ? ' matching "' + state.q + '"' : "");
    $("empty").hidden = rows.length > 0;
    $("rows").innerHTML = rows.map(function (r) {
      var pre = r.token_status === "pre-token";
      var basis = r.value_basis === "market-cap" ? "market cap" : r.value_basis === "fitted" ? "fitted — mcap unreported" : "implied";
      return '<tr data-slug="' + esc(r.slug) + '"' + (pre ? "" : ' class="live-row"') + '>' +
        "<td>#" + r.rank + (pre ? ' <span class="pos">Radar #' + radarNo[r.slug] + "</span>" : "") + "</td>" +
        '<td class="name">' + esc(r.name) + "<small>" + esc(r.slug) + (pre ? "" : " · " + basis) + "</small></td>" +
        "<td>" + esc(r.category || "—") + "</td>" +
        '<td class="num">' + money(r.tvl_usd) + "</td>" +
        '<td class="num">' + pct(r.change_7d) + "</td>" +
        '<td class="num">' + age(r.age_days) + "</td>" +
        '<td class="num">' + (pre ? (r.launch_odds == null ? "—" : Math.round(r.launch_odds * 100) + "%") : "—") + "</td>" +
        '<td class="num"><strong>' + money(r.implied_value_usd) + "</strong></td>" +
        '<td><span class="badge ' + r.verdict.toLowerCase() + '">' + r.verdict + "</span></td></tr>";
    }).join("");
  }
  function renderAside() {
    var list = R.set_aside.slice();
    if (state.q) { var q = state.q.toLowerCase(); list = list.filter(function (r) { return (r.name || "").toLowerCase().indexOf(q) >= 0 || (r.slug || "").toLowerCase().indexOf(q) >= 0; }); }
    if (state.cat) list = list.filter(function (r) { return (r.category || "") === state.cat; });
    $("count").textContent = list.length + " of " + R.set_aside_size + " set aside";
    $("empty").hidden = list.length > 0;
    $("aside-rows").innerHTML = list.map(function (r) {
      return "<tr><td class=\"name\">" + esc(r.name) + "<small>" + esc(r.slug) + "</small></td><td>" + esc(r.category || "—") + "</td>" +
        '<td class="num">' + money(r.tvl_usd) + "</td><td>" + esc(r.token_status) + "</td><td>" + esc(r.reason) + "</td></tr>";
    }).join("");
  }

  /* Detail dialog */
  var dlg = $("detail");
  function openDetail(slug) {
    state.slug = slug; writeHash(); renderDetail();
  }
  function renderDetail() {
    var row = state.slug ? R.rows.find(function (r) { return r.slug === state.slug; }) : null;
    if (!row) { if (dlg.open) dlg.close(); return; }
    var pre = row.token_status === "pre-token";
    $("d-name").textContent = row.name;
    var html = '<p><span class="badge ' + row.verdict.toLowerCase() + '">' + row.verdict + '</span> ' +
      esc(row.category || "Uncategorised") + ' · ' + esc(row.chains ? row.chains.slice(0, 8).join(", ") : "") +
      (row.chains && row.chains.length > 8 ? " +" + (row.chains.length - 8) + " more" : "") + "</p>" +
      "<dl>" +
      "<dt>Global rank</dt><dd>#" + row.rank + (pre ? " · Radar #" + radarNo[row.slug] + " among pre-token" : "") + "</dd>" +
      "<dt>TVL</dt><dd>" + moneyFull(row.tvl_usd) + "</dd>" +
      "<dt>7-day change</dt><dd>" + pct(row.change_7d) + "</dd>" +
      "<dt>Age</dt><dd>" + age(row.age_days) + (row.listed_at ? " · listed " + esc(row.listed_at) : "") + "</dd>" +
      "<dt>Token status</dt><dd>" + (pre ? "Records no token" : "Live token") + "</dd></dl>";
    if (pre) {
      var barW = Math.min(100, (row.implied_value_usd / 25000000) * 100);
      html += "<h3>Model breakdown</h3><dl>" +
        "<dt>Category multiple</dt><dd>" + fmt4(row.multiple) + "</dd>" +
        "<dt>Fitted FDV</dt><dd>" + moneyFull(row.fitted_fdv_usd) + " (TVL × multiple × 2.0)</dd>" +
        "<dt>Launch odds</dt><dd>" + (row.launch_odds == null ? "—" : (row.launch_odds * 100).toFixed(1) + "% in the next 12 months") + "</dd>" +
        "<dt>Implied value</dt><dd><strong>" + moneyFull(row.implied_value_usd) + "</strong> = fitted FDV × launch odds</dd></dl>" +
        '<div class="bar"><i style="width:' + barW.toFixed(0) + '%"></i></div>' +
        "<p>Farm bar $25M · Thin $5M–$25M · Skip under $5M. This row sits at " + money(row.implied_value_usd) + ".</p>";
      if (row.farm_steps && row.farm_steps.length) {
        html += "<h3>Farm plan</h3><ol>" + row.farm_steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>";
      } else {
        html += "<h3>Farm plan</h3><p>No per-protocol farm plan was included in this snapshot's data file, so none is shown here. General approach: use the protocol on its listed chains, track any points or activity it records, and re-check the board after the next snapshot before committing funds.</p>";
      }
    } else {
      html += "<h3>Value basis</h3><dl>" +
        "<dt>Basis</dt><dd>" + (row.value_basis === "market-cap" ? "Market cap (reported)" : "Fitted — market cap unreported") + "</dd>" +
        "<dt>Market cap</dt><dd>" + moneyFull(row.mcap_usd) + "</dd>" +
        "<dt>Fitted FDV</dt><dd>" + moneyFull(row.fitted_fdv_usd) + "</dd>" +
        "<dt>Value shown</dt><dd><strong>" + moneyFull(row.implied_value_usd) + "</strong></dd></dl>" +
        "<h3>Positioning</h3><p>This is a live token, shown for comparison — not a farm. " +
        (row.value_basis === "market-cap" ? "Its market cap is the value used; compare it with the fitted FDV from TVL before judging whether the market already prices the protocol richly." : "No market cap was reported, so the value shown is the fitted FDV from TVL and the category multiple — treat it as a model estimate, not a market price.") + "</p>";
    }
    $("d-body").innerHTML = html;
    if (!dlg.open) dlg.showModal();
  }
  $("d-close").addEventListener("click", function () { dlg.close(); });
  dlg.addEventListener("close", function () { if (state.slug) { state.slug = null; writeHash(); } });
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-slug]");
    if (t) openDetail(t.dataset.slug);
  });
  document.querySelectorAll("#board thead th").forEach(function (th) {
    th.addEventListener("click", function () {
      var k = th.dataset.sort;
      if (state.sort === k) { state.dir = -state.dir; } else { state.sort = k; state.dir = 1; }
      writeHash(); render();
    });
  });
  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () { state.tab = b.dataset.tab; state.cat = ""; writeHash(); render(); });
  });
  $("q").addEventListener("input", function () { state.q = $("q").value; writeHash(); render(); });
  $("cat").addEventListener("change", function () { state.cat = $("cat").value; writeHash(); render(); });
  window.addEventListener("hashchange", function () { parseHash(); render(); });

  parseHash();
  render();
})();
