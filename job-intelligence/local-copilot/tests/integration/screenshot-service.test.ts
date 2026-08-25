import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ScreenshotService,
  captureElectronDisplay,
  editScreenshotWithNativeImage,
  type ScreenshotEdits,
} from '../../src/main/capture/screenshot-service';

const services: ScreenshotService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  vi.useRealTimers();
});

function createService(buffers: Buffer[], ttlMs = 30_000) {
  const captured: Buffer[] = [];
  const edited: ScreenshotEdits[] = [];
  const service = new ScreenshotService({
    capture: async () => {
      const bytes = Buffer.from(buffers[captured.length] ?? [captured.length + 1]);
      captured.push(bytes);
      return { bytes, width: 100, height: 80, mediaType: 'image/png' };
    },
    edit: async ({ bytes, width, height }, edits) => {
      edited.push(edits);
      return { bytes: Buffer.from(bytes), width: edits.crop?.width ?? width, height: edits.crop?.height ?? height };
    },
    ttlMs,
  });
  services.push(service);
  return { service, captured, edited };
}

describe('ScreenshotService', () => {
  it('requires an explicit preview and confirmation before request use', async () => {
    const { service, captured } = createService([Buffer.from('screen')]);

    const preview = await service.preview('display-1');
    await expect(service.withConfirmed([preview.id], async () => undefined)).rejects.toThrow('not confirmed');

    const confirmation = await service.confirm(preview.id, {
      crop: { x: 10, y: 10, width: 50, height: 40 },
      redactions: [{ x: 2, y: 3, width: 8, height: 9 }],
    });
    let attachmentBytes: Uint8Array | undefined;
    const attachment = await service.withConfirmed([confirmation!.id], async ([value]) => {
      expect(Buffer.from(value!.data).toString()).toBe('screen');
      attachmentBytes = value!.data;
      return { id: value!.id, mediaType: value!.mediaType };
    });

    expect(attachment).toMatchObject({ id: preview.id, mediaType: 'image/png' });
    expect([...attachmentBytes!]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(captured[0].every((byte) => byte === 0)).toBe(true);
  });

  it('deduplicates confirmed ids before enforcing the five-attachment limit', async () => {
    const { service } = createService([]);
    const previews = await Promise.all(Array.from({ length: 5 }, () => service.preview()));
    await Promise.all(previews.map(({ id }) => service.confirm(id, {})));

    await expect(service.withConfirmed([...previews.map(({ id }) => id), previews[0].id], async (attachments) => {
      expect(attachments).toHaveLength(5);
    })).resolves.toBeUndefined();
  });

  it('bounds all pending and confirmed screenshots to five', async () => {
    const { service } = createService([]);

    await Promise.all(Array.from({ length: 5 }, (_, index) => service.preview(`display-${index}`)));

    await expect(service.preview('display-6')).rejects.toThrow('five');
  });

  it('discards, expires, and zeroes source bytes deterministically', async () => {
    vi.useFakeTimers();
    const { service, captured } = createService([Buffer.from([1, 2, 3]), Buffer.from([4, 5, 6])], 50);
    const discarded = await service.preview();
    const expired = await service.preview();

    expect(service.discard(discarded.id)).toBe(true);
    expect([...captured[0]]).toEqual([0, 0, 0]);

    await vi.advanceTimersByTimeAsync(50);
    expect([...captured[1]]).toEqual([0, 0, 0]);
    await expect(service.confirm(expired.id, {})).rejects.toThrow('not found');
  });

  it('keeps an approved screenshot after a failed send and consumes it after a successful retry', async () => {
    const { service, captured, edited } = createService([Buffer.from([7, 8]), Buffer.from([9, 10])]);
    const approved = await service.preview();
    const removed = await service.preview();
    const edits = {
      crop: { x: 1, y: 2, width: 30, height: 20 },
      redactions: [{ x: 3, y: 4, width: 5, height: 6 }],
    };

    await service.confirm(approved.id, edits);
    expect(await service.confirm(removed.id, { remove: true })).toBeUndefined();
    expect([...captured[1]]).toEqual([0, 0]);

    await expect(service.withConfirmed([approved.id], async () => {
      throw new Error('provider failed');
    })).rejects.toThrow('provider failed');

    expect(edited).toEqual([edits]);
    await expect(service.withConfirmed([approved.id], async () => 'sent')).resolves.toBe('sent');
    expect([...captured[0]]).toEqual([0, 0]);
  });

  it('never writes screenshot bytes to disk', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'copilot-screenshot-'));
    try {
      const { service } = createService([Buffer.from('private pixels')]);
      const preview = await service.preview();
      await service.confirm(preview.id, {});
      await service.withConfirmed([preview.id], async () => undefined);

      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('captures only the requested native display into an in-memory PNG buffer', async () => {
    const png = Buffer.from('png');
    const getSources = vi.fn(async () => [
      { display_id: 'display-1', thumbnail: { isEmpty: () => false, getSize: () => ({ width: 10, height: 10 }), toPNG: () => Buffer.from('wrong') } },
      { display_id: 'display-2', thumbnail: { isEmpty: () => false, getSize: () => ({ width: 20, height: 10 }), toPNG: () => png } },
    ]);

    const result = await captureElectronDisplay({
      desktopCapturer: { getSources },
      screen: { getAllDisplays: () => [{ size: { width: 1920, height: 1080 }, scaleFactor: 1 }] },
    }, 'display-2');

    expect(getSources).toHaveBeenCalledWith({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
    expect(result).toEqual({ bytes: png, width: 20, height: 10, mediaType: 'image/png' });
  });

  it('crops and permanently blacks out redacted native bitmap pixels', async () => {
    const bitmap = Buffer.alloc(2 * 2 * 4, 255);
    const output = Buffer.from('edited png');
    const cropped = {
      getSize: () => ({ width: 2, height: 2 }),
      toBitmap: () => bitmap,
    };
    const createFromBuffer = vi.fn(() => ({ crop: vi.fn(() => cropped) }));
    const createFromBitmap = vi.fn((bytes: Buffer) => ({ toPNG: () => {
      expect([...bytes.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
      expect([...bytes.subarray(4, 8)]).toEqual([255, 255, 255, 255]);
      return output;
    } }));

    const edited = await editScreenshotWithNativeImage(
      { createFromBuffer, createFromBitmap },
      { bytes: Buffer.from('original'), width: 4, height: 4, mediaType: 'image/png' },
      { crop: { x: 1, y: 1, width: 2, height: 2 }, redactions: [{ x: 0, y: 0, width: 1, height: 1 }] },
    );

    expect(edited).toEqual({ bytes: output, width: 2, height: 2 });
    expect(bitmap.every((byte) => byte === 0)).toBe(true);
  });
});
