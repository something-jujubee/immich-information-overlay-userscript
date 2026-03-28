// ==UserScript==
// @name         Immich Plus Mobile
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  Adds Album, Filename, Size, and RAW indicators to Immich thumbnails. Works on /photos and /albums pages.
// @author       YourName
// @match        *://*/*
// @include      *
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    console.log("--- IMMICH PLUS v2.3 STARTING ---");

    // -------------------------------------------------------------------------
    // Styles — overlays are position:fixed, appended to body.
    // We NEVER mutate position/overflow on Immich's grid elements.
    // -------------------------------------------------------------------------
    const STYLE_ID = 'immich-plus-style';

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = `
            .immich-plus-wrapper {
                position: fixed;
                pointer-events: none;
                z-index: 9999;
                overflow: hidden;
            }
            .i-badge {
                position: absolute;
                color: #fff;
                backdrop-filter: blur(3px);
                -webkit-backdrop-filter: blur(3px);
                font-family: system-ui, -apple-system, sans-serif;
                font-size: 10px;
                padding: 2px 5px;
                border-radius: 4px;
                border: 1px solid rgba(255,255,255,0.15);
                line-height: 1.4;
                box-sizing: border-box;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            /* Has album — blue */
            .i-album {
                top: 6px; left: 6px;
                max-width: 65%;
                background: rgba(30,64,175,0.88);
            }
            /* No album yet — amber warning so you know it needs filing */
            .i-no-album {
                top: 6px; left: 6px;
                background: rgba(180,83,9,0.88);
                font-weight: 700;
            }
            /* RAW — yellow top-right */
            .i-raw {
                top: 6px; right: 6px;
                background: #eab308;
                color: #000;
                font-weight: 800;
                border: none;
                max-width: none;
            }
            /* Size — bottom-left */
            .i-size {
                bottom: 6px; left: 6px;
                background: rgba(0,0,0,0.7);
            }
            /* Filename — bottom-right */
            .i-name {
                bottom: 6px; right: 6px;
                max-width: 50%;
                background: rgba(0,0,0,0.7);
            }
            @media (max-width: 480px) {
                .i-name  { display: none; }
                .i-album, .i-no-album { font-size: 8px; }
                .i-badge { font-size: 9px; padding: 1px 4px; }
            }
        `;
        const doInject = () => document.head && document.head.appendChild(s);
        if (document.head) doInject();
        else new MutationObserver((_, ob) => {
            if (document.head) { doInject(); ob.disconnect(); }
        }).observe(document.documentElement, { childList: true });
    }
    injectStyles();

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    const RAW_EXTS = new Set(['CR2','CR3','ARW','DNG','NEF','ORF','GPR','RW2','RAF']);

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '?';
        const k = 1024, sizes = ['B','KB','MB','GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function getPageContext() {
        const path = window.location.pathname;
        const m = path.match(/^\/albums\/([0-9a-f-]{36})/i);
        if (m) return { type: 'album', albumId: m[1] };
        if (path.startsWith('/photos')) return { type: 'timeline' };
        return { type: 'other' };
    }

    // -------------------------------------------------------------------------
    // Concurrency-limited queue — max 6 parallel API calls at once
    // Prevents hammering the Immich server when scrolling through hundreds of photos
    // -------------------------------------------------------------------------
    class ThrottledQueue {
        constructor(concurrency) {
            this.concurrency = concurrency;
            this.running = 0;
            this.queue = [];
        }
        add(fn) {
            return new Promise((resolve, reject) => {
                this.queue.push({ fn, resolve, reject });
                this._run();
            });
        }
        _run() {
            while (this.running < this.concurrency && this.queue.length > 0) {
                const { fn, resolve, reject } = this.queue.shift();
                this.running++;
                fn()
                    .then(v => { this.running--; resolve(v); this._run(); })
                    .catch(e => { this.running--; reject(e);  this._run(); });
            }
        }
    }

    const apiQueue = new ThrottledQueue(6);

    // -------------------------------------------------------------------------
    // Fetch caches — each asset is fetched at most once per session
    // -------------------------------------------------------------------------
    const assetCache  = new Map(); // assetId -> asset object
    const assetFlight = new Map(); // assetId -> Promise<asset|null>
    const albumCache  = new Map(); // assetId -> album name string | null
    const albumFlight = new Map(); // assetId -> Promise<name|null>

    // For album pages: single fetch for the album name, shared across all thumbnails
    let pageAlbumName  = null;   // string | null
    let pageAlbumReady = false;
    let pageAlbumFlight = null;  // Promise<string|null>

    function fetchAsset(id) {
        if (assetCache.has(id))  return Promise.resolve(assetCache.get(id));
        if (assetFlight.has(id)) return assetFlight.get(id);
        const p = apiQueue.add(() =>
            fetch(`${window.location.origin}/api/assets/${id}`)
                .then(r => r.ok ? r.json() : null)
                .catch(() => null)
        ).then(d => {
            assetFlight.delete(id);
            if (d) assetCache.set(id, d);
            return d || null;
        });
        assetFlight.set(id, p);
        return p;
    }

    // Fetch which album(s) an asset belongs to — used on /photos timeline
    function fetchAssetAlbumName(id) {
        if (albumCache.has(id))  return Promise.resolve(albumCache.get(id));
        if (albumFlight.has(id)) return albumFlight.get(id);
        const p = apiQueue.add(() =>
            fetch(`${window.location.origin}/api/assets/${id}/albums`)
                .then(r => r.ok ? r.json() : [])
                .catch(() => [])
        ).then(albums => {
            albumFlight.delete(id);
            const name = (Array.isArray(albums) && albums.length > 0)
                ? (albums[0].albumName || null)
                : null;
            albumCache.set(id, name);
            return name;
        });
        albumFlight.set(id, p);
        return p;
    }

    // Fetch album name once for a whole album page — single API call
    function fetchPageAlbumName(albumId) {
        if (pageAlbumReady)  return Promise.resolve(pageAlbumName);
        if (pageAlbumFlight) return pageAlbumFlight;
        pageAlbumFlight = apiQueue.add(() =>
            fetch(`${window.location.origin}/api/albums/${albumId}`)
                .then(r => r.ok ? r.json() : null)
                .catch(() => null)
        ).then(d => {
            pageAlbumFlight = null;
            pageAlbumReady  = true;
            pageAlbumName   = d?.albumName || null;
            return pageAlbumName;
        });
        return pageAlbumFlight;
    }

    // -------------------------------------------------------------------------
    // Build overlay element
    // -------------------------------------------------------------------------
    function buildOverlay(asset, albumName) {
        const wrap = document.createElement('div');
        wrap.className = 'immich-plus-wrapper';

        // Album badge — blue if in album, amber warning if not
        const ab = document.createElement('div');
        if (albumName && typeof albumName === 'string') {
            ab.className = 'i-badge i-album';
            ab.textContent = '\uD83D\uDCC1 ' + albumName;
            ab.title = albumName;
        } else {
            ab.className = 'i-badge i-no-album';
            ab.textContent = '\u2795 No Album';
        }
        wrap.appendChild(ab);

        // RAW badge — top right
        const ext = (asset.originalPath || '').split('.').pop().toUpperCase();
        if (RAW_EXTS.has(ext)) {
            const rb = document.createElement('div');
            rb.className = 'i-badge i-raw';
            rb.textContent = 'RAW';
            wrap.appendChild(rb);
        }

        // File size — bottom left
        const fileSize = asset.exifInfo?.fileSizeInByte ?? asset.fileSize ?? 0;
        const sb = document.createElement('div');
        sb.className = 'i-badge i-size';
        sb.textContent = formatBytes(fileSize);
        wrap.appendChild(sb);

        // Filename — bottom right
        const nb = document.createElement('div');
        nb.className = 'i-badge i-name';
        nb.textContent = asset.originalFileName || 'Unknown';
        nb.title = asset.originalFileName || '';
        wrap.appendChild(nb);

        return wrap;
    }

    // -------------------------------------------------------------------------
    // Fixed-position overlay management
    // Overlays live in document.body, positioned via getBoundingClientRect()
    // so we NEVER touch Immich's grid layout CSS
    // -------------------------------------------------------------------------
    const activeOverlays = []; // { el, wrapper }

    function positionWrapper(wrapper, el) {
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 20) {
            wrapper.style.display = 'none';
            return;
        }
        wrapper.style.display = '';
        wrapper.style.top    = r.top    + 'px';
        wrapper.style.left   = r.left   + 'px';
        wrapper.style.width  = r.width  + 'px';
        wrapper.style.height = r.height + 'px';
    }

    function repositionAll() {
        for (const { el, wrapper } of activeOverlays) {
            positionWrapper(wrapper, el);
        }
    }

    let rafPending = false;
    function scheduleReposition() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => { rafPending = false; repositionAll(); });
    }

    window.addEventListener('scroll',  scheduleReposition, { passive: true, capture: true });
    window.addEventListener('resize',  scheduleReposition, { passive: true });
    window.addEventListener('wheel',   scheduleReposition, { passive: true });
    window.addEventListener('touchmove', scheduleReposition, { passive: true });

    // -------------------------------------------------------------------------
    // Track injected elements
    // -------------------------------------------------------------------------
    const injected   = new WeakSet();
    const processing = new Set();

    async function processElement(el) {
        if (injected.has(el)) return;

        const id = el.getAttribute('data-asset-id');
        if (!id || processing.has(id)) return;

        // Wait until element has real painted dimensions
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 20) return;

        processing.add(id);
        injected.add(el); // mark early — prevents duplicate work from interval

        try {
            const ctx = getPageContext();

            let albumPromise;
            if (ctx.type === 'album') {
                // Single fetch for the whole page
                albumPromise = fetchPageAlbumName(ctx.albumId);
            } else {
                // Per-asset fetch, throttled
                albumPromise = fetchAssetAlbumName(id);
            }

            const [asset, albumName] = await Promise.all([
                fetchAsset(id),
                albumPromise,
            ]);

            if (!asset) { injected.delete(el); return; }

            const wrapper = buildOverlay(asset, albumName);
            document.body.appendChild(wrapper);
            positionWrapper(wrapper, el);
            activeOverlays.push({ el, wrapper });
        } catch (e) {
            console.warn('[ImmichPlus] Error processing', id, e);
            injected.delete(el);
        } finally {
            processing.delete(id);
        }
    }

    function inject() {
        const containers = document.querySelectorAll('div[data-asset-id]');
        for (const el of containers) {
            if (!injected.has(el)) processElement(el);
        }
    }

    // -------------------------------------------------------------------------
    // MutationObserver — catch lazily rendered thumbnails immediately
    // -------------------------------------------------------------------------
    function startObserver() {
        const target = document.body || document.documentElement;
        new MutationObserver((muts) => {
            let found = false;
            for (const m of muts) {
                for (const n of m.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    if (n.matches?.('div[data-asset-id]') ||
                        n.querySelector?.('div[data-asset-id]')) {
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
            if (found) inject();
        }).observe(target, { childList: true, subtree: true });
    }

    // -------------------------------------------------------------------------
    // SPA navigation — reset page-level album cache on route change
    // -------------------------------------------------------------------------
    let lastPath = window.location.pathname;

    function onNavigate() {
        const newPath = window.location.pathname;
        if (newPath === lastPath) return;
        lastPath = newPath;
        pageAlbumName  = null;
        pageAlbumReady = false;
        pageAlbumFlight = null;
        console.log('[ImmichPlus] Navigated to', newPath, '— album cache reset');
        setTimeout(inject, 300); // brief delay for SPA to render new page
    }

    const _push    = history.pushState.bind(history);
    const _replace = history.replaceState.bind(history);
    history.pushState    = (...a) => { _push(...a);    onNavigate(); };
    history.replaceState = (...a) => { _replace(...a); onNavigate(); };
    window.addEventListener('popstate', onNavigate);

    // -------------------------------------------------------------------------
    // Boot
    // -------------------------------------------------------------------------
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { startObserver(); inject(); });
    } else {
        startObserver();
        inject();
    }

    // Fallback poll — catches virtual-scroll items the observer misses, and
    // keeps overlays repositioned during smooth-scroll deceleration
    setInterval(() => { repositionAll(); inject(); }, 2000);

})();
