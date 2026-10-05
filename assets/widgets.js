/* ずんだもんと学ぶアナログ回路：動く回路図（ウィジェット）。
 *
 * <figure class="widget" data-widget="bench|transfer|output|inverter" data-ep="ep01" data-init='{...}'>
 * に SVG と操作パネルを作る。数値はすべて model.js（scenes/device.py の移植）から計算する。
 * 回ごとの条件（VDS_FIX、VGS_LIST、VDD、KP_INV など）は <script type="application/json" class="zw-scene"> から読む。
 */
(function () {
  "use strict";
  var EN = document.documentElement.lang === "en";
  var labels = window.ZWidgetEnglish || {};
  function tr(s) { return EN && Object.prototype.hasOwnProperty.call(labels, s) ? labels[s] : s; }
  var M = window.ZModel;
  var NS = "http://www.w3.org/2000/svg";
  var DEV = M.DEVICE;

  // 動画（scenes/kit.py・ep01.py）と同じ色
  var C = {
    vgs: "#81D4FA", vds: "#FFAB91", id: "#F7D96F", ch: "#29B6F6", pmos: "#B39DDB", nmos: "#4FC3F7",
    curves: ["#4FC3F7", "#81C784", "#FFB74D", "#E57373"], off: "#5A606B", wire: "#DDDDDD"
  };
  var REGION = {
    cutoff: tr("遮断（サブスレッショルド）"),
    linear: tr("線形領域"),
    sat: tr("飽和領域")
  };

  // ---- 小さな道具 --------------------------------------------------------------
  function svg(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function h(tag, attrs, parent, html) {
    var e = document.createElement(tag);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (html !== undefined) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }

  /* "V_{GS} = 0.80 V" → 添字つきの SVG text の中身 */
  function setText(t, s, fs) {
    while (t.firstChild) t.removeChild(t.firstChild);
    var re = /_\{([^}]*)\}/g, pos = 0, m, shifted = false, d = (fs || 13) * 0.3;
    function add(str, sub) {
      if (!str) return;
      var sp = svg("tspan", {}, t);
      sp.textContent = str;
      if (sub) { sp.setAttribute("dy", d); sp.setAttribute("font-size", "72%"); shifted = true; }
      else if (shifted) { sp.setAttribute("dy", -d); shifted = false; }
    }
    while ((m = re.exec(s))) { add(s.slice(pos, m.index), false); add(m[1], true); pos = re.lastIndex; }
    add(s.slice(pos), false);
    return t;
  }

  function text(parent, x, y, s, o) {
    o = o || {};
    var fs = o.fs || 13;
    var t = svg("text", { x: x, y: y, "font-size": fs, "text-anchor": o.anchor || "start",
      fill: o.fill || "var(--screen-fg)", "class": o.cls || null, "font-weight": o.weight || null }, parent);
    return setText(t, s, fs);
  }

  /* HTML の添字："V_{GS}" → V<sub>GS</sub> */
  function hs(s) {
    return s.replace(/_\{([^}]*)\}/g, "<sub>$1</sub>");
  }

  function line(p, x1, y1, x2, y2, o) {
    o = o || {};
    return svg("line", { x1: x1, y1: y1, x2: x2, y2: y2, stroke: o.stroke || "currentColor", "stroke-width": o.w || 2,
      "stroke-dasharray": o.dash || null, "stroke-linecap": "round", opacity: o.opacity || null }, p);
  }

  function poly(p, pts, o) {
    o = o || {};
    return svg("polyline", { points: pts.map(function (q) { return q[0] + "," + q[1]; }).join(" "),
      fill: "none", stroke: o.stroke || "currentColor", "stroke-width": o.w || 2, "stroke-linejoin": "round",
      "stroke-linecap": "round", "stroke-dasharray": o.dash || null }, p);
  }

  function arrowHead(p, x, y, dir, color, size) {
    var s = size || 6, pts;
    if (dir === "r") pts = [[x, y], [x - s * 1.4, y - s], [x - s * 1.4, y + s]];
    else if (dir === "l") pts = [[x, y], [x + s * 1.4, y - s], [x + s * 1.4, y + s]];
    else if (dir === "d") pts = [[x, y], [x - s, y - s * 1.4], [x + s, y - s * 1.4]];
    else pts = [[x, y], [x - s, y + s * 1.4], [x + s, y + s * 1.4]];
    return svg("polygon", { points: pts.map(function (q) { return q.join(","); }).join(" "), fill: color || "currentColor" }, p);
  }

  function niceStep(span, n) {
    var raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
    var c = [1, 2, 2.5, 3, 5, 10];
    for (var i = 0; i < c.length; i++) if (c[i] * p >= raw - 1e-12) return c[i] * p;
    return 10 * p;
  }

  function niceMax(v, n) {
    var st = niceStep(v, n);
    return { max: Math.ceil(v / st - 1e-9) * st, step: st };
  }

  function decimals(step) {
    return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  }

  var LOG_LABEL = { "-1": "100 mA", "-2": "10 mA", "-3": "1 mA", "-4": "100 µA", "-5": "10 µA", "-6": "1 µA",
    "-7": "100 nA", "-8": "10 nA", "-9": "1 nA", "-10": "100 pA", "-11": "10 pA", "-12": "1 pA", "-13": "100 fA" };

  /* グラフの座標系（log のとき y は log10(値) の範囲） */
  function Plot(parent, box, xr, yr, o) {
    o = o || {};
    var self = this;
    this.box = box; this.xr = xr; this.yr = yr; this.log = !!o.log;
    this.sx = function (v) { return box.x + (v - xr[0]) / (xr[1] - xr[0]) * box.w; };
    this.sy = function (v) {
      var y = self.log ? Math.log10(Math.max(v, 1e-300)) : v;
      y = Math.max(yr[0], Math.min(yr[1], y));
      return box.y + box.h - (y - yr[0]) / (yr[1] - yr[0]) * box.h;
    };
    var g = svg("g", { "class": "axes" }, parent);
    var xs = o.xstep || niceStep(xr[1] - xr[0], 6), xd = decimals(xs);
    for (var i = 1; xr[0] + i * xs <= xr[1] + 1e-9; i++) {
      var v = xr[0] + i * xs;
      line(g, this.sx(v), box.y, this.sx(v), box.y + box.h, { stroke: "var(--screen-grid)", w: 1 });
      text(g, this.sx(v), box.y + box.h + 15, v.toFixed(xd), { anchor: "middle", fs: 11, fill: "var(--screen-muted)", cls: "mono" });
    }
    if (this.log) {
      for (var k = Math.ceil(yr[0]); k <= yr[1]; k++) {
        var yy = box.y + box.h - (k - yr[0]) / (yr[1] - yr[0]) * box.h;
        line(g, box.x, yy, box.x + box.w, yy, { stroke: "var(--screen-grid)", w: 1 });
        text(g, box.x - 5, yy + 4, LOG_LABEL[String(k)] || ("1e" + k + " A"), { anchor: "end", fs: 10, fill: "var(--screen-muted)", cls: "mono" });
      }
    } else {
      var ys = o.ystep || niceStep(yr[1] - yr[0], 4), yd = decimals(ys);
      for (var j = 1; yr[0] + j * ys <= yr[1] + 1e-9; j++) {
        var u = yr[0] + j * ys, y2 = this.sy(u);
        line(g, box.x, y2, box.x + box.w, y2, { stroke: "var(--screen-grid)", w: 1 });
        text(g, box.x - 5, y2 + 4, u.toFixed(yd), { anchor: "end", fs: 11, fill: "var(--screen-muted)", cls: "mono" });
      }
    }
    line(g, box.x, box.y + box.h, box.x + box.w, box.y + box.h, { stroke: "var(--screen-muted)", w: 1.5 });
    line(g, box.x, box.y, box.x, box.y + box.h, { stroke: "var(--screen-muted)", w: 1.5 });
    text(g, box.x + box.w, box.y + box.h + 32, o.xlabel || "", { anchor: "end", fs: 12 });
    text(g, box.x - 4, box.y - 10, o.ylabel || "", { anchor: "start", fs: 12 });
  }

  Plot.prototype.path = function (f, x0, x1, n) {
    var d = "";
    n = n || 240;
    for (var i = 0; i <= n; i++) {
      var x = x0 + (x1 - x0) * i / n;
      d += (i ? "L" : "M") + this.sx(x).toFixed(2) + "," + this.sy(f(x)).toFixed(2);
    }
    return d;
  };

  // ---- 操作パネル -------------------------------------------------------------
  function slider(panel, id, label, min, max, step, value, fmt, color) {
    var row = h("div", { "class": "w-ctrl" }, panel);
    h("label", { "for": id, "class": "w-lab", style: color ? "--sw:" + color : null }, row, label);
    var inp = h("input", { type: "range", id: id, min: min, max: max, step: step }, row);
    inp.value = value;
    var out = h("output", { "for": id, "class": "w-val" }, row);
    function upd() {
      var s = fmt(Number(inp.value));
      out.textContent = s;
      inp.setAttribute("aria-valuetext", s.replace(/ V$/, tr(" ボルト")));
    }
    inp.addEventListener("input", upd);
    upd();
    return inp;
  }

  function segmented(panel, id, legend, options, value) {
    var fs = h("fieldset", { "class": "seg" }, panel);
    h("legend", {}, fs, legend);
    var box = h("div", { "class": "seg-opts" }, fs);
    var inputs = [];
    options.forEach(function (op, i) {
      var iid = id + "-" + i;
      var inp = h("input", { type: "radio", id: iid, name: id, value: op[0] }, box);
      if (Math.abs(Number(op[0]) - Number(value)) < 1e-9 || String(op[0]) === String(value)) inp.checked = true;
      h("label", { "for": iid }, box, op[1]);
      inputs.push(inp);
    });
    if (!inputs.some(function (x) { return x.checked; })) inputs[0].checked = true;
    return {
      value: function () { for (var i = 0; i < inputs.length; i++) if (inputs[i].checked) return inputs[i].value; },
      on: function (fn) { inputs.forEach(function (x) { x.addEventListener("change", fn); }); }
    };
  }

  function readouts(panel, items) {
    var dl = h("dl", { "class": "w-read" }, panel);
    var vals = {};
    items.forEach(function (it) {
      var d = h("div", {}, dl);
      h("dt", {}, d, it[1]);
      vals[it[0]] = h("dd", { "class": "w-num" }, d);
    });
    return vals;
  }

  function chip(panel) {
    var wrap = h("p", { "class": "w-region", "aria-live": "polite" }, panel);
    h("span", { "class": "w-region-l" }, wrap, tr("動作領域"));
    var c = h("span", { "class": "chip" }, wrap);
    return function (r) { c.textContent = REGION[r]; c.className = "chip " + r; };
  }

  function stage(root) {
    return h("div", { "class": "w-stage" }, root);
  }

  /* NMOS の記号（動画と同じ形）。中心 (x, y)、ドレインは上、ソースは下。チャネルの線を返す */
  function nmosSymbol(g, x, y, letters) {
    line(g, x - 10, y - 26, x - 10, y + 26);
    var ch = line(g, x, y - 32, x, y + 32, { w: 2.5 });
    poly(g, [[x, y - 22], [x + 34, y - 22], [x + 34, y - 64]]);
    poly(g, [[x, y + 22], [x + 34, y + 22], [x + 34, y + 64]]);
    line(g, x + 4, y + 22, x + 26, y + 22);
    arrowHead(g, x + 30, y + 22, "r", null, 5);
    if (letters) {
      text(g, x - 24, y - 8, "G", { fs: 12, fill: "var(--screen-muted)" });
      text(g, x + 27, y - 38, "D", { anchor: "end", fs: 12, fill: "var(--screen-muted)" });
      text(g, x + 42, y + 50, "S", { fs: 12, fill: "var(--screen-muted)" });
    }
    return ch;
  }

  function ground(g, x, y) {
    line(g, x, y, x, y + 8);
    line(g, x - 12, y + 8, x + 12, y + 8);
    line(g, x - 7, y + 13, x + 7, y + 13);
    line(g, x - 2.5, y + 18, x + 2.5, y + 18);
  }

  function vsource(g, x, y, r) {
    svg("circle", { cx: x, cy: y, r: r, fill: "var(--screen)", stroke: "currentColor", "stroke-width": 2 }, g);
    text(g, x, y - 3, "+", { anchor: "middle", fs: 13 });
    text(g, x, y + 13, "−", { anchor: "middle", fs: 13 });
  }

  function vfmt(v) { return M.fmtV(v) + " V"; }

  // ---- ① 測定回路 ---------------------------------------------------------------
  function bench(root, S, init, uid) {
    var st = stage(root);
    var s = svg("svg", { viewBox: "0 0 400 262", "class": "w-svg w-svg-c", role: "img", color: C.wire,
      "aria-label": tr("NMOS の測定回路。ゲートとソースの間に VGS、ドレインとソースの間に VDS の電源をつなぎ、ドレイン電流 ID を見る") }, st);
    var X = 175, Y = 135;
    var ch = nmosSymbol(s, X, Y, true);
    var chOff = line(s, X, Y - 32, X, Y + 32, { stroke: "none", w: 2.5, dash: "4 4" });
    poly(s, [[X - 10, Y], [100, Y], [100, Y + 22]]);
    vsource(s, 100, Y + 42, 20);
    poly(s, [[100, Y + 62], [100, 225], [320, 225], [320, Y + 20]]);
    vsource(s, 320, Y, 20);
    poly(s, [[X + 34, Y - 64], [X + 34, 52], [320, 52], [320, Y - 20]]);
    line(s, X + 34, Y + 64, X + 34, 225);
    svg("circle", { cx: X + 34, cy: 225, r: 3, fill: "currentColor" }, s);
    ground(s, X + 34, 225);
    line(s, X + 48, 64, X + 48, 90, { stroke: C.id, w: 3 });
    arrowHead(s, X + 48, 99, "d", C.id, 6);
    var tId = text(s, X + 34, 40, "", { anchor: "middle", fs: 14, fill: C.id, cls: "mono" });
    text(s, 72, Y + 34, "V_{GS}", { anchor: "end", fs: 14, fill: C.vgs });
    var tVgs = text(s, 72, Y + 54, "", { anchor: "end", fs: 13, fill: C.vgs, cls: "mono" });
    text(s, 348, Y - 6, "V_{DS}", { anchor: "start", fs: 14, fill: C.vds });
    var tVds = text(s, 348, Y + 14, "", { anchor: "start", fs: 13, fill: C.vds, cls: "mono" });

    var panel = h("div", { "class": "w-panel" }, root);
    var vgsMax = Math.max.apply(null, S.VGS_LIST);
    var inG = slider(panel, uid + "-vgs", hs("V_{GS}"), 0, vgsMax, 0.01, init.vgs, vfmt, C.vgs);
    var inD = slider(panel, uid + "-vds", hs("V_{DS}"), 0, S.VDS_MAX, 0.01, init.vds, vfmt, C.vds);
    var ro = readouts(panel, [["id", hs("I_{D}")], ["vov", hs("V_{GS} − V_{th}")]]);
    var setRegion = chip(panel);

    function upd() {
      var vgs = Number(inG.value), vds = Number(inD.value);
      var id = M.drainCurrent(vds, vgs), r = M.region(vgs, vds);
      setText(tId, "I_{D} = " + M.fmtCurrent(id), 14);
      tVgs.textContent = vfmt(vgs);
      tVds.textContent = vfmt(vds);
      ro.id.textContent = M.fmtCurrent(id);
      ro.vov.textContent = vfmt(vgs - DEV.VTH);
      ch.setAttribute("stroke", r === "cutoff" ? "none" : C.ch);
      chOff.setAttribute("stroke", r === "cutoff" ? C.off : "none");
      setRegion(r);
    }
    inG.addEventListener("input", upd);
    inD.addEventListener("input", upd);
    upd();
  }

  // ---- ② ID–VGS 特性 -------------------------------------------------------------
  function transfer(root, S, init, uid) {
    var st = stage(root);
    var s = svg("svg", { viewBox: "0 0 420 300", "class": "w-svg w-svg-g", role: "img",
      "aria-label": tr("ID–VGS 特性のグラフ（VDS 一定）") }, st);
    var xmax = Math.max.apply(null, S.VGS_LIST), vds = S.VDS_FIX;
    var box = { x: 64, y: 30, w: 336, h: 218 };
    var layer = svg("g", {}, s);
    var panel = h("div", { "class": "w-panel" }, root);
    var scale = segmented(panel, uid + "-scale", tr("縦軸"), [["lin", tr("線形")], ["log", tr("対数")]], init.scale || "lin");
    var inG = slider(panel, uid + "-vgs", hs("V_{GS}"), 0, xmax, 0.01, init.vgs, vfmt, C.vgs);
    var ro = readouts(panel, [["vds", hs("V_{DS}") + tr("（一定）")], ["id", hs("I_{D}")]]);
    ro.vds.textContent = vfmt(vds);
    var setRegion = chip(panel);
    var slope = h("p", { "class": "w-sub" }, panel);
    var P, dot, tdot;

    function draw() {
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      var log = scale.value() === "log", yr;
      if (log) {
        yr = [Math.floor(Math.log10(M.drainCurrent(vds, 0) * 1e-3)), Math.ceil(Math.log10(M.drainCurrent(vds, xmax) * 1e-3))];
      } else {
        yr = [0, niceMax(M.drainCurrent(vds, xmax), 4).max];
      }
      P = new Plot(layer, box, [0, xmax], yr, { log: log, xlabel: "V_{GS} [V]", ylabel: log ? tr("I_{D}（対数軸）") : "I_{D} [mA]" });
      var xv = P.sx(DEV.VTH);
      if (log) {
        svg("rect", { x: box.x, y: box.y, width: xv - box.x, height: box.h, fill: C.id, opacity: 0.08 }, layer);
        text(layer, box.x + 6, box.y + 14, tr("サブスレッショルド"), { fs: 11, fill: C.id });
      }
      line(layer, xv, box.y, xv, box.y + box.h, { stroke: "var(--screen-fg)", w: 1.2, dash: "3 4" });
      // 対数軸では点の数値ラベル（Vth の右上を通る）と重ならないよう、Vth の線の左（遮断側）に置く
      text(layer, log ? xv - 5 : xv + 5, box.y + (log ? 32 : 14), "V_{th} = " + vfmt(DEV.VTH),
        { fs: 11, anchor: log ? "end" : "start" });
      text(layer, box.x + box.w - 4, log ? box.y + box.h - 8 : box.y + 14, "V_{DS} = " + vfmt(vds) + tr("（一定）"),
        { anchor: "end", fs: 11, fill: C.vds });
      svg("path", { d: P.path(function (v) { var i = M.drainCurrent(vds, v); return log ? i * 1e-3 : i; }, 0, xmax),
        fill: "none", stroke: C.curves[3], "stroke-width": 2.5 }, layer);
      dot = svg("circle", { r: 5, fill: C.id, stroke: "var(--screen)", "stroke-width": 1.5 }, layer);
      tdot = text(layer, 0, 0, "", { fs: 12, fill: C.id, cls: "mono" });
      slope.innerHTML = log
        ? tr("このモデルでは ") + hs("V_{GS}") + tr(" が約 <span class=\"w-num\">") + (DEV.S_SLOPE * 1e3).toFixed(1) +
          tr(" mV</span> 変わるごとに電流が1桁変わる（常温の下限は約 <span class=\"w-num\">") + (DEV.S_MIN * 1e3).toFixed(1) + tr(" mV</span>）")
        : "";
      slope.hidden = !log;
      upd();
    }

    function upd() {
      var vgs = Number(inG.value), id = M.drainCurrent(vds, vgs);
      var px = P.sx(vgs), py = P.sy(P.log ? id * 1e-3 : id);
      dot.setAttribute("cx", px); dot.setAttribute("cy", py);
      var right = px < box.x + box.w * 0.6;
      tdot.setAttribute("x", right ? px + 9 : px - 9);
      tdot.setAttribute("y", right ? py - 8 : py + 18);
      tdot.setAttribute("text-anchor", right ? "start" : "end");
      tdot.textContent = M.fmtCurrent(id);
      ro.id.textContent = M.fmtCurrent(id);
      setRegion(M.region(vgs, vds));
    }
    scale.on(draw);
    inG.addEventListener("input", upd);
    draw();
  }

  // ---- ③ ID–VDS 特性 -------------------------------------------------------------
  function output(root, S, init, uid) {
    var st = stage(root);
    var s = svg("svg", { viewBox: "0 0 420 300", "class": "w-svg w-svg-g", role: "img",
      "aria-label": tr("ID–VDS 特性のグラフ。VGS ごとの曲線と、線形領域と飽和領域の境界（点線）") }, st);
    var xmax = S.VDS_MAX, list = S.VGS_LIST;
    var box = { x: 54, y: 30, w: 340, h: 218 };
    var top = 0;
    list.forEach(function (g) { top = Math.max(top, M.drainCurrent(xmax, g)); });
    var P = new Plot(s, box, [0, xmax], [0, niceMax(top, 4).max], { xlabel: "V_{DS} [V]", ylabel: "I_{D} [mA]" });
    // 境界 VDS = VGS − Vth：scenes/ep01.py と同じく drain_current(v, v + Vth) の点を結ぶ
    var vovMax = Math.max.apply(null, list) - DEV.VTH;
    svg("path", { d: P.path(function (v) { return M.drainCurrent(v, v + DEV.VTH); }, 0, vovMax, 80),
      fill: "none", stroke: "var(--screen-fg)", "stroke-width": 1.4, "stroke-dasharray": "3 4" }, s);
    text(s, P.sx(vovMax * 0.4), box.y + 14, tr("線形"), { anchor: "middle", fs: 12, fill: "var(--screen-muted)" });
    text(s, P.sx((vovMax + xmax) / 2), box.y + 14, tr("飽和"), { anchor: "middle", fs: 12, fill: "var(--screen-muted)" });
    var curves = list.map(function (g, i) {
      var col = C.curves[i % C.curves.length];
      var c = svg("path", { d: P.path(function (v) { return M.drainCurrent(v, g); }, 0, xmax), fill: "none",
        stroke: col, "stroke-width": 2.2 }, s);
      var lab = text(s, box.x + box.w, P.sy(M.drainCurrent(xmax, g)) - 6, M.fmtV(g, 1) + " V",
        { anchor: "end", fs: 11, fill: col, cls: "mono" });
      return [c, lab];
    });
    var bmark = line(s, 0, box.y + box.h - 5, 0, box.y + box.h + 5, { stroke: "var(--screen-fg)", w: 2 });
    var dot = svg("circle", { r: 5, fill: C.id, stroke: "var(--screen)", "stroke-width": 1.5 }, s);
    var tdot = text(s, 0, 0, "", { fs: 12, fill: C.id, cls: "mono" });

    var panel = h("div", { "class": "w-panel" }, root);
    var gsel = segmented(panel, uid + "-vgs", hs("V_{GS}"), list.map(function (g) { return [g, M.fmtV(g, 1) + " V"]; }),
      init.vgs !== undefined ? init.vgs : list[list.length - 1]);
    var inD = slider(panel, uid + "-vds", hs("V_{DS}"), 0, xmax, 0.01, init.vds, vfmt, C.vds);
    var ro = readouts(panel, [["id", hs("I_{D}")], ["sat", tr("境界 ") + hs("V_{GS} − V_{th}")]]);
    var setRegion = chip(panel);

    function upd() {
      var vgs = Number(gsel.value()), vds = Number(inD.value);
      curves.forEach(function (c, i) {
        var on = Math.abs(list[i] - vgs) < 1e-9;
        c[0].setAttribute("opacity", on ? 1 : 0.3);
        c[0].setAttribute("stroke-width", on ? 3 : 1.8);
        c[1].setAttribute("opacity", on ? 1 : 0.45);
      });
      var id = M.drainCurrent(vds, vgs);
      var px = P.sx(vds), py = P.sy(id);
      dot.setAttribute("cx", px); dot.setAttribute("cy", py);
      var right = px < box.x + box.w * 0.62;
      tdot.setAttribute("x", right ? px + 8 : px - 8);
      tdot.setAttribute("y", py + (right ? 18 : -10));
      tdot.setAttribute("text-anchor", right ? "start" : "end");
      tdot.textContent = M.fmtCurrent(id);
      var b = P.sx(Math.max(0, vgs - DEV.VTH));
      bmark.setAttribute("x1", b); bmark.setAttribute("x2", b);
      ro.id.textContent = M.fmtCurrent(id);
      ro.sat.textContent = vfmt(vgs - DEV.VTH);
      setRegion(M.region(vgs, vds));
    }
    gsel.on(upd);
    inD.addEventListener("input", upd);
    upd();
  }

  // ---- ④ CMOS インバータ -------------------------------------------------------------
  function inverter(root, S, init, uid) {
    var VDD = S.VDD, KP = S.KP_INV;
    var st = stage(root);
    var c = svg("svg", { viewBox: "0 0 320 300", "class": "w-svg w-svg-c", role: "img", color: C.wire,
      "aria-label": tr("CMOS インバータの回路図。上が PMOS、下が NMOS。オンのトランジスタを色で示す") }, st);
    var X = 170;
    line(c, 160, 30, 250, 30, { stroke: C.id, w: 3 });
    text(c, 152, 35, "V_{DD} = " + vfmt(VDD), { anchor: "end", fs: 12, fill: C.id });
    function mos(y, p) {
      var g = svg("g", {}, c);
      line(g, X - 10, y - 22, X - 10, y + 22);
      line(g, X, y - 28, X, y + 28, { w: 2.5 });
      var d = p ? 16 : -16, sr = p ? -16 : 16;       // ドレインは出力側、ソースは電源側
      poly(g, [[X, y + d], [X + 30, y + d], [X + 30, 150]]);
      poly(g, [[X, y + sr], [X + 30, y + sr], [X + 30, p ? 30 : 262]]);
      line(g, X + 4, y + sr, X + 26, y + sr);
      if (p) arrowHead(g, X + 5, y + sr, "l", null, 5);
      else arrowHead(g, X + 27, y + sr, "r", null, 5);
      if (p) {
        svg("circle", { cx: X - 16, cy: y, r: 4.5, fill: "var(--screen)", stroke: "currentColor", "stroke-width": 2 }, g);
        line(g, 100, y, X - 21, y);
      } else {
        line(g, 100, y, X - 10, y);
      }
      return g;
    }
    var gp = mos(88, true), gn = mos(212, false);
    line(c, 100, 88, 100, 212);
    svg("circle", { cx: 100, cy: 150, r: 3, fill: "currentColor" }, c);
    line(c, 40, 150, 100, 150);
    svg("circle", { cx: 36, cy: 150, r: 4.5, fill: "var(--screen)", stroke: "currentColor", "stroke-width": 2 }, c);
    svg("circle", { cx: X + 30, cy: 150, r: 3, fill: "currentColor" }, c);
    line(c, X + 30, 150, 276, 150);
    svg("circle", { cx: 280, cy: 150, r: 4.5, fill: "var(--screen)", stroke: "currentColor", "stroke-width": 2 }, c);
    ground(c, X + 30, 262);
    text(c, 36, 134, tr("入力"), { anchor: "middle", fs: 12, fill: "var(--screen-muted)" });
    var tIn = text(c, 36, 176, "", { anchor: "middle", fs: 12, fill: C.vgs, cls: "mono" });
    text(c, 280, 134, tr("出力"), { anchor: "middle", fs: 12, fill: "var(--screen-muted)" });
    var tOut = text(c, 280, 176, "", { anchor: "middle", fs: 12, fill: C.vds, cls: "mono" });
    var tagP = text(c, X + 40, 93, "", { fs: 12, weight: 700 });
    var tagN = text(c, X + 40, 217, "", { fs: 12, weight: 700 });

    var g2 = svg("svg", { viewBox: "0 0 320 300", "class": "w-svg w-svg-g2", role: "img",
      "aria-label": tr("インバータの入出力特性（VIN と VOUT の関係）") }, st);
    var box = { x: 50, y: 30, w: 252, h: 214 };
    var P = new Plot(g2, box, [0, VDD], [0, VDD], { xlabel: "V_{IN} [V]", ylabel: "V_{OUT} [V]" });
    var vm = M.invVm(VDD, KP);
    line(g2, P.sx(vm), box.y, P.sx(vm), box.y + box.h, { stroke: "var(--screen-fg)", w: 1.2, dash: "3 4" });
    text(g2, P.sx(vm) + 5, box.y + 14, vfmt(vm), { fs: 11, cls: "mono" });
    svg("path", { d: P.path(function (v) { return M.invVout(v, VDD, KP); }, 0, VDD, 180), fill: "none",
      stroke: C.curves[0], "stroke-width": 2.5 }, g2);
    var dot = svg("circle", { r: 5, fill: C.id, stroke: "var(--screen)", "stroke-width": 1.5 }, g2);

    var panel = h("div", { "class": "w-panel" }, root);
    var inV = slider(panel, uid + "-vin", hs("V_{IN}"), 0, VDD, 0.01, init.vin || 0, vfmt, C.vgs);
    var ro = readouts(panel, [["vout", hs("V_{OUT}")], ["idd", tr("電源電流 ") + hs("I_{DD}")]]);
    var state = h("p", { "class": "w-region", "aria-live": "polite" }, panel);
    h("p", { "class": "w-sub" }, panel,
      tr("条件：") + hs("V_{DD}") + " = <span class=\"w-num\">" + vfmt(VDD) + tr("</span>、PMOS の W/L は NMOS の ") +
      "<span class=\"w-num\">" + M.pyG(KP / DEV.KP, 3) + tr("</span> 倍（") + hs("K_{p}") + " = <span class=\"w-num\">" +
      M.pyG(KP, 3) + tr(" mA/V²</span>、NMOS の K = <span class=\"w-num\">") + M.pyG(DEV.K, 3) + tr(" mA/V²</span>）。") +
      tr("点線は入力と出力が等しくなる点"));

    function upd() {
      var vin = Number(inV.value);
      var vout = M.invVout(vin, VDD, KP), idd = M.invIdd(vin, VDD, KP);
      var nOn = vin > DEV.VTH, pOn = VDD - vin > DEV.VTHP;      // ep01.py の「オン／オフ」の札と同じ条件
      gp.setAttribute("color", pOn ? C.pmos : C.off);
      gn.setAttribute("color", nOn ? C.nmos : C.off);
      tagP.textContent = "PMOS " + (pOn ? tr("オン") : tr("オフ"));
      tagP.setAttribute("fill", pOn ? C.pmos : "var(--screen-muted)");
      tagN.textContent = "NMOS " + (nOn ? tr("オン") : tr("オフ"));
      tagN.setAttribute("fill", nOn ? C.nmos : "var(--screen-muted)");
      tIn.textContent = vfmt(vin);
      tOut.textContent = vfmt(vout);
      dot.setAttribute("cx", P.sx(vin)); dot.setAttribute("cy", P.sy(vout));
      ro.vout.textContent = vfmt(vout);
      ro.idd.textContent = M.fmtCurrent(idd);
      var both = pOn && nOn;
      state.innerHTML = tr('<span class="w-region-l">オンのトランジスタ</span><span class="chip ') +
        (both ? "both" : pOn ? "pon" : "non") + '">' + (both ? tr("両方オン（電流が流れる）") : pOn ? tr("PMOS だけ") : tr("NMOS だけ")) + "</span>";
    }
    inV.addEventListener("input", upd);
    upd();
  }

  var KINDS = { bench: bench, transfer: transfer, output: output, inverter: inverter };

  function sceneOf(ep) {
    var el = document.querySelector('script.zw-scene[data-ep="' + ep + '"]');
    return el ? JSON.parse(el.textContent) : {};
  }

  function mountAll() {
    var list = document.querySelectorAll("figure.widget[data-widget]");
    Array.prototype.forEach.call(list, function (fig) {
      var kind = KINDS[fig.getAttribute("data-widget")];
      var mount = fig.querySelector(".w-mount");
      if (!kind || !mount || mount.getAttribute("data-ready")) return;
      try {
        mount.textContent = "";
        kind(mount, sceneOf(fig.getAttribute("data-ep")), JSON.parse(fig.getAttribute("data-init") || "{}"), fig.id);
        mount.setAttribute("data-ready", "1");
      } catch (err) {
        mount.textContent = tr("この図を表示できませんでした（") + err.message + tr("）");
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAll);
  else mountAll();
})();
