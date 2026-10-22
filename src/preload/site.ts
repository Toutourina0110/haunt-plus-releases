import { ipcRenderer, webFrame } from 'electron';
import { CH } from '../shared/channels';

if (location.protocol === 'https:' && location.hostname === 'haunt.gg') {
  const code = ipcRenderer.sendSync(CH.hauntPlusCode) as string | null;
  if (code) {
    webFrame.executeJavaScript(code).catch((err: unknown) => console.error('haunt+ failed to start', err));
  }
}
