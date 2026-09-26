// Build the mailto link from data attributes so the address isn't sitting in the HTML.
document.querySelectorAll("a.email").forEach(function (a) {
  var addr = a.dataset.u + "@" + a.dataset.d;
  a.href = "mailto:" + addr;
  a.textContent = addr;
});
