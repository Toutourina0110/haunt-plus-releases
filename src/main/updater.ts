import { app, Notification } from 'electron';
import { autoUpdater } from 'electron-updater';
import { t } from '../shared/i18n';
import type { Locale, UpdateStatus } from '../shared/types';

const CHECK_EVERY = 4 * 60 * 60 * 1000;

export class Updater {
  status: UpdateStatus = { state: app.isPackaged ? 'idle' : 'dev' };

  constructor(
    private readonly locale: () => Locale,
    private readonly onChange: (status: UpdateStatus) => void,
    private readonly beforeInstall: () => void,
  ) {}

  start(): void {
    if (!app.isPackaged) return;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }));
    autoUpdater.on('update-not-available', () => this.set({ state: 'none' }));
    autoUpdater.on('update-available', (info) => this.set({ state: 'downloading', percent: 0, version: info.version }));
    autoUpdater.on('download-progress', (p) =>
      this.set({ state: 'downloading', percent: Math.round(p.percent), version: this.status.version }),
    );
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ state: 'ready', version: info.version });
      if (Notification.isSupported()) {
        new Notification({
          title: t(this.locale(), 'updateReadyTitle'),
          body: t(this.locale(), 'updateReadyBody', { v: info.version }),
        }).show();
      }
    });
    autoUpdater.on('error', (err) => {
      console.error('Update error:', err);
      if (this.status.state !== 'ready') this.set({ state: 'error' });
    });

    setTimeout(() => this.check(), 15_000);
    setInterval(() => this.check(), CHECK_EVERY);
  }

  check(): void {
    if (!app.isPackaged || this.status.state === 'downloading' || this.status.state === 'ready') return;
    autoUpdater.checkForUpdates().catch(() => this.set({ state: 'error' }));
  }

  install(): void {
    if (this.status.state !== 'ready') return;
    this.beforeInstall();
    autoUpdater.quitAndInstall();
  }

  private set(status: UpdateStatus): void {
    this.status = status;
    this.onChange(status);
  }
}
