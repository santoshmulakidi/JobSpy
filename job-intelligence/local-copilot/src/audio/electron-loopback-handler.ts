import type { DesktopCapturer, MediaAccessPermissionRequest, Session, WebContents } from 'electron';

const LOCAL_CAPTURE_ORIGIN = 'copilot://app/';

export class CapturePermissionGate {
  private activeLifecycle: string | null = null;

  public constructor(private readonly designatedWebContents: Pick<WebContents, 'id' | 'mainFrame'>) {}

  public authorize(lifecycle: string): void {
    if (lifecycle.length === 0) {
      throw new Error('Capture lifecycle must not be empty.');
    }
    this.activeLifecycle = lifecycle;
  }

  public revoke(lifecycle?: string): void {
    if (lifecycle === undefined || lifecycle === this.activeLifecycle) {
      this.activeLifecycle = null;
    }
  }

  public allowsDisplay(frame: unknown, securityOrigin: string): boolean {
    return this.activeLifecycle !== null
      && frame === this.designatedWebContents.mainFrame
      && securityOrigin === LOCAL_CAPTURE_ORIGIN;
  }

  public allowsMedia(
    webContents: WebContents | null,
    securityOrigin: string,
    isMainFrame: boolean,
    mediaTypes: readonly string[],
  ): boolean {
    return this.activeLifecycle !== null
      && webContents === this.designatedWebContents
      && securityOrigin === LOCAL_CAPTURE_ORIGIN
      && isMainFrame
      && mediaTypes.length === 1
      && mediaTypes[0] === 'audio';
  }
}

/** Main-process policy for Windows loopback requested by the packaged capture host. */
export function installElectronLoopbackHandler(
  captureSession: Pick<Session,
    'setDisplayMediaRequestHandler' | 'setPermissionCheckHandler' | 'setPermissionRequestHandler'>,
  sourceProvider: Pick<DesktopCapturer, 'getSources'>,
  permissionGate: CapturePermissionGate,
): void {
  captureSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!request.audioRequested || !permissionGate.allowsDisplay(request.frame, request.securityOrigin)) {
      callback({});
      return;
    }
    void sourceProvider.getSources({ types: ['screen'] }).then(([video]) => {
      callback({
        audio: 'loopback',
        ...(request.videoRequested && video ? { video } : {}),
      });
    }, () => callback({}));
  });
  captureSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) =>
    permission === 'media'
    && permissionGate.allowsMedia(
      _webContents,
      details.securityOrigin ?? requestingOrigin,
      details.isMainFrame,
      [details.mediaType ?? 'unknown'],
    ));
  captureSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaRequest = details as MediaAccessPermissionRequest;
    callback(permission === 'media' && permissionGate.allowsMedia(
      webContents,
      mediaRequest.securityOrigin ?? '',
      mediaRequest.isMainFrame,
      mediaRequest.mediaTypes ?? [],
    ));
  });
}
