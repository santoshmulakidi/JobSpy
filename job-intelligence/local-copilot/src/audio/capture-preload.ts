import { ipcRenderer } from 'electron';

import { BrowserMediaCaptureHost } from './browser-media-capture-host';
import { installCapturePreload } from './install-capture-preload';

installCapturePreload(ipcRenderer, new BrowserMediaCaptureHost());
