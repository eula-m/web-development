const API_URL = "https://collectionapi.metmuseum.org/public/collection/v1";
const SEARCH_URL = "https://collectionapi.metmuseum.org/public/collection/v1.1/search";

const PAGE_SIZE = 10;
const MAX_ROOMS = 500;
const MAX_RESULTS = MAX_ROOMS * PAGE_SIZE;
const DEFAULT_SEARCH = "painting";
const FAV_KEY = "artspace-favorites";
const NO_IMAGE = "https://placehold.co/600x400/e9e0d5/8c7058?text=No+Image";

let artworks = [];
let currentPage = 1;
let totalPages = 1;
let totalResults = 0;
let currentSearch = DEFAULT_SEARCH;
let currentDept = "all";
let showFavorites = false;

const MIN_YEAR = -5000;
const MAX_YEAR = new Date().getFullYear();
let currentHighlight = false;
let currentFrom = null;
let currentTo = null;

let currentObject = null;

const MAX_SHARED = 60;
let pendingShared = null;
let currentShared = null;
let sharedList = null;
let sharedLoading = false;
let sharedToken = 0;

let relatedController = null;

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
let hallPaused = reduceMotion.matches;

const SORT_OPTIONS = ["relevance", "title", "artist", "oldest", "newest"];
let currentSort = "relevance";
let relevanceOrder = [];

let allObjectIDs = null;

let modalArt = null;
let modalList = [];

const COMPARE_MAX = 2;
let compareList = [];

let requestCounter = 0;

let abortController = null;

const startOffsets = new Map();

const pageCache = new Map();
let prefetchController = null;

let hallItems = [];
let hallIndex = 0;

const container = document.getElementById("artContainer");
const emptyState = document.getElementById("emptyState");
const pagination = document.getElementById("pagination");
const categoryFilter = document.getElementById("categoryFilter");
const stage = document.getElementById("stage");
const searchInput = document.getElementById("searchInput");
const searchClear = document.getElementById("searchClear");
const sortSelect = document.getElementById("sortSelect");
const highlightToggle = document.getElementById("highlightToggle");
const yearFrom = document.getElementById("yearFrom");
const yearTo = document.getElementById("yearTo");
const yearApply = document.getElementById("yearApply");
const clearFiltersBtn = document.getElementById("clearFilters");
const filtersBtn = document.getElementById("filtersBtn");
const filterCount = document.getElementById("filterCount");
const filterPanel = document.getElementById("filterPanel");
const eraChips = document.getElementById("eraChips");
const tourBtn = document.getElementById("tourBtn");
const collectionTools = document.getElementById("collectionTools");
const shareBtn = document.getElementById("shareBtn");
const saveSharedBtn = document.getElementById("saveSharedBtn");
const toastWrap = document.getElementById("toastWrap");
const artModalEl = document.getElementById("artModal");
const modalContent = document.getElementById("modalContent");
const galleryTitle = document.getElementById("galleryTitle");
const resultCount = document.getElementById("resultCount");
const randomBtn = document.getElementById("randomBtn");
const favBtn = document.getElementById("favBtn");

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    }[char]));
}

function sleep(ms, signal) {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms);

        if (signal) {
            signal.addEventListener("abort", () => {
                clearTimeout(timer);
                resolve();
            }, { once: true });
        }
    });
}

async function fetchWithRetry(url, { signal, retries = 2 } = {}) {
    for (let attempt = 0; ; attempt++) {
        try {
            const response = await fetch(url, { signal });
            const retryable = response.status === 403 || response.status === 429 || response.status >= 500;

            if (!retryable || attempt >= retries) return response;

        } catch (error) {
            if (error.name === "AbortError" || attempt >= retries) throw error;
        }

        await sleep(700 * (attempt + 1), signal);
    }
}

function friendlyError(error) {
    if (error instanceof TypeError) {
        return "Can't reach The Met's collection right now. Check your connection, ad blocker or VPN. "
            + "If you were clicking quickly, wait a minute: the Met limits how fast it can be asked.";
    }

    return error.message;
}

const CACHE_KEY = "artspace-cache-v2";
const MAX_CACHED_DETAILS = 700;
const MAX_CACHED_SEARCHES = 80;

const detailCache = new Map();
const searchCache = new Map();

function slimArtwork(art) {
    return {
        objectID: art.objectID,
        title: art.title,
        artistDisplayName: art.artistDisplayName,
        artistDisplayBio: art.artistDisplayBio,
        artistNationality: art.artistNationality,
        artistWikipediaURL: art.artistWikipediaURL,
        artistWikidataURL: art.artistWikidata_URL,
        objectDate: art.objectDate,
        objectBeginDate: art.objectBeginDate,
        department: art.department,
        objectName: art.objectName,
        culture: art.culture,
        period: art.period,
        accessionNumber: art.accessionNumber,
        medium: art.medium,
        dimensions: art.dimensions,
        creditLine: art.creditLine,
        isPublicDomain: art.isPublicDomain,
        primaryImage: art.primaryImage,
        primaryImageSmall: art.primaryImageSmall,
        additionalImages: (art.additionalImages || []).slice(0, 5),
        objectURL: art.objectURL,
        tags: (art.tags || []).map(tag => tag && tag.term).filter(Boolean).slice(0, 12)
    };
}

function loadCache() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
        if (!saved || saved.v !== 2) return;

        Object.entries(saved.art || {}).forEach(([id, art]) => detailCache.set(Number(id), art));
        (saved.none || []).forEach(id => detailCache.set(Number(id), null));
        Object.entries(saved.search || {}).forEach(([key, value]) => searchCache.set(key, value));

    } catch (error) {
    }
}

function persistCache() {
    try {
        const art = {};
        const none = [];

        [...detailCache.entries()].slice(-MAX_CACHED_DETAILS).forEach(([id, value]) => {
            if (value) art[id] = value;
            else none.push(id);
        });

        const search = Object.fromEntries([...searchCache.entries()].slice(-MAX_CACHED_SEARCHES));

        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ v: 2, art, none, search }));

    } catch (error) {
    }
}

let persistTimer = null;

function persistSoon() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistCache, 800);
}

document.addEventListener("visibilitychange", () => {
    if (document.hidden) persistCache();
});

loadCache();

async function fetchSearch(params, signal) {
    const key = params.toString();
    const hit = searchCache.get(key);

    if (hit) return hit;

    const response = await fetchWithRetry(`${SEARCH_URL}?${key}`, { signal });

    if (!response.ok) {
        throw new Error("API request failed: " + response.status);
    }

    const data = await response.json();
    const result = { total: data.total || 0, ids: data.objectIDs || [] };

    searchCache.set(key, result);
    persistSoon();

    return result;
}

async function fetchArtworkDetails(id, signal) {
    if (detailCache.has(id)) return detailCache.get(id);

    try {
        const response = await fetchWithRetry(`${API_URL}/objects/${id}`, { signal, retries: 1 });

        if (response.status === 404) {
            detailCache.set(id, null);
            return null;
        }

        if (!response.ok) {
            throw new Error("Unable to retrieve artwork.");
        }

        const art = await response.json();

        const usable = art.isPublicDomain && art.primaryImageSmall ? slimArtwork(art) : null;

        detailCache.set(id, usable);
        persistSoon();

        return usable;

    } catch (error) {
        if (error.name === "AbortError") return null;

        console.error("Artwork detail error:", id, error);
        return null;
    }
}

async function fetchMultipleArtworks(ids, signal) {
    const results = new Array(ids.length);
    let index = 0;

    async function worker() {
        while (index < ids.length && !(signal && signal.aborted)) {
            const currentIndex = index++;
            results[currentIndex] = await fetchArtworkDetails(ids[currentIndex], signal);
        }
    }

    await Promise.all([worker(), worker(), worker(), worker()]);

    return results;
}

function currentQuery() {
    return {
        search: currentSearch,
        dept: currentDept,
        highlight: currentHighlight,
        from: currentFrom,
        to: currentTo
    };
}

function queryKeyOf(q) {
    return [q.search, q.dept, q.highlight, q.from, q.to].join("|");
}

function searchParamsFor(q, offset) {
    const params = new URLSearchParams({
        q: q.search,
        hasImages: "true",
        offset: String(offset),
        limit: String(PAGE_SIZE)
    });

    if (ARTIST_TERMS.has(plain(q.search))) params.set("artistOrCulture", "true");

    if (q.dept !== "all") params.set("departmentId", q.dept);

    if (q.highlight) params.set("isHighlight", "true");

    if (q.from !== null && q.to !== null) {
        params.set("dateBegin", String(q.from));
        params.set("dateEnd", String(q.to));
    }

    return params;
}

async function loadPage(q, page, signal) {
    const key = queryKeyOf(q);

    let next = startOffsets.get(key + "|" + page) ?? (page - 1) * PAGE_SIZE;
    let total = 0;
    const loaded = [];

    for (let tries = 0; tries < 3 && loaded.length < PAGE_SIZE; tries++) {

        if (next + PAGE_SIZE > 10000) break;

        const result = await fetchSearch(searchParamsFor(q, next), signal);

        total = result.total;

        if (!result.ids.length) break;

        const batch = await fetchMultipleArtworks(result.ids, signal);

        if (signal.aborted) throw new DOMException("Request cancelled", "AbortError");

        for (let k = 0; k < batch.length; k++) {
            next++;
            if (batch[k]) loaded.push(batch[k]);
            if (loaded.length === PAGE_SIZE) break;
        }
    }

    startOffsets.set(key + "|" + (page + 1), next);

    return { loaded, total };
}

function rememberPage(pageKey, result) {
    pageCache.set(pageKey, result);

    if (pageCache.size > 16) {
        pageCache.delete(pageCache.keys().next().value);
    }
}

function prefetchNext(q, page) {
    if (prefetchController) prefetchController.abort();
    prefetchController = null;

    if (page >= totalPages || showFavorites) return;
    if (navigator.connection && navigator.connection.saveData) return;

    const nextPage = page + 1;
    const pageKey = queryKeyOf(q) + "|" + nextPage;

    if (pageCache.has(pageKey)) return;

    const controller = new AbortController();
    const signal = controller.signal;

    prefetchController = controller;

    sleep(1500, signal).then(async () => {
        if (signal.aborted || document.hidden) return;

        try {
            const result = await loadPage(q, nextPage, signal);
            if (!signal.aborted) rememberPage(pageKey, result);

        } catch (error) {
        }
    });
}

async function fetchArtworks(page = 1, query = DEFAULT_SEARCH, push = true) {
    const requestId = ++requestCounter;

    if (abortController) abortController.abort();
    if (prefetchController) prefetchController.abort();
    abortController = new AbortController();
    const signal = abortController.signal;

    currentPage = page;
    currentSearch = query || DEFAULT_SEARCH;

    leaveShared();

    syncURL(push);

    showFavorites = false;
    syncFavButton();

    showSkeletons();
    pagination.innerHTML = "";
    emptyState.classList.add("d-none");

    try {
        const q = currentQuery();
        const pageKey = queryKeyOf(q) + "|" + page;

        let result = pageCache.get(pageKey);

        if (!result) {
            result = await loadPage(q, page, signal);

            if (requestId !== requestCounter) return;

            rememberPage(pageKey, result);
        }

        const loaded = result.loaded;
        const total = result.total;

        totalResults = total;
        totalPages = Math.max(1, Math.min(MAX_ROOMS, Math.ceil(total / PAGE_SIZE)));

        relevanceOrder = loaded;
        artworks = sortArtworks(loaded);

        if (showFavorites) {
            buildHall();
            return;
        }

        updateHeading();

        if (artworks.length === 0) {
            container.innerHTML = "";
            emptyState.classList.remove("d-none");
            displayPagination();
            return;
        }

        displayArtworks(artworks);
        displayPagination();
        buildHall();

        prefetchNext(q, page);

    } catch (error) {

        if (requestId !== requestCounter) return;

        console.error("Artwork error:", error);

        if (showFavorites) return;

        container.innerHTML = `
            <div class="text-center py-5" style="grid-column:1/-1">
                <h5>Unable to load artworks.</h5>
                <p>${escapeHTML(friendlyError(error))}</p>
                <button class="btn-brown" onclick="fetchArtworks(currentPage, currentSearch, false)">Try Again</button>
            </div>
        `;
    }
}

async function loadDepartments() {
    try {
        const response = await fetch(`${API_URL}/departments`);

        if (!response.ok) {
            throw new Error("Unable to load departments.");
        }

        const data = await response.json();

        (data.departments || []).forEach(dept => {
            const option = document.createElement("option");
            option.value = String(dept.departmentId);
            option.textContent = dept.displayName;
            categoryFilter.appendChild(option);
        });

        categoryFilter.value = currentDept;

        setStat("statDepartments", (data.departments || []).length);

    } catch (error) {
        console.error("Departments error:", error);
    }
}

const frameStyles = ["", "ebony", "walnut", "wine", "silver", "", "walnut"];

function displayArtworks(data) {
    container.innerHTML = "";

    const favIds = new Set(getFavs().map(a => Number(a.objectID)));

    data.forEach((art, i) => {
        const saved = favIds.has(Number(art.objectID));
        const picked = isComparing(art.objectID);

        const title = art.title || "Untitled";
        const artist = art.artistDisplayName || "Unknown artist";
        const category = art.department || art.objectName || "Artwork";
        const date = art.objectDate ? ", " + art.objectDate : "";

        const card = document.createElement("div");
        card.className = "hang";
        card.style.setProperty("--i", i);

        card.innerHTML = `
            <div class="pic">
                <div class="frame ${frameStyles[i % frameStyles.length]}">
                    <button class="fav-btn ${saved ? "is-fav" : ""}" data-id="${Number(art.objectID)}"
                        aria-label="${saved ? "Remove from" : "Save to"} My Collection" aria-pressed="${saved}"
                        onclick="toggleFav(${Number(art.objectID)})">${heartIcon(saved)}</button>
                    <div class="mat">
                        <img src="${escapeHTML(art.primaryImageSmall || NO_IMAGE)}"
                            alt="${escapeHTML(title)}" loading="lazy"
                            onerror="this.onerror=null; this.src='${NO_IMAGE}'">
                    </div>
                </div>
            </div>
            <div class="placard">
                <div class="art-category">${escapeHTML(category)}</div>
                <h5 class="art-title" title="${escapeHTML(title)}">${escapeHTML(title)}</h5>
                <p class="artist-name">${escapeHTML(artist + date)}</p>
                <div class="placard-actions">
                    <button class="view-btn" onclick="viewDetails(${Number(art.objectID)})">View details</button>
                    <button type="button" class="compare-btn ${picked ? "is-on" : ""}" data-id="${Number(art.objectID)}"
                        aria-pressed="${picked}" onclick="toggleCompare(${Number(art.objectID)})">${compareLabel(picked)}</button>
                </div>
            </div>
        `;

        container.appendChild(card);
    });
}

function showSkeletons() {
    container.innerHTML = Array.from({ length: PAGE_SIZE }, () => `
        <div class="hang skeleton" aria-hidden="true">
            <div class="sk-pic"></div>
            <div class="sk-placard">
                <span class="sk-line w40"></span>
                <span class="sk-line w90"></span>
                <span class="sk-line w70"></span>
            </div>
        </div>`).join("");
}

function updateHeading() {
    updateTitle();

    if (showFavorites && currentShared) {
        const n = collectionList().length;

        galleryTitle.textContent = "Shared Collection";
        resultCount.textContent = sharedLoading
            ? "Loading the shared works..."
            : n
                ? `${n} ${n === 1 ? "work" : "works"} shared with you. Tap a heart to keep one.`
                : "Nothing to show here.";
        return;
    }

    if (showFavorites) {
        const n = getFavs().length;

        galleryTitle.textContent = "My Collection";
        resultCount.textContent = n
            ? `${n} saved ${n === 1 ? "work" : "works"}. Tap a heart to remove one.`
            : "Nothing saved yet.";
        return;
    }

    galleryTitle.textContent = currentSearch === DEFAULT_SEARCH && !filtersActive()
        ? "Explore Artworks"
        : "Search Results";

    const summary = filterSummary();

    resultCount.textContent =
        `Room ${currentPage} of ${totalPages.toLocaleString()} \u00b7 ${artworks.length} works`
        + (summary ? ` \u00b7 ${summary}` : "");
}

function displayPagination() {
    pagination.innerHTML = "";

    if (totalPages <= 1) return;

    const previous = document.createElement("li");
    previous.className = `page-item ${currentPage === 1 ? "disabled" : ""}`;
    previous.innerHTML = `<button class="page-link">Previous room</button>`;
    previous.querySelector("button").onclick = () => {
        if (currentPage > 1) fetchArtworks(currentPage - 1, currentSearch);
    };
    pagination.appendChild(previous);

    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);

    for (let page = start; page <= end; page++) {
        const item = document.createElement("li");
        item.className = `page-item ${page === currentPage ? "active" : ""}`;
        item.innerHTML = `<button class="page-link">${page}</button>`;
        item.querySelector("button").onclick = () => fetchArtworks(page, currentSearch);
        pagination.appendChild(item);
    }

    const next = document.createElement("li");
    next.className = `page-item ${currentPage === totalPages ? "disabled" : ""}`;
    next.innerHTML = `<button class="page-link">Next room</button>`;
    next.querySelector("button").onclick = () => {
        if (currentPage < totalPages) fetchArtworks(currentPage + 1, currentSearch);
    };
    pagination.appendChild(next);

    const jump = document.createElement("li");
    jump.className = "page-jump";
    jump.innerHTML = `
        <label for="pageJumpInput">Go to</label>
        <input type="number" id="pageJumpInput" min="1" max="${totalPages}"
            placeholder="${currentPage}" inputmode="numeric" aria-label="Page number">
        <span>of ${totalPages.toLocaleString()}</span>
        <button type="button">Go</button>
    `;

    const jumpInput = jump.querySelector("input");

    const goToPage = () => {
        const value = parseInt(jumpInput.value, 10);

        if (!Number.isFinite(value)) {
            jumpInput.focus();
            return;
        }

        const page = Math.min(Math.max(value, 1), totalPages);

        if (page === currentPage) {
            jumpInput.value = "";
            return;
        }

        fetchArtworks(page, currentSearch);
    };

    jump.querySelector("button").onclick = goToPage;
    jumpInput.addEventListener("keydown", event => {
        if (event.key === "Enter") goToPage();
    });

    pagination.appendChild(jump);
}

function filtersActive() {
    return currentDept !== "all" || currentHighlight || currentFrom !== null;
}

function normalizeRange(a, b) {
    const hasA = Number.isFinite(a);
    const hasB = Number.isFinite(b);

    if (!hasA && !hasB) return { from: null, to: null };

    let from = hasA ? a : MIN_YEAR;
    let to = hasB ? b : MAX_YEAR;

    if (from > to) [from, to] = [to, from];

    return { from, to };
}

function syncFilterControls() {
    categoryFilter.value = currentDept;
    highlightToggle.checked = currentHighlight;
    yearFrom.value = currentFrom ?? "";
    yearTo.value = currentTo ?? "";
    clearFiltersBtn.hidden = !filtersActive();

    eraChips.querySelectorAll(".chip").forEach(chip => {
        const r = normalizeRange(parseInt(chip.dataset.from, 10), parseInt(chip.dataset.to, 10));
        chip.classList.toggle("active", r.from === currentFrom && r.to === currentTo);
    });

    const active = (currentDept !== "all") + currentHighlight + (currentFrom !== null);
    filterCount.textContent = active;
    filterCount.hidden = active === 0;
}

function toggleFilterPanel(force) {
    const open = typeof force === "boolean" ? force : filterPanel.hidden;

    filterPanel.hidden = !open;
    filtersBtn.setAttribute("aria-expanded", String(open));
}

eraChips.addEventListener("click", event => {
    const chip = event.target.closest(".chip");
    if (!chip) return;

    yearFrom.value = chip.dataset.from;
    yearTo.value = chip.dataset.to;
    applyFilters();
});

document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || filterPanel.hidden) return;
    if (document.querySelector(".modal.show")) return;

    toggleFilterPanel(false);
    filtersBtn.focus();
});

function formatYear(year) {
    if (year === MIN_YEAR) return "earliest";
    if (year === MAX_YEAR) return "today";
    return year < 0 ? `${-year} B.C.` : String(year);
}

function filterSummary() {
    const parts = [];

    if (currentDept !== "all" && categoryFilter.selectedOptions[0]) {
        parts.push(categoryFilter.selectedOptions[0].textContent);
    }

    if (currentHighlight) parts.push("Masterworks");

    if (currentFrom !== null) {
        parts.push(`${formatYear(currentFrom)} to ${formatYear(currentTo)}`);
    }

    return parts.join(" \u00b7 ");
}

function applyFilters() {
    currentDept = categoryFilter.value;
    currentHighlight = highlightToggle.checked;

    const range = normalizeRange(parseInt(yearFrom.value, 10), parseInt(yearTo.value, 10));
    currentFrom = range.from;
    currentTo = range.to;

    syncFilterControls();
    fetchArtworks(1, currentSearch);
}

function clearFilters() {
    currentDept = "all";
    currentHighlight = false;
    currentFrom = null;
    currentTo = null;

    syncFilterControls();
    fetchArtworks(1, currentSearch);
}

[yearFrom, yearTo].forEach(input =>
    input.addEventListener("keydown", event => {
        if (event.key === "Enter") applyFilters();
    })
);

function searchArt() {
    const query = searchInput.value.trim();

    if (!query) {
        resetGallery();
        return;
    }

    fetchArtworks(1, query);
}

searchInput.addEventListener("keydown", event => {
    if (event.key === "Enter") searchArt();
});

function toggleClear() {
    searchClear.hidden = !searchInput.value;
}

searchInput.addEventListener("input", toggleClear);

searchClear.addEventListener("click", () => {
    searchInput.value = "";
    toggleClear();
    searchInput.focus();

    if (currentSearch !== DEFAULT_SEARCH) fetchArtworks(1, DEFAULT_SEARCH);
});

async function randomArt() {
    if (showFavorites) {
        const favs = collectionList();
        if (favs.length) viewDetails(favs[Math.floor(Math.random() * favs.length)].objectID);
        return;
    }

    const label = randomBtn.textContent;

    randomBtn.disabled = true;
    randomBtn.textContent = "Choosing...";

    try {
        if (!allObjectIDs) {
            const response = await fetch(`${API_URL}/objects`);

            if (!response.ok) {
                throw new Error("Unable to load the collection.");
            }

            allObjectIDs = (await response.json()).objectIDs || [];
        }

        if (!allObjectIDs.length) {
            throw new Error("The collection is empty.");
        }

        for (let round = 0; round < 4; round++) {
            const picks = Array.from({ length: 4 }, () =>
                allObjectIDs[Math.floor(Math.random() * allObjectIDs.length)]
            );

            const results = await Promise.all(picks.map(id => fetchArtworkDetails(id)));
            const found = results.find(Boolean);

            if (found) {
                viewDetails(found.objectID, found);
                return;
            }
        }

        throw new Error("Couldn't find an artwork this time. Try again.");

    } catch (error) {
        console.error("Surprise error:", error);
        resultCount.textContent = error.message;

    } finally {
        randomBtn.disabled = false;
        randomBtn.textContent = label;
    }
}

function resetGallery() {
    searchInput.value = "";
    toggleClear();

    currentDept = "all";

    currentHighlight = false;
    currentFrom = null;
    currentTo = null;
    syncFilterControls();

    sortSelect.value = "relevance";
    currentSort = "relevance";

    fetchArtworks(1, DEFAULT_SEARCH);
}

async function viewDetails(id, preloaded = null) {
    const modal = bootstrap.Modal.getOrCreateInstance(artModalEl);

    const pools = showFavorites ? [collectionList(), artworks] : [artworks, getFavs()];
    let art = preloaded;

    if (art) {
        modalList = [];
    } else {
        for (const pool of pools) {
            const found = pool.find(item => Number(item.objectID) === Number(id));

            if (found) {
                art = found;
                modalList = pool;
                break;
            }
        }
    }

    if (!art) {
        modalList = [];
        modalContent.innerHTML = `
            <div class="text-center py-5">
                <div class="spinner-border mb-3"></div>
                <p>Loading artwork details...</p>
            </div>
        `;
    }

    modal.show();

    currentObject = Number(id);
    syncURL(false);

    try {
        if (!art) {
            const response = await fetchWithRetry(`${API_URL}/objects/${id}`);

            if (!response.ok) {
                throw new Error("Unable to retrieve artwork details.");
            }

            art = await response.json();
        }

        modalArt = art;
        renderModal(art);

    } catch (error) {
        modalContent.innerHTML = `
            <div class="text-center py-5">
                <h5>Unable to load details.</h5>
                <p>Please try again.</p>
            </div>
        `;

        console.error("Detail error:", error);

        currentObject = null;
        syncURL(false);
    }
}

function renderModal(art) {

    const title = art.title || "Untitled";
    const artist = art.artistDisplayName || "Unknown Artist";
    const mainImage = art.primaryImage || art.primaryImageSmall || "";
    const fallback = art.primaryImageSmall || NO_IMAGE;

    const extras = Array.isArray(art.additionalImages) ? art.additionalImages : [];
    const images = [...new Set([mainImage, ...extras].filter(Boolean))].slice(0, 6);

    const thumbs = images.length > 1 ? `
        <div class="modal-thumbs">
            ${images.map((src, i) => `
                <button type="button" class="thumb ${i === 0 ? "active" : ""}"
                    data-src="${escapeHTML(src)}" aria-label="Show view ${i + 1}"
                    onclick="swapModalImage(this)">
                    <img src="${escapeHTML(i === 0 && art.primaryImageSmall ? art.primaryImageSmall : src)}" alt="" loading="lazy">
                </button>`).join("")}
        </div>` : "";

    const metUrl = typeof art.objectURL === "string" && art.objectURL.startsWith("https://")
        ? art.objectURL
        : "";

    const index = modalList.findIndex(item => Number(item.objectID) === Number(art.objectID));

    const nav = modalList.length > 1 && index >= 0 ? `
        <div class="modal-nav">
            <button type="button" onclick="modalStep(-1)">&#8249; Previous</button>
            <span>${index + 1} of ${modalList.length}</span>
            <button type="button" onclick="modalStep(1)">Next &#8250;</button>
        </div>` : "";

    const tags = tagTerms(art);

    const tagRow = tags.length ? `
        <div class="tag-row" role="group" aria-label="Subjects">
            ${tags.map(tag => `<button type="button" class="tag-chip" data-tag="${escapeHTML(tag)}"
                onclick="searchTag(this.dataset.tag)">${escapeHTML(tag)}</button>`).join("")}
        </div>` : "";

    const saved = isFav(art.objectID);

    const nationality = (art.artistNationality || "").trim();
    const bio = (art.artistDisplayBio || "").trim();
    const wikiUrl = [art.artistWikipediaURL, art.artistWikidataURL || art.artistWikidata_URL]
        .find(u => typeof u === "string" && u.startsWith("https://")) || "";
    const wikiLabel = wikiUrl.includes("wikipedia.org") ? "Wikipedia" : "Wikidata";

    const artistInfo = bio || nationality;

    modalContent.innerHTML = `
        <div class="row g-4">

            <div class="col-md-6">
                <button type="button" class="zoom-btn" onclick="openLightbox()" aria-label="View larger image">
                    <img id="modalMainImg" class="modal-art"
                        src="${escapeHTML(mainImage || fallback)}"
                        alt="${escapeHTML(title)}"
                        data-fallback="${escapeHTML(fallback)}"
                        onerror="this.onerror=null; this.src=this.dataset.fallback">
                </button>
                ${thumbs}
            </div>

            <div class="col-md-6">
                <div class="detail-label">${escapeHTML(art.department || art.objectName || "Artwork")}</div>
                <h2 class="modal-title mt-2 mb-2">${escapeHTML(title)}</h2>
                <p class="text-muted artist-line mb-1">${escapeHTML(artist)}</p>
                ${artistInfo ? `<p class="artist-bio mb-1">${escapeHTML(artistInfo)}</p>` : ""}
                ${wikiUrl ? `<a class="artist-link" href="${escapeHTML(wikiUrl)}" target="_blank" rel="noopener noreferrer">About the artist on ${wikiLabel} &#8599;</a>` : ""}

                <hr class="my-2">

                <div class="detail-grid">
                    <div>
                        <div class="detail-label">Date Created</div>
                        <div class="detail-value">${escapeHTML(art.objectDate || "Not available")}</div>
                    </div>
                    <div>
                        <div class="detail-label">Culture</div>
                        <div class="detail-value">${escapeHTML(art.culture || "Not available")}</div>
                    </div>
                    <div>
                        <div class="detail-label">Period</div>
                        <div class="detail-value">${escapeHTML(art.period || "Not available")}</div>
                    </div>
                    <div>
                        <div class="detail-label">Accession Number</div>
                        <div class="detail-value">${escapeHTML(art.accessionNumber || "Not available")}</div>
                    </div>
                    <div class="span2">
                        <div class="detail-label">Medium</div>
                        <div class="detail-value">${escapeHTML(art.medium || "Not available")}</div>
                    </div>
                    <div class="span2">
                        <div class="detail-label">Dimensions</div>
                        <div class="detail-value">${escapeHTML(art.dimensions || "Not available")}</div>
                    </div>
                    <div class="span2">
                        <div class="detail-label">Collection Information</div>
                        <div class="detail-value">${escapeHTML(art.creditLine || "Not available")}</div>
                    </div>
                    <div>
                        <div class="detail-label">Public Domain</div>
                        <div class="detail-value">${art.isPublicDomain ? "Yes" : "No"}</div>
                    </div>
                </div>

                ${tagRow}

                <div class="modal-actions">
                    <button type="button" class="btn-brown" id="modalFavBtn"
                        onclick="toggleFav(${Number(art.objectID)})">
                        ${saved ? "&#9829; Saved" : "&#9825; Save to My Collection"}
                    </button>
                    <button type="button" class="btn-line" id="modalCompareBtn" onclick="toggleCompare(${Number(art.objectID)})"
                        aria-pressed="${isComparing(art.objectID)}">${compareLabel(isComparing(art.objectID))}</button>
                    <button type="button" class="btn-line btn-icon" onclick="copyArtLink(this)"
                        aria-label="Copy link to this artwork" title="Copy link">${LINK_ICON}</button>
                    ${metUrl ? `<a class="btn-line" href="${escapeHTML(metUrl)}" target="_blank" rel="noopener noreferrer">View on The Met &#8599;</a>` : ""}
                </div>
            </div>
        </div>

        <div class="related" id="relatedWorks" hidden></div>

        ${nav}
    `;

    modalContent.scrollTop = 0;
    updateTitle();
    loadRelated(art);
}

function modalStep(direction) {
    if (!modalArt || modalList.length < 2) return;

    const index = modalList.findIndex(a => Number(a.objectID) === Number(modalArt.objectID));
    if (index < 0) return;

    const n = modalList.length;
    viewDetails(modalList[(index + direction + n) % n].objectID);
}

function swapModalImage(button) {
    const main = document.getElementById("modalMainImg");
    if (!main) return;

    main.src = button.dataset.src;

    document.querySelectorAll(".modal-thumbs .thumb").forEach(t =>
        t.classList.toggle("active", t === button)
    );
}

async function copyArtLink(button) {
    if (!modalArt) return;

    const base = location.href.split(/[?#]/)[0];

    const copied = await copyLink(`${base}?object=${Number(modalArt.objectID)}`, button, CHECK_ICON);

    if (copied) showToast("Link copied.");
}

function tagTerms(art) {
    const tags = Array.isArray(art.tags) ? art.tags : [];
    const terms = tags.map(tag => typeof tag === "string" ? tag : tag && tag.term).filter(Boolean);

    return [...new Set(terms)].slice(0, 8);
}

function searchTag(term) {
    bootstrap.Modal.getInstance(artModalEl)?.hide();

    searchInput.value = term;
    toggleClear();
    fetchArtworks(1, term);

    document.getElementById("gallery").scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth" });
}

function openRelated(id) {
    viewDetails(id, detailCache.get(Number(id)) || null);
}

async function loadRelated(art) {
    if (relatedController) relatedController.abort();

    const controller = new AbortController();
    const signal = controller.signal;
    relatedController = controller;

    const artist = (art.artistDisplayName || "").trim();
    const culture = (art.culture || "").trim();
    const tag = tagTerms(art)[0];

    const params = new URLSearchParams({ hasImages: "true", offset: "0", limit: "12" });
    let label;

    if (artist) {
        params.set("q", artist);
        params.set("artistOrCulture", "true");
        label = `More by ${artist}`;
    } else if (culture) {
        params.set("q", culture);
        params.set("artistOrCulture", "true");
        label = `More from ${culture}`;
    } else if (tag) {
        params.set("q", tag);
        params.set("tags", "true");
        label = `More about \u201c${tag}\u201d`;
    } else {
        return;
    }

    try {
        await sleep(400, signal);
        if (signal.aborted) return;

        const result = await fetchSearch(params, signal);
        const ids = result.ids.filter(id => Number(id) !== Number(art.objectID)).slice(0, 8);

        if (!ids.length) return;

        const works = (await fetchMultipleArtworks(ids, signal)).filter(Boolean).slice(0, 4);

        const box = document.getElementById("relatedWorks");
        const stillOpen = modalArt && Number(modalArt.objectID) === Number(art.objectID);

        if (signal.aborted || !works.length || !box || !stillOpen) return;

        box.innerHTML = `
            <div class="detail-label">${escapeHTML(label)}</div>
            <div class="related-grid">
                ${works.map(work => {
                    const title = work.title || "Untitled";

                    return `
                    <button type="button" class="related-item" onclick="openRelated(${Number(work.objectID)})">
                        <img src="${escapeHTML(work.primaryImageSmall || NO_IMAGE)}" alt="" loading="lazy"
                            onerror="this.onerror=null; this.src='${NO_IMAGE}'">
                        <span>${escapeHTML(title)}</span>
                    </button>`;
                }).join("")}
            </div>`;

        box.hidden = false;

    } catch (error) {
        if (error.name !== "AbortError") console.warn("Related works:", error);
    }
}

const lightbox = document.getElementById("lightbox");
const lightboxStage = document.getElementById("lightboxStage");
const lightboxImg = document.getElementById("lightboxImg");
const zoomLevel = document.getElementById("zoomLevel");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");

const ZOOM_MAX = 8;
const zoom = { s: 1, x: 0, y: 0 };
const pointers = new Map();
let gesture = null;
let didMove = false;
let lastTap = { t: 0, x: 0, y: 0 };
let hintTimer = null;

function applyZoom(animate) {
    const maxX = Math.max(0, (lightboxImg.offsetWidth * zoom.s - lightboxStage.clientWidth) / 2);
    const maxY = Math.max(0, (lightboxImg.offsetHeight * zoom.s - lightboxStage.clientHeight) / 2);

    zoom.x = Math.min(maxX, Math.max(-maxX, zoom.x));
    zoom.y = Math.min(maxY, Math.max(-maxY, zoom.y));

    lightboxImg.style.transition = animate ? "transform .2s ease" : "none";
    lightboxImg.style.transform = `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.s})`;

    zoomLevel.textContent = Math.round(zoom.s * 100) + "%";
    zoomOutBtn.disabled = zoom.s <= 1.001;
    zoomInBtn.disabled = zoom.s >= ZOOM_MAX - 0.001;
    lightbox.classList.toggle("is-zoomed", zoom.s > 1.01);
}

function zoomTo(next, px = 0, py = 0, animate = false) {
    next = Math.min(ZOOM_MAX, Math.max(1, next));

    const k = next / zoom.s;
    zoom.x = px - (px - zoom.x) * k;
    zoom.y = py - (py - zoom.y) * k;
    zoom.s = next;

    applyZoom(animate);
}

function resetZoom(animate) {
    zoom.s = 1;
    zoom.x = 0;
    zoom.y = 0;
    applyZoom(animate);
}

function stagePoint(e) {
    const r = lightboxStage.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
}

function startGesture() {
    const pts = [...pointers.values()];

    gesture = { s: zoom.s, x: zoom.x, y: zoom.y, pts };

    if (pts.length >= 2) {
        gesture.dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        gesture.mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    }
}

function openLightbox() {
    const main = document.getElementById("modalMainImg");
    if (!main) return;

    lightboxImg.src = main.src;
    lightboxImg.alt = main.alt;

    pointers.clear();
    resetZoom(false);

    lightbox.hidden = false;
    lightbox.classList.remove("hint-gone");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => lightbox.classList.add("hint-gone"), 4500);

    lightbox.focus({ preventScroll: true });
}

function closeLightbox() {
    if (lightbox.hidden) return;

    lightbox.hidden = true;
    pointers.clear();
    gesture = null;

    const opener = document.querySelector("#modalContent .zoom-btn");
    if (opener) opener.focus({ preventScroll: true });
}

lightboxStage.addEventListener("wheel", e => {
    e.preventDefault();

    const p = stagePoint(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;

    zoomTo(zoom.s * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)), p.x, p.y);
}, { passive: false });

lightboxStage.addEventListener("pointerdown", e => {
    if (e.button > 0) return;

    lightboxStage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, stagePoint(e));

    if (pointers.size === 1) didMove = false;
    startGesture();

    if (zoom.s > 1) lightbox.classList.add("is-dragging");
});

lightboxStage.addEventListener("pointermove", e => {
    if (!pointers.has(e.pointerId) || !gesture) return;

    pointers.set(e.pointerId, stagePoint(e));
    const pts = [...pointers.values()];

    if (pts.length >= 2) {
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        const next = Math.min(ZOOM_MAX, Math.max(1, gesture.s * dist / gesture.dist));
        const k = next / gesture.s;

        zoom.s = next;
        zoom.x = mid.x - (gesture.mid.x - gesture.x) * k;
        zoom.y = mid.y - (gesture.mid.y - gesture.y) * k;
        didMove = true;

    } else {
        const dx = pts[0].x - gesture.pts[0].x;
        const dy = pts[0].y - gesture.pts[0].y;

        if (Math.hypot(dx, dy) > 4) didMove = true;

        if (zoom.s > 1) {
            zoom.x = gesture.x + dx;
            zoom.y = gesture.y + dy;
        }
    }

    applyZoom(false);
});

function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;

    pointers.delete(e.pointerId);

    if (pointers.size) {
        startGesture();
        didMove = true;
        return;
    }

    gesture = null;
    lightbox.classList.remove("is-dragging");

    if (e.type !== "pointerup" || didMove) return;

    const p = stagePoint(e);
    const now = Date.now();

    if (now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
        lastTap.t = 0;
        zoomTo(zoom.s > 1.01 ? 1 : 2.5, p.x, p.y, true);
    } else {
        lastTap = { t: now, x: p.x, y: p.y };
    }
}

lightboxStage.addEventListener("pointerup", endPointer);
lightboxStage.addEventListener("pointercancel", endPointer);

lightboxStage.addEventListener("click", e => {
    if (didMove) return;

    const r = lightboxImg.getBoundingClientRect();
    const onImage = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;

    if (!onImage) closeLightbox();
});

zoomInBtn.addEventListener("click", () => zoomTo(zoom.s * 1.5, 0, 0, true));
zoomOutBtn.addEventListener("click", () => zoomTo(zoom.s / 1.5, 0, 0, true));
document.getElementById("zoomResetBtn").addEventListener("click", () => resetZoom(true));

document.addEventListener("keydown", e => {
    if (lightbox.hidden) return;

    const step = 70;

    if (e.key === "+" || e.key === "=") zoomTo(zoom.s * 1.5, 0, 0, true);
    else if (e.key === "-" || e.key === "_") zoomTo(zoom.s / 1.5, 0, 0, true);
    else if (e.key === "0") resetZoom(true);
    else if (zoom.s > 1 && e.key.startsWith("Arrow")) {
        zoom.x += e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0;
        zoom.y += e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
        applyZoom(false);
    } else return;

    e.preventDefault();
});

window.addEventListener("resize", () => {
    if (!lightbox.hidden) applyZoom(false);
});

document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !lightbox.hidden) {
        e.preventDefault();
        e.stopPropagation();
        closeLightbox();
    }
}, true);

artModalEl.addEventListener("hidden.bs.modal", () => {
    closeLightbox();

    if (relatedController) relatedController.abort();

    currentObject = null;
    syncURL(false);
});

function heartIcon(filled) {
    return `<img src="images/${filled ? "heart-filled" : "heart"}.png" alt="" width="20" height="20">`;
}

function getFavs() {
    try {
        const saved = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
        return Array.isArray(saved) ? saved : [];
    } catch (error) {
        return [];
    }
}

function saveFavs(list) {
    try {
        localStorage.setItem(FAV_KEY, JSON.stringify(list));
    } catch (error) {
        console.error("Favorites error:", error);
    }
}

function isFav(id) {
    return getFavs().some(a => Number(a.objectID) === Number(id));
}

function findArtwork(id) {
    return artworks.find(a => Number(a.objectID) === Number(id))
        || (sharedList && sharedList.find(a => Number(a.objectID) === Number(id)))
        || (modalArt && Number(modalArt.objectID) === Number(id) ? modalArt : null);
}

function toggleFav(id) {
    const favs = getFavs();
    const index = favs.findIndex(a => Number(a.objectID) === Number(id));

    if (index >= 0) {
        const [removed] = favs.splice(index, 1);

        saveFavs(favs);
        updateFavUI();

        showToast(`Removed \u201c${removed.title || "Untitled"}\u201d`, "Undo", () => restoreFav(removed, index));
        return;
    }

    const art = findArtwork(id);
    if (!art) return;

    favs.unshift(art);

    saveFavs(favs);
    updateFavUI();
}

function restoreFav(art, index) {
    const favs = getFavs();

    if (favs.some(a => Number(a.objectID) === Number(art.objectID))) return;

    favs.splice(Math.min(index, favs.length), 0, art);

    saveFavs(favs);
    updateFavUI();
}

function updateFavUI() {
    const favIds = new Set(getFavs().map(a => Number(a.objectID)));

    document.querySelectorAll(".fav-btn").forEach(btn => {
        const on = favIds.has(Number(btn.dataset.id));
        btn.classList.toggle("is-fav", on);
        btn.setAttribute("aria-pressed", String(on));
        btn.setAttribute("aria-label", on ? "Remove from My Collection" : "Save to My Collection");
        btn.innerHTML = heartIcon(on);
    });

    const modalBtn = document.getElementById("modalFavBtn");

    if (modalBtn && modalArt) {
        modalBtn.innerHTML = favIds.has(Number(modalArt.objectID))
            ? "&#9829; Saved"
            : "&#9825; Save to My Collection";
    }

    if (showFavorites) {
        renderFavorites();
    } else {
        syncFavButton();
    }
}

function syncFavButton() {
    favBtn.innerHTML = showFavorites
        ? "Back to Gallery"
        : `My Collection <span class="fav-count" id="favCount">${getFavs().length}</span>`;

    categoryFilter.disabled = showFavorites;
    sortSelect.disabled = showFavorites;

    [highlightToggle, yearFrom, yearTo, yearApply, clearFiltersBtn, filtersBtn].forEach(el => {
        el.disabled = showFavorites;
    });

    if (showFavorites) toggleFilterPanel(false);

    syncCollectionTools();

    eraChips.querySelectorAll(".chip").forEach(chip => { chip.disabled = showFavorites; });

    randomBtn.title = showFavorites
        ? "Open a random work from your collection"
        : "Open a random work from the whole Met collection";
}

function collectionList() {
    return sharedList || getFavs();
}

function syncCollectionTools() {
    const visible = showFavorites && !sharedLoading && collectionList().length > 0;

    collectionTools.hidden = !visible;
    shareBtn.hidden = !(visible && !currentShared);
    saveSharedBtn.hidden = !(visible && currentShared);
}

function renderFavorites() {
    const favs = collectionList();

    pagination.innerHTML = "";
    emptyState.classList.add("d-none");

    syncFavButton();
    updateHeading();

    if (sharedLoading) {
        showSkeletons();
        return;
    }

    if (!favs.length) {
        container.innerHTML = currentShared
            ? `
            <div class="text-center py-5" style="grid-column:1/-1">
                <h4>Nothing to show.</h4>
                <p>The works in this link couldn't be loaded. They may no longer be available.</p>
                <button class="btn-brown" onclick="toggleFavorites()">Back to Gallery</button>
            </div>`
            : `
            <div class="text-center py-5" style="grid-column:1/-1">
                <h4>Your collection is empty.</h4>
                <p>Tap the heart on any artwork to keep it here.</p>
                <button class="btn-brown" onclick="toggleFavorites()">Back to Gallery</button>
            </div>`;
        return;
    }

    displayArtworks(favs);
}

function leaveShared() {
    if (!currentShared) return;

    sharedToken++;
    currentShared = null;
    sharedList = null;
    sharedLoading = false;
}

async function openSharedCollection(ids) {
    const token = ++sharedToken;

    currentShared = ids;
    sharedList = [];
    sharedLoading = true;
    showFavorites = true;

    syncURL(false);
    renderFavorites();

    const results = await fetchMultipleArtworks(ids);

    if (token !== sharedToken) return;

    sharedList = results.filter(Boolean);
    sharedLoading = false;

    renderFavorites();
}

const LINK_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;

const CHECK_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5"/></svg>`;

async function copyLink(link, button, doneHtml = "Link copied") {
    if (button.dataset.copying) return false;

    try {
        await navigator.clipboard.writeText(link);
    } catch (error) {
        window.prompt("Copy this link:", link);
        return false;
    }

    const original = button.innerHTML;

    button.dataset.copying = "1";
    button.innerHTML = doneHtml;

    setTimeout(() => {
        button.innerHTML = original;
        delete button.dataset.copying;
    }, 1800);

    return true;
}

function shareCollection(button) {
    const favs = getFavs();
    if (!favs.length) return;

    const ids = favs.slice(0, MAX_SHARED).map(a => Number(a.objectID));
    const base = location.href.split(/[?#]/)[0];

    copyLink(`${base}?collection=${ids.join(",")}`, button);

    if (favs.length > MAX_SHARED) {
        showToast(`The link holds your ${MAX_SHARED} most recent works.`);
    }
}

function saveSharedToCollection() {
    if (!sharedList || !sharedList.length) return;

    const favs = getFavs();
    const have = new Set(favs.map(a => Number(a.objectID)));
    const added = sharedList.filter(a => !have.has(Number(a.objectID)));

    if (!added.length) {
        showToast("They are all in your collection already.");
        return;
    }

    saveFavs([...added, ...favs]);
    updateFavUI();

    const addedIds = new Set(added.map(a => Number(a.objectID)));

    showToast(`Saved ${added.length} ${added.length === 1 ? "work" : "works"}.`, "Undo", () => {
        saveFavs(getFavs().filter(a => !addedIds.has(Number(a.objectID))));
        updateFavUI();
    });
}

let toastTimer = null;

function hideToast() {
    clearTimeout(toastTimer);
    toastWrap.innerHTML = "";
}

function showToast(message, actionLabel, onAction) {
    hideToast();

    const toast = document.createElement("div");
    toast.className = "art-toast";

    const text = document.createElement("span");
    text.textContent = message;
    toast.appendChild(text);

    if (actionLabel) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = actionLabel;
        button.onclick = () => {
            hideToast();
            onAction();
        };
        toast.appendChild(button);
    }

    toastWrap.appendChild(toast);
    toastTimer = setTimeout(hideToast, 6000);
}

function toggleFavorites() {
    if (showFavorites) {
        const wasShared = Boolean(currentShared);

        leaveShared();
        showFavorites = false;
        syncFavButton();

        if (wasShared) syncURL(false);

        if (!artworks.length) {
            fetchArtworks(currentPage, currentSearch);
            return;
        }

        emptyState.classList.add("d-none");
        updateHeading();
        displayArtworks(artworks);
        displayPagination();
        return;
    }

    showFavorites = true;
    renderFavorites();
}

function buildHall() {
    hallItems = artworks.slice(0, 7);
    hallIndex = Math.floor(hallItems.length / 2);

    document.getElementById("hallTrack").innerHTML = hallItems.map((a, i) => `
        <figure class="slide" data-i="${i}" role="button" tabindex="0"
            aria-label="${escapeHTML((a.title || "Untitled") + ", " + (a.artistDisplayName || "Unknown artist"))}">
            <div class="frame ${["", "ebony", "walnut", "wine", "silver"][i % 5]}">
                <div class="mat">
                    <img src="${escapeHTML(a.primaryImageSmall)}" alt="">
                </div>
            </div>
        </figure>`).join("");

    document.querySelectorAll("#hallTrack .slide").forEach(el => {
        el.onclick = () => {
            const i = Number(el.dataset.i);
            i === hallIndex ? openHall() : goHall(i);
        };

        el.onkeydown = e => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                el.onclick();
            }
        };
    });

    renderHall();
}

function renderHall() {
    const n = hallItems.length;
    if (!n) return;

    const half = Math.floor(n / 2);

    document.querySelectorAll("#hallTrack .slide").forEach((el, i) => {
        const o = ((i - hallIndex + half) % n + n) % n - half;
        el.style.setProperty("--o", o);
        el.style.setProperty("--ao", Math.abs(o));
        el.style.zIndex = 10 - Math.abs(o);
        const hidden = Math.abs(o) > 2;

        el.classList.toggle("is-hidden", hidden);
        el.tabIndex = hidden ? -1 : 0;
        el.setAttribute("aria-hidden", String(hidden));
    });

    const art = hallItems[hallIndex];

    document.getElementById("featuredTitle").textContent = art.title || "Untitled";
    document.getElementById("featuredArtist").textContent =
        (art.artistDisplayName || "Unknown artist") + (art.objectDate ? ", " + art.objectDate : "");
}

function goHall(i) {
    const n = hallItems.length;
    if (!n) return;

    hallIndex = ((i % n) + n) % n;
    renderHall();
}

function openHall() {
    if (hallItems[hallIndex]) viewDetails(hallItems[hallIndex].objectID);
}

document.addEventListener("keydown", e => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
    if (e.target.closest && e.target.closest(".filter-panel")) return;

    if (!lightbox.hidden || document.querySelector("#compareModal.show")) return;

    if (document.querySelector(".modal.show")) {
        if (e.key === "ArrowLeft") modalStep(-1);
        if (e.key === "ArrowRight") modalStep(1);
        return;
    }

    if (e.key === "ArrowLeft") goHall(hallIndex - 1);
    if (e.key === "ArrowRight") goHall(hallIndex + 1);
});

let swipeX = null;

stage.addEventListener("pointerdown", e => { swipeX = e.clientX; });
stage.addEventListener("pointerup", e => {
    if (swipeX === null) return;

    const dx = e.clientX - swipeX;
    swipeX = null;

    if (Math.abs(dx) > 50) goHall(hallIndex + (dx < 0 ? 1 : -1));
});

function syncTourButton() {
    tourBtn.textContent = hallPaused ? "Play tour" : "Pause tour";
}

function toggleTour() {
    hallPaused = !hallPaused;
    syncTourButton();
}

setInterval(() => {
    if (document.hidden || hallPaused || !hallItems.length) return;
    if (document.querySelector(".modal.show") || stage.matches(":hover, :focus-within")) return;
    if (reduceMotion.matches) return;

    goHall(hallIndex + 1);
}, 6500);

function yearOf(art) {
    if (!art.objectDate) return null;

    const ancient = /b\.?c|millenn|century|ca\.\s*\d{1,3}\b/i.test(art.objectDate);
    const match = art.objectDate.match(/\b(\d{4})\b/);

    if (match && !ancient) return Number(match[1]);

    return typeof art.objectBeginDate === "number" ? art.objectBeginDate : null;
}

function compareYear(a, b, direction) {
    const x = yearOf(a);
    const y = yearOf(b);

    if (x === null && y === null) return compareTitle(a, b);
    if (x === null) return 1;
    if (y === null) return -1;

    return (x - y) * direction || compareTitle(a, b);
}

function titleKey(art) {
    return (art.title || "").replace(/^(the|a|an)\s+/i, "").trim();
}

function compareTitle(a, b) {
    return titleKey(a).localeCompare(titleKey(b), undefined, { sensitivity: "base", numeric: true });
}

function sortArtworks(list) {
    const sorted = [...list];

    if (currentSort === "title") {
        sorted.sort(compareTitle);

    } else if (currentSort === "artist") {
        sorted.sort((a, b) => {
            const x = a.artistDisplayName || "";
            const y = b.artistDisplayName || "";

            if (!x && y) return 1;
            if (x && !y) return -1;
            return x.localeCompare(y);
        });

    } else if (currentSort === "oldest") {
        sorted.sort((a, b) => compareYear(a, b, 1));

    } else if (currentSort === "newest") {
        sorted.sort((a, b) => compareYear(a, b, -1));
    }

    return sorted;
}

function changeSort() {
    currentSort = sortSelect.value;
    syncURL(false);

    if (!relevanceOrder.length) return;

    artworks = sortArtworks(relevanceOrder);
    displayArtworks(artworks);
}

function syncURL(push) {
    const params = new URLSearchParams();

    if (currentSearch !== DEFAULT_SEARCH) params.set("q", currentSearch);
    if (currentDept !== "all") params.set("dept", currentDept);
    if (currentSort !== "relevance") params.set("sort", currentSort);
    if (currentPage > 1) params.set("page", String(currentPage));
    if (currentHighlight) params.set("highlight", "1");

    if (currentFrom !== null && currentTo !== null) {
        params.set("from", String(currentFrom));
        params.set("to", String(currentTo));
    }

    if (currentObject) params.set("object", String(currentObject));
    if (currentShared) params.set("collection", currentShared.join(","));

    const query = params.toString().replace(/%2C/g, ",");
    const url = location.pathname + (query ? "?" + query : "");

    updateTitle();

    if (url === location.pathname + location.search) return;

    try {
        history[push ? "pushState" : "replaceState"](null, "", url);
    } catch (error) {
        console.warn("URL not updated:", error.message);
    }
}

function readURL() {
    const params = new URLSearchParams(location.search);
    const sort = params.get("sort");
    const page = parseInt(params.get("page"), 10);

    currentSearch = (params.get("q") || "").trim() || DEFAULT_SEARCH;
    currentDept = params.get("dept") || "all";
    currentSort = SORT_OPTIONS.includes(sort) ? sort : "relevance";

    currentHighlight = params.get("highlight") === "1";

    const range = normalizeRange(parseInt(params.get("from"), 10), parseInt(params.get("to"), 10));
    currentFrom = range.from;
    currentTo = range.to;

    const object = parseInt(params.get("object"), 10);
    currentObject = Number.isFinite(object) && object > 0 ? object : null;

    const shared = (params.get("collection") || "")
        .split(",")
        .map(n => parseInt(n, 10))
        .filter(n => Number.isFinite(n) && n > 0);

    pendingShared = shared.length ? [...new Set(shared)].slice(0, MAX_SHARED) : null;

    return Number.isFinite(page) && page > 0 ? Math.min(page, MAX_ROOMS) : 1;
}

function syncControls() {
    searchInput.value = currentSearch === DEFAULT_SEARCH ? "" : currentSearch;
    categoryFilter.value = currentDept;
    sortSelect.value = currentSort;
    syncFilterControls();
    toggleClear();
}

window.addEventListener("popstate", () => {
    const page = readURL();

    syncControls();
    fetchArtworks(page, currentSearch, false);

    if (pendingShared) openSharedCollection(pendingShared);

    if (currentObject) {
        viewDetails(currentObject);
    } else {
        const open = document.querySelector(".modal.show");
        if (open) bootstrap.Modal.getInstance(open)?.hide();
    }
});

const navMenu = document.getElementById("navbarMenu");
const navLinks = [...document.querySelectorAll(".navbar .nav-link")];
const navSections = navLinks.map(link => document.querySelector(link.getAttribute("href")));

navLinks.forEach(link => {
    link.addEventListener("click", () => {
        if (navMenu.classList.contains("show")) {
            bootstrap.Collapse.getOrCreateInstance(navMenu, { toggle: false }).hide();
        }
    });
});

function updateActiveNav() {
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    let current = 0;

    navSections.forEach((section, i) => {
        if (section && section.getBoundingClientRect().top <= window.innerHeight * 0.35) current = i;
    });

    if (atBottom) current = navSections.length - 1;

    navLinks.forEach((link, i) => {
        link.classList.toggle("active", i === current);

        if (i === current) {
            link.setAttribute("aria-current", "true");
        } else {
            link.removeAttribute("aria-current");
        }
    });
}

window.addEventListener("scroll", updateActiveNav, { passive: true });
window.addEventListener("resize", updateActiveNav);

const BASE_TITLE = document.title;

function updateTitle() {
    let title = BASE_TITLE;

    if (currentObject && modalArt && Number(modalArt.objectID) === Number(currentObject)) {
        const artist = (modalArt.artistDisplayName || "").trim();
        title = `${modalArt.title || "Untitled"}${artist ? " — " + artist : ""} | ArtSpace`;

    } else if (showFavorites) {
        title = `${currentShared ? "Shared Collection" : "My Collection"} | ArtSpace`;

    } else if (currentSearch !== DEFAULT_SEARCH || filtersActive()) {
        const what = currentSearch !== DEFAULT_SEARCH ? `“${currentSearch}”` : "Search results";
        const room = currentPage > 1 ? ` – Room ${currentPage}` : "";

        title = `${what}${room} | ArtSpace`;
    }

    document.title = title;
}

function plain(text) {
    return String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const ARTIST_TERMS = new Set([
    "Monet", "Van Gogh", "Rembrandt", "Vermeer", "Degas", "Renoir", "Cézanne", "Manet", "Sargent",
    "Turner", "Hokusai", "Egyptian"
].map(plain));

const DAILY_KEY = "artspace-daily";
let dailyArt = null;

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function dayNumber() {
    return Math.floor(Date.now() / 86400000);
}

async function pickDailyArtwork() {
    const base = new URLSearchParams({
        q: "painting",
        hasImages: "true",
        isHighlight: "true",
        offset: "0",
        limit: "1"
    });

    const first = await fetchSearch(base);
    const pool = Math.min(first.total, 2000);

    if (!pool) return null;

    const start = (dayNumber() * 7919) % pool;

    for (let i = 0; i < 8; i++) {
        const params = new URLSearchParams(base);
        params.set("offset", String((start + i) % pool));

        const result = await fetchSearch(params);
        const art = result.ids.length ? await fetchArtworkDetails(result.ids[0]) : null;

        if (art) return art;
    }

    return null;
}

function renderDaily(art) {
    dailyArt = art;

    const artist = (art.artistDisplayName || "").trim();
    const meta = [art.objectDate, art.medium].filter(Boolean).join(" · ");
    const date = new Date().toLocaleDateString(undefined, {
        weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC"
    });

    const img = document.getElementById("dailyImg");
    img.src = art.primaryImageSmall || NO_IMAGE;
    img.alt = art.title || "Untitled";
    img.onerror = () => { img.onerror = null; img.src = NO_IMAGE; };

    document.getElementById("dailyDate").textContent = date;
    document.getElementById("dailyTitle").textContent = art.title || "Untitled";
    document.getElementById("dailyArtist").textContent = artist || "Unknown artist";
    document.getElementById("dailyMeta").textContent = meta;

    document.getElementById("daily").hidden = false;
}

function openDaily() {
    if (dailyArt) viewDetails(dailyArt.objectID, dailyArt);
}

async function loadDailyArtwork() {
    try {
        const saved = JSON.parse(localStorage.getItem(DAILY_KEY) || "null");

        if (saved && saved.day === todayKey() && saved.art) {
            renderDaily(saved.art);
            return;
        }
    } catch (error) {
    }

    try {
        await sleep(1500);

        const art = await pickDailyArtwork();
        if (!art) return;

        renderDaily(art);

        try {
            localStorage.setItem(DAILY_KEY, JSON.stringify({ day: todayKey(), art }));
        } catch (error) {
        }

    } catch (error) {
        console.warn("Artwork of the day:", error);
    }
}

const compareModalEl = document.getElementById("compareModal");

function isComparing(id) {
    return compareList.some(a => Number(a.objectID) === Number(id));
}

function compareLabel(on) {
    return on ? "&#10003; Comparing" : "+ Compare";
}

function lookupArt(id) {
    return findArtwork(id)
        || getFavs().find(a => Number(a.objectID) === Number(id))
        || detailCache.get(Number(id))
        || null;
}

function toggleCompare(id) {
    const n = Number(id);
    const index = compareList.findIndex(a => Number(a.objectID) === n);

    if (index >= 0) {
        compareList.splice(index, 1);
        updateCompareUI();
        return;
    }

    const art = lookupArt(n);
    if (!art) return;

    const bumped = compareList.length >= COMPARE_MAX ? compareList.shift() : null;

    compareList.push(art);
    updateCompareUI();

    if (bumped) {
        showToast(`Two at a time: \u201c${bumped.title || "Untitled"}\u201d was swapped out.`);
    } else if (compareList.length === COMPARE_MAX && artModalEl.classList.contains("show")) {
        showToast("Ready to compare.", "Compare now", openCompare);
    }
}

function clearCompare() {
    compareList = [];
    updateCompareUI();
}

function updateCompareUI() {
    document.querySelectorAll(".compare-btn").forEach(btn => {
        const on = isComparing(btn.dataset.id);

        btn.classList.toggle("is-on", on);
        btn.setAttribute("aria-pressed", String(on));
        btn.innerHTML = compareLabel(on);
    });

    const modalBtn = document.getElementById("modalCompareBtn");

    if (modalBtn && modalArt) {
        const on = isComparing(modalArt.objectID);

        modalBtn.setAttribute("aria-pressed", String(on));
        modalBtn.innerHTML = compareLabel(on);
    }

    const tray = document.getElementById("compareTray");

    tray.hidden = compareList.length === 0;
    document.body.classList.toggle("has-tray", compareList.length > 0);
    document.getElementById("compareGo").disabled = compareList.length < COMPARE_MAX;

    document.getElementById("traySlots").innerHTML = Array.from({ length: COMPARE_MAX }, (_, i) => {
        const art = compareList[i];

        if (!art) return `<div class="slot empty">${i === 0 ? "Pick a work" : "Pick one more"}</div>`;

        const title = art.title || "Untitled";

        return `
            <div class="slot">
                <img src="${escapeHTML(art.primaryImageSmall || NO_IMAGE)}" alt="">
                <span>${escapeHTML(title)}</span>
                <button type="button" aria-label="Remove ${escapeHTML(title)} from compare"
                    onclick="toggleCompare(${Number(art.objectID)})">&times;</button>
            </div>`;
    }).join("");
}

const COMPARE_ROWS = [
    ["Date", a => a.objectDate],
    ["Culture", a => a.culture],
    ["Period", a => a.period],
    ["Medium", a => a.medium],
    ["Dimensions", a => a.dimensions],
    ["Collection", a => a.department],
    ["Credit line", a => a.creditLine]
];

let compareDiffOnly = false;

function toggleDiffOnly() {
    compareDiffOnly = !compareDiffOnly;
    renderCompare();
}

function renderCompare() {
    const column = art => {
        const title = art.title || "Untitled";
        const fallback = art.primaryImageSmall || NO_IMAGE;

        return `
            <div class="cmp-col">
                <img class="modal-art" src="${escapeHTML(art.primaryImage || fallback)}" alt="${escapeHTML(title)}"
                    data-fallback="${escapeHTML(fallback)}" onerror="this.onerror=null; this.src=this.dataset.fallback">
                <h3 class="cmp-title">${escapeHTML(title)}</h3>
                <p class="cmp-artist">${escapeHTML(art.artistDisplayName || "Unknown artist")}</p>
            </div>`;
    };

    let total = 0;
    let differ = 0;

    const cell = v => v ? `<div class="cmp-val">${escapeHTML(v)}</div>` : `<div class="cmp-val na">Not available</div>`;

    const rows = COMPARE_ROWS.map(([label, get]) => {
        const [x, y] = compareList.map(a => String(get(a) || "").trim());

        if (!x && !y) return "";

        const same = x && y && x.toLowerCase() === y.toLowerCase();

        total++;
        if (!same) differ++;

        return `
            <div class="cmp-row ${same ? "same" : "diff"}">
                <div class="cmp-label">${label}</div>
                ${cell(x)}${cell(y)}
            </div>`;
    }).join("");

    const [tagsA, tagsB] = compareList.map(tagTerms);
    const common = tagsA.filter(t => tagsB.some(u => u.toLowerCase() === t.toLowerCase()));

    const shared = (tagsA.length || tagsB.length) ? `
        <div class="cmp-row cmp-shared ${common.length ? "same" : "diff"}">
            <div class="cmp-label">Subjects in common</div>
            <div class="cmp-val cmp-common">${common.length
                ? common.map(t => `<span class="tag-chip">${escapeHTML(t)}</span>`).join("")
                : "<span class=\"na\">None shared</span>"}</div>
        </div>` : "";

    const [yearA, yearB] = compareList.map(yearOf);
    const gap = yearA !== null && yearB !== null ? Math.abs(yearA - yearB) : null;

    const summary = total
        ? `${differ} of ${total} details differ`
            + (gap !== null ? gap === 0 ? " \u00b7 made in the same year" : ` \u00b7 about ${gap.toLocaleString()} ${gap === 1 ? "year" : "years"} apart` : "")
        : "No details to compare";

    document.getElementById("compareContent").innerHTML = `
        <div class="cmp-bar">
            <p class="cmp-summary" role="status">${escapeHTML(summary)}</p>
            <button type="button" class="btn-line" aria-pressed="${compareDiffOnly}" onclick="toggleDiffOnly()">
                ${compareDiffOnly ? "Show all details" : "Differences only"}
            </button>
        </div>
        <div class="cmp-grid ${compareDiffOnly ? "diff-only" : ""}">${compareList.map(column).join("")}${rows}${shared}</div>`;
}

function openCompare() {
    if (compareList.length < COMPARE_MAX) return;

    renderCompare();

    const details = artModalEl;
    const show = () => bootstrap.Modal.getOrCreateInstance(compareModalEl).show();

    if (details.classList.contains("show")) {
        details.addEventListener("hidden.bs.modal", show, { once: true });
        bootstrap.Modal.getInstance(details).hide();
    } else {
        show();
    }
}

function setStat(id, value) {
    const el = document.getElementById(id);
    if (!el || !Number.isFinite(value) || value <= 0) return;

    el.dataset.value = String(value);

    if (reduceMotion.matches || !("IntersectionObserver" in window)) {
        el.textContent = value.toLocaleString();
        return;
    }

    const watcher = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;

        watcher.disconnect();
        countUp(el, value);
    }, { threshold: 0.4 });

    watcher.observe(el);
}

function countUp(el, value) {
    const start = performance.now();
    const duration = 1400;

    function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);

        el.textContent = Math.round(value * eased).toLocaleString();

        if (t < 1) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
}

async function loadStats() {
    try {
        await sleep(2500);

        const paintings = await fetchSearch(new URLSearchParams({
            q: "painting", hasImages: "true", offset: "0", limit: "1"
        }));

        setStat("statPaintings", Math.min(paintings.total, MAX_RESULTS));

        const highlights = await fetchSearch(new URLSearchParams({
            q: "painting", hasImages: "true", isHighlight: "true", offset: "0", limit: "1"
        }));

        setStat("statHighlights", highlights.total);

    } catch (error) {
        console.warn("Collection stats:", error);
    }
}

syncFavButton();
updateActiveNav();

const startPage = readURL();
syncControls();

loadDepartments();
fetchArtworks(startPage, currentSearch, false);

if (pendingShared) openSharedCollection(pendingShared);

syncTourButton();
loadDailyArtwork();
loadStats();

if (currentObject) viewDetails(currentObject);