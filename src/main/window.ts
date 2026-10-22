import {
  app,
  BrowserWindow,
  clipboard,
  nativeTheme,
  screen,
  WebContentsView,
  type HandlerDetails,
  type Input,
  type Rectangle,
  type Session,
  type WebContents,
  type WindowOpenHandlerResponse,
} from 'electron';
import { readFileSync } from 'node:fs';
import { CH } from '../shared/channels';
import { palette } from '../shared/palette';
import { SPEED_MS } from '../shared/tile-params';
import {
  TABS,
  type Locale,
  type LogoFile,
  type MenuAction,
  type NavAction,
  type PageShot,
  type SettingsOpenPayload,
  type ShellState,
  type SiteId,
  type TabId,
  type TourStartPayload,
  type TransitionPayload,
  type UiInit,
  type UpdateStatus,
} from '../shared/types';
import type { Popups } from './popups';
import { decideNavigation, decideWindowOpen, SITES, type Decision } from './routing';
import type { SettingsStore } from './settings';
import { runMenuCommandJs } from './userscript';
import {
  assetFile,
  delay,
  load,
  openExternal,
  pageShot,
  rendererFile,
  sitePrefs,
  snapshot,
  TITLEBAR,
  uiPrefs,
  waitForStop,
} from './util';

const MENU_W = 76;
const MENU_H = 296;
const EDGE = 6;
const SPLASH_MIN = 900;
const HAUNT_PLUS_SCOPE = /^\/(dashboard|acp)(\/|$)/;
const MODIFIERS = ['Control', 'Shift', 'Alt', 'Meta'];
const LOGO_FILES: Record<TabId, [string, string]> = {
  haunt: ['assets/haunt.png', 'image/png'],
  tools: ['assets/tools.svg', 'image/svg+xml'],
  images: ['assets/imagehost.svg', 'image/svg+xml'],
};

type OverlayMode = 'hidden' | 'menu' | 'full' | 'tour';
type Run = { target: TabId; aborted: boolean };
type Signal = typeof CH.overlayReady | typeof CH.overlayCovered | typeof CH.overlayDone | typeof CH.settingsClosed;

export interface MainWindowDeps {
  locale: () => Locale;
  version: string;
  settings: SettingsStore;
  session: Session;
  popups: () => Popups;
  isQuitting: () => boolean;
  updateStatus: () => UpdateStatus;
  hasKey: () => boolean;
  shortcutStatus: () => UiInit['shortcuts'];
  onHiddenToTray: () => void;
}

const isSiteId = (tab: TabId): tab is SiteId => tab !== 'images';

export class MainWindow {
  readonly win: BrowserWindow;
  private readonly views: Record<TabId, WebContentsView>;
  private readonly overlay: WebContentsView;
  private active: TabId;
  private pending: TabId | null = null;
  private overlayMode: OverlayMode = 'full';
  private busy = true;
  private settingsOpen = false;
  private tourOn = false;
  private recording = false;
  private edgeSince = 0;
  private outSince = 0;
  private poll: NodeJS.Timeout | null = null;
  private boundsTimer: NodeJS.Timeout | null = null;
  private readonly signals = new Map<Signal, () => void>();
  private readonly shots: Partial<Record<TabId, PageShot>> = {};
  private run: Run | null = null;
  private queued: TabId | null = null;
  private marks: Record<TabId, LogoFile> | null = null;

  constructor(private readonly deps: MainWindowDeps) {
    const s = deps.settings.get();
    this.active = s.startPage === 'last' ? s.lastSite : s.startPage;
    const p = palette(this.active, nativeTheme.shouldUseDarkColors);

    this.win = new BrowserWindow({
      ...this.initialBounds(),
      minWidth: 820,
      minHeight: 560,
      show: false,
      title: 'haunt+',
      icon: assetFile('icon-tools.png'),
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: p.bg, symbolColor: p.fg, height: TITLEBAR },
      backgroundColor: p.bg,
      webPreferences: uiPrefs(),
    });

    this.views = {
      haunt: new WebContentsView({ webPreferences: sitePrefs(deps.session) }),
      tools: new WebContentsView({ webPreferences: sitePrefs(deps.session) }),
      images: new WebContentsView({ webPreferences: uiPrefs() }),
    };
    this.overlay = new WebContentsView({ webPreferences: uiPrefs() });
    this.overlay.setBackgroundColor('#00000000');

    for (const tab of [...TABS.filter((t) => t !== this.active), this.active]) {
      this.views[tab].setBackgroundColor(palette(tab, true).bg);
      this.win.contentView.addChildView(this.views[tab]);
    }
    this.win.contentView.addChildView(this.overlay);
    this.layout();

    for (const id of ['haunt', 'tools'] as const) this.wireSite(id);
    this.wireImages();
    this.wireWindow();
  }

  async start(hidden: boolean): Promise<void> {
    const ready = Promise.all([
      new Promise<void>((resolve) => this.win.webContents.once('did-finish-load', () => resolve())),
      this.expect(CH.overlayReady, 4000),
    ]);
    void this.win.loadFile(rendererFile('shell.html'));
    void this.overlay.webContents.loadFile(rendererFile('overlay.html'));
    await ready;

    if (!hidden) {
      if (this.deps.settings.value('maximized')) this.win.maximize();
      this.win.show();
    }
    const shownAt = Date.now();

    for (const tab of TABS) {
      const wc = this.views[tab].webContents;
      if (isSiteId(tab)) load(wc, SITES[tab].home);
      else wc.loadFile(rendererFile('imagehost.html')).catch(() => {});
    }
    const first = this.views[this.active];
    await waitForStop(first.webContents, 8000);
    await delay(Math.max(0, SPLASH_MIN - (Date.now() - shownAt)));

    const mode = this.deps.settings.value('animations');
    const play = mode !== 'off' && this.win.isVisible();
    const shot = play ? await pageShot(first) : null;
    if (shot) this.shots[this.active] = shot;
    this.run = { target: this.active, aborted: false };
    const done = this.expect(CH.overlayDone, this.duration() + 3000);
    this.sendOverlay(CH.transition, {
      kind: 'intro',
      mode: mode === 'off' ? 'simple' : mode,
      duration: this.duration(),
      fromSite: null,
      toSite: this.active,
      from: null,
      to: shot,
    } satisfies TransitionPayload);
    await done;

    this.hideOverlay();
    for (const tab of TABS) if (tab !== this.active) this.views[tab].setVisible(false);
    this.busy = false;
    this.endRun();
    this.startPolling();
    if (!this.deps.settings.value('tourAppSeen') && this.win.isVisible()) void this.startAppTour();
  }

  show(): void {
    if (this.win.isMinimized()) this.win.restore();
    if (!this.win.isVisible()) {
      if (this.deps.settings.value('maximized')) this.win.maximize();
      this.win.show();
    }
    this.win.focus();
  }

  toggleVisible(): void {
    if (this.win.isVisible() && this.win.isFocused()) this.win.hide();
    else this.show();
  }

  owns(wc: WebContents): boolean {
    return wc === this.win.webContents || wc === this.overlay.webContents || wc === this.views.images.webContents;
  }

  isImagesView(wc: WebContents): boolean {
    return wc === this.views.images.webContents;
  }

  isHauntView(wc: WebContents): boolean {
    return wc === this.views.haunt.webContents;
  }

  init(wc: WebContents): UiInit {
    const overlay = wc === this.overlay.webContents;
    const images = this.isImagesView(wc);
    return {
      role: overlay ? 'overlay' : images ? 'images' : 'shell',
      locale: this.deps.locale(),
      dark: nativeTheme.shouldUseDarkColors,
      site: this.active,
      settings: this.deps.settings.get(),
      version: this.deps.version,
      marks: overlay ? this.logoFiles() : undefined,
      hasKey: images ? this.deps.hasKey() : undefined,
      shortcuts: images ? this.deps.shortcutStatus() : undefined,
    };
  }

  private logoFiles(): Record<TabId, LogoFile> {
    if (!this.marks) {
      const read = (tab: TabId): LogoFile => ({ bytes: readFileSync(rendererFile(LOGO_FILES[tab][0])), type: LOGO_FILES[tab][1] });
      this.marks = { haunt: read('haunt'), tools: read('tools'), images: read('images') };
    }
    return this.marks;
  }

  setRecording(on: boolean): void {
    this.recording = on;
  }

  onUi(channel: string, data: unknown, sender: WebContents): void {
    switch (channel) {
      case CH.overlayReady:
      case CH.overlayCovered:
      case CH.overlayDone:
        if (sender === this.overlay.webContents) this.resolve(channel);
        break;
      case CH.settingsClosed:
        if (sender === this.overlay.webContents) this.onSettingsClosed();
        break;
      case CH.switchSite:
        if (TABS.includes(data as TabId)) void this.switchTo(data as TabId);
        break;
      case CH.nav:
        if (data === 'back' || data === 'forward' || data === 'reload') this.navigate(data);
        break;
      case CH.copyLink:
        this.copyLink();
        break;
      case CH.menuAction:
        if (sender === this.overlay.webContents) void this.onMenu(data as MenuAction);
        break;
      case CH.tourRequest:
        if (sender === this.win.webContents) void this.startAppTour();
        break;
      case CH.tourDone:
        if (sender === this.overlay.webContents) this.endAppTour();
        break;
    }
  }

  sendToImages(channel: string, data?: unknown): void {
    const wc = this.views.images.webContents;
    if (!wc.isDestroyed()) wc.send(channel, data);
  }

  openInSite(site: TabId, url?: string): void {
    this.show();
    void this.switchTo(site, url);
  }

  async switchTo(target: TabId, url?: string): Promise<void> {
    const view = this.views[target];
    if (url && isSiteId(target) && view.webContents.getURL() !== url) load(view.webContents, url);
    if (this.run) {
      if (target !== this.run.target) this.queued = target;
      this.abortTransition();
      return;
    }
    if (target === this.active) {
      view.webContents.focus();
      return;
    }
    if (this.busy || this.tourOn) return;
    this.closeSettings();

    this.busy = true;
    this.pending = target;
    this.pushState();
    const from = this.views[this.active];
    const mode = this.deps.settings.value('animations');

    try {
      if (mode === 'off' || !this.win.isVisible() || this.win.isMinimized()) {
        this.swapTo(target);
        return;
      }

      const run: Run = { target, aborted: false };
      this.run = run;
      const a = await pageShot(from);
      if (a) this.shots[this.active] = a;
      if (run.aborted) {
        this.swapTo(target);
        return;
      }

      const duration = this.duration();
      this.showOverlay('full');
      const covered = this.expect(CH.overlayCovered, 600);
      const done = this.expect(CH.overlayDone, duration + 3000);
      this.sendOverlay(CH.transition, {
        kind: 'switch',
        mode,
        duration,
        fromSite: this.active,
        toSite: target,
        from: a,
        to: null,
      } satisfies TransitionPayload);
      await covered;

      this.swapTo(target);
      if (!run.aborted) void this.sendTarget(run, view, target, url);
      await done;
      this.hideOverlay();
    } finally {
      this.pending = null;
      this.busy = false;
      this.endRun();
    }
  }

  private async sendTarget(run: Run, view: WebContentsView, tab: TabId, url?: string): Promise<void> {
    if (url) await waitForStop(view.webContents, 700);
    const shot = await this.freshShot(view);
    if (shot) this.shots[tab] = shot;
    if (this.run === run) this.sendOverlay(CH.transitionPlay, { to: shot ?? this.shots[tab] ?? null });
  }

  private async freshShot(view: WebContentsView): Promise<PageShot | null> {
    for (const wait of [30, 60, 90]) {
      await delay(wait);
      const shot = await pageShot(view);
      if (shot) return shot;
    }
    return null;
  }

  private swapTo(tab: TabId): void {
    const view = this.views[tab];
    if (this.overlayMode === 'menu') this.hideOverlay();
    view.setVisible(true);
    this.raise(view);
    if (this.overlayMode === 'full') this.raise(this.overlay);
    for (const other of TABS) if (other !== tab) this.views[other].setVisible(false);
    this.commit(tab);
  }

  private abortTransition(): void {
    if (!this.run || this.run.aborted) return;
    this.run.aborted = true;
    this.sendOverlay(CH.transitionAbort);
  }

  private endRun(): void {
    this.run = null;
    const next = this.queued;
    this.queued = null;
    if (next && next !== this.active) this.swapTo(next);
    this.pushState();
    this.views[this.active].webContents.focus();
  }

  private duration(): number {
    return SPEED_MS[this.deps.settings.value('transitionSpeed')];
  }

  private commit(tab: TabId): void {
    this.active = tab;
    this.deps.settings.update({ lastSite: tab });
    this.applyChrome();
  }

  private nextTab(tab: TabId): TabId {
    return TABS[(TABS.indexOf(tab) + 1) % TABS.length];
  }

  navigate(action: NavAction): void {
    const wc = this.views[this.active].webContents;
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    if (action === 'reload') wc.reload();
  }

  copyLink(): void {
    if (!isSiteId(this.active)) return;
    void clipboard.writeText(this.views[this.active].webContents.getURL());
    this.win.webContents.send(CH.linkCopied);
  }

  private startPolling(): void {
    if (this.poll) return;
    this.poll = setInterval(() => this.checkCursor(), 50);
  }

  private checkCursor(): void {
    if (this.win.isDestroyed()) return;
    const usable = this.win.isVisible() && !this.win.isMinimized() && this.win.isFocused();
    if (!usable || this.busy || this.overlayMode === 'full' || this.overlayMode === 'tour') {
      if (this.overlayMode === 'menu' && !usable) this.hideMenu();
      this.edgeSince = 0;
      return;
    }

    const point = screen.getCursorScreenPoint();
    const bounds = this.win.getContentBounds();
    const x = point.x - bounds.x;
    const y = point.y - bounds.y;
    const now = Date.now();

    if (this.overlayMode === 'hidden') {
      const atEdge = x >= bounds.width - EDGE && x <= bounds.width && y > TITLEBAR && y <= bounds.height;
      if (!atEdge) {
        this.edgeSince = 0;
      } else if (!this.edgeSince) {
        this.edgeSince = now;
      } else if (now - this.edgeSince > 90) {
        this.edgeSince = 0;
        this.showMenu();
      }
      return;
    }

    const r = this.menuRect();
    const inside = x >= r.x - 14 && x <= bounds.width + 6 && y >= r.y - 18 && y <= r.y + r.height + 18;
    if (inside) {
      this.outSince = 0;
    } else if (!this.outSince) {
      this.outSince = now;
    } else if (now - this.outSince > 220) {
      this.outSince = 0;
      this.hideMenu();
    }
  }

  private showMenu(): void {
    this.showOverlay('menu');
    this.sendOverlay(CH.menuShow, { active: this.active, hauntPlus: this.deps.settings.value('hauntPlus') });
  }

  private hideMenu(): void {
    if (this.overlayMode !== 'menu') return;
    this.sendOverlay(CH.menuHide);
    this.overlayMode = 'hidden';
    setTimeout(() => {
      if (this.overlayMode === 'hidden') this.overlay.setVisible(false);
    }, 180);
  }

  private async onMenu(action: MenuAction): Promise<void> {
    switch (action) {
      case 'haunt':
      case 'tools':
      case 'images':
        if (action === this.active) this.hideMenu();
        await this.switchTo(action);
        break;
      case 'settings':
        await this.openSettings();
        break;
      case 'hauntplus':
        this.hideMenu();
        await this.runHauntPlus('Theme settings');
        break;
    }
  }

  async openSettings(): Promise<void> {
    if (this.busy || this.settingsOpen || this.tourOn) return;
    this.show();
    this.settingsOpen = true;
    const shot = await snapshot(this.views[this.active]);
    this.showOverlay('full');
    this.sendOverlay(CH.settingsOpen, {
      snapshot: shot,
      settings: this.deps.settings.get(),
      update: this.deps.updateStatus(),
    } satisfies SettingsOpenPayload);
    this.overlay.webContents.focus();
  }

  private closeSettings(): void {
    if (!this.settingsOpen) return;
    this.settingsOpen = false;
    this.sendOverlay(CH.settingsClose);
  }

  private onSettingsClosed(): void {
    if (!this.settingsOpen) return;
    this.settingsOpen = false;
    this.hideOverlay();
    this.views[this.active].webContents.focus();
  }

  async reloadUi(): Promise<void> {
    const reopen = this.settingsOpen;
    this.settingsOpen = false;
    this.hideOverlay();
    const ready = this.expect(CH.overlayReady, 4000);
    this.win.webContents.once('did-finish-load', () => this.pushState());
    this.win.webContents.reload();
    this.overlay.webContents.reload();
    this.views.images.webContents.reload();
    await ready;
    if (reopen) await this.openSettings();
  }

  async startAppTour(): Promise<void> {
    if (this.busy || this.tourOn) return;
    this.show();
    this.closeSettings();
    this.hideMenu();
    this.tourOn = true;
    this.showOverlay('tour');
    await this.sendTour();
    this.overlay.webContents.focus();
  }

  private endAppTour(): void {
    if (!this.tourOn) return;
    this.tourOn = false;
    this.hideOverlay();
    this.deps.settings.update({ tourAppSeen: true });
    this.views[this.active].webContents.focus();
  }

  private async sendTour(): Promise<void> {
    const code = `(() => {
      const box = (id) => {
        const el = document.getElementById(id);
        if (!el || getComputedStyle(el).visibility === 'hidden') return null;
        const r = el.getBoundingClientRect();
        return r.width && r.height ? [r.x, r.y, r.width, r.height] : null;
      };
      const area = navigator.windowControlsOverlay && navigator.windowControlsOverlay.getTitlebarAreaRect();
      const bar = area && area.width ? [area.x, area.y, area.width, area.height] : null;
      return { switch: box('switch'), nav: box('nav'), copy: box('copy'), help: box('help'), bar };
    })()`;
    let raw: Record<string, unknown> = {};
    try {
      raw = (await this.win.webContents.executeJavaScript(code)) as Record<string, unknown>;
    } catch {
      raw = {};
    }
    const rect = (v: unknown) =>
      Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
        ? { x: v[0], y: v[1], w: v[2], h: v[3] }
        : null;
    this.sendOverlay(CH.tourStart, {
      rects: { switch: rect(raw.switch), nav: rect(raw.nav), copy: rect(raw.copy), help: rect(raw.help) },
      titlebar: rect(raw.bar),
      active: this.active,
      hauntPlus: this.deps.settings.value('hauntPlus'),
    } satisfies TourStartPayload);
  }

  sendToOverlay(channel: string, data?: unknown): void {
    this.sendOverlay(channel, data);
  }

  async runHauntPlus(command: string): Promise<void> {
    if (!this.deps.settings.value('hauntPlus')) return;
    await this.switchTo('haunt');
    const wc = this.views.haunt.webContents;
    let path = '';
    try {
      path = new URL(wc.getURL()).pathname;
    } catch {
      path = '';
    }
    if (!HAUNT_PLUS_SCOPE.test(path)) {
      load(wc, 'https://haunt.gg/dashboard');
      await delay(150);
      await waitForStop(wc, 8000);
      await delay(500);
    }
    try {
      await wc.executeJavaScript(runMenuCommandJs(command), true);
    } catch (err) {
      console.error('haunt+ command failed:', err);
    }
  }

  reloadHaunt(): void {
    this.views.haunt.webContents.reload();
  }

  reloadAll(): void {
    for (const view of Object.values(this.views)) view.webContents.reload();
  }

  handleKey(input: Input, wc: WebContents): boolean {
    if (input.type !== 'keyDown') return false;
    if (this.recording && wc === this.views.images.webContents) return false;
    const ctrl = input.control || input.meta;
    const key = input.key;
    const lower = key.toLowerCase();
    if (this.run && !MODIFIERS.includes(key)) this.abortTransition();
    const target = this.owns(wc) || this.isSite(wc) ? this.views[this.active].webContents : wc;

    if (ctrl && !input.shift && !input.alt && ['1', '2', '3'].includes(key)) {
      void this.switchTo(TABS[Number(key) - 1]);
      return true;
    }
    if (ctrl && key === 'Tab') {
      void this.switchTo(this.nextTab(this.run?.target ?? this.active));
      return true;
    }
    if (ctrl && !input.shift && key === ',') {
      void this.openSettings();
      return true;
    }
    if (input.alt && !ctrl && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      const history = target.navigationHistory;
      if (key === 'ArrowLeft' && history.canGoBack()) history.goBack();
      if (key === 'ArrowRight' && history.canGoForward()) history.goForward();
      return true;
    }
    if (key === 'F5' || (ctrl && lower === 'r')) {
      if (input.shift) target.reloadIgnoringCache();
      else target.reload();
      return true;
    }
    if (ctrl && input.shift && lower === 'c') {
      if (target === this.views.images.webContents) return true;
      void clipboard.writeText(target.getURL());
      if (target === this.views[this.active].webContents) this.win.webContents.send(CH.linkCopied);
      return true;
    }
    if (ctrl && (key === '=' || key === '+')) {
      target.setZoomLevel(Math.min(3, target.getZoomLevel() + 0.5));
      return true;
    }
    if (ctrl && key === '-') {
      target.setZoomLevel(Math.max(-3, target.getZoomLevel() - 0.5));
      return true;
    }
    if (ctrl && key === '0') {
      target.setZoomLevel(0);
      return true;
    }
    if (key === 'F12' && !app.isPackaged) {
      target.toggleDevTools();
      return true;
    }
    return false;
  }

  onThemeChange(): void {
    this.applyChrome();
    const payload = { dark: nativeTheme.shouldUseDarkColors };
    this.win.webContents.send(CH.theme, payload);
    this.sendOverlay(CH.theme, payload);
    this.sendToImages(CH.theme, payload);
  }

  private applyChrome(): void {
    if (this.win.isDestroyed()) return;
    const p = palette(this.active, nativeTheme.shouldUseDarkColors);
    this.win.setTitleBarOverlay({ color: p.bg, symbolColor: p.fg, height: TITLEBAR });
    this.win.setBackgroundColor(p.bg);
  }

  private wireSite(id: SiteId): void {
    const wc = this.views[id].webContents;
    const push = () => {
      if (id === this.active || id === this.pending) this.pushState();
    };

    wc.setWindowOpenHandler((details) => this.onWindowOpen(id, details));
    wc.on('will-navigate', (event) => {
      const decision = decideNavigation(id, event.url, this.deps.settings.value('externalLinks'));
      if (this.apply(id, decision)) event.preventDefault();
    });
    wc.on('page-title-updated', push);
    wc.on('did-navigate', push);
    wc.on('did-navigate-in-page', push);
    wc.on('did-start-loading', push);
    wc.on('did-stop-loading', push);
    wc.on('before-input-event', (event, input) => {
      if (this.handleKey(input, wc)) event.preventDefault();
    });
    wc.on('render-process-gone', (_event, details) => {
      if (details.reason !== 'clean-exit') setTimeout(() => !wc.isDestroyed() && wc.reload(), 1000);
    });
  }

  private wireImages(): void {
    const wc = this.views.images.webContents;
    wc.on('will-navigate', (event) => event.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('before-input-event', (event, input) => {
      if (this.handleKey(input, wc)) event.preventDefault();
    });
    wc.on('render-process-gone', (_event, details) => {
      if (details.reason !== 'clean-exit') setTimeout(() => !wc.isDestroyed() && wc.reload(), 1000);
    });
  }

  private onWindowOpen(from: SiteId, details: HandlerDetails): WindowOpenHandlerResponse {
    const decision = decideWindowOpen(from, details.url, details.features, this.deps.settings.value('externalLinks'));
    if (decision.kind === 'auth-popup') {
      return { action: 'allow', createWindow: (options) => this.deps.popups().adopt(from, options) };
    }
    this.apply(from, decision);
    return { action: 'deny' };
  }

  private apply(from: SiteId, decision: Decision): boolean {
    switch (decision.kind) {
      case 'allow':
      case 'auth-popup':
        return false;
      case 'block':
        return true;
      case 'site':
        void this.switchTo(decision.site, decision.url);
        return true;
      case 'popup':
        this.deps.popups().open(from, decision.url);
        return true;
      case 'external':
        openExternal(decision.url);
        return true;
    }
  }

  private wireWindow(): void {
    const relayout = () => this.layout();
    this.win.on('resize', relayout);
    this.win.on('maximize', relayout);
    this.win.on('unmaximize', relayout);
    this.win.on('enter-full-screen', relayout);
    this.win.on('leave-full-screen', relayout);
    this.win.on('resize', () => this.rememberBounds());
    this.win.on('move', () => this.rememberBounds());
    this.win.on('blur', () => this.hideMenu());

    this.win.on('close', (event) => {
      this.saveBounds();
      if (!this.deps.isQuitting() && this.deps.settings.value('closeToTray')) {
        event.preventDefault();
        this.win.hide();
        this.deps.onHiddenToTray();
      }
    });
    this.win.on('closed', () => {
      if (this.poll) clearInterval(this.poll);
    });

    for (const wc of [this.win.webContents, this.overlay.webContents]) {
      wc.on('before-input-event', (event, input) => {
        if (this.handleKey(input, wc)) event.preventDefault();
      });
      wc.on('will-navigate', (event) => event.preventDefault());
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    }
  }

  private pushState(): void {
    if (this.win.isDestroyed()) return;
    const shown = this.pending ?? this.active;
    const wc = this.views[shown].webContents;
    const site = isSiteId(shown);
    const state: ShellState = {
      active: shown,
      title: site ? wc.getTitle() : '',
      url: site ? wc.getURL() : '',
      canGoBack: site && wc.navigationHistory.canGoBack(),
      canGoForward: site && wc.navigationHistory.canGoForward(),
      loading: site && wc.isLoading(),
    };
    this.win.webContents.send(CH.state, state);
    this.win.setTitle(state.title ? `${state.title} | haunt+` : 'haunt+');
  }

  private layout(): void {
    if (this.win.isDestroyed()) return;
    const rect = this.siteRect();
    for (const view of Object.values(this.views)) view.setBounds(rect);
    if (this.overlayMode === 'full') this.overlay.setBounds(rect);
    if (this.overlayMode === 'menu') this.overlay.setBounds(this.menuRect());
    if (this.overlayMode === 'tour') {
      this.overlay.setBounds(this.windowRect());
      void this.sendTour();
    }
  }

  private windowRect(): Rectangle {
    const [width, height] = this.win.getContentSize();
    return { x: 0, y: 0, width, height };
  }

  private siteRect(): Rectangle {
    const [width, height] = this.win.getContentSize();
    return { x: 0, y: TITLEBAR, width, height: Math.max(0, height - TITLEBAR) };
  }

  private menuRect(): Rectangle {
    const [width, height] = this.win.getContentSize();
    const area = Math.max(0, height - TITLEBAR);
    const h = Math.min(MENU_H, area);
    return { x: width - MENU_W, y: TITLEBAR + Math.round((area - h) / 2), width: MENU_W, height: h };
  }

  private showOverlay(mode: Exclude<OverlayMode, 'hidden'>): void {
    this.overlayMode = mode;
    this.overlay.setBounds(mode === 'full' ? this.siteRect() : mode === 'tour' ? this.windowRect() : this.menuRect());
    this.overlay.setVisible(true);
    this.raise(this.overlay);
  }

  private hideOverlay(): void {
    this.overlayMode = 'hidden';
    this.overlay.setVisible(false);
  }

  private raise(view: WebContentsView): void {
    this.win.contentView.addChildView(view);
  }

  private sendOverlay(channel: string, data?: unknown): void {
    if (!this.overlay.webContents.isDestroyed()) this.overlay.webContents.send(channel, data);
  }

  private expect(name: Signal, timeout: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(finish, timeout);
      function finish() {
        clearTimeout(timer);
        resolve();
      }
      this.signals.set(name, finish);
    });
  }

  private resolve(name: Signal): void {
    const finish = this.signals.get(name);
    this.signals.delete(name);
    finish?.();
  }

  private isSite(wc: WebContents): boolean {
    return wc === this.views.haunt.webContents || wc === this.views.tools.webContents;
  }

  private initialBounds(): Partial<Rectangle> {
    const saved = this.deps.settings.value('bounds');
    if (saved) {
      const area = screen.getDisplayMatching(saved).workArea;
      const visible =
        saved.x < area.x + area.width - 80 &&
        saved.x + saved.width > area.x + 80 &&
        saved.y >= area.y - 8 &&
        saved.y < area.y + area.height - 80;
      if (visible) return saved;
    }
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(1360, Math.round(area.width * 0.86));
    const height = Math.min(880, Math.round(area.height * 0.88));
    return { width, height };
  }

  private rememberBounds(): void {
    if (this.boundsTimer) clearTimeout(this.boundsTimer);
    this.boundsTimer = setTimeout(() => this.saveBounds(), 500);
  }

  private saveBounds(): void {
    if (this.win.isDestroyed() || this.win.isMinimized() || this.win.isFullScreen()) return;
    this.deps.settings.update({ bounds: this.win.getNormalBounds(), maximized: this.win.isMaximized() });
  }
}
