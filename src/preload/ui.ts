import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { UI_INVOKE, UI_LISTEN, UI_SEND } from '../shared/channels';

const send = new Set<string>(UI_SEND);
const listen = new Set<string>(UI_LISTEN);
const invoke = new Set<string>(UI_INVOKE);

contextBridge.exposeInMainWorld('desk', {
  send(channel: string, data?: unknown): void {
    if (send.has(channel)) ipcRenderer.send(channel, data);
  },
  invoke(channel: string, data?: unknown): Promise<unknown> {
    if (!invoke.has(channel)) return Promise.reject(new Error(`Channel not allowed: ${channel}`));
    return ipcRenderer.invoke(channel, data);
  },
  on(channel: string, callback: (data: unknown) => void): () => void {
    if (!listen.has(channel)) return () => {};
    const listener = (_event: IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
