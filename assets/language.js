/* Keep the current reading position when following a language tab. */
(function () {
  "use strict";
  function updateLanguageLinks() {
    document.querySelectorAll(".language-tabs a").forEach(function (link) {
      var target = new URL(link.href, window.location.href);
      target.hash = window.location.hash;
      link.href = target.href;
    });
  }
  updateLanguageLinks();
  window.addEventListener("hashchange", updateLanguageLinks);
  document.querySelectorAll(".language-tabs a").forEach(function (link) {
    link.addEventListener("click", function () {
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
}());
