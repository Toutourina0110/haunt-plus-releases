(function () {
    'use strict';

    const STORE_KEY = 'haunt_theme_cfg_v3';

    const PRESETS = {
        white:    { label: 'White',           accent: '#FFFFFF', bg: '#0A0A0A', fg: '#F5F5F5' },
        silver:   { label: 'Light gray',      accent: '#D4D4D8', bg: '#0B0B0D', fg: '#EDEDF0' },
        midnight: { label: 'Midnight blue',   accent: '#7DA2F2', bg: '#080B12', fg: '#E8EDF7' },
        violet:   { label: 'Violet',          accent: '#A78BFA', bg: '#0B0910', fg: '#EFEAFA' },
        cyan:     { label: 'Cyan',            accent: '#22D3EE', bg: '#060C0E', fg: '#E6F6FA' },
        emerald:  { label: 'Emerald',         accent: '#34D399', bg: '#060D0A', fg: '#E8F7F1' },
        amber:    { label: 'Amber',           accent: '#FBBF24', bg: '#0D0A05', fg: '#F8F1E3' },
        crimson:  { label: 'Crimson',         accent: '#F87171', bg: '#0D0707', fg: '#F8EAEA' },
        paper:    { label: 'Paper (light)',   accent: '#171717', bg: '#F7F7F5', fg: '#141414' },
        pink:     { label: 'Pink (original)', accent: '#F27DB3', bg: '#0B080A', fg: '#F4EFF2' },
    };

    const FONTS = {
        default: { label: 'Default',   stack: '' },
        inter:   { label: 'Inter',     stack: '"Inter", ui-sans-serif, system-ui, sans-serif' },
        geist:   { label: 'Geist',     stack: '"Geist", "Inter", ui-sans-serif, sans-serif' },
        mono:    { label: 'Monospace', stack: 'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace' },
        serif:   { label: 'Serif',     stack: 'ui-serif, Georgia, "Times New Roman", serif' },
        custom:  { label: 'Google Fonts…', stack: '' },
    };

    const FONT_WEIGHTS = [
        { v: 0,   label: 'Site default' },
        { v: 200, label: 'Extra light 200' },
        { v: 300, label: 'Light 300' },
        { v: 400, label: 'Regular 400' },
        { v: 500, label: 'Medium 500' },
        { v: 600, label: 'Semibold 600' },
        { v: 700, label: 'Bold 700' },
        { v: 800, label: 'Extrabold 800' },
        { v: 900, label: 'Black 900' },
    ];
    const FONT_WEIGHT_VALUES = FONT_WEIGHTS.map(w => w.v);

    const SCRIPT_VERSION = '4.16.0';
    const HIST_KEY = 'haunt_reciprocity_history_v1';
    const INTRO_FLAG = 'haunt_intro_seen_v1';
    const INTRO_PHRASE = 'I UNDERSTAND';
    const CODE_PREFIX = 'HAUNT1-';
    const CODE_FIELDS = [
        'preset', 'accent', 'bg', 'fg', 'contrast', 'bgIntensity', 'radius', 'font',
        'glow', 'scrub', 'logoRgb', 'card', 'border', 'sidebar', 'success', 'warning', 'error', 'activeFg', 'customFont', 'fontWeight', 'fontItalic', 'fontHeadings',
    ];

    const AUTO_SURFACES = ['card', 'border', 'sidebar', 'activeFg'];
    const AUTO_LABELS = {
        card: 'Cards', border: 'Borders', sidebar: 'Sidebar', activeFg: 'Text on accent',
    };

    const LINK_TOS = 'https://haunt-tools.site/tos';
    const LINK_PRIVACY = 'https://haunt-tools.site/privacy';
    const LINK_CONTACT = 'https://haunt.gg/toutourina';
    let introHost = null;
    const ownNodes = new WeakSet();

    const NAV_LINKS = [
        {
            key: 'marketplace',
            id: 'haunt-nav-marketplace',
            label: 'Marketplace',
            href: 'https://haunt.gg/marketplace',
            icon: '<path fill="currentColor" fill-rule="evenodd" d="M7 7V6.5a5 5 0 0 1 10 0V7h3.1a1 1 0 0 1 1 1.09l-1.1 11.5A2.5 2.5 0 0 1 17.5 22h-11a2.5 2.5 0 0 1-2.5-2.41L2.9 8.09A1 1 0 0 1 3.9 7H7Zm2 0h6v-.5a3 3 0 0 0-6 0V7Zm-1.5 4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm9 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" clip-rule="evenodd"/>',
        },
        {
            key: 'pricing',
            id: 'haunt-nav-pricing',
            label: 'Pricing',
            href: 'https://haunt.gg/pricing',
            icon: '<path fill="currentColor" fill-rule="evenodd" d="M3 4.6A1.6 1.6 0 0 1 4.6 3h6.55a2 2 0 0 1 1.42.59l8.26 8.26a2 2 0 0 1 0 2.83l-6.15 6.15a2 2 0 0 1-2.83 0L3.59 12.57A2 2 0 0 1 3 11.15V4.6Zm4.4 1.65a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Z" clip-rule="evenodd"/>',
        },
        {
            key: 'leaderboard',
            id: 'haunt-nav-leaderboard',
            label: 'Leaderboard',
            href: 'https://haunt.gg/leaderboard',
            icon: '<path fill="currentColor" d="M9.75 3h4.5A1.75 1.75 0 0 1 16 4.75V21H8V4.75C8 3.78 8.78 3 9.75 3Z"/><path fill="currentColor" opacity=".85" d="M3.75 12h2.5c.14 0 .25.11.25.25V21H3V12.75c0-.41.34-.75.75-.75Z"/><path fill="currentColor" opacity=".85" d="M17.75 8h2.5c.41 0 .75.34.75.75V21h-3.5V8.25c0-.14.11-.25.25-.25Z"/>',
        },
        {
            key: 'help',
            id: 'haunt-nav-help',
            label: 'Help center',
            href: 'https://help.haunt.gg/',
            external: true,
            icon: '<path fill="currentColor" fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm.06 4.4c-1.9 0-3.32 1.13-3.5 2.94a.9.9 0 0 0 .9.99h.13c.44 0 .8-.32.9-.75.15-.62.63-1 1.4-1 .78 0 1.3.44 1.3 1.08 0 .55-.25.85-1.02 1.4-.95.66-1.42 1.36-1.36 2.53l.01.24c.03.47.42.84.9.84h.02c.5 0 .9-.4.9-.9v-.1c0-.53.2-.8.9-1.28 1.06-.72 1.6-1.5 1.6-2.79 0-1.75-1.4-3.2-3.58-3.2ZM12 15.9a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z" clip-rule="evenodd"/>',
        },
    ];

    const C4C_BTN_ID = 'haunt-c4c-btn';
    const HUB_BTN_ID = 'haunt-hub-btn';
    const HUB_ROW_ID = 'haunt-hub-row';
    const HUB_MENU_ID = 'haunt-hub-menu';
    let hubHost = null;
    const L4L_BTN_ID = 'haunt-l4l-btn';

    const MODES = {
        c4c: {
            key: 'c4c',
            title: /recent comments|coment[aá]rios recentes|comentarios recientes|commentaires r[eé]cents|neueste kommentare|commenti recenti|последние комментарии/i,
            cardName: 'Recent comments',
            scanLabel: 'Scan C4C',
            badge: "didn't C4C back",
            badgeMine: "you owe them a C4C",
            intro: 'Compares the profiles you commented with the ones who commented you.',
        },
        l4l: {
            key: 'l4l',
            title: /recent feedback|feedback recentes|r[eé]actions r[eé]centes|neuestes feedback|reacciones recientes|feedback recenti|последние реакции/i,
            cardName: 'Recent feedback',
            scanLabel: 'Scan L4L',
            badge: "didn't L4L back",
            badgeMine: "you owe them a L4L",
            likedOnly: true,
            intro: 'Compares the profiles you liked with the ones who liked you. Dislikes are ignored.',
        },
    };

    const DEFAULTS = {
        enabled: true,
        preset: 'white',
        accent: '#FFFFFF',
        bg: '#0A0A0A',
        fg: '#F5F5F5',
        contrast: 100,
        bgIntensity: 100,
        radius: 12,
        font: 'default',
        customFont: '',
        fontWeight: 0,
        fontItalic: false,
        fontHeadings: false,
        glow: false,
        scrub: true,
        logoRgb: true,
        advanced: false,
        tab: 'theme',
        secOpen: { colours: true, style: false, nav: false, share: false, script: false },
        introSeen: false,
        nav: { marketplace: true, pricing: true, leaderboard: true, help: true },
        card: null,
        border: null,
        sidebar: null,
        activeFg: null,
        success: '#34D399',
        warning: '#FBBF24',
        error: '#F87171',
    };

    function freshDefaults() {
        const d = Object.assign({}, DEFAULTS);
        d.nav = Object.assign({}, DEFAULTS.nav);
        d.secOpen = Object.assign({}, DEFAULTS.secOpen);
        return d;
    }

    let cfg = Object.assign(freshDefaults(), readStore());
    cfg.secOpen = Object.assign({}, DEFAULTS.secOpen, cfg.secOpen && typeof cfg.secOpen === 'object' ? cfg.secOpen : {});
    cfg.nav = Object.assign({}, DEFAULTS.nav, cfg.nav && typeof cfg.nav === 'object' ? cfg.nav : {});

    function readStore() {
        try {
            const raw = typeof GM_getValue === 'function'
                ? GM_getValue(STORE_KEY, null)
                : localStorage.getItem(STORE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function b64encode(str) {
        return btoa(unescape(encodeURIComponent(str)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function b64decode(str) {
        const pad = str.replace(/-/g, '+').replace(/_/g, '/');
        return decodeURIComponent(escape(atob(pad + '==='.slice((pad.length + 3) % 4))));
    }

    function exportThemeCode() {
        const row = CODE_FIELDS.map(k => {
            const v = cfg[k];
            if (v === null || v === undefined) return null;
            if (k === 'customFont') return String(v);
            if (typeof v === 'string' && /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
                return normHex(v).slice(1);
            }
            return v;
        });
        return CODE_PREFIX + b64encode(JSON.stringify(row));
    }

    function parseThemeCode(code) {
        const raw = String(code || '').trim();
        if (!raw.startsWith(CODE_PREFIX)) return null;

        let row;
        try {
            row = JSON.parse(b64decode(raw.slice(CODE_PREFIX.length)));
        } catch (e) {
            return null;
        }
        if (!Array.isArray(row)) return null;

        const NULLABLE = { card: 1, border: 1, sidebar: 1, activeFg: 1 };
        const colour = (v, key) => {
            if (v === null || v === undefined) return NULLABLE[key] ? null : undefined;
            const t = String(v).replace('#', '');
            return /^[0-9a-fA-F]{6}$/.test(t) ? '#' + t.toLowerCase() : undefined;
        };
        const num = (v, lo, hi) => {
            if (v === null || v === undefined || v === '') return undefined;
            const n = Number(v);
            return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : undefined;
        };

        const out = {};
        let seen = 0;

        CODE_FIELDS.forEach((key, i) => {
            if (i >= row.length) return;
            const v = row[i];
            let clean;

            if (key === 'preset') clean = Object.prototype.hasOwnProperty.call(PRESETS, v) ? v : undefined;
            else if (key === 'font') clean = Object.prototype.hasOwnProperty.call(FONTS, v) ? v : undefined;
            else if (key === 'customFont') clean = v === '' ? '' : (validFontName(v) || undefined);
            else if (key === 'contrast') clean = num(v, 30, 220);
            else if (key === 'bgIntensity') clean = num(v, 20, 100);
            else if (key === 'radius') clean = num(v, 0, 28);
            else if (key === 'fontWeight') clean = FONT_WEIGHT_VALUES.indexOf(Number(v)) >= 0 ? Number(v) : undefined;
            else if (key === 'glow' || key === 'scrub' || key === 'logoRgb' || key === 'fontItalic' || key === 'fontHeadings')
                clean = v === true || v === false ? v : undefined;
            else clean = colour(v, key);

            if (clean !== undefined) {
                out[key] = clean;
                seen++;
            }
        });

        return seen ? out : null;
    }

    function applyThemeCode(code) {
        const parsed = parseThemeCode(code);
        if (!parsed) return false;
        for (const k of AUTO_SURFACES) {
            if (!Object.prototype.hasOwnProperty.call(parsed, k)) cfg[k] = null;
        }
        Object.assign(cfg, parsed);
        writeStore();
        applyTheme();
        return true;
    }

    async function copyText(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (e) {}
        return false;
    }

    const HT_FONT_ID = 'haunt-tools-font';
    const HT_FONT_HREF = 'https://fonts.googleapis.com/css2?family=Gabarito:wght@800;900&family=Onest:wght@400;500;600&display=swap';

    function ensureToolsFont() {
        if (document.getElementById(HT_FONT_ID)) return;
        const link = document.createElement('link');
        link.id = HT_FONT_ID;
        link.rel = 'stylesheet';
        link.href = HT_FONT_HREF;
        ownNodes.add(link);
        (document.head || document.documentElement).appendChild(link);
    }

    const HT_CSS = `
  * { box-sizing: border-box; }
  .ht {
    --ground: #0d0d10; --panel: #15151b; --panel-raised: #1b1a24; --raised: #22212e;
    --hairline: #26262f; --hairline-hi: #34333f;
    --ink: #ece9f7; --ink-soft: #d6d2ec; --muted: #a19eb3; --faint: #75738a;
    --lavender: #8a83d6; --lavender-hi: #a49ee6; --sticker-ink: #0f0e1a;
    --green: #4ac97e; --gold: #f1bf0f; --red: #e5484d; --red-wash: #3a1c22;
    background: var(--panel); color: var(--ink);
    border: 1px solid var(--hairline); border-radius: 16px;
    box-shadow: 0 4px 0 rgba(0,0,0,.25), 0 22px 44px rgba(0,0,0,.5);
    font: 400 14px/1.55 "Onest", system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
    text-align: start;
  }
  .ht ::selection { background: var(--lavender); color: var(--sticker-ink); }
  .ht h1, .ht h2, .ht h3 {
    font-family: "Gabarito", "Onest", system-ui, sans-serif; font-weight: 800;
    color: var(--ink); letter-spacing: 0; text-transform: none;
  }
  .ht a { color: var(--lavender-hi); }
  .ht button {
    height: 34px; padding: 0 14px; border-radius: 10px;
    border: 1px solid var(--hairline); background: var(--panel-raised); color: var(--ink);
    font: 600 13px/1 "Onest", system-ui, sans-serif; cursor: pointer;
  }
  .ht button:hover { background: var(--raised); border-color: var(--hairline-hi); }
  .ht button:active { transform: translateY(1px); }
  .ht button:disabled { opacity: .45; cursor: not-allowed; transform: none; }
  .ht button:disabled:hover { background: var(--panel-raised); border-color: var(--hairline); }
  .ht button.primary { background: var(--lavender); border-color: var(--lavender); color: var(--sticker-ink); }
  .ht button.primary:hover { background: var(--lavender-hi); border-color: var(--lavender-hi); }
  .ht button.primary:disabled:hover { background: var(--lavender); border-color: var(--lavender); }
  .ht button.danger { background: transparent; color: #f08a8e; }
  .ht button.danger:hover { background: var(--red-wash); border-color: #5a2a31; }
  .ht input[type=text], .ht select {
    height: 38px; padding: 0 12px; border-radius: 10px;
    border: 1px solid var(--hairline); background: var(--ground); color: var(--ink);
    font: 400 14px "Onest", system-ui, sans-serif; outline: none;
  }
  .ht input[type=text]:focus, .ht select:focus { border-color: var(--lavender); background: var(--panel-raised); }
  .ht input[type=range], .ht input[type=checkbox] { accent-color: var(--lavender); }
  .ht :focus-visible { outline: 2px solid var(--lavender-hi); outline-offset: 3px; }
  .ht .warn { border: 1px solid #5a2a31; background: var(--red-wash); color: #f3b7ba; padding: 9px 12px; border-radius: 10px; margin: 8px 0; }
  .ht .ok { border: 1px solid #1f4d33; background: #0f2318; color: #8fe0b2; padding: 9px 12px; border-radius: 10px; margin: 8px 0; }
`;

    function mountOverlay(el) {
        const root = document.documentElement || document.body;
        if (root) root.appendChild(el);
    }

    function wipeAllData() {
        const keys = [STORE_KEY, HIST_KEY, INTRO_FLAG];
        for (const k of keys) {
            try { localStorage.removeItem(k); } catch (e) {}
            try {
                if (typeof GM_setValue === 'function') GM_setValue(k, '');
                if (typeof GM_deleteValue === 'function') GM_deleteValue(k);
            } catch (e) {}
        }
        cfg = freshDefaults();
    }

    function writeStore() {
        const raw = JSON.stringify(cfg);
        try {
            if (typeof GM_setValue === 'function') GM_setValue(STORE_KEY, raw);
            else localStorage.setItem(STORE_KEY, raw);
        } catch (e) {}
    }

    function hexToRgb(hex) {
        const h = String(hex).replace('#', '').trim();
        const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
        const n = parseInt(full, 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    function rgbToHex({ r, g, b }) {
        const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
        return '#' + c(r) + c(g) + c(b);
    }

    function rgba(hex, a) {
        const { r, g, b } = hexToRgb(hex);
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    function mix(a, b, t) {
        const x = hexToRgb(a), y = hexToRgb(b);
        return rgbToHex({
            r: x.r + (y.r - x.r) * t,
            g: x.g + (y.g - x.g) * t,
            b: x.b + (y.b - x.b) * t,
        });
    }

    function luminance(hex) {
        const { r, g, b } = hexToRgb(hex);
        const f = v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }

    function onColor(hex) {
        return luminance(hex) > 0.45 ? '#0A0A0A' : '#FFFFFF';
    }

    function isValidHex(v) {
        return /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(v).trim());
    }

    function validFontName(v) {
        const t = String(v || '').trim().replace(/\s+/g, ' ');
        return /^[A-Za-z0-9][A-Za-z0-9 -]{0,48}$/.test(t) ? t : null;
    }

    function fontFamilyParam(name) {
        return encodeURIComponent(name).replace(/%20/g, '+');
    }

    function googleFontHrefs(name) {
        const wght = [200, 300, 400, 500, 600, 700, 800, 900];
        const axes = wght.map(w => '0,' + w).concat(wght.map(w => '1,' + w)).join(';');
        const base = 'https://fonts.googleapis.com/css2?family=' + fontFamilyParam(name);
        return [
            base + ':ital,wght@' + axes + '&display=swap',
            base + ':wght@' + wght.join(';') + '&display=swap',
            base + '&display=swap',
        ];
    }

    function activeFontStack() {
        if (cfg.font === 'custom') {
            const name = validFontName(cfg.customFont);
            if (!name) return '';
            const titled = titleCaseFamily(name);
            const alt = titled !== name ? `, "${titled}"` : '';
            return `"${name}"${alt}, ui-sans-serif, system-ui, sans-serif`;
        }
        return FONTS[cfg.font] ? FONTS[cfg.font].stack : '';
    }

    function normHex(v) {
        let t = String(v).trim().replace('#', '');
        if (t.length === 3) t = t.split('').map(c => c + c).join('');
        return '#' + t.toLowerCase();
    }

    function palette() {
        const k = cfg.contrast / 100;
        const bg = mix('#000000', cfg.bg, cfg.bgIntensity / 100);
        const fg = cfg.fg;
        const lift = luminance(bg) > 0.5 ? '#000000' : '#FFFFFF';
        const step = t => mix(bg, lift, Math.min(0.85, t * k));

        return {
            bg,
            fg,
            card:      cfg.card    || step(0.045),
            popover:   cfg.card    || step(0.06),
            muted:     step(0.09),
            secondary: step(0.09),
            input:     step(0.11),
            border:    cfg.border  || step(0.14),
            sidebar:   cfg.sidebar || (luminance(bg) > 0.5
                ? mix(bg, lift, 0.05 * k)
                : mix(bg, '#000000', 0.4 * k)),
            mutedFg:   mix(fg, bg, 0.42),
            faintFg:   mix(fg, bg, 0.62),
        };
    }

    function autoSurfaceValue(key) {
        const saved = cfg[key];
        cfg[key] = null;
        let out;
        try {
            out = key === 'activeFg' ? onColor(cfg.accent) : palette()[key];
        } finally {
            cfg[key] = saved;
        }
        return out;
    }

    const SCOPE_RE = /^\/(?:[a-z]{2}\/)?(dashboard|acp)(\/|$)/;

    function inScope() {
        return SCOPE_RE.test(location.pathname);
    }

    function buildCss() {
        if (!cfg.enabled || !inScope()) return '';

        const a = cfg.accent;
        const p = palette();
        const light = luminance(p.bg) > 0.5;
        const onA = cfg.activeFg || onColor(a);

        const r = cfg.radius;
        const scale = {
            sm: r * 0.34, md: r * 0.5, lg: r * 0.67, xl: r,
            '2xl': r * 1.34, '3xl': r * 2, '4xl': r * 2.67,
        };
        const radiusVars = Object.entries(scale)
            .map(([k, v]) => `  --radius-${k}: ${Math.round(v)}px !important;`).join('\n');

        const fontStack = activeFontStack();

        return `
:root, .dark, html, body, [data-theme] {
  --background: ${p.bg} !important;
  --foreground: ${p.fg} !important;
  --card: ${p.card} !important;
  --card-foreground: ${p.fg} !important;
  --popover: ${p.popover} !important;
  --popover-foreground: ${p.fg} !important;
  --muted: ${p.muted} !important;
  --muted-foreground: ${p.mutedFg} !important;
  --secondary: ${p.secondary} !important;
  --secondary-foreground: ${p.fg} !important;
  --accent: ${p.muted} !important;
  --accent-foreground: ${p.fg} !important;
  --border: ${p.border} !important;
  --input: ${p.input} !important;
  --dark-text: ${p.fg} !important;

  --primary: ${a} !important;
  --primary-foreground: ${onA} !important;
  --ring: ${rgba(a, 0.55)} !important;

  --destructive: ${cfg.error} !important;
  --destructive-foreground: ${onColor(cfg.error)} !important;
  --success: ${cfg.success} !important;
  --success-foreground: ${onColor(cfg.success)} !important;
  --warning: ${cfg.warning} !important;
  --warning-foreground: ${onColor(cfg.warning)} !important;
  --info: ${a} !important;
  --info-foreground: ${onA} !important;

  --sidebar: ${p.sidebar} !important;
  --sidebar-foreground: ${p.fg} !important;
  --sidebar-primary: ${a} !important;
  --sidebar-primary-foreground: ${onA} !important;
  --sidebar-accent: ${rgba(a, 0.10)} !important;
  --sidebar-accent-foreground: ${a} !important;
  --sidebar-border: ${p.border} !important;
  --sidebar-ring: ${rgba(a, 0.45)} !important;

  --primary-tint-bg: ${rgba(a, 0.12)} !important;
  --primary-tint-hover: ${rgba(a, 0.18)} !important;
  --primary-tint-border: ${rgba(a, 0.32)} !important;
  --primary-tint-text: ${a} !important;

  --chart-primary: ${a} !important;
  --chart-1: ${a} !important;
  --chart-2: ${rgba(a, 0.75)} !important;
  --chart-3: ${rgba(a, 0.55)} !important;
  --chart-4: ${rgba(a, 0.38)} !important;
  --chart-5: ${rgba(a, 0.22)} !important;

  --radius: ${r}px !important;
${radiusVars}

  color-scheme: ${light ? 'light' : 'dark'} !important;
}

[data-sonner-toaster], [data-sonner-toast] {
  --normal-bg: ${p.card} !important;
  --normal-bg-hover: ${p.muted} !important;
  --normal-text: ${p.fg} !important;
  --normal-border: ${p.border} !important;
  --normal-border-hover: ${p.input} !important;
  --success-bg: ${rgba(cfg.success, 0.12)} !important;
  --success-border: ${rgba(cfg.success, 0.35)} !important;
  --success-text: ${cfg.success} !important;
  --error-bg: ${rgba(cfg.error, 0.12)} !important;
  --error-border: ${rgba(cfg.error, 0.35)} !important;
  --error-text: ${cfg.error} !important;
  --warning-bg: ${rgba(cfg.warning, 0.12)} !important;
  --warning-border: ${rgba(cfg.warning, 0.35)} !important;
  --warning-text: ${cfg.warning} !important;
  --info-bg: ${rgba(a, 0.12)} !important;
  --info-border: ${rgba(a, 0.35)} !important;
  --info-text: ${a} !important;
}

[data-chart] {
  --color-DESKTOP: ${a} !important;
  --color-MOBILE: ${rgba(a, 0.30)} !important;
  --color-TABLET: ${rgba(a, 0.55)} !important;
  --color-UNKNOWN: ${p.mutedFg} !important;
  --color-count: ${a} !important;
}
.recharts-cartesian-grid line { stroke: ${p.border} !important; }
.recharts-text, .recharts-cartesian-axis-tick text { fill: ${p.mutedFg} !important; }

[class*="text-rose-"], [class*="text-pink-"], [class*="text-fuchsia-"] { color: ${a} !important; }
[class*="bg-rose-"], [class*="bg-pink-"], [class*="bg-fuchsia-"] { background-color: ${rgba(a, 0.14)} !important; }
[class*="border-rose-"], [class*="border-pink-"], [class*="border-fuchsia-"] { border-color: ${rgba(a, 0.30)} !important; }
[class*="fill-rose-"], [class*="fill-pink-"] { fill: ${a} !important; }
[class*="ring-rose-"], [class*="ring-pink-"] { --tw-ring-color: ${rgba(a, 0.4)} !important; }

[class*="text-red-"], [class*="text-destructive"] { color: ${cfg.error} !important; }
[class*="text-green-"], [class*="text-emerald-"] { color: ${cfg.success} !important; }
[class*="text-amber-"], [class*="text-yellow-"], [class*="text-orange-"] { color: ${cfg.warning} !important; }

[class*="F27DB3"], [class*="f27db3"], [class*="242,125,179"], [class*="242_125_179"] {
  color: ${a} !important;
}

[class*="data-active:text-white"][data-active="true"],
[class*="data-active:text-white"][data-active="true"] svg { color: ${onA} !important; }

input::placeholder, textarea::placeholder { color: ${p.faintFg} !important; }
::selection { background: ${rgba(a, 0.3)}; color: ${p.fg}; }
* { scrollbar-color: ${p.input} transparent; }
::-webkit-scrollbar-thumb { background: ${p.input} !important; border-radius: 0; }
::-webkit-scrollbar-track { background: transparent !important; }
:focus-visible { outline-color: ${rgba(a, 0.6)} !important; }

${cfg.logoRgb ? '' : `
[class*="drop-shadow-[0_0_10px_rgba(242,125,179"],
[class*="drop-shadow-[0_0_10px_rgba(255,255,255"] {
  filter: drop-shadow(0 0 10px ${rgba(a, cfg.glow ? 0.8 : 0)}) !important;
}`}

${cfg.glow ? `
[data-slot="sidebar-menu-button"][data-active="true"] {
  box-shadow: 0 0 18px -6px ${rgba(a, 0.55)};
}
button[data-slot="button"]:not([data-variant="ghost"]):hover {
  box-shadow: 0 0 16px -8px ${rgba(a, 0.6)};
}` : ''}

${fontStack ? `
html, body, button, input, select, textarea {
  font-family: ${fontStack} !important;
}` : ''}
${cfg.fontWeight || cfg.fontItalic ? `
html, body, p, li, label, span, button, input, select, textarea {
  ${cfg.fontWeight ? `font-weight: ${cfg.fontWeight} !important;` : ''}
  ${cfg.fontItalic ? 'font-style: italic !important;' : ''}
}` : ''}
${cfg.fontHeadings && cfg.fontWeight ? `
body *:not(svg):not(svg *) {
  font-weight: ${cfg.fontWeight} !important;
}` : ''}
`;
    }

    const LOGO_SEL = 'a[href="https://haunt.gg/"], a[href="https://haunt.gg"], [data-slot="sidebar-header"] a';
    let logoRaf = null, logoHue = 0, logoLast = 0;

    function logoAnchor() {
        return document.querySelector(LOGO_SEL);
    }

    const BLANK_PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    function maskLogo(img, col) {
        if (!img.dataset.hauntSrc) {
            const orig = img.currentSrc || img.src;
            if (!orig || orig === BLANK_PX) return false;
            img.dataset.hauntSrc = orig;
        }
        const shape = `url("${img.dataset.hauntSrc}") center / contain no-repeat`;
        if (img.src !== BLANK_PX) img.src = BLANK_PX;
        img.style.setProperty('-webkit-mask', shape, 'important');
        img.style.setProperty('mask', shape, 'important');
        img.style.setProperty('background-color', col, 'important');
        img.style.setProperty('filter', 'none', 'important');
        return true;
    }

    function paintLogo(hue) {
        const col = `hsl(${hue} 100% 62%)`;
        paintHubMark(col);
        const anchor = logoAnchor();
        if (!anchor) return;
        const img = anchor.querySelector('img');
        if (img && !maskLogo(img, col)) {
            img.style.setProperty('filter', `hue-rotate(${hue}deg) saturate(2.4)`, 'important');
        }
        for (const s of anchor.querySelectorAll('span')) {
            s.style.setProperty('color', col, 'important');
            s.style.setProperty('-webkit-text-fill-color', col, 'important');
            s.style.setProperty('filter', 'none', 'important');
            s.style.setProperty('text-shadow', 'none', 'important');
        }
    }

    function clearLogo(retries) {
        paintHubMark(null);
        const anchor = logoAnchor();
        if (!anchor) {
            if ((retries || 0) < 20) setTimeout(() => clearLogo((retries || 0) + 1), 150);
            return;
        }
        const img = anchor.querySelector('img');
        if (img) {
            if (img.dataset.hauntSrc) {
                img.src = img.dataset.hauntSrc;
                delete img.dataset.hauntSrc;
            }
            img.style.removeProperty('-webkit-mask');
            img.style.removeProperty('mask');
            img.style.removeProperty('background-color');
            img.style.removeProperty('filter');
        }
        for (const s of anchor.querySelectorAll('span')) {
            s.style.removeProperty('color');
            s.style.removeProperty('-webkit-text-fill-color');
            s.style.removeProperty('filter');
            s.style.removeProperty('text-shadow');
        }
    }

    function logoTick(ts) {
        logoRaf = requestAnimationFrame(logoTick);
        if (ts - logoLast < 32) return;
        logoLast = ts;
        logoHue = (logoHue + 3) % 360;
        paintLogo(logoHue);
    }

    const TOOLS_URL = 'https://haunt-tools.site';
    const PLUS_ID = 'haunt-plus-mark';
    const SUB_ID = 'haunt-plus-sub';

    function ensureBranding() {
        const anchor = logoAnchor();
        if (!anchor) return;

        const stalePlus = anchor.querySelector('#' + PLUS_ID);
        if (stalePlus && !ownNodes.has(stalePlus)) stalePlus.remove();
        if (!anchor.querySelector('#' + PLUS_ID)) {
            const plus = document.createElement('span');
            plus.id = PLUS_ID;
            plus.textContent = '+';
            plus.title = TOOLS_URL;
            plus.className = 'text-2xl';
            plus.style.cssText = 'margin-inline-start:5px;cursor:pointer;line-height:1;' +
                'font-weight:900;font-style:italic;';
            plus.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                window.open(TOOLS_URL, '_blank', 'noopener');
            });
            ownNodes.add(plus);
            anchor.appendChild(plus);
        }

        const header = anchor.parentElement;
        if (header && !header.querySelector('#' + SUB_ID)) {
            const sub = document.createElement('a');
            sub.id = SUB_ID;
            sub.href = TOOLS_URL;
            sub.target = '_blank';
            sub.rel = 'noopener noreferrer';
            sub.textContent = 'Script by haunt-tools.site';
            sub.className = 'group-data-[collapsible=icon]:hidden';
            sub.style.cssText = 'display:block;margin-top:-20px;margin-bottom:2px;text-align:center;' +
                'font-size:11px;line-height:1.2;font-weight:700;text-decoration:none;cursor:pointer;' +
                'color:var(--muted-foreground);opacity:.85;';
            sub.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                window.open(TOOLS_URL, '_blank', 'noopener');
            });
            anchor.insertAdjacentElement('afterend', sub);
        }
    }

    function removeBranding() {
        for (const id of [PLUS_ID, SUB_ID]) {
            const el = document.getElementById(id);
            if (el) el.remove();
        }
    }

    function syncLogo() {
        if (cfg.enabled && inScope()) {
            try { ensureBranding(); } catch (e) {}
            try { ensureC4CButton(); } catch (e) {}
            try { ensureHubButton(); } catch (e) {}
            try { if (hubMenuOpen()) placeHubMenu(); } catch (e) {}
            try { maybeShowIntro(); } catch (e) {}
        } else {
            try { removeBranding(); } catch (e) {}
            try { removeHubButton(); } catch (e) {}
            try { removeC4CButtons(); } catch (e) {}
        }

        const on = cfg.enabled && cfg.logoRgb && inScope();
        if (on && logoRaf === null) {
            logoRaf = requestAnimationFrame(logoTick);
        } else if (!on && logoRaf !== null) {
            cancelAnimationFrame(logoRaf);
            logoRaf = null;
            clearLogo();
        }
    }

    let fontLink = null;
    let fontState = { name: null, status: 'idle' };
    const onFontState = new Set();

    function setFontState(name, status) {
        fontState = { name: name, status: status };
        for (const fn of onFontState) {
            try { fn(fontState); } catch (e) {}
        }
    }

    function titleCaseFamily(name) {
        return name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    const FONT_PROBE = 'WAOwiil@#MImm0O1lI';
    const FONT_FALLBACKS = ['monospace', 'serif', 'sans-serif'];
    let fontCanvas = null;

    function probeWidths(family) {
        if (!fontCanvas) fontCanvas = document.createElement('canvas');
        const ctx = fontCanvas.getContext('2d');
        const out = [];
        for (const fb of FONT_FALLBACKS) {
            ctx.font = '72px ' + (family ? '"' + family + '", ' : '') + fb;
            out.push(ctx.measureText(FONT_PROBE).width);
        }
        return out;
    }

    function fontUsable(name) {
        try {
            const base = probeWidths(null);
            const test = probeWidths(name);
            for (let i = 0; i < base.length; i++) {
                if (Math.abs(base[i] - test[i]) > 0.5) return true;
            }
            return false;
        } catch (e) {
            return true;
        }
    }

    function syncFontLink() {
        const name = cfg.enabled && inScope() && cfg.font === 'custom'
            ? validFontName(cfg.customFont)
            : null;

        if (!name) {
            if (fontLink) { fontLink.remove(); fontLink = null; }
            if (fontState.status !== 'idle') setFontState(null, 'idle');
            return;
        }
        if (fontLink && fontLink.isConnected && fontState.name === name) return;

        if (fontLink) fontLink.remove();
        setFontState(name, 'loading');

        const spellings = [name];
        const titled = titleCaseFamily(name);
        if (titled !== name) spellings.push(titled);

        const tries = [];
        for (const sp of spellings) {
            for (const href of googleFontHrefs(sp)) tries.push({ family: sp, href: href });
        }

        const attempt = i => {
            const link = document.createElement('link');
            link.id = 'haunt-google-font';
            link.rel = 'stylesheet';
            fontLink = link;

            const settle = errored => {
                if (fontLink !== link) return;
                const decide = () => {
                    if (fontLink !== link) return;
                    if (fontUsable(tries[i].family) || fontUsable(name)) {
                        setFontState(name, 'ready');
                    } else if (i + 1 < tries.length) {
                        link.remove();
                        attempt(i + 1);
                    } else {
                        setFontState(name, errored ? 'error' : 'missing');
                    }
                };
                if (document.fonts && document.fonts.load) {
                    const both = [tries[i].family, name].filter((v, k, a) => a.indexOf(v) === k)
                        .map(f => document.fonts.load('72px "' + f + '"').catch(() => null));
                    Promise.all(both).then(() => setTimeout(decide, 30), () => setTimeout(decide, 30));
                } else {
                    setTimeout(decide, 30);
                }
            };

            link.addEventListener('load', () => settle(false));
            link.addEventListener('error', () => settle(true));
            link.href = tries[i].href;
            (document.head || document.documentElement).appendChild(link);
        };

        attempt(0);
    }

    let styleEl = null;

    function applyTheme() {
        const root = document.head || document.documentElement;
        if (!root) return;
        if (!styleEl || !styleEl.isConnected) {
            styleEl = document.createElement('style');
            styleEl.id = 'haunt-theme-customizer';
            root.appendChild(styleEl);
        }
        const css = buildCss();
        if (styleEl.textContent !== css) styleEl.textContent = css;
        syncFontLink();
        syncLogo();
    }

    function boot() {
        if (!document.documentElement) {
            setTimeout(boot, 0);
            return;
        }
        applyTheme();
        new MutationObserver(() => {
            applyTheme();
            scheduleScrub();
        }).observe(document.documentElement, { childList: true, subtree: true });

        let sweeps = 0;
        const sweep = setInterval(() => {
            applyTheme();
            if (++sweeps >= 30) clearInterval(sweep);
        }, 400);
    }

    boot();

    const PINK_RE = /#f27db3\b|#fb7185\b|#f472b6\b|#ec4899\b|rgba?\(\s*242[\s,]+125[\s,]+179[^)]*\)/gi;
    const COLOR_ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color', 'color'];

    function pinkReplacement(match) {
        const alpha = match.match(/[\d.]+\s*\)$/);
        const isRgba = /^rgba/i.test(match) && match.split(/[\s,]+/).length > 3;
        return isRgba && alpha ? rgba(cfg.accent, parseFloat(alpha[0])) : cfg.accent;
    }

    function scrubNode(el) {
        if (!el.getAttribute) return;

        const inline = el.getAttribute('style');
        PINK_RE.lastIndex = 0;
        if (inline && PINK_RE.test(inline)) {
            PINK_RE.lastIndex = 0;
            el.setAttribute('style', inline.replace(PINK_RE, pinkReplacement));
        }

        for (const attr of COLOR_ATTRS) {
            const v = el.getAttribute(attr);
            PINK_RE.lastIndex = 0;
            if (v && PINK_RE.test(v)) el.setAttribute(attr, cfg.accent);
        }
        PINK_RE.lastIndex = 0;
    }

    let scrubTimer = null;

    function scheduleScrub() {
        if (!cfg.enabled || !cfg.scrub || !inScope() || scrubTimer) return;
        scrubTimer = setTimeout(() => {
            scrubTimer = null;
            if (!document.body) return;
            const nodes = document.querySelectorAll('[style], [fill], [stroke], [stop-color], svg *');
            for (const el of nodes) scrubNode(el);
        }, 150);
    }

    document.addEventListener('DOMContentLoaded', scheduleScrub);

    let lastPath = location.pathname;

    function onRouteChange() {
        if (location.pathname === lastPath) return;
        lastPath = location.pathname;
        applyTheme();
        if (!inScope()) {
            if (host) togglePanel();
            closeC4C();
            if (introHost) { introHost.remove(); introHost = null; }
        }
        scheduleScrub();
    }

    for (const fn of ['pushState', 'replaceState']) {
        const orig = history[fn];
        history[fn] = function () {
            const r = orig.apply(this, arguments);
            onRouteChange();
            return r;
        };
    }

    window.addEventListener('popstate', onRouteChange);
    setInterval(onRouteChange, 500);

    let host = null;

    function togglePanel() {
        if (host) {
            host.remove();
            host = null;
            return;
        }
        buildPanel();
    }

    function colorRow(id, label, value, auto) {
        const pinned = auto ? !!cfg[id] : false;
        return `
  <label data-row="${id}" data-pinned="${pinned ? 1 : 0}">${label}${auto ? ' <span class="pin">pinned</span>' : ''}
    <span class="crow">
      <input type="color" id="${id}" value="${value}">
      <input type="text" id="${id}Hex" value="${value}">
      ${auto ? `<span class="auto"><input type="checkbox" id="${id}Auto" ${pinned ? '' : 'checked'}><label for="${id}Auto">auto</label></span>` : ''}
    </span>
  </label>`;
    }

    function buildPanel() {
        host = document.createElement('div');
        host.style.cssText = 'position:fixed;top:10px;right:10px;z-index:2147483647;';
        mountOverlay(host);

        ensureToolsFont();
        const root = host.attachShadow({ mode: 'open' });
        const p = palette();

        root.innerHTML = `
<style>
${HT_CSS}
  .panel { padding: 16px 18px; width: 280px; max-height: 88vh; overflow-y: auto; }
  .panel p { margin: 0 0 12px; font: 800 17px/1.2 "Gabarito", "Onest", system-ui, sans-serif; }
  .panel p a { color: var(--lavender-hi); text-decoration: none; }
  .panel p a:hover { color: var(--ink); }
  .panel label { display: block; margin-top: 10px; color: var(--muted); font-size: 13px; font-weight: 500; }
  .panel label > span.v { color: var(--ink); }
  .crow { display: flex; gap: 6px; margin-top: 4px; align-items: center; }
  .crow .auto { flex: 0 0 auto; display: flex; align-items: center; gap: 4px; }
  .crow .auto label { margin: 0; color: var(--faint); font-size: 12px; cursor: pointer; }
  .pin { display: none; }
  label[data-pinned="1"] .pin { display: inline; color: var(--gold); font-size: 12px; font-weight: 600; margin-inline-start: 4px; }
  .panel select, .panel input[type=text] { width: 100%; }
  .panel select { margin-top: 4px; }
  .panel input[type=range] { width: 100%; margin-top: 4px; }
  .panel input[type=color] {
    width: 38px; flex: 0 0 38px; height: 38px; padding: 4px; cursor: pointer;
    background: var(--ground); border: 1px solid var(--hairline); border-radius: 10px;
  }
  .panel input[type=checkbox] { vertical-align: -2px; margin: 0 6px 0 0; }
  .sec { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--hairline); }
  .sec:first-of-type { margin-top: 0; padding-top: 0; border-top: 0; }
  .sec h2 {
    font-size: 15px; margin: 0 0 2px; cursor: pointer; user-select: none;
    display: flex; align-items: center; gap: 8px;
  }
  .sec h2:hover { color: var(--lavender-hi); }
  .caret { border: 4px solid transparent; border-left-color: currentColor;
           display: inline-block; transition: transform .12s; transform-origin: 25% 50%; }
  .sec[data-open="1"] .caret { transform: rotate(90deg); }
  .sec[data-open="0"] > *:not(h2) { display: none !important; }
  .sec h3 { font-size: 13px; color: var(--ink-soft); margin: 12px 0 0; }
  .panel .sec > label:first-of-type { margin-top: 6px; }
  .tabs {
    display: flex; gap: 4px; margin: 0 0 14px; padding: 4px;
    background: var(--ground); border: 1px solid var(--hairline); border-radius: 12px;
  }
  .panel .tabs .tab { flex: 1; height: 32px; margin: 0; border: 0; background: transparent; color: var(--muted); }
  .panel .tabs .tab:hover { color: var(--ink); background: transparent; }
  .panel .tabs .tab[data-active="1"] { background: var(--ink); color: var(--sticker-ink); transform: rotate(-1.5deg); }
  .page { display: none; }
  .page[data-active="1"] { display: block; }
  .foot { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--hairline);
          display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .foot .hint { margin: 0; }
  .btns { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--hairline); }
  .panel button { margin: 6px 6px 0 0; }
  .panel button.danger.armed { background: var(--red); border-color: var(--red); color: #fff; }
  .wipeNote, .codeMsg { color: var(--faint); font-size: 12px; margin-top: 6px; line-height: 1.45; }
  .codeMsg:empty { display: none; }
  .codeMsg.good { color: var(--green); }
  .codeMsg.bad { color: #f08a8e; }
  .codeMsg.warn { color: var(--gold); }
  .panel input#code { font-family: ui-monospace, "Cascadia Mono", Menlo, monospace; font-size: 12px; }
  .hint { margin-top: 8px; color: var(--faint); font-size: 12px; }
</style>
<div class="panel ht">
  <p>haunt<a href="https://haunt-tools.site" target="_blank" rel="noopener noreferrer" title="haunt-tools.site">+</a> settings</p>

  <div class="tabs">
    <button class="tab" data-tab="theme">Theme</button>
    <button class="tab" data-tab="settings">Settings</button>
  </div>

  <div class="page" data-page="theme">

  <div class="sec" data-sec="colours" data-open="${cfg.secOpen.colours ? 1 : 0}">
    <h2><span class="caret"></span>Colours</h2>
    <label>Preset
      <select id="preset"></select>
    </label>
${colorRow('accent', 'Accent', cfg.accent)}
${colorRow('bg', 'Background', cfg.bg)}
${colorRow('fg', 'Text', cfg.fg)}

    <label>Contrast: <span class="v" id="contrastV">${cfg.contrast}</span>%
      <input type="range" id="contrast" min="30" max="220" step="5" value="${cfg.contrast}">
    </label>

    <label>Background intensity: <span class="v" id="bgIntensityV">${cfg.bgIntensity}</span>%
      <input type="range" id="bgIntensity" min="20" max="100" step="5" value="${cfg.bgIntensity}">
    </label>

    <label><input type="checkbox" id="scrub" ${cfg.scrub ? 'checked' : ''}> Remove leftover pink</label>
    <label><input type="checkbox" id="advanced" ${cfg.advanced ? 'checked' : ''}> More colours</label>
    <div class="codeMsg" id="pinNote"></div>

    <div id="adv" style="display:${cfg.advanced ? 'block' : 'none'};margin-top:8px">
      <h3>Surfaces</h3>
${colorRow('card', 'Cards', cfg.card || p.card, true)}
${colorRow('border', 'Borders', cfg.border || p.border, true)}
${colorRow('sidebar', 'Sidebar', cfg.sidebar || p.sidebar, true)}
      <h3>Selected items</h3>
${colorRow('activeFg', 'Text on accent', cfg.activeFg || onColor(cfg.accent), true)}
      <h3>States</h3>
${colorRow('success', 'Success', cfg.success)}
${colorRow('warning', 'Warning', cfg.warning)}
${colorRow('error', 'Error', cfg.error)}
      <button id="autoSurf" style="margin-top:8px">All back to auto</button>
    </div>
  </div>

  <div class="sec" data-sec="style" data-open="${cfg.secOpen.style ? 1 : 0}">
    <h2><span class="caret"></span>Style</h2>
    <label>Corner radius: <span class="v" id="radiusV">${cfg.radius}</span>px
      <input type="range" id="radius" min="0" max="28" step="1" value="${cfg.radius}">
    </label>

    <label>Font
      <select id="font"></select>
    </label>

    <div id="customFontRow" style="display:${cfg.font === 'custom' ? 'block' : 'none'}">
      <label>Google Fonts family
        <input type="text" id="customFont" spellcheck="false" autocomplete="off"
               placeholder="Poppins" value="${esc(cfg.customFont || '')}">
      </label>
      <div class="codeMsg" id="fontMsg"></div>
    </div>

    <label>Weight
      <select id="fontWeight"></select>
    </label>
    <label><input type="checkbox" id="fontHeadings" ${cfg.fontHeadings ? 'checked' : ''}> Force weight on titles too</label>
    <label><input type="checkbox" id="fontItalic" ${cfg.fontItalic ? 'checked' : ''}> Italic</label>

    <label><input type="checkbox" id="logoRgb" ${cfg.logoRgb ? 'checked' : ''}> RGB logo</label>
    <label><input type="checkbox" id="glow" ${cfg.glow ? 'checked' : ''}> Glow effects</label>
  </div>

  </div>

  <div class="page" data-page="settings">
  <div class="sec" data-sec="nav" data-open="${cfg.secOpen.nav ? 1 : 0}">
    <h2><span class="caret"></span>H+ menu links</h2>
    <label><input type="checkbox" class="navChk" data-key="marketplace"> Marketplace</label>
    <label><input type="checkbox" class="navChk" data-key="pricing"> Pricing</label>
    <label><input type="checkbox" class="navChk" data-key="leaderboard"> Leaderboard</label>
    <label><input type="checkbox" class="navChk" data-key="help"> Help center</label>
  </div>

  <div class="sec" data-sec="share" data-open="${cfg.secOpen.share ? 1 : 0}">
    <h2><span class="caret"></span>Share</h2>
    <input type="text" id="code" spellcheck="false" autocomplete="off">
    <div style="margin-top:6px">
      <button id="copyCode">Copy mine</button>
      <button id="applyCode">Apply pasted</button>
    </div>
    <div class="codeMsg" id="codeMsg">Share this code, or paste someone else's and hit Apply.</div>
  </div>

  <div class="sec" data-sec="script" data-open="${cfg.secOpen.script ? 1 : 0}">
    <h2><span class="caret"></span>Script</h2>
    <div class="codeMsg" id="verLine">haunt+ v${SCRIPT_VERSION}</div>
    <label><input type="checkbox" id="enabled" ${cfg.enabled ? 'checked' : ''}> Theme enabled</label>
    <button id="reset" style="margin-top:8px">Reset theme</button>
    <button id="wipe" class="danger">Reset everything</button>
    <div class="wipeNote" id="wipeNote"></div>
  </div>

  </div>

  <div class="foot">
    <button id="close">Close</button>
    <span class="hint">Ctrl + Shift + H</span>
  </div>
</div>`;

        const $ = id => root.getElementById(id);

        function commit() {
            writeStore();
            applyTheme();
        }

        function rebuild() {
            onFontState.delete(showFontState);
            host.remove();
            host = null;
            buildPanel();
        }

        function pinNote() {
            const el = $('pinNote');
            if (!el) return;
            const on = AUTO_SURFACES.filter(k => cfg[k]);
            if (!on.length) {
                el.className = 'codeMsg';
                el.textContent = '';
                return;
            }
            el.className = 'codeMsg warn';
            el.textContent = on.map(k => AUTO_LABELS[k]).join(', ') +
                (on.length > 1 ? ' are' : ' is') +
                ' pinned and will not follow the background. Open More colours and tick auto to release.';
        }

        function markPinned(key) {
            if (AUTO_SURFACES.indexOf(key) < 0) return;
            const row = root.querySelector('[data-row="' + key + '"]');
            if (row) row.setAttribute('data-pinned', cfg[key] ? '1' : '0');
            const chk = $(key + 'Auto');
            if (chk) chk.checked = !cfg[key];
            pinNote();
        }

        function refreshAuto() {
            for (const k of AUTO_SURFACES) {
                if (cfg[k]) continue;
                const picker = $(k), hex = $(k + 'Hex');
                if (!picker || !hex) continue;
                const v = autoSurfaceValue(k);
                picker.value = v;
                hex.value = v;
            }
        }

        function fillSelect(el, map, current) {
            Object.entries(map).forEach(([key, item]) => {
                const o = document.createElement('option');
                o.value = key;
                o.textContent = item.label;
                if (current === key) o.selected = true;
                el.appendChild(o);
            });
        }

        fillSelect($('preset'), PRESETS, cfg.preset);
        fillSelect($('font'), FONTS, cfg.font);
        const wSel = $('fontWeight');
        for (const w of FONT_WEIGHTS) {
            const o = document.createElement('option');
            o.value = String(w.v);
            o.textContent = w.label;
            if (w.v === cfg.fontWeight) o.selected = true;
            wSel.appendChild(o);
        }

        function bindColor(id, key) {
            const picker = $(id), hex = $(id + 'Hex');
            if (!picker) return;

            const set = v => {
                cfg[key] = v;
                picker.value = v;
                hex.value = v;
                markPinned(key);
                commit();
                refreshAuto();
            };

            picker.addEventListener('input', e => set(e.target.value));
            hex.addEventListener('change', e => {
                if (isValidHex(e.target.value)) set(normHex(e.target.value));
                else e.target.value = cfg[key] || picker.value;
            });

            const chk = $(id + 'Auto');
            if (chk) {
                chk.addEventListener('change', e => {
                    cfg[key] = e.target.checked ? null : normHex(picker.value);
                    markPinned(key);
                    commit();
                    refreshAuto();
                });
            }
        }

        ['accent', 'bg', 'fg', 'card', 'border', 'sidebar', 'success', 'warning', 'error', 'activeFg']
            .forEach(k => bindColor(k, k));

        function bindRange(id, key, cast) {
            $(id).addEventListener('input', e => {
                cfg[key] = cast(e.target.value);
                $(id + 'V').textContent = cfg[key];
                commit();
                refreshAuto();
            });
        }

        bindRange('contrast', 'contrast', parseInt);
        bindRange('bgIntensity', 'bgIntensity', parseInt);
        bindRange('radius', 'radius', parseInt);

        pinNote();
        refreshAuto();

        $('preset').addEventListener('change', e => {
            const preset = PRESETS[e.target.value];
            Object.assign(cfg, {
                preset: e.target.value,
                accent: preset.accent,
                bg: preset.bg,
                fg: preset.fg,
                card: null,
                border: null,
                sidebar: null,
                activeFg: null,
            });
            commit();
            rebuild();
        });

        const fontRow = $('customFontRow');
        const fontInput = $('customFont');
        const fontMsg = $('fontMsg');

        const showFontState = st => {
            if (!host || !host.isConnected) { onFontState.delete(showFontState); return; }
            if (cfg.font !== 'custom') { fontMsg.textContent = ''; return; }
            const name = validFontName(cfg.customFont);
            if (!name) {
                fontMsg.className = 'codeMsg';
                fontMsg.textContent = cfg.customFont
                    ? 'Letters, numbers, spaces and hyphens only.'
                    : 'Type a family name exactly as it appears on Google Fonts.';
                return;
            }
            const map = {
                loading: ['codeMsg', 'Loading ' + name + '…'],
                ready:   ['codeMsg good', name + ' is applied.'],
                missing: ['codeMsg bad', 'The stylesheet loaded but "' + name + '" did not resolve. Check the spelling.'],
                error:   ['codeMsg bad', 'Google Fonts did not return "' + name +
                          '". Either the family name is wrong, or the site is blocking Google Fonts.'],
            };
            const m = map[st && st.status] || ['codeMsg', ''];
            fontMsg.className = m[0];
            fontMsg.textContent = m[1];
        };

        onFontState.add(showFontState);
        showFontState(fontState);

        let fontTimer = null;
        const pushFont = () => {
            clearTimeout(fontTimer);
            cfg.customFont = fontInput.value;
            commit();
            showFontState(fontState);
        };
        fontInput.addEventListener('input', () => {
            clearTimeout(fontTimer);
            fontTimer = setTimeout(pushFont, 500);
        });
        fontInput.addEventListener('change', pushFont);

        $('font').addEventListener('change', e => {
            cfg.font = e.target.value;
            fontRow.style.display = cfg.font === 'custom' ? 'block' : 'none';
            commit();
            showFontState(fontState);
        });
        $('fontWeight').addEventListener('change', e => {
            const v = Number(e.target.value);
            cfg.fontWeight = FONT_WEIGHT_VALUES.indexOf(v) >= 0 ? v : 0;
            commit();
        });
        $('fontHeadings').addEventListener('change', e => { cfg.fontHeadings = e.target.checked; commit(); });
        $('fontItalic').addEventListener('change', e => { cfg.fontItalic = e.target.checked; commit(); });
        $('logoRgb').addEventListener('change', e => { cfg.logoRgb = e.target.checked; commit(); });
        $('glow').addEventListener('change', e => { cfg.glow = e.target.checked; commit(); });
        $('scrub').addEventListener('change', e => { cfg.scrub = e.target.checked; commit(); scheduleScrub(); });
        $('enabled').addEventListener('change', e => { cfg.enabled = e.target.checked; commit(); });

        $('advanced').addEventListener('change', e => {
            cfg.advanced = e.target.checked;
            $('adv').style.display = cfg.advanced ? 'block' : 'none';
            writeStore();
        });

        $('autoSurf').addEventListener('click', () => {
            for (const k of AUTO_SURFACES) cfg[k] = null;
            commit();
            rebuild();
        });

        $('reset').addEventListener('click', () => {
            cfg = freshDefaults();
            commit();
            rebuild();
        });

        const showTab = name => {
            for (const t of root.querySelectorAll('.tabs .tab')) {
                t.setAttribute('data-active', t.dataset.tab === name ? '1' : '0');
            }
            for (const pg of root.querySelectorAll('.page')) {
                pg.setAttribute('data-active', pg.dataset.page === name ? '1' : '0');
            }
        };

        showTab(cfg.tab === 'settings' ? 'settings' : 'theme');

        for (const t of root.querySelectorAll('.tabs .tab')) {
            t.addEventListener('click', () => {
                cfg.tab = t.dataset.tab;
                writeStore();
                showTab(cfg.tab);
            });
        }

        for (const head of root.querySelectorAll('.sec[data-sec] > h2')) {
            head.addEventListener('click', () => {
                const sec = head.parentElement;
                const key = sec.dataset.sec;
                const open = sec.getAttribute('data-open') !== '1';
                sec.setAttribute('data-open', open ? '1' : '0');
                cfg.secOpen[key] = open;
                writeStore();
            });
        }

        for (const chk of root.querySelectorAll('.navChk')) {
            chk.checked = cfg.nav[chk.dataset.key] !== false;
            chk.addEventListener('change', e => {
                cfg.nav[e.target.dataset.key] = e.target.checked;
                commit();
            });
        }

        const codeInput = $('code');
        const codeMsg = $('codeMsg');
        codeInput.value = exportThemeCode();

        const say = (text, kind) => {
            codeMsg.textContent = text;
            codeMsg.className = 'codeMsg' + (kind ? ' ' + kind : '');
        };

        $('copyCode').addEventListener('click', async () => {
            const code = exportThemeCode();
            codeInput.value = code;
            codeInput.select();
            say(await copyText(code)
                ? 'Copied. Paste it anywhere to share your theme.'
                : 'Clipboard blocked. The code is selected, press Ctrl+C.', 'good');
        });

        $('applyCode').addEventListener('click', () => {
            const value = codeInput.value.trim();
            if (!value) return say('Paste a code first.', 'bad');
            if (!applyThemeCode(value)) {
                return say('That code is not valid. Nothing was changed.', 'bad');
            }
            rebuild();
            const panel = host && host.shadowRoot;
            if (panel && panel.getElementById('codeMsg')) {
                panel.getElementById('codeMsg').textContent = 'Theme applied.';
                panel.getElementById('codeMsg').className = 'codeMsg good';
            }
        });

        let wipeArmed = null;
        $('wipe').addEventListener('click', () => {
            const btn = $('wipe');
            const note = $('wipeNote');

            if (!wipeArmed) {
                btn.textContent = 'Click again to erase everything';
                btn.classList.add('armed');
                note.textContent = 'Deletes your theme settings, the C4C and L4L scan history, ' +
                    'and the first-run notice. Nothing on haunt.gg is touched. This cannot be undone.';
                wipeArmed = setTimeout(() => {
                    wipeArmed = null;
                    btn.textContent = 'Reset everything';
                    btn.classList.remove('armed');
                    note.textContent = '';
                }, 6000);
                return;
            }

            clearTimeout(wipeArmed);
            wipeArmed = null;
            wipeAllData();
            applyTheme();
            closeC4C();
            togglePanel();
            buildIntro();
        });

        $('close').addEventListener('click', togglePanel);
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function findCard(titleRe) {
        for (const t of document.querySelectorAll('[data-slot="card-title"]')) {
            if (titleRe.test(t.textContent || '')) return t.closest('[data-slot="card"]');
        }
        return null;
    }

    function commentsCard() {
        return findCard(MODES.c4c.title);
    }

    function commentTabs(card) {
        const out = { received: null, given: null };
        const all = [...card.querySelectorAll('[data-slot="tabs-trigger"]')];
        for (const b of all) {
            const t = (b.textContent || '').trim().toLowerCase();
            if (t.startsWith('received')) out.received = b;
            else if (t.startsWith('given')) out.given = b;
        }
        if ((!out.received || !out.given) && all.length === 2) [out.received, out.given] = all;
        return out;
    }

    const LIKE_WORDS = ['liked', 'like', 'j\'aime', 'me gusta', 'mi piace', 'лайк'];

    function tabTotal(btn) {
        const m = btn && (btn.textContent || '').match(/\((\d+)\)/);
        return m ? parseInt(m[1], 10) : null;
    }

    function avatarKey(img) {
        const src = img ? (img.getAttribute('src') || '') : '';
        if (!src || src.startsWith('data:')) return null;
        const clean = src.split('?')[0].split('#')[0];
        const parts = clean.split('/').filter(Boolean).slice(-2);
        const key = parts.join('/').replace(/\.[a-z0-9]+$/i, '');
        return key.length >= 8 ? key.toLowerCase() : null;
    }

    function harvestUsers(card, likedOnly) {
        const out = new Map();
        for (const li of card.querySelectorAll('li')) {
            if (likedOnly) {
                const badge = li.querySelector('[data-slot="badge"]');
                const txt = badge ? (badge.textContent || '').trim().toLowerCase() : '';
                if (!LIKE_WORDS.some(w => txt.startsWith(w))) continue;
            }
            let user = null;
            for (const a of li.querySelectorAll('a[href*="haunt.gg/"]')) {
                const m = (a.getAttribute('href') || '')
                    .match(/^https?:\/\/haunt\.gg\/([^\/?#]+)\/?$/i);
                if (!m) continue;
                const u = m[1].toLowerCase();
                if (u === 'dashboard' || u === 'acp') continue;
                user = u;
                break;
            }
            if (!user) continue;

            let rec = out.get(user);
            if (!rec) {
                rec = { count: 0, avatars: new Set(), dates: [] };
                out.set(user, rec);
            }
            rec.count++;
            const av = avatarKey(li.querySelector('img[data-slot="avatar-image"]'));
            if (av) rec.avatars.add(av);
            const t = li.querySelector('time');
            if (t) {
                rec.dates.push({
                    iso: t.getAttribute('datetime') || '',
                    label: (t.textContent || '').trim(),
                });
            }
        }
        return out;
    }

    function stamp(d) {
        if (!d || !d.iso) return Infinity;
        const t = Date.parse(d.iso);
        return isNaN(t) ? Infinity : t;
    }

    function oldestDate(rec) {
        if (!rec || !rec.dates.length) return null;
        let best = rec.dates[0];
        for (const d of rec.dates) {
            if (stamp(d) < stamp(best)) best = d;
        }
        return best;
    }

    function daysAgo(iso) {
        if (!iso) return null;
        const t = Date.parse(iso);
        if (isNaN(t)) return null;
        const d = Math.floor((Date.now() - t) / 86400000);
        return d >= 0 ? d : null;
    }

    function sortByAge(list, src) {
        return list.sort((a, b) => {
            const ta = stamp(oldestDate(src.get(a)));
            const tb = stamp(oldestDate(src.get(b)));
            if (ta !== tb) return ta < tb ? -1 : 1;
            return a.localeCompare(b);
        });
    }

    async function loadWholeList(card, onTick, live) {
        let last = -1, stable = 0;
        for (let i = 0; i < 300 && stable < 5; i++) {
            if (live && !live()) break;
            const n = card.querySelectorAll('li').length;
            if (n === last) stable++;
            else { stable = 0; last = n; }
            if (onTick) onTick(n);
            const box = card.querySelector('.overflow-y-auto');
            if (box) box.scrollTop = box.scrollHeight;
            await sleep(200);
        }
        const box = card.querySelector('.overflow-y-auto');
        if (box) box.scrollTop = 0;
        return card.querySelectorAll('li').length;
    }

    async function waitFor(fn, timeout, step) {
        const t0 = Date.now();
        while (Date.now() - t0 < (timeout || 4000)) {
            if (fn()) return true;
            await sleep(step || 100);
        }
        return false;
    }

    function firstRowHref(card) {
        const a = card.querySelector('li a[href*="haunt.gg/"]');
        return a ? a.getAttribute('href') : null;
    }

    function activateTab(btn) {
        try { btn.focus(); } catch (e) {}
        const Pointer = window.PointerEvent || MouseEvent;
        btn.dispatchEvent(new Pointer('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
        btn.dispatchEvent(new Pointer('pointerup', { bubbles: true, cancelable: true, button: 0 }));
        btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
        btn.click();
    }

    async function openTab(btn, card, label) {
        if (btn.getAttribute('data-state') === 'active') return;
        const before = firstRowHref(card);
        activateTab(btn);
        const switched = await waitFor(() => btn.getAttribute('data-state') === 'active', 5000);
        if (!switched) {
            throw new Error(`The ${label} tab did not open. Click it once yourself, then run Scan again.`);
        }
        await waitFor(() => firstRowHref(card) !== before, 3000);
        await sleep(500);
    }

    async function runScan(mode, onStatus, alive) {
        const live = alive || (() => true);
        const card = findCard(mode.title);
        if (!card) {
            throw new Error(`"${mode.cardName}" card not found. Open the dashboard Overview page.`);
        }
        const tabs = commentTabs(card);
        if (!tabs.received || !tabs.given) throw new Error('Received / Given tabs not found.');

        const wasReceived = tabs.received.getAttribute('data-state') === 'active';
        const totals = { received: tabTotal(tabs.received), given: tabTotal(tabs.given) };

        onStatus('Opening Given...');
        await openTab(tabs.given, card, 'Given');
        const givenRows = await loadWholeList(card, n => onStatus(`Reading Given... ${n}`), live);
        const given = harvestUsers(card, mode.likedOnly);

        if (!live()) throw new Error('Scan cancelled.');
        onStatus('Opening Received...');
        await openTab(tabs.received, card, 'Received');
        const recvRows = await loadWholeList(card, n => onStatus(`Reading Received... ${n}`), live);
        const received = harvestUsers(card, mode.likedOnly);

        if (!wasReceived) {
            try { await openTab(tabs.given, card, 'Given'); } catch (e) {}
        }

        const sameSets = given.size === received.size && given.size > 0 &&
            [...given.keys()].every(u => received.has(u));
        if (sameSets && totals.given !== totals.received) {
            throw new Error('Both tabs returned the same list, so the switch failed. ' +
                'Nothing is reported rather than showing a wrong result.');
        }

        const sum = m => [...m.values()].reduce((a, b) => a + b.count, 0);
        const top = [...given.entries()].sort((a, b) => b[1].count - a[1].count)[0];
        const skewed = top && sum(given) >= 5 && top[1].count / sum(given) > 0.8;

        const avatarsOf = m => {
            const set = new Set();
            for (const rec of m.values()) {
                for (const av of rec.avatars) set.add(av);
            }
            return set;
        };
        const recvAvatars = avatarsOf(received);
        const givenAvatars = avatarsOf(given);

        const split = (source, otherMap, otherAvatars) => {
            const missing = [], alias = [];
            for (const u of source.keys()) {
                if (otherMap.has(u)) continue;
                const sameAvatar = [...source.get(u).avatars].some(av => otherAvatars.has(av));
                (sameAvatar ? alias : missing).push(u);
            }
            sortByAge(missing, source);
            sortByAge(alias, source);
            return { missing, alias };
        };

        const theirs = split(given, received, recvAvatars);
        const mine = split(received, given, givenAvatars);

        return {
            mode, given, received, totals, skewed,
            owed: theirs.missing,
            aliasLikely: theirs.alias,
            youOwe: mine.missing,
            youOweAlias: mine.alias,
            topName: top ? top[0] : null,
            rows: { given: givenRows, received: recvRows },
        };
    }

    async function resolveCanonical(username) {
        const url = 'https://haunt.gg/' + encodeURIComponent(username);
        try {
            const res = await fetch(url, { credentials: 'same-origin', redirect: 'follow' });
            const landed = (res.url || '').match(/^https?:\/\/haunt\.gg\/([^\/?#]+)/i);
            if (landed && landed[1].toLowerCase() !== username.toLowerCase()) {
                return { canon: landed[1].toLowerCase(), how: 'redirect' };
            }
            const html = await res.text();
            const meta = html.match(/property=["']og:url["'][^>]*content=["']https?:\/\/haunt\.gg\/([^"'\/?#]+)/i)
                || html.match(/content=["']https?:\/\/haunt\.gg\/([^"'\/?#]+)["'][^>]*property=["']og:url["']/i)
                || html.match(/rel=["']canonical["'][^>]*href=["']https?:\/\/haunt\.gg\/([^"'\/?#]+)/i);
            if (meta) return { canon: meta[1].toLowerCase(), how: 'canonical' };
            return { canon: username.toLowerCase(), how: 'unresolved' };
        } catch (e) {
            return { canon: null, how: 'error' };
        }
    }

    async function verifyAliases(names, received, onStatus) {
        const out = { aliasOf: {}, confirmed: [], unresolved: [], failed: [] };
        for (let i = 0; i < names.length; i++) {
            const u = names[i];
            if (onStatus) onStatus(`Checking ${i + 1}/${names.length}: ${u}`);
            const res = await resolveCanonical(u);
            if (res.how === 'error') out.failed.push(u);
            else if (res.canon && res.canon !== u && received.has(res.canon)) out.aliasOf[u] = res.canon;
            else if (res.how === 'unresolved') out.unresolved.push(u);
            else out.confirmed.push(u);
            await sleep(300);
        }
        return out;
    }

    function readHistory() {
        try {
            const raw = typeof GM_getValue === 'function'
                ? GM_getValue(HIST_KEY, null)
                : localStorage.getItem(HIST_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function writeHistory(h) {
        try {
            const raw = JSON.stringify(h);
            if (typeof GM_setValue === 'function') GM_setValue(HIST_KEY, raw);
            else localStorage.setItem(HIST_KEY, raw);
        } catch (e) {}
    }

    function trackList(prevMap, current, nowIso, out) {
        if (!prevMap || typeof prevMap !== 'object' || Array.isArray(prevMap)) prevMap = {};
        const next = {};
        for (const u of current) {
            const old = prevMap[u];
            if (old) {
                next[u] = { firstSeen: old.firstSeen || nowIso, scans: (old.scans || 1) + 1 };
            } else {
                next[u] = { firstSeen: nowIso, scans: 1 };
                out.fresh.push(u);
            }
        }
        for (const u of Object.keys(prevMap)) {
            if (!next[u]) out.gone.push(u);
        }
        return next;
    }

    function updateHistory(result) {
        const all = readHistory();
        const key = result.mode.key;
        let prev = all[key];
        if (!prev || typeof prev !== 'object' || Array.isArray(prev)) prev = null;
        const nowIso = new Date().toISOString();

        const owedDiff = { fresh: [], gone: [] };
        const mineDiff = { fresh: [], gone: [] };

        const nextOwed = trackList(prev ? prev.owed || {} : {}, result.owed, nowIso, owedDiff);
        const nextMine = trackList(prev ? prev.youOwe || {} : {}, result.youOwe, nowIso, mineDiff);

        all[key] = { lastScanAt: nowIso, owed: nextOwed, youOwe: nextMine };
        writeHistory(all);

        return {
            firstRun: !prev,
            previousScanAt: prev ? prev.lastScanAt : null,
            owed: owedDiff,
            youOwe: mineDiff,
            scansOwed: nextOwed,
            scansMine: nextMine,
        };
    }

    let c4cHost = null;
    let c4cMode = null;
    let scanToken = 0;
    let scanBusy = false;
    let pendingProfile = null;
    let lastCheck = 0;
    let c4cCheck = null;

    function closeC4C() {
        scanToken++;
        scanBusy = false;
        c4cCheck = null;
        if (c4cHost) {
            c4cHost.remove();
            c4cHost = null;
            c4cMode = null;
        }
    }

    function openReciprocity(mode, autoScan) {
        if (c4cHost && c4cMode === mode) {
            if (!autoScan) { closeC4C(); return; }
        } else {
            closeC4C();
            buildC4CPanel(mode);
        }
        if (!autoScan || !c4cHost) return;
        const btn = c4cHost.shadowRoot.getElementById('scan');
        if (btn && !btn.disabled) btn.click();
    }

    const IN_APP = !!window.__hauntPlusMenu;
    const CHECK_GAP = 15000;
    let besideWin = null;
    let besideTimer = 0;

    function profileClosed() {
        const user = pendingProfile;
        pendingProfile = null;
        if (!user || !c4cCheck || scanBusy || Date.now() - lastCheck < CHECK_GAP) return;
        lastCheck = Date.now();
        c4cCheck(user);
    }

    function openBeside(profileUrl) {
        const w = Math.round(screen.availWidth / 2);
        const left = (screen.availLeft || 0) + w;
        besideWin = window.open(profileUrl, 'hauntplus-profile',
            `popup,width=${w},height=${screen.availHeight},left=${left},top=${screen.availTop || 0}`);
        if (!besideWin) { window.open(profileUrl, '_blank', 'noopener'); return; }
        besideWin.focus();
        clearInterval(besideTimer);
        besideTimer = setInterval(() => {
            if (besideWin && !besideWin.closed) return;
            clearInterval(besideTimer);
            besideWin = null;
            profileClosed();
        }, 500);
    }

    function onPanelLink(e) {
        const a = e.target.closest && e.target.closest('a[href]');
        if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
        let profile;
        try { profile = new URL(a.href); } catch (err) { return; }
        if (profile.origin !== 'https://haunt.gg') return;
        try { pendingProfile = decodeURIComponent(profile.pathname.slice(1)).toLowerCase(); } catch (err) { return; }
        if (IN_APP) return;
        e.preventDefault();
        openBeside(profile.href);
    }

    window.addEventListener('hauntplus:popup-closed', profileClosed);

    function esc(s) {
        return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    function buildC4CPanel(mode) {
        c4cMode = mode;
        c4cHost = document.createElement('div');
        c4cHost.style.cssText = 'position:fixed;top:10px;left:10px;z-index:2147483647;';
        mountOverlay(c4cHost);
        ensureToolsFont();
        const root = c4cHost.attachShadow({ mode: 'open' });
        root.addEventListener('click', onPanelLink);

        root.innerHTML = `
<style>
${HT_CSS}
  .panel { padding: 16px 18px; width: 340px; max-height: 88vh; overflow-y: auto; font-size: 13px; }
  .panel p.h { margin: 0 0 12px; font: 800 17px/1.2 "Gabarito", "Onest", system-ui, sans-serif; }
  .panel button { margin-right: 6px; }
  .st { margin: 10px 0; color: var(--muted); }
  ul { list-style: none; margin: 6px 0 0; padding: 0; }
  li { display: flex; justify-content: space-between; gap: 10px; align-items: center;
       padding: 10px 0; border-top: 1px solid var(--hairline); }
  li .who { min-width: 0; }
  li a.name { color: var(--ink); text-decoration: none; font-weight: 600; display: block; }
  li a.name:hover { color: var(--lavender-hi); }
  li span { color: var(--muted); font-size: 12px; display: block; }
  a.open {
    flex: 0 0 auto; display: inline-flex; align-items: center; height: 30px; padding: 0 12px;
    border-radius: 10px; border: 1px solid var(--hairline); background: var(--panel-raised);
    color: var(--ink); font: 600 12px "Onest", system-ui, sans-serif; text-decoration: none;
  }
  a.open:hover { background: var(--raised); border-color: var(--hairline-hi); }
  .sect { margin: 16px 0 4px; padding-top: 12px; border-top: 1px solid var(--hairline);
          font: 800 15px/1.2 "Gabarito", "Onest", system-ui, sans-serif; }
  .sect:first-child { margin-top: 4px; border-top: 0; padding-top: 0; }
  .meta { color: var(--faint); font-size: 12px; margin-top: 8px; }
</style>
<div class="panel ht">
  <p class="h">${mode.key.toUpperCase()} check</p>
  <div>
    <button id="scan" class="primary">Scan</button>
    <button id="verify" disabled title="Opens each flagged profile in the background to read its real username">Verify aliases</button>
    <button id="close">Close</button>
  </div>
  <div class="st" id="status">${esc(mode.intro)}</div>
  <div id="out"></div>
</div>`;

        const $ = id => root.getElementById(id);
        $('close').addEventListener('click', closeC4C);

        let lastResult = null;

        c4cCheck = async user => {
            if (scanBusy || !lastResult) return;
            const card = findCard(mode.title);
            const tabs = card ? commentTabs(card) : {};
            if (!tabs.received || !tabs.given) return;
            const mine = scanToken;
            scanBusy = true;
            $('scan').disabled = true;
            $('status').textContent = `Checking ${user}...`;
            let note;
            try {
                if (tabs.given.getAttribute('data-state') === 'active') await openTab(tabs.received, card, 'Received');
                await openTab(tabs.given, card, 'Given');
                if (mine !== scanToken) return;
                if (harvestUsers(card, mode.likedOnly).has(user)) {
                    lastResult.youOwe = (lastResult.youOwe || []).filter(u => u !== user);
                    lastResult.youOweAlias = (lastResult.youOweAlias || []).filter(u => u !== user);
                    renderResult(root, lastResult);
                    note = `${user}: given back, out of "You owe them".`;
                } else {
                    note = `${user}: nothing given yet. Scan again later to be sure.`;
                }
            } catch (e) {
                note = 'Check failed: ' + e.message;
            } finally {
                if (mine === scanToken) {
                    scanBusy = false;
                    $('scan').disabled = false;
                }
            }
            if (mine === scanToken) $('status').textContent = note;
        };

        $('scan').addEventListener('click', async () => {
            if (scanBusy) return;
            const btn = $('scan');
            const mine = ++scanToken;
            scanBusy = true;
            btn.disabled = true;
            $('verify').disabled = true;
            $('out').innerHTML = '';
            $('status').textContent = mode.intro;
            try {
                const r = await runScan(mode, m => {
                    if (mine === scanToken) $('status').textContent = m;
                }, () => mine === scanToken);
                if (mine !== scanToken) return;
                try { r.history = updateHistory(r); } catch (e) {}
                lastResult = r;
                renderResult(root, r);
                $('verify').disabled = !r.owed.length;
            } catch (e) {
                if (mine !== scanToken) return;
                $('status').textContent = '';
                $('out').innerHTML = `<div class="warn">${esc(e.message)}</div>`;
            } finally {
                if (mine === scanToken) {
                    scanBusy = false;
                    btn.disabled = false;
                }
            }
        });

        $('verify').addEventListener('click', async () => {
            if (!lastResult || !lastResult.owed.length) return;
            const btn = $('verify');
            btn.disabled = true;
            $('scan').disabled = true;
            try {
                const v = await verifyAliases(lastResult.owed, lastResult.received,
                    m => { $('status').textContent = m; });
                const aliases = Object.keys(v.aliasOf);
                lastResult.owed = lastResult.owed.filter(u => !v.aliasOf[u]);
                lastResult.verified = v;
                renderResult(root, lastResult);
                $('status').textContent = aliases.length
                    ? `${aliases.length} alias resolved and removed from the list.`
                    : 'No alias found among the flagged profiles.';
            } catch (e) {
                $('status').textContent = 'Verification failed: ' + e.message;
            }
            btn.disabled = false;
            $('scan').disabled = false;
        });
    }

    function renderResult(root, r) {
        const $ = id => root.getElementById(id);
        const mode = r.mode;
        const covG = r.totals.given ? Math.round(100 * r.rows.given / r.totals.given) : null;
        const covR = r.totals.received ? Math.round(100 * r.rows.received / r.totals.received) : null;
        const unknownTotals = r.totals.given === null || r.totals.received === null;
        const partial = (covG !== null && covG < 98) || (covR !== null && covR < 98);
        const num = v => (v === null || v === undefined ? '?' : v);

        $('status').textContent = '';

        if (r.skewed) {
            $('out').innerHTML = `<div class="warn">Scan aborted. Almost every Given row points at
                "${esc(r.topName)}", so this list shows authors, not the profiles you acted on.
                Comparing them would blame innocent people.</div>`;
            return;
        }

        let html = '';
        if (unknownTotals) {
            html += `<div class="warn">The tabs no longer show how many entries they hold, so this
                scan cannot be checked for completeness. Treat the list as indicative only.</div>`;
        }
        if (partial) {
            html += `<div class="warn">Partial data: only ${r.rows.given}/${num(r.totals.given)} Given and
                ${r.rows.received}/${num(r.totals.received)} Received rows could be loaded. Names missing from
                the unloaded part would look guilty by mistake, so treat this list as incomplete.</div>`;
        }

        const hist = r.history;

        const row = (u, note, src, track) => {
            const rec = (src || r.given).get(u);
            const d = oldestDate(rec);
            const age = d ? daysAgo(d.iso) : null;
            const bits = [esc(note)];
            if (d && d.label) {
                bits.push(esc(d.label) + (age !== null ? ` (${age}d ago)` : ''));
            }
            const seen = track && track[u] ? track[u].scans : 0;
            if (seen > 1) bits.push(`${seen} scans`);
            if (hist && !hist.firstRun && track && track[u] && track[u].scans === 1) bits.push('NEW');
            const url = 'https://haunt.gg/' + encodeURIComponent(u);
            return `<li>
                <span class="who">
                    <a class="name" href="${url}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>
                    <span>${bits.join(' &middot; ')}</span>
                </span>
                <a class="open" href="${url}" target="_blank" rel="noopener noreferrer">Open</a>
            </li>`;
        };

        if (hist && !hist.firstRun) {
            const bits = [];
            if (hist.owed.fresh.length) bits.push(`${hist.owed.fresh.length} new in "they owe you"`);
            if (hist.owed.gone.length) bits.push(`${hist.owed.gone.length} cleared: ${hist.owed.gone.map(esc).join(', ')}`);
            if (hist.youOwe.fresh.length) bits.push(`${hist.youOwe.fresh.length} new in "you owe them"`);
            if (hist.youOwe.gone.length) bits.push(`${hist.youOwe.gone.length} you settled`);
            const since = hist.previousScanAt ? new Date(hist.previousScanAt).toLocaleString() : '';
            html += bits.length
                ? `<div class="ok">Since ${esc(since)}: ${bits.join(' &middot; ')}.</div>`
                : `<div class="st">No change since ${esc(since)}.</div>`;
        } else if (hist) {
            html += `<div class="st">First scan saved. The next one will show what changed.</div>`;
        }

        html += `<div class="sect">They owe you</div>`;
        if (!r.owed.length) {
            html += `<div class="ok">Everyone gave it back.</div>`;
        } else {
            html += `<div class="st">${r.owed.length} profile(s):</div><ul>` +
                r.owed.map(u => row(u, mode.badge, r.given, hist && hist.scansOwed)).join('') + '</ul>';
        }

        if (r.aliasLikely && r.aliasLikely.length) {
            html += `<div class="warn">${r.aliasLikely.length} profile(s) kept out of the list above:
                the username never appears in Received, but their avatar matches someone who did,
                so this is likely the same person under an alias. Check before acting.</div><ul>` +
                r.aliasLikely.map(u => row(u, 'same avatar as a reciprocator', r.given)).join('') + '</ul>';
        }

        const youOwe = r.youOwe || [];
        const youOweAlias = r.youOweAlias || [];
        html += `<div class="sect">You owe them</div>`;
        if (!youOwe.length) {
            html += `<div class="ok">You gave everyone something back.</div>`;
        } else {
            html += `<div class="st">${youOwe.length} profile(s):</div><ul>` +
                youOwe.map(u => row(u, mode.badgeMine, r.received, hist && hist.scansMine)).join('') + '</ul>';
        }

        if (youOweAlias.length) {
            html += `<div class="warn">${youOweAlias.length} profile(s) kept out of the list above:
                their avatar matches someone you already gave to, likely the same person
                under an alias.</div><ul>` +
                youOweAlias.map(u => row(u, 'same avatar as someone you gave to', r.received)).join('') + '</ul>';
        }

        const v = r.verified;
        if (v) {
            const aliases = Object.entries(v.aliasOf);
            if (aliases.length) {
                html += `<div class="warn">Alias check: ${aliases.length} profile(s) removed from the
                    accusation list because their page resolves to someone who did reciprocate &mdash;
                    ${aliases.map(([a, c]) => esc(a) + ' &rarr; ' + esc(c)).join(', ')}.</div>`;
            }
            const notes = [];
            if (v.confirmed.length) notes.push(`${v.confirmed.length} confirmed as distinct accounts`);
            if (v.unresolved.length) notes.push(`${v.unresolved.length} could not be resolved`);
            if (v.failed.length) notes.push(`${v.failed.length} failed to load`);
            if (notes.length) html += `<div class="meta">Alias check: ${notes.join(' &middot; ')}.</div>`;
        }

        html += `<div class="meta">${esc(mode.cardName)} &middot; Given ${r.rows.given}/${num(r.totals.given)} rows,
            ${r.given.size} unique &middot; Received ${r.rows.received}/${num(r.totals.received)} rows,
            ${r.received.size} unique. Nothing was deleted; removal stays manual.</div>`;

        $('out').innerHTML = html;
    }

    function introAlreadySeen() {
        if (cfg.introSeen) return true;
        try {
            if (localStorage.getItem(INTRO_FLAG) === '1') return true;
        } catch (e) {}
        try {
            if (typeof GM_getValue === 'function' && GM_getValue(INTRO_FLAG, '') === '1') return true;
        } catch (e) {}
        return false;
    }

    function markIntroSeen() {
        cfg.introSeen = true;
        writeStore();
        try { localStorage.setItem(INTRO_FLAG, '1'); } catch (e) {}
        try {
            if (typeof GM_setValue === 'function') GM_setValue(INTRO_FLAG, '1');
        } catch (e) {}
    }

    function closeIntro() {
        if (introHost) {
            introHost.remove();
            introHost = null;
        }
        markIntroSeen();
    }

    function buildIntro(revisit) {
        if (introHost || !document.documentElement) return;
        const seen = revisit === true;
        introHost = document.createElement('div');
        introHost.style.cssText =
            'position:fixed;inset:0;z-index:2147483647;display:flex;' +
            'align-items:center;justify-content:center;background:rgba(0,0,0,.72);';
        mountOverlay(introHost);
        ensureToolsFont();
        const root = introHost.attachShadow({ mode: 'open' });

        root.innerHTML = `
<style>
${HT_CSS}
  .box { width: min(480px, calc(100vw - 32px)); max-height: 86vh; overflow-y: auto;
         padding: 24px 26px; border-radius: 24px; }
  h1 { font-size: 28px; font-weight: 900; line-height: 1.05; margin: 0 0 6px; }
  .sub { color: var(--muted); font-size: 13px; margin: 0 0 16px; padding-bottom: 14px;
         border-bottom: 1px solid var(--hairline); }
  h2 { font-size: 17px; margin: 18px 0 6px; }
  p { margin: 0 0 8px; color: var(--ink-soft); }
  b { color: var(--ink); font-weight: 600; }
  .step { border-left: 2px solid var(--hairline-hi); padding-left: 12px; margin-bottom: 8px; }
  .no { border: 1px solid #5a2a31; background: var(--red-wash); border-radius: 12px; padding: 10px 12px; }
  .no p, .no b { color: #f3b7ba; }
  a:hover { color: var(--ink); }
  .links { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--hairline);
           display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; }
  .foot { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--hairline); }
  .foot label { display: block; color: var(--ink-soft); font-size: 13px; margin-bottom: 8px; }
  .foot label b { font-family: ui-monospace, "Cascadia Mono", Menlo, monospace; }
  .foot input { width: 100%; margin-bottom: 10px; }
  .foot input.good { border-color: var(--green); color: #8fe0b2; }
  .foot button { width: 100%; height: 42px; }
</style>
<div class="box ht">
  <h1>haunt+ is now running</h1>
  <p class="sub">Read this once. It takes twenty seconds and saves everyone time.</p>

  <h2>If something looks broken</h2>
  <div class="step">
    <p><b>1.</b> Turn the script off first, from the userscript menu
      (<b>Enable / disable</b>), then reload the page.</p>
  </div>
  <div class="step">
    <p><b>2.</b> Still broken with the script off? Then it comes from
      <b>haunt.gg itself</b>, not from this script.</p>
  </div>
  <div class="step">
    <p><b>3.</b> Fixed once the script is off? Then it is mine, and I want to hear about it.</p>
  </div>

  <h2>Reporting a problem</h2>
  <p>Contact me on <a href="${LINK_CONTACT}" target="_blank" rel="noopener noreferrer">haunt.gg/toutourina</a>.</p>
  <div class="no">
    <p style="margin:0"><b>Do not ask the haunt.gg staff about this script.</b>
      It is not their work, they cannot support it, and reporting it to them will not get it fixed.</p>
  </div>

  <h2>What it does to your account</h2>
  <p>The script <b>never deletes anything</b> and never posts on your behalf. It changes how the
    dashboard looks, and it reads your comment and feedback lists to compare them. Every action
    stays yours.</p>

  <div class="links">
    <a href="${LINK_TOS}" target="_blank" rel="noopener noreferrer">Terms of service</a>
    <a href="${LINK_PRIVACY}" target="_blank" rel="noopener noreferrer">Privacy policy</a>
  </div>

  <div class="foot">
    ${seen ? '' : `<label for="confirm">Type <b>${INTRO_PHRASE}</b> to continue</label>
    <input type="text" id="confirm" autocomplete="off" spellcheck="false"
           placeholder="${INTRO_PHRASE}">`}
    <button class="primary" id="ok"${seen ? '' : ' disabled'}>${seen ? 'Close' : 'Continue'}</button>
  </div>
</div>`;

        const okBtn = root.getElementById('ok');
        const input = root.getElementById('confirm');

        const matches = () => seen || (input && input.value.trim() === INTRO_PHRASE);

        if (seen) {
            okBtn.addEventListener('click', closeIntro);
            introHost.addEventListener('click', e => { if (e.target === introHost) closeIntro(); });
            document.addEventListener('keydown', function esc(e) {
                if (e.key === 'Escape' && introHost) {
                    document.removeEventListener('keydown', esc);
                    closeIntro();
                }
            });
            return;
        }

        const refresh = () => {
            const good = matches();
            okBtn.disabled = !good;
            input.classList.toggle('good', good && input.value.length > 0);
        };

        input.addEventListener('input', refresh);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && matches()) closeIntro();
        });
        okBtn.addEventListener('click', () => {
            if (matches()) closeIntro();
        });

        setTimeout(() => { try { input.focus(); } catch (e) {} }, 50);
    }

    function maybeShowIntro() {
        if (introAlreadySeen() || !document.documentElement || !inScope()) return;
        if (introHost) {
            if (!introHost.isConnected) mountOverlay(introHost);
            return;
        }
        buildIntro();
    }

    function nativeButtonStyle() {
        const pick = previewAnchor()
            || document.querySelector('[data-slot][data-variant="primary"][data-size="default"]')
            || document.querySelector('[data-slot="button"][data-variant="primary"]')
            || document.querySelector('[data-slot="button"][data-variant="outline"]');
        if (!pick) return null;
        return {
            cls: pick.getAttribute('class') || '',
            variant: pick.getAttribute('data-variant') || 'primary',
            size: pick.getAttribute('data-size') || 'default',
        };
    }

    function previewAnchor() {
        return document.querySelector('a[aria-label="Live preview"]')
            || [...document.querySelectorAll('a[href*="preview"]')].find(a => {
                try {
                    const u = new URL(a.getAttribute('href'), location.origin);
                    return u.origin === location.origin && /^\/(?:[a-z]{2}\/)?preview$/.test(u.pathname);
                } catch (e) {
                    return false;
                }
            })
            || null;
    }

    const TILE_SEL = ['Share your profile', 'Compartilhe seu perfil', 'Partage ton profil', 'Profil teilen',
        'Comparte tu perfil', 'Condividi il tuo profilo', 'Поделись профилем']
        .map(l => `button[aria-label="${l}"]`).join(', ');
    const TILE_FALLBACK = 'flex h-14 min-w-0 items-center gap-2 rounded-2xl border border-foreground/5 ' +
        'bg-card px-2.5 shadow-sm transition-all hover:bg-accent active:translate-y-0.5';
    const HUB_MARK_CLS = 'haunt-hub-mark';
    const HUB_EDGE_CLS = 'haunt-hub-edge';

    function hubTools() {
        return [
            {
                key: 'c4c',
                label: 'C4C check',
                eyebrow: 'Comments',
                icon: '<path fill="currentColor" fill-rule="evenodd" d="M12 3c-5 0-9 3.36-9 7.5 0 2.3 1.24 4.35 3.18 5.72-.1 1.1-.46 2.2-1.3 3.14-.3.34-.07.9.39.87 1.86-.12 3.5-.75 4.72-1.53.63.13 1.3.2 2.01.2 5 0 9-3.36 9-7.4S17 3 12 3Z" clip-rule="evenodd"/>',
                run: () => openReciprocity(MODES.c4c, true),
            },
            {
                key: 'l4l',
                label: 'L4L check',
                eyebrow: 'Feedback',
                icon: '<path fill="currentColor" d="M12 21s-7.8-4.6-9.4-9.2C1.3 8.3 3.4 5 6.9 5c2 0 3.8 1.1 4.7 2.6l.4.6.4-.6C13.3 6.1 15.1 5 17.1 5c3.5 0 5.6 3.3 4.3 6.8C19.8 16.4 12 21 12 21Z"/>',
                run: () => openReciprocity(MODES.l4l, true),
            },
            {
                key: 'theme',
                label: 'Theme settings',
                eyebrow: 'Customize',
                icon: '<path fill="currentColor" fill-rule="evenodd" d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H17a5 5 0 0 0 5-5c0-4.4-4.5-8-10-8Zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3.5 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" clip-rule="evenodd"/>',
                run: () => togglePanel(),
            },
            {
                key: 'about',
                label: 'About & help',
                eyebrow: 'haunt+',
                icon: '<path fill="currentColor" fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 4.8a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6ZM11 11h2v6.5h-2V11Z" clip-rule="evenodd"/>',
                run: () => buildIntro(true),
            },
        ];
    }

    function hubMarkSvg(size) {
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true" ' +
            'focusable="false" class="' + HUB_MARK_CLS + '" width="' + size + '" height="' + size + '" ' +
            'style="color:inherit">' +
            '<text x="16" y="22.5" text-anchor="middle" fill="currentColor" ' +
            'transform="rotate(-14 16 16)" ' +
            'font-family="inherit" font-size="19" font-weight="800" font-style="italic" ' +
            'letter-spacing="-0.5">H+</text></svg>';
    }

    function paintHubMark(col) {
        for (const el of document.querySelectorAll('.' + HUB_MARK_CLS)) {
            if (col) el.style.setProperty('color', col, 'important');
            else el.style.removeProperty('color');
        }
        for (const el of document.querySelectorAll('.' + HUB_EDGE_CLS)) {
            if (col) {
                el.style.setProperty('border-style', 'solid', 'important');
                el.style.setProperty('border-width', '1px', 'important');
                for (const side of ['top', 'right', 'bottom', 'left']) {
                    el.style.setProperty('border-' + side + '-color', col, 'important');
                }
            } else {
                el.style.removeProperty('border-style');
                el.style.removeProperty('border-width');
                for (const side of ['top', 'right', 'bottom', 'left']) {
                    el.style.removeProperty('border-' + side + '-color');
                }
            }
        }
    }

    function hubMenuOpen() {
        return !!(hubHost && hubHost.isConnected);
    }

    function hubMount() {
        const anchor = previewAnchor();
        if (!anchor || !anchor.parentElement) return null;
        const li = anchor.closest('li');
        if (li && li.parentElement && li.parentElement.tagName === 'UL') return { own: true, after: li };
        return { own: false, after: anchor };
    }

    function hubLabel(el) {
        el.classList.add(HUB_MARK_CLS);
        el.style.setProperty('font-style', 'italic', 'important');
        el.style.setProperty('font-weight', '700', 'important');
        el.textContent = 'haunt+';
        return el;
    }

    function hubRowButton() {
        const btn = hubTile('button', hubMarkSvg(22), 'Tools', 'haunt+');
        btn.style.width = '';
        btn.style.flex = '';
        const txt = btn.children[1];
        if (txt && txt.children.length >= 2) hubLabel(txt.children[1]);
        else if (txt) hubLabel(txt);
        return btn;
    }

    function hubInlineButton(anchor) {
        const btn = document.createElement('button');
        btn.className = anchor.getAttribute('class') || '';
        btn.setAttribute('data-slot', 'button');
        btn.setAttribute('data-variant', anchor.getAttribute('data-variant') || 'outline');
        btn.setAttribute('data-size', anchor.getAttribute('data-size') || 'default');
        btn.innerHTML = hubMarkSvg(22) + '<span class="hidden md:inline"></span>';
        hubLabel(btn.querySelector('span'));
        return btn;
    }

    function ensureHubButton() {
        const mount = hubMount();
        if (!mount) return;

        removeNavLinks();

        const found = document.getElementById(HUB_BTN_ID);
        const holder = document.getElementById(HUB_ROW_ID) || found;
        if (found) {
            if (ownNodes.has(found) && (holder === found || ownNodes.has(holder))) {
                const rightShape = mount.own === (holder.id === HUB_ROW_ID);
                if (rightShape) {
                    if (holder.previousElementSibling !== mount.after) {
                        mount.after.insertAdjacentElement('afterend', holder);
                    }
                    return;
                }
            }
            holder.remove();
        }

        const btn = mount.own ? hubRowButton() : hubInlineButton(mount.after);
        btn.id = HUB_BTN_ID;
        btn.type = 'button';
        btn.setAttribute('aria-haspopup', 'menu');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', 'haunt+ tools');
        btn.setAttribute('title', 'haunt+ tools');
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            toggleHubMenu();
        });
        ownNodes.add(btn);

        let node = btn;
        if (mount.own) {
            node = document.createElement('li');
            node.id = HUB_ROW_ID;
            node.className = mount.after.getAttribute('class') || '';
            for (const at of ['data-slot', 'data-sidebar']) {
                const v = mount.after.getAttribute(at);
                if (v) node.setAttribute(at, v);
            }
            node.appendChild(btn);
            ownNodes.add(node);
        }
        mount.after.insertAdjacentElement('afterend', node);
        if (logoRaf) paintLogo(logoHue);
    }

    function removeHubButton() {
        closeHubMenu();
        const row = document.getElementById(HUB_ROW_ID);
        if (row) row.remove();
        const el = document.getElementById(HUB_BTN_ID);
        if (el) el.remove();
        removeNavLinks();
    }

    function toggleHubMenu() {
        if (hubMenuOpen()) closeHubMenu();
        else buildHubMenu();
    }

    function closeHubMenu() {
        document.removeEventListener('mousedown', hubOutside, true);
        window.removeEventListener('resize', placeHubMenu);
        window.removeEventListener('scroll', placeHubMenu, true);
        const btn = document.getElementById(HUB_BTN_ID);
        if (btn) {
            btn.setAttribute('aria-expanded', 'false');
            btn.removeAttribute('data-state');
        }
        if (hubHost) {
            hubHost.remove();
            hubHost = null;
        }
    }

    function hubOutside(e) {
        const btn = document.getElementById(HUB_BTN_ID);
        if (btn && (e.target === btn || btn.contains(e.target))) return;
        if (hubHost && hubHost.contains(e.target)) return;
        closeHubMenu();
    }

    function placeHubMenu() {
        const btn = document.getElementById(HUB_BTN_ID);
        if (!hubHost || !btn) return;
        const w = 300;
        hubHost.style.boxSizing = 'border-box';
        hubHost.style.width = w + 'px';

        const r = btn.getBoundingClientRect();
        const h = hubHost.offsetHeight || 320;
        let left = r.left + r.width / 2 - w / 2;
        let top = r.bottom + 8;
        if (top + h > window.innerHeight - 8) top = r.top - 8 - h;

        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        top = Math.max(8, Math.min(top, window.innerHeight - h - 8));

        hubHost.style.left = Math.round(left) + 'px';
        hubHost.style.top = Math.round(top) + 'px';
    }

    function hubTile(tag, icon, eyebrow, label) {
        const src = document.querySelector(TILE_SEL);
        let el;
        if (src) {
            el = src.cloneNode(true);
            if (el.tagName.toLowerCase() !== tag) {
                const swap = document.createElement(tag);
                swap.className = el.className;
                swap.innerHTML = el.innerHTML;
                el = swap;
            }
        } else {
            el = document.createElement(tag);
            el.className = TILE_FALLBACK;
            el.innerHTML =
                '<div class="grid size-9 place-items-center rounded-xl bg-muted text-foreground dark:bg-secondary"></div>' +
                '<div class="min-w-0 flex-1 text-start text-foreground">' +
                '<div class="translate-y-0.5 text-xs text-muted-foreground"></div>' +
                '<div class="-translate-y-0.5 truncate"></div></div>';
        }
        el.removeAttribute('id');
        el.removeAttribute('aria-label');
        if (tag === 'button') el.setAttribute('type', 'button');
        el.style.width = '100%';
        el.style.flex = '0 0 auto';

        const box = el.children[0];
        const txt = el.children[1];
        if (box) {
            box.innerHTML = typeof icon === 'string' && icon.indexOf('<svg') === 0
                ? icon
                : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" ' +
                  'focusable="false" class="size-5">' + icon + '</svg>';
        }
        if (txt && txt.children.length >= 2) {
            txt.children[0].textContent = eyebrow;
            txt.children[1].textContent = label;
            txt.children[1].classList.remove('max-w-35');
        } else if (txt) {
            txt.textContent = label;
        }
        return el;
    }

    function hubRow(tag, icon, eyebrow, label) {
        const el = document.createElement(tag);
        el.className = 'row';
        el.setAttribute('role', 'menuitem');
        if (tag === 'button') el.setAttribute('type', 'button');
        const box = document.createElement('span');
        box.className = 'ico';
        box.innerHTML = typeof icon === 'string' && icon.indexOf('<svg') === 0
            ? icon
            : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" ' +
              'focusable="false" width="18" height="18">' + icon + '</svg>';
        const txt = document.createElement('span');
        txt.className = 'txt';
        const eb = document.createElement('span');
        eb.className = 'eb';
        eb.textContent = eyebrow;
        const lb = document.createElement('span');
        lb.className = 'lb';
        lb.textContent = label;
        txt.append(eb, lb);
        el.append(box, txt);
        return el;
    }

    function hubGroup(text) {
        const d = document.createElement('div');
        d.className = 'grp';
        d.textContent = text;
        return d;
    }

    function buildHubMenu() {
        closeHubMenu();
        const btn = document.getElementById(HUB_BTN_ID);
        if (!btn) return;

        hubHost = document.createElement('div');
        hubHost.id = HUB_MENU_ID;
        hubHost.style.cssText = 'position:fixed;top:-9999px;left:-9999px;z-index:2147483646;';
        ownNodes.add(hubHost);
        ensureToolsFont();
        const root = hubHost.attachShadow({ mode: 'open' });
        root.innerHTML = `
<style>${HT_CSS}
  .menu { padding: 6px; display: flex; flex-direction: column; gap: 2px; max-height: 78vh; overflow-y: auto; }
  .grp { padding: 8px 10px 4px; color: var(--muted); font: 600 12px "Onest", system-ui, sans-serif; }
  .ht .row {
    display: flex; align-items: center; gap: 10px; width: 100%; height: auto; padding: 8px 10px;
    border: 0; border-radius: 12px; background: transparent; color: var(--ink);
    text-decoration: none; text-align: start; cursor: pointer; font: inherit;
  }
  .ht .row:hover { background: var(--raised); }
  .ht .row:active { transform: none; }
  .ico {
    flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px;
    background: var(--panel-raised); border: 1px solid var(--hairline); color: var(--lavender-hi);
  }
  .row:hover .ico { border-color: var(--hairline-hi); }
  .txt { min-width: 0; display: flex; flex-direction: column; }
  .eb { color: var(--muted); font-size: 12px; line-height: 1.3; }
  .lb { font: 800 15px/1.25 "Gabarito", "Onest", system-ui, sans-serif;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ht .foot { padding: 6px 10px 4px; color: var(--faint); font-size: 12px; text-decoration: none; }
  .ht .foot:hover { color: var(--lavender-hi); }
</style>
<div class="ht menu" role="menu"></div>`;
        const menu = root.querySelector('.menu');

        menu.appendChild(hubGroup('Tools'));
        for (const t of hubTools()) {
            const row = hubRow('button', t.icon, t.eyebrow, t.label);
            row.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                closeHubMenu();
                t.run();
            });
            menu.appendChild(row);
        }

        const links = NAV_LINKS.filter(l => cfg.nav[l.key] !== false);
        if (links.length) {
            menu.appendChild(hubGroup('Links'));
            for (const l of links) {
                const row = hubRow('a', l.icon, 'Open', l.label);
                row.setAttribute('href', l.href);
                if (l.external) {
                    row.setAttribute('target', '_blank');
                    row.setAttribute('rel', 'noopener noreferrer');
                }
                row.addEventListener('click', () => closeHubMenu());
                menu.appendChild(row);
            }
        }

        const foot = document.createElement('a');
        foot.className = 'foot';
        foot.href = TOOLS_URL;
        foot.target = '_blank';
        foot.rel = 'noopener noreferrer';
        foot.textContent = 'haunt-tools.site';
        menu.appendChild(foot);

        mountOverlay(hubHost);
        btn.setAttribute('aria-expanded', 'true');
        btn.setAttribute('data-state', 'open');
        placeHubMenu();
        document.addEventListener('mousedown', hubOutside, true);
        window.addEventListener('resize', placeHubMenu);
        window.addEventListener('scroll', placeHubMenu, true);
    }

    function removeC4CButtons() {
        for (const id of [C4C_BTN_ID, L4L_BTN_ID]) {
            const el = document.getElementById(id);
            if (el) el.remove();
        }
    }

    function removeNavLinks() {
        for (const link of NAV_LINKS) {
            const el = document.getElementById(link.id);
            if (el) el.remove();
        }
    }

    function makeCardButton(id, label, mode) {
        const btn = document.createElement('button');
        btn.id = id;
        btn.type = 'button';
        btn.textContent = label;
        btn.style.cssText = 'margin-inline-start:8px;padding:4px 10px;font-size:12px;font-weight:600;' +
            'cursor:pointer;border:1px solid var(--border);border-radius:12px;' +
            'background:var(--secondary);color:var(--foreground);';
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            openReciprocity(mode, true);
        });
        ownNodes.add(btn);
        return btn;
    }

    function ensureC4CButton() {
        for (const mode of [MODES.c4c, MODES.l4l]) {
            const card = findCard(mode.title);
            if (!card) continue;
            const id = mode.key === 'c4c' ? C4C_BTN_ID : L4L_BTN_ID;
            const found = card.querySelector('#' + id);
            if (found) {
                if (ownNodes.has(found)) continue;
                found.remove();
            }
            const tabs = commentTabs(card);
            const list = tabs.received && tabs.received.parentElement;
            if (!list || !list.parentElement) continue;
            list.parentElement.appendChild(makeCardButton(id, mode.key.toUpperCase(), mode));
        }
    }

    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
            e.preventDefault();
            if (document.body && inScope()) togglePanel();
        }
    });

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Theme settings', () => { if (document.body && inScope()) togglePanel(); });
        GM_registerMenuCommand('C4C check', () => {
            if (document.body && inScope()) openReciprocity(MODES.c4c, false);
        });
        GM_registerMenuCommand('L4L check', () => {
            if (document.body && inScope()) openReciprocity(MODES.l4l, false);
        });
        GM_registerMenuCommand('About & help', () => {
            if (document.body && inScope()) buildIntro(true);
        });
        GM_registerMenuCommand('Enable / disable', () => {
            cfg.enabled = !cfg.enabled;
            writeStore();
            applyTheme();
        });
    }
})();
