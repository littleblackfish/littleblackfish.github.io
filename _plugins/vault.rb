# frozen_string_literal: true

require "json"
require "set"
require "uri"

# Treats text/ as an Obsidian vault, published the way Obsidian Publish would.
#
# Every published note goes out exactly as written (properties and all) at
# /text/<path>.md; that file is the only copy of its words, and the RSVP reader
# fetches it in the browser. Jekyll never renders a note itself, so notes can
# use native Obsidian properties and any characters they like.
#
# The plugin builds:
#   /<name>              an empty section page per note (file <name>.html), except home
#   site.data.notes      every published note, ordered by `order`, then name
#   /assets/vault.json   names, paths, aliases and attachments -> URLs, so the
#                        reader can resolve [[links]] and ![[embeds]] like Obsidian
#
# Attachments (images etc. in text/) are only published if a published note
# links to or embeds them, so a draft's pictures stay private too.
#
# Properties, all optional. Obsidian Publish's own:
#   publish      false = not published at all (no page, no file, links become plain text)
#   permalink    page address instead of the file name, e.g. "cv" -> /cv
#   aliases      other names [[links]] can use
#   description  meta description (and the tagline, if there is none)
#   cssclasses   extra classes on the page's <body>
# This site's:
#   nav          short label for the nav and "other" links (default: file name)
#   title        page title (default: nav)
#   tagline      one line under the title
#   color        accent color in light mode
#   color_dark   accent color in dark mode
#   order        position in the nav and on the home page (lower first)
#   hidden       true = published and linkable, but no nav entry or card
module Vault
  DIR = "text"

  class Generator < Jekyll::Generator
    safe true
    priority :lowest # after Jekyll has read every file, including attachments

    def generate(site)
      root = File.join(site.source, DIR)
      return unless File.directory?(root)

      # Jekyll has already read the notes as pages or static files; take them over.
      site.pages.reject! { |p| note?(p.relative_path) }
      site.static_files.reject! { |f| note?(f.relative_path) }

      @refs = Set.new
      notes = Dir.glob("**/*.md", :base => root).sort.filter_map do |rel|
        next if rel.split("/").any? { |part| part.start_with?(".", "_") } # .obsidian, .trash

        publish(site, root, rel)
      end
      site.static_files.reject! { |f| attachment?(f.relative_path) && !referenced?(f.relative_path) }

      site.data["notes"] = notes.sort_by { |n| [n["order"] || Float::INFINITY, n["name"].downcase] }
      site.pages << manifest(site, notes)
    end

    private

    def vault_path(path)
      path.sub(%r!\A/!, "")
    end

    def note?(path)
      vault_path(path).start_with?("#{DIR}/") && path.end_with?(".md")
    end

    def attachment?(path)
      vault_path(path).start_with?("#{DIR}/") && !path.end_with?(".md")
    end

    # Obsidian finds attachments by name or by vault path; match either.
    def referenced?(path)
      rel = vault_path(path).delete_prefix("#{DIR}/").downcase
      @refs.include?(rel) || @refs.include?(File.basename(rel))
    end

    # Files a note points at: ![[photo.jpg]], [[file.pdf]], ![](img/a.png), [x](doc.pdf).
    def collect_refs(text)
      text.scan(%r!\[\[([^\]|#]+)!).each { |(t)| add_ref(t) }
      text.scan(%r!\]\(([^)\s]+)!).each { |(t)| add_ref(t) unless t.match?(%r!\A[a-z][a-z0-9+.-]*:|\A/!i) }
    end

    def add_ref(target)
      t = (URI::DEFAULT_PARSER.unescape(target) rescue target).strip.downcase
      return if t.empty? || !t.match?(%r!\.[a-z0-9]+\z!) || t.end_with?(".md")

      @refs << t << File.basename(t)
    end

    def publish(site, root, rel)
      text = File.read(File.join(root, rel), :encoding => "UTF-8")
      props = properties(text, rel)
      return if props["publish"] == false

      collect_refs(text)
      dir = File.join(DIR, File.dirname(rel)).chomp("/.")
      file = File.basename(rel)
      name = File.basename(rel, ".md")
      site.static_files << Jekyll::StaticFile.new(site, site.source, dir, file)

      slug = props["permalink"].to_s.gsub(%r!\A/+|/+\z!, "")
      slug = name if slug.empty?
      nav = (props["nav"] || name.tr("-_", "  ")).to_s
      note = props.merge(
        "name"    => name,
        "path"    => rel.delete_suffix(".md"),
        "nav"     => nav,
        "title"   => (props["title"] || nav).to_s,
        "tagline" => props["tagline"] || props["description"],
        "aliases" => Array(props["aliases"]).map(&:to_s),
        "src"     => "/#{dir}/#{file}",
        "url"     => name == "home" ? "/" : "/#{slug}",
        "class"   => Jekyll::Utils.slugify(name)
      )

      unless name == "home"
        page = Jekyll::PageWithoutAFile.new(site, site.source, File.dirname(slug).delete_suffix("."), "#{File.basename(slug)}.html")
        page.data.merge!(
          "layout"      => "section",
          "title"       => note["title"],
          "description" => props["description"],
          "note"        => note
        )
        site.pages << page
      end
      note
    end

    # Lookup tables for the reader, keyed the way Obsidian matches links:
    # lower-cased note name, vault path or alias; attachment name or vault path.
    def manifest(site, notes)
      names = {}
      notes.each do |n|
        entry = { "url" => n["url"], "src" => n["src"], "title" => n["title"] }
        keys = [n["path"], n["name"], *n["aliases"]].map(&:downcase)
        keys.each do |k|
          if names.key?(k) && names[k]["src"] != n["src"]
            Jekyll.logger.warn "Vault:", "\"#{k}\" matches more than one note; links use #{names[k]["src"]}"
            next
          end
          names[k] = entry
        end
      end

      files = {}
      site.static_files.each do |f|
        path = vault_path(f.relative_path)
        next unless path.start_with?("#{DIR}/") && !path.end_with?(".md")

        rel = path.delete_prefix("#{DIR}/")
        url = "/#{path}"
        files[rel.downcase] = url
        files[File.basename(rel).downcase] ||= url
      end

      page = Jekyll::PageWithoutAFile.new(site, site.source, "assets", "vault.json")
      page.content = JSON.pretty_generate("notes" => names, "files" => files)
      page.data["layout"] = nil
      page.data["render_with_liquid"] = false
      page
    end

    # The note's properties block, or {} if it has none or it doesn't parse.
    def properties(text, path)
      match = text.match(%r!\A---\s*\n(.*?)\n---\s*$!m)
      return {} unless match

      data = SafeYAML.load(match[1])
      data.is_a?(Hash) ? data : {}
    rescue StandardError => e
      Jekyll.logger.warn "Vault:", "couldn't read properties of #{path}: #{e.message}"
      {}
    end
  end
end
