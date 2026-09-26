# littleblack.fish

mu's personal site: Jekyll 4 with one small plugin (`_plugins/vault.rb`),
built and published by GitHub Actions (`.github/workflows/pages.yml`) on every
push to `main`. The repo's Settings → Pages → Source must be **GitHub Actions**;
GitHub's built-in Jekyll build would ignore the plugin.

## Writing

All the words live in `text/`, which is an Obsidian vault: open that folder
with "Open folder as vault". `text/home.md` is the intro on the home page, and
**every other note becomes its own section**: `text/reading-list.md` is served
at `/reading-list` and shows up in the nav and on the home page cards.
Delete the note and the section is gone. Every section page lists its
backlinks: the published notes that link to or embed it.

A note's settings are native Obsidian properties, all optional. Obsidian
Publish's own:

```yaml
---
publish: false                 # draft: not published at all
permalink: kyoto               # address /kyoto instead of the file name
aliases: [old capital]         # other names [[links]] can use
description: Temples and trains.  # page description (and tagline if none)
cssclasses: [wide]             # extra classes on the page
---
```

And this site's:

```yaml
---
nav: scientist                 # label in the nav (default: file name)
title: mu the scientist        # page title (default: nav)
tagline: Discovering order in nature.
color: "#0b7a75"               # accent color, light mode
color_dark: "#4fd1c5"          # accent color, dark mode
order: 1                       # position in the nav and cards (lower first)
hidden: true                   # published and linkable, but no nav entry or card
---
```

Other properties (`tags`, …) are fine; the site ignores them. Notes can live
in subfolders; pages are named after the file (or `permalink`), so keep names
unique.

Links work like in Obsidian: `[[Note]]`, `[[folder/Note]]`, `[[alias]]`,
`[[Note#Heading]]` and `[[Note|label]]`, in any capitalization, plus Markdown
links like `[label](Note.md)`. Links to notes that don't exist or aren't
published show as plain text. `![[photo.jpg]]` finds the image anywhere in the
vault, and `![[Note]]` or `![[Note#Heading]]` embeds that note (or section).
An image inside a paragraph (`... the ![[boat.jpg]] out ...`) flashes in the
reader in place of a word, then stays below it as a thumbnail; an image on a
line of its own is shown normally between readers.

The site reads the notes as they are and plays them through the RSVP reader
(`assets/js/rsvp.js`): headings and images show normally, and every paragraph,
quote and list flashes one word at a time.

Supported: `#`/`##`/`###` headings, paragraphs, `>` quotes and callouts,
lists (including tasks), **bold**, *italic*, `==highlight==`, `` `code` ``,
links, embeds on a line of their own, `---` rules, and `%% comments %%`, which
are hidden. Not supported (yet): code blocks, tables, footnotes, math.

Notes are published exactly as written, at `/text/<note>.md`. That file is the
only copy of the words: section pages are empty frames that the reader fills in
the browser. `_plugins/vault.rb` does this.

## Run locally

```sh
bundle config set --local path vendor/bundle
bundle install
bundle exec jekyll serve --livereload
```

Then open http://localhost:4000. Edits to notes (text and properties) show up on
reload. Restart the server after changing `_config.yml` or `_plugins/`.

## License

Code: MIT (`LICENSE`). Writing: CC BY 4.0 (`LICENSE-content`).
