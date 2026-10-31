/* Language: open the English page for readers whose browser is not set to Japanese,
   and keep the current reading position when following a language tab. */
(function () {
  "use strict";
  var KEY = "zunda-lang";      // the language the reader chose with a tab ("ja" / "en")

  function stored() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function store(lang) {
    try { window.localStorage.setItem(KEY, lang); } catch (e) { /* private mode etc. */ }
  }
  function prefersJapanese() {
    var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
    return Array.prototype.some.call(langs, function (l) { return /^ja\b/i.test(l || ""); });
  }

  // An explicit ?lang= (set on the language tabs and on "Japanese only" links) wins over everything,
  // so readers whose storage is blocked can still stay on the Japanese page.
  var param = /[?&]lang=(ja|en)\b/.exec(window.location.search);
  if (param) store(param[1]);

  // Runs while <head> is parsed (the script is not deferred), before the page is drawn.
  var english = document.querySelector('link[rel="alternate"][hreflang="en"]');
  var robot = /bot|crawl|spider|slurp|inspectiontool|lighthouse|headless|facebookexternalhit/i.test(navigator.userAgent);
  if (document.documentElement.lang === "ja" && english && !robot) {
    var choice = param ? param[1] : stored();
    if (choice === "en" || (choice !== "ja" && !prefersJapanese())) {
      var target = new URL(english.getAttribute("href"), window.location.href);
      target.hash = window.location.hash;
      window.location.replace(target.href);
      return;
    }
  }

  function updateLanguageLinks() {
    document.querySelectorAll(".language-tabs a").forEach(function (link) {
      var target = new URL(link.href, window.location.href);
      target.hash = window.location.hash;
      link.href = target.href;
    });
  }
  function init() {
    updateLanguageLinks();
    window.addEventListener("hashchange", updateLanguageLinks);
    document.querySelectorAll(".language-tabs a").forEach(function (link) {
      link.addEventListener("click", function () {
        store(link.getAttribute("hreflang") || link.lang);
        var sections = Array.from(document.querySelectorAll(".sec[id]"));
        var current = sections.filter(function (section) {
          return section.getBoundingClientRect().top <= window.innerHeight * 0.4;
        }).pop();
        if (current) {
          var target = new URL(link.href, window.location.href);
          target.hash = current.id;
          link.href = target.href;
        }
      });
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
