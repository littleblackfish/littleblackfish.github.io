// Spritz-style RSVP reader. Any element with data-src="/text/<note>.md" is filled
// from that Markdown note: headings, images and rules render normally, while
// paragraphs, quotes and lists are never shown whole. They flash one word at a
// time, with the pivot letter pinned to the center.
//
//   mouse:     hover to read, leave to pause; click the bar to jump
//   touch:     tap to read / pause
//   keyboard:  focus to read; space pause, ← → sentence, + − speed, Home restart
(function () {
  var md = window.LBFMarkdown;
  var containers = document.querySelectorAll("[data-src]");
  if (!md || !containers.length) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var touch = window.matchMedia("(hover: none)").matches;
  var WPM_KEY = "rsvp-wpm";
  var MIN_WPM = 100;
  var MAX_WPM = 900;
  var readers = [];
  var wpm = loadWpm() || (reduceMotion ? 250 : 350);

  // How the visitor last interacted, so focus only auto-plays for keyboard users.
  var lastInput = "mouse";
  document.addEventListener("pointerdown", function (e) { lastInput = e.pointerType; }, true);
  document.addEventListener("keydown", function () { lastInput = "keyboard"; }, true);

  function loadWpm() {
    try { return parseInt(localStorage.getItem(WPM_KEY), 10) || 0; } catch (e) { return 0; }
  }

  function setWpm(v) {
    wpm = Math.max(MIN_WPM, Math.min(MAX_WPM, v));
    try { localStorage.setItem(WPM_KEY, String(wpm)); } catch (e) { /* private mode */ }
    readers.forEach(function (r) { r.refresh(); });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function isExternal(href) {
    return /^([a-z]+:)?\/\//i.test(href) && href.indexOf(location.host) === -1;
  }

  function link(href, text) {
    var a = el("a", null, text);
    a.href = href;
    if (isExternal(href)) { a.target = "_blank"; a.rel = "noopener"; }
    return a;
  }

  // Runs -> real inline HTML (headings, and the screen-reader copy of each block).
  function renderRuns(parent, runs, focusable) {
    runs.forEach(function (r) {
      if (r.image) {
        var img = el("img");
        img.src = r.image;
        img.alt = r.text;
        parent.appendChild(img);
        return;
      }
      var node = r.href ? link(r.href, r.text) : r.strong ? el("strong", null, r.text) :
        r.em ? el("em", null, r.text) : r.code ? el("code", null, r.text) : document.createTextNode(r.text);
      if (r.href && !focusable) node.tabIndex = -1;
      parent.appendChild(node);
    });
    return parent;
  }

  /* ---------- words ---------- */

  // Spritz's pivot: roughly a third of the way into the word.
  function pivot(len) {
    if (len <= 1) return 0;
    if (len <= 5) return 1;
    if (len <= 9) return 2;
    if (len <= 13) return 3;
    return 4;
  }

  function letters(w) {
    return w.replace(/[^\p{L}\p{N}]/gu, "").length;
  }

  function breakAfter(w) {
    if (/[.!?…]['"”’)\]]*$/.test(w)) return "sentence";
    if (/[,;:—–]['"”’)\]]*$/.test(w) || w === "-") return "clause";
    return null;
  }

  // Runs -> [{w, href, label, strong, em, code}], joining runs that touch ("**bold**,").
  function words(runs) {
    var out = [];
    var open = null;
    runs.forEach(function (r) {
      if (r.image) {
        // An inline image is a token of its own; it flashes in place of a word.
        out.push({ w: "", image: r.image, alt: r.text });
        open = null;
        return;
      }
      r.text.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { open = null; return; }
        if (open) { open.w += part; return; }
        open = { w: part, href: r.href, label: r.href ? r.text.trim() : null,
          strong: r.strong, em: r.em, code: r.code };
        out.push(open);
      });
    });
    return out;
  }

  // Where to cut near `k`: after a vowel, before a consonant ("electro|physiology").
  function cutNear(w, k) {
    for (var off = 0; off <= 3; off++) {
      for (var c = k - off; c <= k + off; c += off || 1) {
        if (c > 2 && c < w.length - 3 && /[aeiou]/i.test(w[c - 1]) && /[b-df-hj-np-tv-z]/i.test(w[c])) return c;
      }
    }
    return k;
  }

  // Break words longer than 13 letters into hyphenated pieces of about 9.
  function split(t) {
    var n = letters(t.w);
    if (n <= 13) return [t];
    var pieces = [];
    var rest = t.w;
    while (letters(rest) > 13) {
      var parts = Math.ceil(letters(rest) / 9);
      var k = cutNear(rest, Math.round(rest.length / parts));
      pieces.push(rest.slice(0, k));
      rest = rest.slice(k);
    }
    pieces.push(rest);
    return pieces.map(function (p, idx) {
      var last = idx === pieces.length - 1;
      return Object.assign({}, t, { w: last ? p : p + "-", brk: last ? t.brk : null });
    });
  }

  // All the text blocks of one section, as a single stream of words.
  function tokensFor(blocks) {
    var tokens = [];
    blocks.forEach(function (block, b) {
      var groups = block.type === "list" ? block.items : [block.runs];
      groups.forEach(function (runs, item) {
        var ws = words(runs);
        ws.forEach(function (t, idx) {
          t.brk = breakAfter(t.w);
          if (block.type === "quote") t.em = true;
          if (block.type === "list") {
            t.item = item;
            t.items = block.items.length;
            if (idx === ws.length - 1) t.brk = "item";
          }
          tokens.push.apply(tokens, split(t));
        });
      });
      if (tokens.length && b < blocks.length - 1) tokens[tokens.length - 1].brk = "para";
    });
    tokens.forEach(function (t) { t.len = letters(t.w); });
    return tokens;
  }

  function plain(runs) {
    return runs.map(function (r) { return r.text; }).join("").trim();
  }

  var RAMP = [1.8, 1.4, 1.15];

  function delay(t, ramp) {
    // Images get a beat to be seen: ~1.5 s at 350 wpm, never under a second.
    if (t.image) return Math.max(1000, 60000 / wpm * 9);
    var d = 60000 / wpm;
    if (t.len > 8) d *= 1.2;
    if (t.len > 11) d *= 1.25;
    if (t.brk === "clause") d *= 1.8;
    else if (t.brk === "sentence") d *= 2.6;
    else if (t.brk === "item") d *= 3;
    else if (t.brk === "para") d *= 3.4;
    if (ramp < RAMP.length) d *= RAMP[ramp];
    return d;
  }

  function duration(tokens) {
    var s = tokens.reduce(function (sum, t) { return sum + delay(t, 99); }, 0) / 1000;
    return s < 60 ? "~" + Math.max(1, Math.round(s)) + " s" : "~" + Math.round(s / 60) + " min";
  }

  /* ---------- one reader per section ---------- */

  // section: {heading: heading block or null, blocks: [para | quote | list], anchor: bool}
  function Reader(section) {
    var heading = section.heading;
    var blocks = section.blocks;
    var tokens = tokensFor(blocks);
    var n = tokens.length;
    var starts = [0];  // sentence / item starts, for seeking
    tokens.forEach(function (t, k) { if (t.brk && t.brk !== "clause" && k + 1 < n) starts.push(k + 1); });

    var onlyQuotes = blocks.every(function (b) { return b.type === "quote"; });
    var root = el("div", "rsvp" + (onlyQuotes && !heading ? " rsvp-quote" : ""));
    if (heading && section.anchor) root.id = heading.id;
    root.tabIndex = 0;
    root.setAttribute("role", "group");
    root.setAttribute("aria-roledescription", "speed reader");

    // Screen readers get the real heading and text.
    var sr = el("div", "sr-only");
    if (heading) sr.appendChild(renderRuns(el("h" + Math.max(2, heading.level)), heading.runs));
    blocks.forEach(function (block) {
      if (block.type === "list") {
        var list = el(block.ordered ? "ol" : "ul");
        block.items.forEach(function (runs) { list.appendChild(renderRuns(el("li"), runs)); });
        sr.appendChild(list);
      } else {
        sr.appendChild(renderRuns(el(block.type === "quote" ? "blockquote" : "p"), block.runs));
      }
    });

    var stage = el("div", "rsvp-stage");
    stage.setAttribute("aria-hidden", "true");
    var word = el("div", "rsvp-word");
    var left = el("span", "rsvp-l");
    var mid = el("span", "rsvp-p");
    var right = el("span", "rsvp-r");
    word.append(left, mid, right);
    // At rest the stage shows the section title, with how to read it underneath.
    var hint = el("div", "rsvp-hint");
    if (heading) hint.appendChild(el("span", "rsvp-title", plain(heading.runs)));
    var when = el("span", "rsvp-when");
    hint.appendChild(when);
    var meta = el("div", "rsvp-meta");
    var speed = el("div", "rsvp-speed");
    var slower = el("button", null, "−");
    var rate = el("span");
    var faster = el("button", null, "+");
    slower.type = faster.type = "button";
    slower.tabIndex = faster.tabIndex = -1;
    speed.append(slower, rate, faster);
    var bar = el("div", "rsvp-bar");
    bar.appendChild(el("span"));
    var pic = el("div", "rsvp-pic");
    var picImg = el("img");
    pic.appendChild(picImg);
    stage.append(word, hint, pic, meta, speed, bar);

    // Load the section's images up front so they flash in without a delay.
    tokens.forEach(function (t) { if (t.image) new Image().src = t.image; });

    // Links are revealed as chips once their words have flashed by.
    var chips = el("div", "rsvp-links");
    var revealed = {};

    root.append(sr, stage, chips);

    function reveal(href, label) {
      if (revealed[href]) return;
      revealed[href] = true;
      chips.appendChild(link(href, label));
    }

    // Images, like links, stay behind as a thumbnail once they've been shown.
    function revealImage(src, alt) {
      if (revealed["img:" + src]) return;
      revealed["img:" + src] = true;
      var a = link(src, "");
      a.className = "rsvp-thumb";
      a.target = "_blank";
      var img = el("img");
      img.src = src;
      img.alt = alt;
      a.appendChild(img);
      chips.appendChild(a);
    }

    // The title is shown whole, so links in it are available straight away.
    if (heading) heading.runs.forEach(function (r) { if (r.href) reveal(r.href, r.text.trim()); });

    var i = 0;        // next token to show
    var cur = -1;     // token on screen
    var ramp = 0;
    var timer = null;
    var playing = false;

    function setProgress(p) {
      bar.style.setProperty("--p", p);
    }

    function show(k) {
      var t = tokens[k];
      root.classList.toggle("showing-image", !!t.image);
      if (t.image) {
        root.classList.remove("gap");
        picImg.src = t.image;
        picImg.alt = t.alt;
        left.textContent = mid.textContent = right.textContent = "";
        setProgress((k + 1) / n);
        revealImage(t.image, t.alt);
        cur = k;
        return;
      }
      var p = pivot(t.len);
      var lead = t.w.length - t.w.replace(/^[^\p{L}\p{N}]+/u, "").length;
      var at = Math.min(t.w.length - 1, lead + p);
      root.classList.remove("gap");
      left.textContent = t.w.slice(0, at);
      mid.textContent = t.w.charAt(at);
      right.textContent = t.w.slice(at + 1);
      word.className = "rsvp-word" + (t.strong ? " strong" : "") + (t.em ? " em" : "") +
        (t.code ? " code" : "") + (t.href ? " link" : "");
      meta.textContent = t.item != null ? t.item + 1 + " / " + t.items : "";
      setProgress((k + 1) / n);
      if (t.href) reveal(t.href, t.label);
      cur = k;
    }

    function tick() {
      if (i >= n) {
        // Blank beat, then go round again.
        i = 0;
        ramp = 0;
        root.classList.add("gap");
        setProgress(0);
        timer = setTimeout(tick, 1400);
        return;
      }
      show(i);
      timer = setTimeout(tick, delay(tokens[i++], ramp++));
    }

    function sentenceStart(k) {
      var s = 0;
      starts.forEach(function (x) { if (x <= k) s = x; });
      return s;
    }

    function play() {
      if (playing || !n) return;
      playing = true;
      root.classList.add("playing");
      root.classList.remove("peek");
      // Resuming mid-text: back up to the sentence start, or a few words.
      if (i > 0 && i < n) {
        var s = sentenceStart(i - 1);
        i = i - 1 - s <= 8 ? s : Math.max(s, i - 4);
      }
      ramp = 0;
      tick();
    }

    function pause() {
      clearTimeout(timer);
      timer = null;
      playing = false;
      root.classList.remove("playing");
    }

    function seek(k) {
      i = Math.max(0, Math.min(n - 1, k));
      if (playing) {
        clearTimeout(timer);
        ramp = 0;
        tick();
      } else {
        show(i);
        root.classList.add("peek");
      }
    }

    function back() {
      var here = cur < 0 ? 0 : cur;
      var s = sentenceStart(here);
      seek(here - s < 2 ? sentenceStart(Math.max(0, s - 1)) : s);
    }

    function forward() {
      var here = cur < 0 ? 0 : cur;
      for (var k = 0; k < starts.length; k++) if (starts[k] > here) return seek(starts[k]);
    }

    this.refresh = function () {
      rate.textContent = wpm + " wpm";
      when.textContent = (touch ? "tap to read" : "hover to read") + " · " + duration(tokens);
    };
    this.pause = pause;
    this.el = root;
    this.refresh();

    root.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") play(); });
    root.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") pause(); });
    stage.addEventListener("click", function () {
      if (lastInput !== "mouse") (playing ? pause : play)();
    });
    root.addEventListener("focus", function () { if (lastInput === "keyboard") play(); });
    root.addEventListener("blur", function (e) {
      if (!root.contains(e.relatedTarget) && !root.matches(":hover")) pause();
    });
    // Keep focus on the reader when the speed buttons are clicked.
    [slower, faster].forEach(function (b) {
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    });

    bar.addEventListener("click", function (e) {
      e.stopPropagation();
      var r = bar.getBoundingClientRect();
      seek(sentenceStart(Math.floor((e.clientX - r.left) / r.width * n)));
    });
    slower.addEventListener("click", function (e) { e.stopPropagation(); setWpm(wpm - 25); });
    faster.addEventListener("click", function (e) { e.stopPropagation(); setWpm(wpm + 25); });

    root.addEventListener("keydown", function (e) {
      var handled = true;
      switch (e.key) {
        case " ": case "Enter": (playing ? pause : play)(); break;
        case "ArrowLeft": back(); break;
        case "ArrowRight": forward(); break;
        case "+": case "=": setWpm(wpm + 25); break;
        case "-": case "_": setWpm(wpm - 25); break;
        case "Home": seek(0); break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    });
  }

  /* ---------- page ---------- */

  // The blocks of one heading's section, for ![[note#heading]].
  function sectionOf(blocks, anchor) {
    var id = md.slugify(anchor);
    var start = -1;
    for (var k = 0; k < blocks.length; k++) {
      if (start < 0 && blocks[k].type === "heading" && blocks[k].id === id) start = k;
      else if (start >= 0 && blocks[k].type === "heading" && blocks[k].level <= blocks[start].level) break;
    }
    return start < 0 ? blocks : blocks.slice(start, k);
  }

  function fetchNote(src) {
    return fetch(src, { cache: "no-cache" }).then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.text();
    });
  }

  // ![[note]]: the embedded note's readers inside a frame that links to it.
  // `chain` is the notes already being shown, so notes can't embed each other forever.
  function embed(b, vault, chain) {
    var box = el("div", "embed");
    var source = link(b.anchor ? b.note.url + "#" + md.slugify(b.anchor) : b.note.url,
      (b.note.title || "") + (b.anchor ? " › " + b.anchor : ""));
    source.className = "embed-source";
    var inner = el("div");
    box.append(source, inner);
    if (chain.length < 3 && chain.indexOf(b.note.src) < 0) {
      fetchNote(b.note.src).then(function (src) {
        var blocks = md.parse(src, vault);
        render(inner, b.anchor ? sectionOf(blocks, b.anchor) : blocks, vault, chain.concat(b.note.src));
      }).catch(function () { box.remove(); });
    }
    return box;
  }

  // Each heading and the text under it become one reader, titled by the heading.
  // Images, embeds and rules sit between readers; text after them continues the section.
  function render(container, blocks, vault, chain) {
    container.textContent = "";
    var section = null;

    function flush() {
      if (!section) return;
      if (section.blocks.length) {
        var r = new Reader(section);
        readers.push(r);
        container.appendChild(r.el);
      } else if (section.heading && section.anchor) {
        // A heading with nothing under it stays a plain heading.
        var h = renderRuns(el("h" + Math.max(2, section.heading.level)), section.heading.runs, true);
        h.id = section.heading.id;
        container.appendChild(h);
      }
      section = null;
    }

    blocks.forEach(function (b) {
      if (b.type === "heading") {
        flush();
        section = { heading: b, blocks: [], anchor: true };
        return;
      }
      if (b.type !== "rule" && b.type !== "image" && b.type !== "embed") {
        if (!section) section = { heading: null, blocks: [], anchor: false };
        section.blocks.push(b);
        return;
      }
      var carry = section && section.heading;
      flush();
      if (b.type === "rule") {
        container.appendChild(el("hr"));
      } else if (b.type === "embed") {
        container.appendChild(embed(b, vault, chain));
      } else if (b.type === "image") {
        var fig = el("figure");
        var img = el("img");
        img.src = b.src;
        img.alt = b.alt;
        img.loading = "lazy";
        fig.appendChild(img);
        container.appendChild(fig);
      }
      if (carry) section = { heading: carry, blocks: [], anchor: false };
    });
    flush();
    if (chain.length === 1 && location.hash) {
      var target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) target.scrollIntoView();
    }
  }

  // Names, aliases and attachments -> URLs, for resolving links like Obsidian does.
  var vaultIndex = fetch("/assets/vault.json", { cache: "no-cache" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .catch(function () { return null; });

  containers.forEach(function (c) {
    Promise.all([vaultIndex, fetchNote(c.dataset.src)])
      .then(function (r) { render(c, md.parse(r[1], r[0]), r[0], [c.dataset.src]); })
      .catch(function () {
        c.textContent = "";
        var p = el("p", "rsvp-error", "The fish lost this text. ");
        p.appendChild(link(c.dataset.src, "Read the plain file"));
        c.appendChild(p);
      });
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) readers.forEach(function (r) { r.pause(); });
  });
})();
