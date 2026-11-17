// Obsidian-flavoured Markdown for real notes (spec 5.9): headings, lists and tasks, tables, quotes,
// callouts (foldable), code, frontmatter as properties, [[wikilinks]] with alias and heading,
// ![[embeds]], ==highlights==, ~~strike~~, footnotes, %% comments %%, ^block ids, $math$ and mermaid.
// Plain function, no DOM: math, mermaid and embeds come out as placeholders that hydrate() fills in.
// Unknown syntax stays visible as text: nothing is lost or rewritten.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escHtml = s => String(s).replace(/[&<>"']/g, c => ESC[c]);
export const slug = s => String(s).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");

/** Frontmatter: simple YAML (key: value, lists with "- " or [a, b]). Returns { props, body }. */
export function frontmatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { props: null, body: src };
  const props = []; let cur = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([^\s:#][^:]*):\s*(.*)$/.exec(line);
    if (kv) { let v = kv[2].trim(); if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(",").map(x => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean); else v = v.replace(/^["']|["']$/g, ""); cur = { key: kv[1].trim(), value: v }; props.push(cur); continue; }
    const li = /^\s*-\s+(.*)$/.exec(line);
    if (li && cur) { if (!Array.isArray(cur.value)) cur.value = cur.value ? [cur.value] : []; cur.value.push(li[1].trim().replace(/^["']|["']$/g, "")); }
  }
  return { props, body: src.slice(m[0].length) };
}

/** Tags of a note: #tags in the text (not in code) plus frontmatter tags. Lower-case, without '#'. */
export function noteTags(src) {
  const { props, body } = frontmatter(String(src || ""));
  const out = new Set();
  const fm = props && props.find(p => /^tags?$/i.test(p.key));
  if (fm) for (const v of [].concat(fm.value)) for (const x of String(v).split(/[\s,]+/)) if (x) out.add(x.replace(/^#/, "").toLowerCase());
  const text = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "").replace(/%%[\s\S]*?%%/g, "");
  for (const m of text.matchAll(/(^|[\s(])#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu)) out.add(m[2].toLowerCase());
  return [...out];
}

/** Headings of a note for the outline: [{ level, text, id }] */
export function headings(src) {
  const { body } = frontmatter(String(src || ""));
  const out = []; let code = false;
  for (const l of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(l)) { code = !code; continue; }
    const m = !code && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) out.push({ level: m[1].length, text: m[2], id: slug(m[2]) });
  }
  return out;
}

const CALLOUT_ICON = { note: "✎", info: "ℹ", tip: "💡", hint: "💡", important: "❗", success: "✓", check: "✓", done: "✓", question: "?", help: "?", faq: "?", warning: "⚠", caution: "⚠", attention: "⚠", failure: "✗", fail: "✗", missing: "✗", danger: "⚡", error: "⚡", bug: "🐞", example: "▤", quote: "❝", cite: "❝", abstract: "≡", summary: "≡", tldr: "≡", todo: "☐" };

/**
 * opts.resolve(name) → attribute string for a [[link]] target ('' = not found)
 * opts.t(key) → UI text (properties, footnotes)
 */
export function renderMarkdown(src, opts = {}) {
  const resolve = opts.resolve || (() => "");
  const t = opts.t || (k => k);
  const notes = [];   // footnote definitions in order
  const fnIndex = new Map();
  const { props, body: body0 } = frontmatter(String(src || "").replace(/\r\n/g, "\n"));
  // block comments %% … %% (may span lines) are not shown
  const body = body0.replace(/%%[\s\S]*?%%/g, "");
  const lines = body.split("\n");

  // footnote definitions first, so references can number them
  const defs = new Map();
  for (const l of lines) { const m = /^\[\^([^\]]+)\]:\s?(.*)$/.exec(l); if (m) defs.set(m[1], m[2]); }

  const math = s => `<span class="math" data-tex="${escHtml(s)}">${escHtml(s)}</span>`;
  function inline(s) {
    // protect code spans and inline math first
    const keep = [];
    const hold = h => { keep.push(h); return `\u0000${keep.length - 1}\u0000`; };
    s = s.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${escHtml(c)}</code>`));
    s = s.replace(/(^|[^\\$])\$([^$\n]+?)\$(?!\d)/g, (_, a, m) => a + hold(math(m)));
    // embeds and wikilinks
    s = s.replace(/!\[\[([^\]|#^]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, n, h, al) => hold(`<span class="embed" data-embed="${escHtml(n.trim())}"${h ? ` data-sub="${escHtml(h.slice(1))}"` : ""}${al && /^\d+(x\d+)?$/.test(al) ? ` data-size="${escHtml(al)}"` : ""}>${escHtml(n.trim())}</span>`));
    s = s.replace(/\[\[([^\]|#^]*)(#\^?[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, n, h, al) => {
      const name = n.trim(), at = name ? resolve(name) : "";
      const label = al || (name ? name + (h ? " › " + h.slice(1).replace(/^\^/, "") : "") : (h || "").slice(1));
      return hold(`<span class="wl${at || !name ? "" : " miss"}"${at}${h ? ` data-heading="${escHtml(slug(h.slice(1).replace(/^\^/, "")))}"` : ""}>${escHtml(label)}</span>`);
    });
    // markdown images and links (links are shown, not followed inside the app)
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, u) => hold(/^https?:/i.test(u) ? `<span class="extimg" title="${escHtml(u)}">🖼 ${escHtml(alt || u)}</span>` : `<span class="embed" data-embed="${escHtml(decodeURI(u).split("/").pop())}">${escHtml(alt || u)}</span>`));
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, txt, u) => hold(`<a class="ext" data-href="${escHtml(u)}" title="${escHtml(u)}">${escHtml(txt)}</a>`));
    s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_, u) => hold(`<a class="ext" data-href="${escHtml(u)}" title="${escHtml(u)}">${escHtml(u)}</a>`));
    // footnote references
    s = s.replace(/\[\^([^\]]+)\]/g, (m, id) => { if (!defs.has(id)) return m; if (!fnIndex.has(id)) { fnIndex.set(id, fnIndex.size + 1); notes.push(id); } const n = fnIndex.get(id); return hold(`<sup class="fn"><a data-fn="${n}">${n}</a></sup>`); });
    // block id at the end of a line
    s = s.replace(/\s\^([A-Za-z0-9-]+)\s*$/, (_, id) => hold(`<span class="bid" id="^${escHtml(id)}"></span>`));
    s = escHtml(s);
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "<b><i>$1</i></b>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/__([^_]+)__/g, "<b>$1</b>")
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<i>$2</i>").replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<i>$2</i>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>").replace(/==([^=]+)==/g, "<mark>$1</mark>")
      .replace(/(^|[\s(])#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu, '$1<span class="tagc" data-tag="$2">#$2</span>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);
  }

  const out = [];
  if (props && props.length) {
    out.push(`<div class="props"><div class="props-h">${escHtml(t("mdProps"))}</div>${props.map(p => `<div class="prop"><span class="k">${escHtml(p.key)}</span><span class="v">${Array.isArray(p.value) ? p.value.map(v => /^tags?$/i.test(p.key) ? `<span class="tagc" data-tag="${escHtml(String(v).replace(/^#/, ""))}">#${escHtml(String(v).replace(/^#/, ""))}</span>` : `<span class="pv">${inline(String(v))}</span>`).join(" ") : inline(String(p.value))}</span></div>`).join("")}</div>`);
  }

  let i = 0;
  const isBlank = l => !l.trim();
  const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\[\^[^\]]+\]:/.test(l)) { i++; continue; }
    // fenced code / mermaid / math block
    const f = /^\s*(```|~~~)\s*([\w+-]*)/.exec(l);
    if (f) {
      const buf = []; i++;
      while (i < lines.length && !new RegExp("^\\s*" + f[1]).test(lines[i])) buf.push(lines[i++]);
      i++;
      const code = buf.join("\n"), lang = f[2].toLowerCase();
      if (lang === "mermaid") out.push(`<div class="mermaid-box" data-mermaid="${escHtml(code)}"><pre class="code">${escHtml(code)}</pre></div>`);
      else out.push(`<pre class="code"${lang ? ` data-lang="${escHtml(lang)}"` : ""}><code>${escHtml(code)}</code></pre>`);
      continue;
    }
    if (/^\s*\$\$/.test(l)) {
      const first = l.replace(/^\s*\$\$/, "");
      if (/\$\$\s*$/.test(first) && first.trim().length > 2) { out.push(`<div class="math block" data-tex="${escHtml(first.replace(/\$\$\s*$/, ""))}">${escHtml(first)}</div>`); i++; continue; }
      const buf = first.trim() ? [first] : []; i++;
      while (i < lines.length && !/\$\$\s*$/.test(lines[i])) buf.push(lines[i++]);
      if (i < lines.length) { const last = lines[i].replace(/\$\$\s*$/, ""); if (last.trim()) buf.push(last); i++; }
      const tex = buf.join("\n");
      out.push(`<div class="math block" data-tex="${escHtml(tex)}">${escHtml(tex)}</div>`);
      continue;
    }
    if (isBlank(l)) { i++; continue; }
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (h) { out.push(`<h${h[1].length} id="${escHtml(slug(h[2]))}">${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
    // quote / callout
    if (/^\s*>/.test(l)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*> ?/, ""));
      const c = /^\[!([\w-]+)\]([+-]?)\s*(.*)$/.exec(buf[0] || "");
      if (c) {
        const type = c[1].toLowerCase(), title = c[3] || type[0].toUpperCase() + type.slice(1);
        const inner = renderMarkdown(buf.slice(1).join("\n"), { ...opts, inner: true });
        const head = `<span class="ci">${CALLOUT_ICON[type] || "✎"}</span>${inline(title)}`;
        out.push(c[2] ? `<details class="callout c-${escHtml(type)}"${c[2] === "+" ? " open" : ""}><summary>${head}</summary>${inner}</details>` : `<div class="callout c-${escHtml(type)}"><div class="ct">${head}</div>${inner}</div>`);
      } else out.push(`<blockquote>${renderMarkdown(buf.join("\n"), { ...opts, inner: true })}</blockquote>`);
      continue;
    }
    // table
    if (/\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const cells = r => r.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map(x => x.trim());
      const head = cells(l), al = cells(lines[i + 1]).map(x => x.startsWith(":") && x.endsWith(":") ? "center" : x.endsWith(":") ? "right" : "");
      i += 2; const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && !isBlank(lines[i])) rows.push(cells(lines[i++]));
      const td = (x, k, tag) => `<${tag}${al[k] ? ` style="text-align:${al[k]}"` : ""}>${inline(x)}</${tag}>`;
      out.push(`<div class="tablewrap"><table><thead><tr>${head.map((x, k) => td(x, k, "th")).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => td(r[k] || "", k, "td")).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    // lists (nested by indentation)
    if (listRe.test(l)) {
      const items = [];
      while (i < lines.length && (listRe.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const m = listRe.exec(lines[i]);
        // a list of the other kind at the same level starts a new list
        if (m && items.length && m[1].replace(/\t/g, "    ").length <= items[0].ind && /\d/.test(m[2]) !== items[0].ord) break;
        if (m) items.push({ ind: m[1].replace(/\t/g, "    ").length, ord: /\d/.test(m[2]), start: parseInt(m[2], 10) || 1, text: m[3] });
        else items[items.length - 1].text += " " + lines[i].trim();
        i++;
      }
      out.push(listHtml(items, 0, items.length, inline));
      continue;
    }
    // paragraph
    const buf = [];
    while (i < lines.length && !isBlank(lines[i]) && !/^(#{1,6})\s|^\s*(```|~~~|>|\$\$)|^\s*([-*_])(\s*\3){2,}\s*$/.test(lines[i]) && !listRe.test(lines[i]) && !/^\[\^[^\]]+\]:/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) { out.push(`<p>${inline(lines[i++])}</p>`); continue; }
    out.push(`<p>${buf.map(inline).join("<br>")}</p>`);
  }
  if (notes.length && !opts.inner) out.push(`<div class="footnotes"><div class="props-h">${escHtml(t("mdNotes"))}</div><ol>${notes.map(id => `<li id="fn-${fnIndex.get(id)}">${inline(defs.get(id) || "")}</li>`).join("")}</ol></div>`);
  return opts.inner ? out.join("") : `<div class="md note">${out.join("")}</div>`;
}

function listHtml(items, a, b, inline) {
  if (a >= b) return "";
  const base = items[a].ind, ord = items[a].ord;
  let h = ord ? `<ol${items[a].start !== 1 ? ` start="${items[a].start}"` : ""}>` : "<ul>";
  let k = a;
  while (k < b) {
    const it = items[k]; let e = k + 1;
    while (e < b && items[e].ind > base) e++;
    let text = it.text, cls = "";
    const tm = /^\[([ xX/\-])\]\s+(.*)$/.exec(text);
    if (tm) { const done = tm[1] !== " "; cls = ` class="task${done ? " done" : ""}"`; text = `<span class="cb${done ? " x" : ""}"></span>` + inline(tm[2]); }
    else text = inline(text);
    h += `<li${cls}>${text}${listHtml(items, k + 1, e, inline)}</li>`;
    k = e;
  }
  return h + (ord ? "</ol>" : "</ul>");
}

/** Section of a note under a heading (for ![[Note#Heading]]). */
export function section(src, heading) {
  const lines = frontmatter(String(src || "")).body.split("\n"), want = slug(heading);
  let start = -1, level = 0;
  for (let k = 0; k < lines.length; k++) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[k]);
    if (!m) continue;
    if (start < 0 && slug(m[2]) === want) { start = k; level = m[1].length; continue; }
    if (start >= 0 && m[1].length <= level) return lines.slice(start, k).join("\n");
  }
  return start >= 0 ? lines.slice(start).join("\n") : null;
}
