import {
  app,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  session,
  Tray,
  type IpcMainEvent,
  type Session,
} from 'electron';
import { CH, UI_SEND } from '../shared/channels';
import { SHORTCUT_KEYS, type ShortcutKey, type ShortcutStatus } from '../shared/shortcuts';
import { resolveLocale, t } from '../shared/i18n';
import type { Locale, SettingsPatch } from '../shared/types';
import { setupCapture } from './capture';
import { ImageEditors } from './editor-image';
import { VideoEditors } from './editor-video';
import { MediaGrants, registerMediaScheme, setupMediaProtocol } from './media-protocol';
import { Recorder } from './recorder';
import { ImageHost } from './imagehost';
import { isPopupAction, Popups } from './popups';
import { Replay } from './replay';
import { isWebUrl, parseUrl } from './routing';
import { cleanPatch, SettingsStore } from './settings';
import { Updater } from './updater';
import { hauntPlusCode, watchUserscript } from './userscript';
import { assetFile, openExternal } from './util';
import path from 'node:path';
import { MainWindow } from './window';

const APP_ID = 'site.haunt-tools.desktop';
const GLOBAL_SHORTCUT = 'Control+Alt+H';

let quitting = false;
let mainWindow: MainWindow | null = null;
let popups: Popups | null = null;
let replay: Replay | null = null;
let tray: Tray | null = null;

registerMediaScheme();
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId(app.isPackaged ? APP_ID : APP_ID + '.dev');
  app.on('second-instance', () => mainWindow?.show());
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(boot).catch((err) => {
    console.error(err);
    app.quit();
  });
}

async function boot(): Promise<void> {
  Menu.setApplicationMenu(null);
  const settings = new SettingsStore();
  let locale = resolveLocale(settings.value('language'), app.getLocale());
  const currentLocale = () => locale;
  const sites = session.fromPartition('persist:sites');
  setupSiteSession(sites);
  lockDownUiSession(session.defaultSession, (wc, permission) => {
    if (permission !== 'media' && permission !== 'display-capture') return false;
    if (permission === 'media' && replay?.isPage(wc)) return true;
    return !!recorder?.isPage(wc) || (permission === 'media' && !!wc && !!mainWindow?.isImagesView(wc));
  });
  const videoRoot = () => settings.value('videoFolder') || path.join(app.getPath('videos'), 'haunt+');
  const grants = new MediaGrants(videoRoot);
  setupMediaProtocol(grants);

  let notice: { message: string } | null = null;
  let noticeShown = false;
  const offerNotice = () => {
    const s = updater.status;
    if (!notice || noticeShown || !s.version || (s.state !== 'downloading' && s.state !== 'ready')) return;
    noticeShown = !!mainWindow?.showUpdateNotice({ version: s.version, message: notice.message });
  };
  const readNotice = async () => {
    try {
      const url = process.env.HAUNT_PLUS_NOTICE_URL || 'https://www.haunt-tools.site/api/maintenance';
      const res = await net.fetch(url, { cache: 'no-store' });
      const data = res.ok ? ((await res.json()) as { desktop?: { message?: unknown } | null }) : null;
      const desktop = data?.desktop;
      notice = desktop ? { message: typeof desktop.message === 'string' ? desktop.message.slice(0, 300) : '' } : null;
    } catch {
      return;
    }
    if (!notice) return;
    const state = updater.status.state;
    if (state === 'downloading' || state === 'ready') offerNotice();
    else updater.check();
  };

  const updater = new Updater(
    currentLocale,
    (status) => {
      mainWindow?.sendToOverlay(CH.updateStatus, status);
      offerNotice();
    },
    () => {
      quitting = true;
    },
  );

  const imagehost = new ImageHost({
    locale: currentLocale,
    settings,
    onUploaded: () => mainWindow?.sendToImages(CH.imagehostUploaded),
    openImages: () => mainWindow?.openInSite('images'),
    openEditor: (png) => editors.openPng(png),
  });
  const editors = new ImageEditors({
    locale: currentLocale,
    isDark: () => nativeTheme.shouldUseDarkColors,
    settings,
    hasKey: () => imagehost.hasKey(),
    upload: (png) => imagehost.uploadEdited(png),
  });
  setupCapture();
  const videos = new VideoEditors({
    locale: currentLocale,
    isDark: () => nativeTheme.shouldUseDarkColors,
    settings,
    hasKey: () => imagehost.hasKey(),
    root: videoRoot,
    grants,
    list: (query) => imagehost.list(query),
    upload: (name, mime, data) => imagehost.uploadFile(name, mime, data),
  });
  let recorder: Recorder | null = null;
  let hiddenForRecording = false;
  recorder = new Recorder({
    locale: currentLocale,
    settings,
    videoRoot,
    onDone: (dir) => videos.open({ recording: path.basename(dir) }),
    onBusy: (busy) => {
      mainWindow?.sendToImages(CH.recording, busy);
      if (!busy && hiddenForRecording) {
        hiddenForRecording = false;
        mainWindow?.show();
      }
    },
  });
  replay = new Replay({
    locale: currentLocale,
    settings,
    videoRoot,
    openClip: (file) => videos.open({ clip: file }),
  });
  const recordFromApp = async (kind: 'area' | 'screen') => {
    if (recorder?.recording) return recorder.command('stop');
    mainWindow?.win.hide();
    hiddenForRecording = true;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await recorder?.toggle(kind);
    if (!recorder?.recording) {
      hiddenForRecording = false;
      mainWindow?.show();
    }
  };

  popups = new Popups({
    locale: currentLocale,
    version: app.getVersion(),
    settings,
    session: sites,
    isDark: () => nativeTheme.shouldUseDarkColors,
    parent: () => mainWindow?.win ?? null,
    openInSite: (site, url) => mainWindow?.openInSite(site, url),
    handleKey: (input, wc) => mainWindow?.handleKey(input, wc) ?? false,
  });

  mainWindow = new MainWindow({
    locale: currentLocale,
    version: app.getVersion(),
    settings,
    session: sites,
    popups: () => popups!,
    isQuitting: () => quitting,
    updateStatus: () => updater.status,
    hasKey: () => imagehost.hasKey(),
    shortcutStatus: () => shortcutStatus,
    onHiddenToTray: () => showTrayHint(locale, settings),
  });

  const applyLoginItem = () => {
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: settings.value('openAtLogin'), args: ['--autostart'] });
    }
  };
  const captureActions: Record<ShortcutKey, () => void> = {
    shortcutArea: () => void imagehost.captureArea(),
    shortcutScreen: () => void imagehost.captureScreen(),
    shortcutClipboard: () => void imagehost.uploadClipboard(),
    shortcutRecordArea: () => void recorder?.toggle('area'),
    shortcutRecordScreen: () => void recorder?.toggle('screen'),
    shortcutReplay: () => void replay?.save(),
  };
  let shortcutStatus = Object.fromEntries(SHORTCUT_KEYS.map((key) => [key, false])) as ShortcutStatus;
  let shortcutsPaused = false;
  const tryRegister = (acc: string, action: () => void) => {
    try {
      return globalShortcut.register(acc, action);
    } catch {
      return false;
    }
  };
  const applyShortcut = () => {
    globalShortcut.unregisterAll();
    if (settings.value('globalShortcut')) tryRegister(GLOBAL_SHORTCUT, () => mainWindow?.toggleVisible());
    const used = new Set<string>([GLOBAL_SHORTCUT]);
    const status = { ...shortcutStatus };
    for (const key of SHORTCUT_KEYS) {
      const acc = settings.value(key);
      if (!shortcutsPaused) status[key] = settings.value('imagehostShortcuts') && !used.has(acc) && tryRegister(acc, captureActions[key]);
      used.add(acc);
    }
    shortcutStatus = status;
    mainWindow?.sendToImages(CH.shortcutStatus, status);
  };

  const applySettings = (patch: SettingsPatch) => {
    const before = settings.get();
    settings.update(patch);
    if (patch.openAtLogin !== undefined) applyLoginItem();
    if (
      patch.globalShortcut !== undefined ||
      patch.imagehostShortcuts !== undefined ||
      SHORTCUT_KEYS.some((key) => patch[key] !== undefined)
    ) {
      applyShortcut();
    }
    if (patch.hauntPlus !== undefined && patch.hauntPlus !== before.hauntPlus) mainWindow?.reloadHaunt();
    const replayKeys = ['replayEnabled', 'replayMode', 'replaySeconds', 'replayMic'] as const;
    if (replayKeys.some((key) => patch[key] !== undefined && patch[key] !== before[key]) || (patch.recordMic !== undefined && before.replayMic)) {
      void replay?.apply();
    }
    if (patch.language && patch.language !== before.language) {
      locale = resolveLocale(patch.language, app.getLocale());
      tray?.setContextMenu(trayMenu(locale));
      void mainWindow?.reloadUi();
    } else if (patch.font !== undefined && patch.font !== before.font) {
      void mainWindow?.reloadUi();
    }
    mainWindow?.sendToOverlay(CH.settingsChanged, settings.get());
    mainWindow?.sendToImages(CH.settingsChanged, settings.get());
    mainWindow?.sendToShell(CH.settingsChanged, settings.get());
  };

  const clearData = async () => {
    await sites.clearStorageData();
    await sites.clearCache();
    popups?.closeAll();
    mainWindow?.reloadAll();
    mainWindow?.sendToOverlay(CH.dataCleared);
  };

  ipcMain.handle(CH.init, (event) => {
    if (mainWindow?.owns(event.sender)) return mainWindow.init(event.sender);
    const popup = popups?.find(event.sender);
    if (popup) return popup.init();
    throw new Error('Unknown sender');
  });

  for (const channel of UI_SEND) {
    ipcMain.on(channel, (event: IpcMainEvent, data: unknown) => {
      const sender = event.sender;
      if (mainWindow?.owns(sender)) {
        switch (channel) {
          case CH.settingsSet:
            applySettings(cleanPatch(data));
            return;
          case CH.clearData:
            void clearData();
            return;
          case CH.updateCheck:
            updater.check();
            return;
          case CH.updateInstall:
            updater.install();
            return;
          case CH.shortcutPause:
            if (mainWindow.isImagesView(sender)) {
              shortcutsPaused = data === true;
              mainWindow.setRecording(shortcutsPaused);
              applyShortcut();
            }
            return;
          case CH.imagehostCopy:
            if (isHttpsUrl(data)) clipboard.writeText(data);
            return;
          case CH.imagehostOpen:
            if (isHttpsUrl(data)) openExternal(data);
            return;
          case CH.imagehostCapture:
            if (data === 'area' || data === 'screen') void captureFromApp(data);
            if (data === 'clipboard') void imagehost.uploadClipboard();
            if (data === 'record-area' || data === 'record-screen') void recordFromApp(data === 'record-area' ? 'area' : 'screen');
            if (data === 'video-editor') videos.open();
            if (data === 'replay-save') void replay?.save();
            if (data === 'video-folder') void chooseVideoFolder();
            return;
          case CH.imagehostAnnotate:
            if (mainWindow.isImagesView(sender)) void editors.openSource(data);
            return;
          default:
            mainWindow.onUi(channel, data, sender);
            return;
        }
      }
      const popup = popups?.find(sender);
      if (popup && channel === CH.popupAction && isPopupAction(data)) popup.action(data);
    });
  }

  const fromImages = (event: Electron.IpcMainInvokeEvent) => mainWindow?.isImagesView(event.sender) ?? false;
  ipcMain.handle(CH.imagehostList, (event, query: unknown) => (fromImages(event) ? imagehost.list(query) : null));
  ipcMain.handle(CH.imagehostFolders, (event) => (fromImages(event) ? imagehost.folders() : null));
  ipcMain.handle(CH.imagehostUpload, (event, files: unknown) => (fromImages(event) ? imagehost.uploadFiles(files) : []));
  ipcMain.handle(CH.imagehostKey, (event, key: unknown) => (fromImages(event) ? imagehost.setKey(key) : null));
  ipcMain.handle(CH.imagehostDelete, (event, item: unknown) => (fromImages(event) ? imagehost.deleteUpload(item, mainWindow?.win ?? null) : null));

  const chooseVideoFolder = async () => {
    const win = mainWindow?.win;
    if (!win) return;
    const res = await dialog.showOpenDialog(win, { defaultPath: videoRoot(), properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths[0]) return;
    settings.update({ videoFolder: res.filePaths[0] });
    mainWindow?.sendToImages(CH.settingsChanged, settings.get());
  };

  const captureFromApp = async (kind: 'area' | 'screen') => {
    const win = mainWindow?.win;
    if (!win) return;
    win.hide();
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      await (kind === 'area' ? imagehost.captureArea() : imagehost.captureScreen());
    } finally {
      mainWindow?.show();
    }
  };

  ipcMain.on(CH.hauntPlusCode, (event) => {
    event.returnValue = shouldInjectHauntPlus(event, settings.value('hauntPlus')) ? hauntPlusCode() : null;
  });

  nativeTheme.on('updated', () => {
    mainWindow?.onThemeChange();
    popups?.setDark(nativeTheme.shouldUseDarkColors);
  });

  createTray(locale);
  applyLoginItem();
  applyShortcut();

  void replay.apply();

  app.on('will-quit', () => {
    replay?.stop();
    globalShortcut.unregisterAll();
    settings.flush();
  });

  const hidden = process.argv.includes('--autostart') && settings.value('closeToTray');
  await mainWindow.start(hidden);
  updater.start();
  mainWindow.win.on('show', offerNotice);
  setTimeout(() => void readNotice(), 20_000);
  setInterval(() => void readNotice(), 10 * 60 * 1000);
  watchUserscript();
}

function shouldInjectHauntPlus(event: IpcMainEvent, enabled: boolean): boolean {
  if (!enabled || !mainWindow?.isHauntView(event.sender)) return false;
  const url = parseUrl(event.senderFrame?.url ?? event.sender.getURL());
  return !!url && url.protocol === 'https:' && url.hostname === 'haunt.gg';
}

function isHttpsUrl(v: unknown): v is string {
  const url = typeof v === 'string' ? parseUrl(v) : null;
  return !!url && url.protocol === 'https:';
}

function setupSiteSession(ses: Session): void {
  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen', 'notifications']);
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(allowed.has(permission) && isWebUrl(details.requestingUrl));
  });
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

function lockDownUiSession(ses: Session, allow: (wc: Electron.WebContents | null, permission: string) => boolean): void {
  ses.setPermissionRequestHandler((wc, permission, callback) => callback(allow(wc, permission)));
  ses.setPermissionCheckHandler((wc, permission) => allow(wc, permission));
}

function trayIcon(): Electron.NativeImage {
  return nativeImage.createFromPath(assetFile('tray-tools.png'));
}

function createTray(locale: Locale): void {
  tray = new Tray(trayIcon());
  tray.setToolTip('haunt+');
  tray.setContextMenu(trayMenu(locale));
  tray.on('click', () => mainWindow?.show());
}

function trayMenu(locale: Locale): Electron.Menu {
  return Menu.buildFromTemplate([
    { label: t(locale, 'trayOpenHaunt'), click: () => openFromTray('haunt') },
    { label: t(locale, 'trayOpenTools'), click: () => openFromTray('tools') },
    { label: t(locale, 'traySettings'), click: () => void mainWindow?.openSettings() },
    { type: 'separator' },
    {
      label: t(locale, 'trayQuit'),
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function openFromTray(site: 'haunt' | 'tools'): void {
  mainWindow?.show();
  void mainWindow?.switchTo(site);
}

function showTrayHint(locale: Locale, settings: SettingsStore): void {
  if (settings.value('trayHintShown') || !tray) return;
  settings.update({ trayHintShown: true });
  tray.displayBalloon({
    title: t(locale, 'trayHintTitle'),
    content: t(locale, 'trayHintBody'),
    iconType: 'none',
  });
}

