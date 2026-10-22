const book = document.getElementById("book");
const detail = document.getElementById("detail");
const toc = document.getElementById("toc");
const chips = document.getElementById("chips");
const search = document.getElementById("search");
const tabAll = document.getElementById("tabAll");
const tabFav = document.getElementById("tabFav");
const favCount = document.getElementById("favCount");
const themeBtn = document.getElementById("themeBtn");
const soundBtn = document.getElementById("soundBtn");

const DEFAULT_UI = {
  openCue: "Click to open the book", contents: "Contents", tabRecipes: "Recipes", tabFavorites: "Favorites",
  closeBook: "Close the book", searchPlaceholder: "Search a dish, ingredient or tag…", all: "all",
  welcome: "Pick a dish on the left page<br>and the page will turn for you.",
  noFavs: "No favorites yet. Open a recipe and press Save to keep it here.",
  noMatch: "No matches. Try another ingredient.",
  save: "Save", saved: "Saved", seeVideo: "See how others cook it", backToPhoto: "Back to the photo",
  cookIt: "I cooked this!", cookAgain: "I cooked it again!", cookedStamp: "Cooked!",
  cookedOnce: "Cooked once", cookedTimes: "Cooked {n} times", undo: "undo",
  servings: "{n} servings", fewerServings: "Fewer servings", moreServings: "More servings",
  ingredients: "Ingredients", instructions: "Instructions", minutes: "{n} min", about: "About {price}",
  photoSlot: "Add your photo here", source: "Source",
  timerStart: "⏱ {n} min", timerRunning: "⏱ {t} · tap to stop", timerDone: "✓ Done! tap to reset",
  themeDay: "Switch to daytime", themeNight: "Switch to night",
  soundOn: "Page-flip sound: on", soundOff: "Page-flip sound: off"
};
let config = { currency: "₱", ui: { ...DEFAULT_UI }, limits: { minServings: 1, maxServings: 20 }, categories: [], tableItems: [], units: {} };

const t = (key, vars = {}) =>
  String(config.ui[key] ?? DEFAULT_UI[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

let recipes = [];
let current = null;
let servings = 0;
let category = "all";
let view = "all";
let favorites = new Set();
let cooked = {};
let night = false;
let soundOn = false;

const save = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
try { favorites = new Set(JSON.parse(localStorage.getItem("hc-favs") || "[]")); } catch (e) {}
try { cooked = JSON.parse(localStorage.getItem("hc-cooked") || "{}") || {}; } catch (e) {}
try { night = localStorage.getItem("hc-night") === "1"; soundOn = localStorage.getItem("hc-sound") === "1"; } catch (e) {}
const saveFavs = () => save("hc-favs", JSON.stringify([...favorites]));
const saveCooked = () => save("hc-cooked", JSON.stringify(cooked));

function applyTheme() {
  document.body.classList.toggle("night", night);
  themeBtn.setAttribute("aria-pressed", night);
  themeBtn.title = night ? t("themeDay") : t("themeNight");
}
function applySound() {
  soundBtn.setAttribute("aria-pressed", soundOn);
  soundBtn.title = soundOn ? t("soundOn") : t("soundOff");
}
themeBtn.addEventListener("click", () => { night = !night; save("hc-night", night ? "1" : "0"); applyTheme(); });
soundBtn.addEventListener("click", () => { soundOn = !soundOn; save("hc-sound", soundOn ? "1" : "0"); applySound(); playFlip(); });
applyTheme();
applySound();

let actx = null;
function audio() {
  if (!actx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; actx = new A(); }
  if (actx.state === "suspended") actx.resume();
  return actx;
}
function noise(c, dur) {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = buf;
  return s;
}
function playFlip() {
  if (!soundOn) return;
  const c = audio(); if (!c) return;
  const t0 = c.currentTime;
  const s = noise(c, .4), f = c.createBiquadFilter(), g = c.createGain();
  f.type = "bandpass"; f.Q.value = .9;
  f.frequency.setValueAtTime(900, t0); f.frequency.exponentialRampToValueAtTime(4200, t0 + .3);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.35, t0 + .06); g.gain.exponentialRampToValueAtTime(.001, t0 + .38);
  s.connect(f).connect(g).connect(c.destination); s.start(t0);
  const l = noise(c, .1), lf = c.createBiquadFilter(), lg = c.createGain();
  lf.type = "lowpass"; lf.frequency.value = 700;
  lg.gain.setValueAtTime(.0001, t0 + .26); lg.gain.linearRampToValueAtTime(.3, t0 + .275); lg.gain.exponentialRampToValueAtTime(.001, t0 + .37);
  l.connect(lf).connect(lg).connect(c.destination); l.start(t0 + .26);
}
function playThud() {
  if (!soundOn) return;
  const c = audio(); if (!c) return;
  const t0 = c.currentTime + .2;
  const o = c.createOscillator(), g = c.createGain();
  o.type = "sine"; o.frequency.setValueAtTime(140, t0); o.frequency.exponentialRampToValueAtTime(45, t0 + .18);
  g.gain.setValueAtTime(.5, t0); g.gain.exponentialRampToValueAtTime(.001, t0 + .22);
  o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + .25);
}
function playChime() {
  const c = audio(); if (!c) return;
  [0, .25, .5].forEach(off => {
    const t0 = c.currentTime + off;
    const o = c.createOscillator(), g = c.createGain();
    o.type = "triangle"; o.frequency.value = 880;
    g.gain.setValueAtTime(.0001, t0); g.gain.linearRampToValueAtTime(.3, t0 + .02); g.gain.exponentialRampToValueAtTime(.001, t0 + .22);
    o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + .25);
  });
}

const heart = (filled) => `<svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5C5 16 2.5 12.5 2.5 8.8 2.5 6.2 4.5 4.5 6.8 4.5c1.8 0 3.9 1 5.2 3 1.3-2 3.4-3 5.2-3 2.3 0 4.3 1.7 4.3 4.3 0 3.7-2.5 7.2-9.5 11.7z" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

document.getElementById("openBtn").addEventListener("click", () => { book.classList.add("open"); playFlip(); });
document.getElementById("closeBtn").addEventListener("click", () => { book.classList.remove("open"); playFlip(); });

function normalizeRecipe(r, i) {
  const label = r.name || `recipe #${i + 1}`;
  if (!r.name) console.warn(`data.json: ${label} has no "name"`);
  ["servings", "category", "ingredients", "steps"].forEach(k => { if (r[k] == null) console.warn(`data.json: "${label}" is missing "${k}"`); });

  const groups = [];
  (r.ingredients || []).forEach(entry => {
    if (Array.isArray(entry.items)) { groups.push({ group: entry.group || "", items: entry.items }); return; }
    const last = groups[groups.length - 1];
    if (last && !last.group) last.items.push(entry); else groups.push({ group: "", items: [entry] });
  });

  return {
    video: "", image: "", story: "", source: null, tags: [], cookingTime: 0, difficulty: "", budget: 0,
    ...r,
    name: r.name || label,
    slug: r.slug || slugify(r.name || label),
    category: r.category || "other",
    servings: Number(r.servings) > 0 ? Number(r.servings) : 4,
    groups,
    allIngredients: groups.flatMap(g => g.items),
    steps: (r.steps || []).map(s => typeof s === "string" ? { text: s } : { text: s.text || "", minutes: s.minutes })
  };
}

function migrateLegacyStorage() {
  const byLegacy = new Map(recipes.filter(r => r.legacyId != null).map(r => [String(r.legacyId), r.slug]));
  let changed = false;
  const favs = new Set();
  favorites.forEach(f => {
    if (typeof f === "number" || /^\d+$/.test(f)) { changed = true; const s = byLegacy.get(String(f)); if (s) favs.add(s); }
    else favs.add(f);
  });
  const done = {};
  Object.entries(cooked).forEach(([k, v]) => {
    if (/^\d+$/.test(k)) { changed = true; const s = byLegacy.get(k); if (s) done[s] = v; }
    else done[k] = v;
  });
  if (changed) { favorites = favs; cooked = done; saveFavs(); saveCooked(); }
}

function applyUi() {
  document.querySelectorAll("[data-ui]").forEach(el => { el.textContent = t(el.dataset.ui); });
  document.querySelectorAll("[data-ui-placeholder]").forEach(el => {
    el.placeholder = t(el.dataset.uiPlaceholder);
    el.setAttribute("aria-label", t(el.dataset.uiPlaceholder));
  });
  applyTheme();
  applySound();
}

function buildTableItems() {
  const mat = document.querySelector(".table-decor .mat");
  if (!mat) return;
  let ref = mat;
  (config.tableItems || []).forEach(item => {
    const img = new Image();
    img.className = "item " + String(item.class || "").replace(/[^\w\s-]/g, "");
    img.src = item.src;
    img.alt = "";
    ref.after(img); ref = img;
    if (item.steam) {
      const steam = document.createElement("div");
      steam.className = "steam";
      steam.setAttribute("aria-hidden", "true");
      steam.innerHTML = "<i></i><i></i><i></i>";
      img.after(steam); ref = steam;
    }
  });
}

fetch("data.json")
  .then(res => {
    if (!res.ok) throw new Error("Could not find data.json");
    return res.json();
  })
  .then(data => {
    config = {
      ...config,
      currency: data.currency ?? config.currency,
      limits: { ...config.limits, ...(data.limits || {}) },
      ui: { ...DEFAULT_UI, ...(data.ui || {}) },
      categories: data.categories || [],
      tableItems: data.tableItems || [],
      units: data.units || {}
    };
    recipes = (data.recipes || []).map(normalizeRecipe);

    const seen = new Set();
    recipes.forEach(r => { if (seen.has(r.slug)) console.warn(`data.json: duplicate slug "${r.slug}"`); seen.add(r.slug); });
    recipes.forEach((r, i) => { r.page = i + 1; });

    migrateLegacyStorage();
    document.getElementById("bookTitle").textContent = data.title || "Recipe Book";
    document.getElementById("bookSub").textContent = data.subtitle || "";
    if (data.title) document.title = `${data.title} | Recipe Book`;
    applyUi();
    buildTableItems();
    buildChips();
    renderToc();
    showWelcome();
  })
  .catch(err => {
    toc.innerHTML = `<li class="status">Could not load the recipes. Open the page with Live Server instead of double-clicking it. (${esc(err.message)})</li>`;
  });

function setView(v) {
  view = v;
  tabAll.classList.toggle("on", v === "all");
  tabFav.classList.toggle("on", v === "fav");
  tabAll.setAttribute("aria-selected", v === "all");
  tabFav.setAttribute("aria-selected", v === "fav");
  renderToc();
}
tabAll.addEventListener("click", () => setView("all"));
tabFav.addEventListener("click", () => setView("fav"));

function categoryList() {
  const list = config.categories.map(c => ({ icon: "", ...c }));
  const known = new Set(list.map(c => c.id));
  recipes.forEach(r => {
    if (!known.has(r.category)) {
      console.warn(`data.json: category "${r.category}" is not listed in "categories"`);
      known.add(r.category);
      list.push({ id: r.category, label: r.category, icon: "" });
    }
  });
  const used = new Set(recipes.map(r => r.category));
  return list.filter(c => used.has(c.id));
}

function buildChips() {
  const cats = [{ id: "all", label: t("all"), icon: "" }, ...categoryList()];
  chips.innerHTML = cats
    .map(c => `<button class="chip ${c.id === category ? "on" : ""}" data-cat="${esc(c.id)}">${c.icon ? esc(c.icon) + " " : ""}${esc(c.label)}</button>`)
    .join("");
}

chips.addEventListener("click", e => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  category = btn.dataset.cat;
  buildChips();
  renderToc();
});

search.addEventListener("input", renderToc);

function renderToc() {
  favCount.textContent = favorites.size;
  const q = search.value.trim().toLowerCase().replace(/^#/, "");
  const list = recipes.filter(r => {
    const inView = view === "all" || favorites.has(r.slug);
    const inCat = category === "all" || r.category === category;
    const inText = !q || r.name.toLowerCase().includes(q)
      || r.allIngredients.some(i => String(i.name).toLowerCase().includes(q))
      || r.tags.some(tag => tag.toLowerCase().includes(q));
    return inView && inCat && inText;
  });

  if (!list.length) {
    toc.innerHTML = view === "fav" && !favorites.size
      ? `<li class="status">${esc(t("noFavs"))}</li>`
      : `<li class="status">${esc(t("noMatch"))}</li>`;
    return;
  }
  toc.innerHTML = list.map(r => `
    <li><button data-slug="${esc(r.slug)}" class="${current && current.slug === r.slug ? "active" : ""}">
      <span class="t-name">${esc(r.name)}${favorites.has(r.slug) ? heart(true) : ""}</span>
      <span class="t-page">${r.page}</span>
    </button></li>`).join("");
}

toc.addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  current = recipes.find(r => r.slug === btn.dataset.slug);
  if (!current) return;
  servings = current.servings;
  renderDetail(true);
  playFlip();
  renderToc();
});

function ytId(v) {
  v = String(v || "").trim();
  if (/^[\w-]{11}$/.test(v)) return v;
  const m = v.match(/(?:youtu\.be\/|[?&]v=|embed\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : "";
}

detail.addEventListener("click", e => {
  const tagBtn = e.target.closest(".tag");
  if (tagBtn) {
    view = "all"; category = "all";
    tabAll.classList.add("on"); tabFav.classList.remove("on");
    search.value = tagBtn.dataset.tag;
    buildChips();
    renderToc();
    return;
  }
  const timerBtn = e.target.closest(".step-timer");
  if (timerBtn) { toggleTimer(timerBtn); return; }

  const btn = e.target.closest(".see-video");
  if (!btn) return;
  const photo = btn.closest(".photo");
  const on = !photo.classList.contains("playing");
  photo.classList.toggle("playing", on);
  btn.setAttribute("aria-pressed", on);
  btn.textContent = on ? t("backToPhoto") : t("seeVideo");
  const old = photo.querySelector(".p-video");
  if (old) old.remove();
  if (on) {
    const box = document.createElement("div");
    box.className = "p-video";
    box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${photo.dataset.vid}?autoplay=1&rel=0" title="${esc(current ? current.name : "Recipe")} video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    btn.before(box);
  }
});

const timers = {};
let tick = null;
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function timerLabel(key, minutes) {
  const tm = timers[key];
  if (!tm) return t("timerStart", { n: minutes });
  if (tm.done) return t("timerDone");
  return t("timerRunning", { t: mmss(Math.max(0, Math.ceil((tm.end - Date.now()) / 1000))) });
}
function paintTimers() {
  document.querySelectorAll(".step-timer").forEach(b => {
    const tm = timers[b.dataset.key];
    b.textContent = timerLabel(b.dataset.key, b.dataset.min);
    b.classList.toggle("running", !!tm && !tm.done);
    b.classList.toggle("done", !!tm && tm.done);
  });
}
function runTick() {
  if (tick) return;
  tick = setInterval(() => {
    Object.values(timers).forEach(tm => {
      if (!tm.done && Date.now() >= tm.end) { tm.done = true; playChime(); }
    });
    paintTimers();
    if (!Object.values(timers).some(tm => !tm.done)) { clearInterval(tick); tick = null; }
  }, 250);
}
function toggleTimer(btn) {
  const key = btn.dataset.key;
  if (timers[key]) { delete timers[key]; }
  else { audio(); timers[key] = { end: Date.now() + Number(btn.dataset.min) * 60000, done: false }; runTick(); }
  paintTimers();
}

function showWelcome() {
  detail.innerHTML = `<div class="welcome">${t("welcome")}</div>`;
}

function fmt(n) {
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 4) / 4;
  const sym = { 0: "", 0.25: "¼", 0.5: "½", 0.75: "¾", 1: "" }[frac];
  const w = whole + (frac === 1 ? 1 : 0);
  if (!sym) return String(w || (n > 0 ? "<¼" : 0));
  return (w ? w + " " : "") + sym;
}

function sourceHtml(src) {
  if (!src) return "";
  const s = typeof src === "string" ? { name: src } : src;
  const name = esc(s.name || s.url || "");
  const link = /^https?:\/\//.test(s.url || "") ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${name}</a>` : name;
  return `<p class="r-source">${esc(t("source"))}: ${link}</p>`;
}

function unitLabel(unit, amount) {
  if (!unit) return "";
  const plural = config.units[unit];
  return plural && Math.round(amount * 4) / 4 > 1 ? plural : unit;
}

function ingredientHtml(i, ratio) {
  const scaled = i.scalable === false ? i.amount : i.amount * ratio;
  const qty = i.amount == null ? "" : fmt(scaled);
  return `<li><span>${esc(i.name)}</span><b>${esc(`${qty} ${unitLabel(i.unit, scaled)}`.trim())}</b></li>`;
}

function renderDetail(flip = false, slam = false) {
  const r = current;
  const ratio = servings / r.servings;
  const cost = Math.round(r.budget * ratio);
  const saved = favorites.has(r.slug);
  const times = cooked[r.slug] || 0;
  const vid = ytId(r.video);
  const playing = !flip ? detail.querySelector(`.photo.playing[data-slug="${CSS.escape(r.slug)}"]`) : null;
  const { minServings, maxServings } = config.limits;

  const stamp = times ? `<div class="stamp${slam ? " slam" : ""}" aria-label="${esc(times === 1 ? t("cookedOnce") : t("cookedTimes", { n: times }))}"><b>${esc(t("cookedStamp"))}</b><small>×${times}</small></div>` : "";

  detail.innerHTML = `
    ${stamp}
    <div class="r-head">
      <h2 class="r-name">${esc(r.name)}</h2>
      <button class="fav-btn ${saved ? "on" : ""}" id="favBtn" aria-pressed="${saved}">${heart(saved)}<span>${esc(saved ? t("saved") : t("save"))}</span></button>
    </div>
    <p class="r-story">${esc(r.story)}</p>
    ${sourceHtml(r.source)}

    <figure class="photo${r.image ? "" : " missing"}" data-slug="${esc(r.slug)}" data-vid="${vid}">
      ${r.image ? `<img src="${esc(r.image)}" alt="${esc(r.name)}" onerror="this.parentElement.classList.add('missing')">` : ""}
      <figcaption class="slot">${esc(t("photoSlot"))}${r.image ? `<code>${esc(r.image)}</code>` : ""}</figcaption>
      ${vid ? `<button type="button" class="see-video" aria-pressed="false">${esc(t("seeVideo"))}</button>` : ""}
    </figure>

    <div class="meta">
      ${r.cookingTime ? `<span>${esc(t("minutes", { n: r.cookingTime }))}</span>` : ""}
      ${r.difficulty ? `<span>${esc(r.difficulty)}</span>` : ""}
      ${r.budget ? `<span>${esc(t("about", { price: config.currency + cost }))}</span>` : ""}
      <button type="button" class="cook-btn" id="cookBtn">${esc(times ? t("cookAgain") : t("cookIt"))}</button>
      ${times ? `<span class="cook-count">${esc(times === 1 ? t("cookedOnce") : t("cookedTimes", { n: times }))}</span><button type="button" class="cook-undo" id="cookUndo" aria-label="Remove one cook">${esc(t("undo"))}</button>` : ""}
    </div>
    ${r.tags.length ? `<div class="tags">${r.tags.map(tag => `<button type="button" class="tag" data-tag="${esc(tag)}">#${esc(tag)}</button>`).join("")}</div>` : ""}

    <h3 class="r-sec">${esc(t("ingredients"))}</h3>
    <div class="servings">
      <button id="minus" aria-label="${esc(t("fewerServings"))}">−</button>
      <span>${esc(t("servings", { n: servings }))}</span>
      <button id="plus" aria-label="${esc(t("moreServings"))}">+</button>
    </div>
    ${r.groups.map(g => `
      ${g.group ? `<h4 class="ing-group">${esc(g.group)}</h4>` : ""}
      <ul class="ing">${g.items.map(i => ingredientHtml(i, ratio)).join("")}</ul>`).join("")}

    <h3 class="r-sec">${esc(t("instructions"))}</h3>
    <ol class="steps">${r.steps.map((s, idx) => {
      const key = `${r.slug}:${idx}`;
      const timer = s.minutes > 0
        ? ` <button type="button" class="step-timer${timers[key] ? (timers[key].done ? " done" : " running") : ""}" data-key="${esc(key)}" data-min="${s.minutes}">${esc(timerLabel(key, s.minutes))}</button>`
        : "";
      return `<li>${esc(s.text)}${timer}</li>`;
    }).join("")}</ol>
  `;

  if (playing) detail.querySelector(".photo").replaceWith(playing);

  if (flip) {
    detail.classList.remove("flip");
    void detail.offsetWidth;
    detail.classList.add("flip");
  }

  document.getElementById("minus").onclick = () => { if (servings > minServings) { servings--; renderDetail(); } };
  document.getElementById("plus").onclick = () => { if (servings < maxServings) { servings++; renderDetail(); } };
  document.getElementById("cookBtn").onclick = () => {
    cooked[r.slug] = times + 1;
    saveCooked();
    playThud();
    renderDetail(false, true);
  };
  const undo = document.getElementById("cookUndo");
  if (undo) undo.onclick = () => {
    if (times > 1) cooked[r.slug] = times - 1; else delete cooked[r.slug];
    saveCooked();
    renderDetail();
  };
  document.getElementById("favBtn").onclick = () => {
    favorites.has(r.slug) ? favorites.delete(r.slug) : favorites.add(r.slug);
    saveFavs();
    renderDetail();
    renderToc();
  };
}