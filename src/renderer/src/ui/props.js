// Properties editor (Obsidian replacement, Paket 1): the YAML frontmatter of a note as rows of name and value.
// Only the simple forms Obsidian's own editor writes (text, number, true/false, date, lists) are edited here;
// anything else (nested maps, multi-line text) is left alone and the note keeps it unchanged.

const FM = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

const unq = s => { s = s.trim(); if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1).replace(/\\"/g, '"').replace(/''/g, "'"); return s; };

/** { props: [{key, value: string | string[]}], body, simple } — simple=false when something cannot be edited here. */
export function parseProps(text) {
  const m = FM.exec(text);
  if (!m) return { props: [], body: text, simple: true, had: false };
  const lines = m[1].split(/\r?\n/), props = [];
  let simple = true;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const kv = /^([^\s:#][^:]*):(?:\s+(.*))?\s*$/.exec(l);
    if (!kv) { simple = false; continue; }
    const key = kv[1].trim(), raw = (kv[2] || "").trim();
    if (raw === "" || raw === "[]") {   // a list in "- item" lines, or empty
      const items = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) items.push(unq(lines[++i].replace(/^\s*-\s+/, "")));
      if (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) simple = false;   // nested map
      props.push({ key, value: items.length || raw === "[]" ? items : "" });
    } else if (/^\[.*\]$/.test(raw)) props.push({ key, value: raw.slice(1, -1).split(",").map(unq).filter(Boolean) });
    else if (/^[|>]/.test(raw)) { simple = false; props.push({ key, value: raw }); }
    else props.push({ key, value: unq(raw) });
  }
  return { props, body: text.slice(m[0].length), simple, had: true };
}

const needsQuote = s => s === "" || /^[\s\-?:,[\]{}#&*!|>'"%@`]|: |\s#|\s$/.test(s);
const q = s => (needsQuote(s) ? JSON.stringify(s) : s);

export function serializeProps(props, body) {
  const keep = props.filter(p => p.key.trim());
  if (!keep.length) return body.replace(/^\r?\n/, "");
  const y = keep.map(p => Array.isArray(p.value) ? (p.value.length ? `${p.key.trim()}:\n${p.value.map(v => `  - ${q(String(v))}`).join("\n")}` : `${p.key.trim()}: []`) : `${p.key.trim()}: ${p.value === "" ? "" : q(String(p.value))}`.trimEnd()).join("\n");
  return `---\n${y}\n---\n${body}`;
}

/** The editor block: one row per property; lists as comma-separated text. */
export function propsBlock(text, { t, esc, open }) {
  const P = parseProps(text);
  const head = `<button type="button" class="btn sm" data-x="props">${t(open ? "propsHide" : "propsShow")}${P.props.length ? ` (${P.props.length})` : ""}</button>`;
  if (!open) return head;
  if (!P.simple) return head + `<p class="hint">${t("propsComplex")}</p>`;
  const rows = P.props.map((p, i) => `<div class="prow"><input class="inp pk" data-pi="${i}" data-pf="k" value="${esc(p.key)}" spellcheck="false" aria-label="${esc(t("propsName"))}"><input class="inp pv" data-pi="${i}" data-pf="v" value="${esc(Array.isArray(p.value) ? p.value.join(", ") : p.value)}" spellcheck="false" aria-label="${esc(t("propsValue"))}"${Array.isArray(p.value) ? ` data-list="1" title="${esc(t("propsList"))}"` : ""}><button type="button" class="btn sm" data-x="propdel:${i}" aria-label="${esc(t("propsDel"))}">✕</button></div>`).join("");
  return head + `<div class="props">${rows}<div class="btns" style="margin-top:4px"><button type="button" class="btn sm" data-x="propadd">${t("propsAdd")}</button><button type="button" class="btn sm" data-x="propadd:tags">${t("propsAddTags")}</button></div></div>`;
}
