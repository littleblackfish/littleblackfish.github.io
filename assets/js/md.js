// A small Markdown parser for the notes in text/ (an Obsidian vault).
// It only understands what the RSVP reader needs: headings, paragraphs, quotes
// (and callouts), lists, images, note embeds, rules, links, [[wikilinks]] and
// emphasis. Output is a list of blocks; inline text is a list of runs:
//   {text, href, strong, em, code}, or {image, text: alt} for an inline image
//
// Links resolve like Obsidian's when given the vault index (/assets/vault.json,
// built by _plugins/vault.rb): case-insensitive, by note name, vault path or
// alias. Links to notes that aren't published come out as plain text.
(function (root) {
  var TEXT_ROOT = "/text/";
  var IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;
  var EXTERNAL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

  function slugify(s) {
    return s.trim().toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-");
  }

  // The note a link points at: {url, src, title}, or null if it isn't published.
  // Without an index, falls back to guessing /<name>.
  function noteFor(target, vault) {
    var key = target.trim().replace(/\.md$/i, "").toLowerCase();
    if (!vault) {
      var name = target.trim().replace(/\.md$/i, "").split("/").pop();
      return { url: /^(home|index)$/i.test(name) ? "/" : "/" + encodeURIComponent(name), src: TEXT_ROOT + name + ".md" };
    }
    return vault.notes[key] || vault.notes[key.split("/").pop()] || null;
  }

  // An attachment's URL; Obsidian finds attachments by name anywhere in the vault.
  function fileFor(path, vault) {
    if (EXTERNAL.test(path) || path.charAt(0) === "/") return path;
    path = decodeURI(path).trim();
    if (!vault) return TEXT_ROOT + encodeURI(path);
    var key = path.toLowerCase();
    var url = vault.files[key] || vault.files[key.split("/").pop()];
    return url ? encodeURI(url) : null;
  }

  function noteHref(note, anchor) {
    // Block references (#^abc) have no anchors here; just open the note.
    return anchor && anchor.charAt(0) !== "^" ? note.url + "#" + slugify(anchor) : note.url;
  }

  var INLINE = new RegExp([
    /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/.source,   // 1-2 embed ![[x|alt]]
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.source,          // 3-4 image ![alt](x)
    /\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]+))?\]\]/.source, // 5-7 wikilink
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.source,          // 8-9 link
    /\*\*(.+?)\*\*/.source,                                      // 10 strong
    /__(.+?)__/.source,                                          // 11 strong
    /\*([^*\s](?:[^*]*[^*\s])?)\*/.source,                       // 12 em
    /(?<![\p{L}\p{N}])_([^_\s](?:[^_]*[^_\s])?)_(?![\p{L}\p{N}])/.source, // 13 em
    /==(.+?)==/.source,                                          // 14 highlight
    /`([^`]+)`/.source                                           // 15 code
  ].join("|"), "gu");

  // An inline image run, or null if the file isn't there. Obsidian's ![[x|300]]
  // sizes aren't alt text.
  function imageRun(target, alt, vault) {
    var src = IMAGE.test(target.trim()) && fileFor(target, vault);
    return src ? { image: src, text: alt && !/^\d+(x\d+)?$/.test(alt) ? alt : "" } : null;
  }

  function inline(text, vault) {
    var runs = [];
    var last = 0;
    var m;
    INLINE.lastIndex = 0;
    while ((m = INLINE.exec(text))) {
      if (m.index > last) runs.push({ text: text.slice(last, m.index) });
      var img = m[1] ? imageRun(m[1], m[2], vault) : m[4] ? imageRun(m[4], m[3], vault) : null;
      if (img) {
        runs.push(img);
      } else if (m[1] || m[4]) {
        // Not an image (or not found): an inline note embed reads as a link to it.
        var embedded = m[1] && noteFor(m[1], vault);
        if (embedded) runs.push({ text: embedded.title || m[1], href: embedded.url });
      } else if (m[5]) {
        var label = m[7] || (m[6] ? m[5] + " › " + m[6] : m[5]);
        var note = noteFor(m[5], vault);
        runs.push(note ? { text: label, href: noteHref(note, m[6]) } : { text: label });
      } else if (m[8]) {
        runs.push({ text: m[8], href: linkHref(m[9], vault) });
      } else if (m[10] || m[11] || m[14]) {
        runs.push({ text: m[10] || m[11] || m[14], strong: true });
      } else if (m[12] || m[13]) {
        runs.push({ text: m[12] || m[13], em: true });
      } else if (m[15]) {
        runs.push({ text: m[15], code: true });
      }
      last = INLINE.lastIndex;
    }
    if (last < text.length) runs.push({ text: text.slice(last) });
    return runs;
  }

  // [text](target): web links as they are; anything else is a note or file in the vault.
  function linkHref(target, vault) {
    if (EXTERNAL.test(target) || /^[\/#]/.test(target)) return target;
    var parts = decodeURI(target).split("#");
    if (/\.[a-z0-9]+$/i.test(parts[0]) && !/\.md$/i.test(parts[0])) return fileFor(parts[0], vault) || undefined;
    var note = noteFor(parts[0], vault);
    return note ? noteHref(note, parts[1]) : undefined;
  }

  var HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
  var RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
  var WIKI_EMBED = /^\s*!\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]\s*$/;
  var MD_IMAGE = /^\s*!\[([^\]]*)\]\(([^)\s]+)[^)]*\)\s*$/;
  var QUOTE = /^\s*>\s?(.*)$/;
  var ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;

  function startsBlock(line) {
    return HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line) ||
      WIKI_EMBED.test(line) || MD_IMAGE.test(line);
  }

  function parse(src, vault) {
    src = src.replace(/\r\n?/g, "\n")
      .replace(/^---\n[\s\S]*?\n---\n/, "")  // properties, if any slipped in
      .replace(/%%[\s\S]*?%%/g, "")          // Obsidian comments
      .replace(/<!--[\s\S]*?-->/g, "");      // HTML comments
    var lines = src.split("\n");
    var blocks = [];
    var i = 0;
    var m;

    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) { i++; continue; }

      if ((m = line.match(HEADING))) {
        blocks.push({ type: "heading", level: m[1].length, id: slugify(m[2]), runs: inline(m[2], vault) });
        i++;
      } else if (RULE.test(line)) {
        blocks.push({ type: "rule" });
        i++;
      } else if ((m = line.match(WIKI_EMBED))) {
        // ![[photo.jpg|300]] is an image; ![[note]] or ![[note#heading]] embeds that note.
        var target = m[1].trim();
        if (IMAGE.test(target)) {
          var src = fileFor(target, vault);
          if (src) blocks.push({ type: "image", src: src, alt: m[3] && !/^\d+(x\d+)?$/.test(m[3]) ? m[3] : "" });
        } else {
          var embedded = noteFor(target, vault);
          if (embedded) blocks.push({ type: "embed", note: embedded, anchor: m[2] && m[2].charAt(0) !== "^" ? m[2] : null });
        }
        i++;
      } else if ((m = line.match(MD_IMAGE))) {
        var img = fileFor(m[2], vault);
        if (img) blocks.push({ type: "image", src: img, alt: m[1] });
        i++;
      } else if (QUOTE.test(line)) {
        var q = [];
        while (i < lines.length && (m = lines[i].match(QUOTE))) { q.push(m[1]); i++; }
        // Callouts: drop the "[!note] " marker, keep any title.
        var text = q.join(" ").replace(/^\s*\[!\w+\][+-]?\s*/, "").trim();
        if (text) blocks.push({ type: "quote", runs: inline(text, vault) });
      } else if ((m = line.match(ITEM))) {
        var ordered = /\d/.test(m[1]);
        var items = [];
        while (i < lines.length && lines[i].trim()) {
          if ((m = lines[i].match(ITEM))) {
            items.push(m[2].replace(/^\[[ xX]\]\s+/, ""));  // task checkboxes
          } else if (startsBlock(lines[i])) {
            break;
          } else {
            items[items.length - 1] += " " + lines[i].trim();
          }
          i++;
        }
        blocks.push({ type: "list", ordered: ordered, items: items.map(function (t) { return inline(t, vault); }) });
      } else {
        var para = [];
        while (i < lines.length && lines[i].trim() && (!para.length || !startsBlock(lines[i]))) {
          para.push(lines[i].trim());
          i++;
        }
        blocks.push({ type: "para", runs: inline(para.join(" "), vault) });
      }
    }
    return blocks;
  }

  var api = { parse: parse, inline: inline, slugify: slugify };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LBFMarkdown = api;
})(this);
