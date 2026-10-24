import {
  BrowserWindow,
  clipboard,
  WebContentsView,
  type BrowserWindowConstructorOptions,
  type Input,
  type Session,
  type WebContents,
} from 'electron';
import { CH } from '../shared/channels';
import { palette } from '../shared/palette';
import type { Locale, PopupAction, PopupState, SiteId, UiInit } from '../shared/types';
import { decidePopupNavigation, siteOf, type Decision } from './routing';
import type { SettingsStore } from './settings';
import { assetFile, load, openExternal, rendererFile, sitePrefs, TITLEBAR, uiPrefs } from './util';

export interface PopupContext {
  locale: () => Locale;
  version: string;
  settings: SettingsStore;
  session: Session;
  isDark(): boolean;
  parent(): BrowserWindow | null;
  openInSite(site: SiteId, url: string): void;
  handleKey(input: Input, wc: WebContents): boolean;
}

type Kind = 'link' | 'auth';

class Popup {
  readonly win: BrowserWindow;
  readonly view: WebContentsView;
  private readonly home: SiteId | null;

  constructor(
    private readonly ctx: PopupContext,
    readonly source: SiteId,
    readonly kind: Kind,
    init: { url?: string; guest?: WebContents; width?: number; height?: number },
    offset: number,
    onClosed: () => void,
  ) {
    this.home = init.url ? siteOf(init.url) : null;
    const p = palette(source, ctx.isDark());
    const parent = ctx.parent();
    const width = Math.max(480, Math.round(init.width ?? 1040));
    const height = Math.max(420, Math.round((init.height ?? 680) + TITLEBAR));
    const options: BrowserWindowConstructorOptions = {
      width,
      height,
      minWidth: 420,
      minHeight: 360,
      show: false,
      title: 'haunt+',
      icon: assetFile('icon-tools.png'),
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: p.bg, symbolColor: p.fg, height: TITLEBAR },
      backgroundColor: p.bg,
      webPreferences: uiPrefs(),
    };
    if (parent && !parent.isDestroyed() && parent.isVisible()) {
      const b = parent.getBounds();
      options.x = Math.round(b.x + (b.width - width) / 2 + offset);
      options.y = Math.round(b.y + (b.height - height) / 2 + offset);
    }

    this.win = new BrowserWindow(options);
    this.view = init.guest
      ? new WebContentsView({ webContents: init.guest })
      : new WebContentsView({ webPreferences: sitePrefs(ctx.session) });
    this.view.setBackgroundColor(p.bg);
    this.win.contentView.addChildView(this.view);
    this.layout();

    this.win.on('resize', () => this.layout());
    this.win.once('ready-to-show', () => this.win.show());
    this.win.on('closed', () => {
      if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
      onClosed();
    });

    this.wire();
    this.win.webContents.on('will-navigate', (event) => event.preventDefault());
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.win.webContents.on('before-input-event', (event, input) => {
      if (this.ctx.handleKey(input, this.view.webContents)) event.preventDefault();
    });
    void this.win.loadFile(rendererFile('popup.html'));
    if (init.url) load(this.view.webContents, init.url);
  }

  init(): UiInit {
    return {
      role: 'popup',
      locale: this.ctx.locale(),
      dark: this.ctx.isDark(),
      site: this.source,
      settings: this.ctx.settings.get(),
      version: this.ctx.version,
    };
  }

  action(action: PopupAction): void {
    const wc = this.view.webContents;
    switch (action) {
      case 'back':
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
        break;
      case 'forward':
        if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
        break;
      case 'reload':
        wc.reload();
        break;
      case 'copy':
        clipboard.writeText(wc.getURL());
        this.win.webContents.send(CH.linkCopied);
        break;
      case 'browser':
        openExternal(wc.getURL());
        break;
    }
  }

  setDark(dark: boolean): void {
    const p = palette(this.source, dark);
    this.win.setTitleBarOverlay({ color: p.bg, symbolColor: p.fg, height: TITLEBAR });
    this.win.setBackgroundColor(p.bg);
    this.win.webContents.send(CH.theme, { dark });
  }

  close(): void {
    if (!this.win.isDestroyed()) this.win.close();
  }

  private layout(): void {
    const [width, height] = this.win.getContentSize();
    this.view.setBounds({ x: 0, y: TITLEBAR, width, height: Math.max(0, height - TITLEBAR) });
  }

  private state(): PopupState {
    const wc = this.view.webContents;
    return {
      source: this.source,
      title: wc.getTitle(),
      url: wc.getURL(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
    };
  }

  private push = (): void => {
    if (this.win.isDestroyed() || this.view.webContents.isDestroyed()) return;
    this.win.webContents.send(CH.popupState, this.state());
    this.win.setTitle(this.view.webContents.getTitle() || 'haunt+');
  };

  private apply(decision: Decision): boolean {
    switch (decision.kind) {
      case 'site':
        this.ctx.openInSite(decision.site, decision.url);
        return true;
      case 'external':
        openExternal(decision.url);
        return true;
      case 'block':
        return true;
      default:
        return false;
    }
  }

  private wire(): void {
    const wc = this.view.webContents;
    wc.on('will-navigate', (event) => {
      if (this.apply(decidePopupNavigation(this.kind, event.url, this.home))) event.preventDefault();
    });
    wc.setWindowOpenHandler(({ url }) => {
      const decision = decidePopupNavigation('link', url, this.home);
      if (!this.apply(decision)) load(wc, url);
      return { action: 'deny' };
    });
    wc.on('page-title-updated', this.push);
    wc.on('did-navigate', this.push);
    wc.on('did-navigate-in-page', this.push);
    wc.on('did-start-loading', this.push);
    wc.on('did-stop-loading', this.push);
    wc.on('before-input-event', (event, input) => {
      if (this.ctx.handleKey(input, wc)) event.preventDefault();
    });
    wc.on('destroyed', () => this.close());
    this.win.webContents.on('did-finish-load', this.push);
  }
}

export class Popups {
  private readonly items = new Map<number, Popup>();
  private cascade = 0;

  constructor(private readonly ctx: PopupContext) {}

  open(source: SiteId, url: string, onClosed?: () => void): void {
    this.track(
      new Popup(this.ctx, source, 'link', { url }, this.nextOffset(), () => {
        this.forget();
        onClosed?.();
      }),
    );
  }

  adopt(source: SiteId, options: BrowserWindowConstructorOptions): WebContents {
    const guest = (options as { webContents?: WebContents }).webContents;
    if (!guest) throw new Error('window.open without a guest WebContents');
    const popup = new Popup(
      this.ctx,
      source,
      'auth',
      { guest, width: options.width, height: options.height },
      this.nextOffset(),
      () => this.forget(),
    );
    this.track(popup);
    return guest;
  }

  find(sender: WebContents): Popup | undefined {
    return this.items.get(sender.id);
  }

  setDark(dark: boolean): void {
    for (const popup of this.items.values()) popup.setDark(dark);
  }

  closeAll(): void {
    for (const popup of [...this.items.values()]) popup.close();
  }

  private track(popup: Popup): void {
    const id = popup.win.webContents.id;
    this.items.set(id, popup);
    popup.win.on('closed', () => this.items.delete(id));
  }

  private forget(): void {
    if (this.items.size <= 1) this.cascade = 0;
  }

  private nextOffset(): number {
    const offset = (this.cascade % 6) * 24;
    this.cascade += 1;
    return offset;
  }
}

export function isPopupAction(value: unknown): value is PopupAction {
  return typeof value === 'string' && ['back', 'forward', 'reload', 'copy', 'browser'].includes(value);
}
