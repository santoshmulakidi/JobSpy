import type { DesktopCapturer, MediaAccessPermissionRequest, Session } from 'electron';

/** Main-process policy for Windows loopback requested by the packaged capture host. */
export function installElectronLoopbackHandler(
  captureSession: Pick<Session,
    'setDisplayMediaRequestHandler' | 'setPermissionCheckHandler' | 'setPermissionRequestHandler'>,
  sourceProvider: Pick<DesktopCapturer, 'getSources'>,
): void {
  const isLocalCaptureOrigin = (origin: string | undefined) => origin === 'copilot://app/';
  captureSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!isLocalCaptureOrigin(request.securityOrigin) || !request.audioRequested) {
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
    && details.mediaType === 'audio'
    && isLocalCaptureOrigin(details.securityOrigin ?? requestingOrigin));
  captureSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const mediaRequest = details as MediaAccessPermissionRequest;
    const audioOnly = mediaRequest.mediaTypes?.length === 1 && mediaRequest.mediaTypes[0] === 'audio';
    callback(permission === 'media' && audioOnly && isLocalCaptureOrigin(mediaRequest.securityOrigin));
  });
}
