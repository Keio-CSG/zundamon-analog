/* ずんだもんと学ぶアナログ回路：デバイスモデル（scenes/device.py の移植）。
 *
 * 定数は手で書かない。pipeline/site.py がビルド時に scenes/device.py から読み出して下の DEVICE の行を置き換える。
 * 回ごとの条件（ep01 のインバータの VDD・PMOS の K など）は scenes/epNN.py から読み、ページの JSON で渡す。
 * 単位は device.py と同じ: 電圧 [V]、電流 [mA]。
 * 照合テスト: python tests/test_model_js.py（Node で Python の値と比べる）。
 */
(function (root) {
  "use strict";
  var DEVICE = {"K": 2.0, "LAM": 0.1, "VTH": 0.4, "N_SUB": 1.5, "TEMP": 300.0, "UT": 0.025851999786435535, "S_SLOPE": 0.08928964399849758, "S_MIN": 0.05952642933233172, "KP": 1.0, "VTHP": 0.4, "LAMP": 0.1};

  /* numpy.logaddexp(0, x) と同じ分岐で ln(1 + e^x) を計算する */
  function softplus(x) {
    if (x === 0) return Math.LN2;
    return x > 0 ? x + Math.log1p(Math.exp(-x)) : Math.log1p(Math.exp(x));
  }

  /* _f(x) = ln²(1 + eˣ) */
  function f2(x) {
    var s = softplus(x);
    return s * s;
  }

  function opt(o, key, dflt) {
    return o && o[key] !== undefined ? o[key] : dflt;
  }

  /* device.drain_current(vds, vgs, vth, lam, k) [mA]（EKV 型の補間式） */
  function drainCurrent(vds, vgs, o) {
    var vth = opt(o, "vth", DEVICE.VTH), lam = opt(o, "lam", DEVICE.LAM), k = opt(o, "k", DEVICE.K);
    var a = 2 * DEVICE.N_SUB * DEVICE.UT;
    var vov = vgs - vth;
    return 0.5 * k * a * a * (f2(vov / a) - f2((vov - vds) / a)) * (1 + lam * vds);
  }

  /* device.drain_current_p(vsd, vsg, vth=VTHP, lam=LAMP, k=KP) [mA] */
  function drainCurrentP(vsd, vsg, o) {
    return drainCurrent(vsd, vsg, {
      vth: opt(o, "vth", DEVICE.VTHP), lam: opt(o, "lam", DEVICE.LAMP), k: opt(o, "k", DEVICE.KP)
    });
  }

  /* device.solve：f(lo)·f(hi) < 0 の区間で二分法 */
  function solve(f, lo, hi, tol) {
    if (tol === undefined) tol = 1e-10;
    var flo = f(lo);
    for (var i = 0; i < 200; i++) {
      var mid = 0.5 * (lo + hi);
      var fm = f(mid);
      if ((fm > 0) === (flo > 0)) { lo = mid; flo = fm; } else { hi = mid; }
      if (hi - lo < tol) break;
    }
    return 0.5 * (lo + hi);
  }

  /* scenes/ep01.py の inv_vout / inv_idd と同じ（vdd = VDD、kp = KP_INV を渡す） */
  function invVout(vin, vdd, kp) {
    return solve(function (vo) {
      return drainCurrent(vo, vin) - drainCurrentP(vdd - vo, vdd - vin, { k: kp });
    }, 0.0, vdd);
  }

  function invIdd(vin, vdd, kp) {
    return drainCurrent(invVout(vin, vdd, kp), vin);
  }

  /* 入力と出力が等しくなる点（ep01.py の VM） */
  function invVm(vdd, kp) {
    return solve(function (v) { return invVout(v, vdd, kp) - v; }, 0.0, vdd);
  }

  /* 動作領域（ep01 のまとめの表と同じ条件） */
  function region(vgs, vds, vth) {
    if (vth === undefined) vth = DEVICE.VTH;
    if (vgs < vth) return "cutoff";
    return vds < vgs - vth ? "linear" : "sat";
  }

  /* Python の format(x, ".{p}g") と同じ文字列（正の有限値・0 を想定） */
  function pyG(x, p) {
    if (x === 0) return "0";
    var neg = x < 0;
    var ax = Math.abs(x);
    var e = Number(ax.toExponential(p - 1).split("e")[1]);
    var s;
    if (e < -4 || e >= p) {
      var parts = ax.toExponential(p - 1).split("e");
      var m = parts[0];
      if (m.indexOf(".") >= 0) m = m.replace(/0+$/, "").replace(/\.$/, "");
      var ex = Number(parts[1]);
      s = m + "e" + (ex < 0 ? "-" : "+") + (Math.abs(ex) < 10 ? "0" : "") + Math.abs(ex);
    } else {
      s = ax.toFixed(Math.max(0, p - 1 - e));
      if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    }
    return (neg ? "-" : "") + s;
  }

  /* Python の f"{x:.{d}f}"。どちらも2進値の正確な10進展開で丸める
   * （違うのは 0.125 のようにちょうど中間の値だけ: Python は偶数丸め、toFixed は切り上げ） */
  function pyF(x, d) {
    return x.toFixed(d);
  }

  /* scenes/kit.py の fmt_current と同じ規則 */
  function fmtCurrent(iMa) {
    if (iMa >= 0.01 || iMa < 1e-10) return pyF(iMa, 2) + " mA";
    var units = [["µA", 1e-3], ["nA", 1e-6], ["pA", 1e-9]];
    for (var i = 0; i < units.length; i++) {
      if (iMa >= units[i][1]) return pyG(iMa / units[i][1], 3) + " " + units[i][0];
    }
    return pyG(iMa / 1e-9, 3) + " pA";
  }

  /* scenes/kit.py の fmt（負号は −） */
  function fmtV(v, digits) {
    if (digits === undefined) digits = 2;
    v = Math.abs(v) < 0.5 * Math.pow(10, -digits) ? 0.0 : v;
    return pyF(v, digits).replace("-", "−");
  }

  var api = {
    DEVICE: DEVICE,
    drainCurrent: drainCurrent, drainCurrentP: drainCurrentP, solve: solve,
    invVout: invVout, invIdd: invIdd, invVm: invVm, region: region,
    fmtCurrent: fmtCurrent, fmtV: fmtV, pyG: pyG
  };
  root.ZModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
