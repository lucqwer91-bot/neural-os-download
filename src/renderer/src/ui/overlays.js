// Module windows ("overlays"): open, bring to front, drag, minimise, resize, close.
// At most `max` windows are open; opening one more closes the oldest.
// On wide screens (> 1000 px) position and size are remembered per module.

const KEY = "nos-ov";
const WIDE = 1000;

function loadMem(storage) {
  try { return JSON.parse(storage.getItem(KEY) || "{}") || {}; } catch (_) { return {}; }
}

/**
 * @param {{root: HTMLElement, max?: number, codeOf: (m:string)=>string, titleOf: (m:string)=>string,
 *   bodyOf: (m:string)=>string, onChange?: ()=>void, onCreate?: (el:HTMLElement, m:string)=>void, onFill?: (body:HTMLElement, m:string)=>void,
 *   storage?: {getItem:(k:string)=>string|null, setItem:(k:string,v:string)=>void}}} o
 */
export function createOverlays(o) {
  const { root, max = 3, leftSide = [], codeOf, titleOf, bodyOf, onChange = () => {}, onCreate = () => {}, onFill = () => {} } = o;
  const storage = o.storage || (() => { try { return window.localStorage; } catch (_) { return null; } })();
  /** @type {Map<string, HTMLElement>} */
  const open = new Map();
  let z = 0, slot = 0;
  let mem = storage ? loadMem(storage) : {};

  function save(el) {
    if (innerWidth <= WIDE || !storage) return;
    mem[el.dataset.m] = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.style.height ? el.offsetHeight : 0 };
    try { storage.setItem(KEY, JSON.stringify(mem)); } catch (_) {}
  }

  function front(el) {
    el.style.zIndex = String(30 + (++z));
    root.querySelectorAll(".ov").forEach(x => x.classList.toggle("front", x === el));
  }

  function fill(m) {
    const el = open.get(m); if (!el) return;
    el.querySelector("h2").textContent = titleOf(m);
    const b = el.querySelector(".body"), sc = b.scrollTop;
    b.innerHTML = bodyOf(m); b.scrollTop = sc;
    onFill(b, m);
  }

  function close(m) {
    const el = open.get(m);
    if (el) { el.remove(); open.delete(m); onChange(); }
  }

  function place(el) {
    const p = mem[el.dataset.m];
    if (p && innerWidth > WIDE) {
      el.style.left = Math.min(p.x, innerWidth - 120) + "px"; el.style.top = Math.min(p.y, innerHeight - 80) + "px";
      if (p.w) el.style.width = p.w + "px";
      if (p.h) { el.style.height = p.h + "px"; el.style.maxHeight = "none"; }
    }
    if (innerWidth > WIDE) { const over = el.offsetLeft + el.offsetWidth - (innerWidth - 12); if (over > 0) el.style.left = Math.max(90, el.offsetLeft - over) + "px"; }
  }

  // drag `handle` with the pointer; `move` gets the pointer event; save when released
  function track(handle, el, move) {
    const mv = ev => move(ev);
    const up = () => { handle.removeEventListener("pointermove", mv); handle.removeEventListener("pointerup", up); save(el); };
    handle.addEventListener("pointermove", mv); handle.addEventListener("pointerup", up);
  }

  function openOv(m) {
    if (open.has(m)) { front(open.get(m)); return; }
    if (open.size >= max) close(open.keys().next().value);
    const el = document.createElement("section"); el.className = "ov glass"; el.dataset.m = m;
    const w = Math.min(380, innerWidth - 32);
    if (leftSide.includes(m) && innerWidth > WIDE) { el.style.left = "92px"; el.style.top = "72px"; }   // sidebars (files) sit beside the dock, so notes opened from them do not cover them
    else { el.style.left = Math.max(16, innerWidth - w - 30 - (slot % 3) * 28) + "px"; el.style.top = 72 + (slot % 3) * 28 + "px"; slot++; }
    el.innerHTML = `<header><span class="code">${codeOf(m)}</span><h2></h2><button type="button" data-c="min" aria-label="Minimize">–</button><button type="button" data-c="close" aria-label="Close">×</button></header><div class="body"></div>`;
    root.appendChild(el); open.set(m, el); fill(m); front(el); onChange();

    const hd = el.querySelector("header");
    hd.addEventListener("pointerdown", e => {
      if (e.target.closest("button")) return;
      front(el); const ox = e.clientX - el.offsetLeft, oy = e.clientY - el.offsetTop; hd.setPointerCapture(e.pointerId);
      track(hd, el, ev => {
        el.style.left = Math.max(0, Math.min(innerWidth - 80, ev.clientX - ox)) + "px";
        el.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - oy)) + "px";
      });
    });
    el.addEventListener("pointerdown", () => front(el));
    el.addEventListener("click", e => {
      const c = e.target.closest("[data-c]"); if (!c) return;
      if (c.dataset.c === "close") close(m); else el.classList.toggle("min");
    });

    place(el);
    const h = document.createElement("i"); h.className = "rsz"; h.setAttribute("aria-hidden", "true"); el.appendChild(h);
    h.addEventListener("pointerdown", e => {
      e.preventDefault(); e.stopPropagation(); h.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, w0 = el.offsetWidth, h0 = el.offsetHeight;
      track(h, el, ev => {
        el.style.width = Math.max(300, Math.min(innerWidth - el.offsetLeft - 10, w0 + ev.clientX - sx)) + "px";
        el.style.height = Math.max(220, Math.min(innerHeight - el.offsetTop - 10, h0 + ev.clientY - sy)) + "px";
        el.style.maxHeight = "none";
      });
    });
    front(el);
    onCreate(el, m);
  }

  return {
    open, openOv, fill, close, front,
    refresh: m => { if (open.has(m)) fill(m); },
    refreshAll: () => open.forEach((_, m) => fill(m))
  };
}
