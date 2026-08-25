import { randomUUID } from 'node:crypto';

export interface ScreenshotRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ScreenshotEdits {
  readonly crop?: ScreenshotRectangle;
  readonly redactions?: readonly ScreenshotRectangle[];
  readonly remove?: boolean;
}

export interface CapturedScreenshot {
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface ScreenshotPreviewHandle {
  readonly id: string;
  readonly displayId?: string;
  readonly mediaType: CapturedScreenshot['mediaType'];
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly expiresAt: number;
}

export interface ConfirmedScreenshot {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly edits: ScreenshotEdits;
}

export interface ScreenshotAttachment {
  readonly id: string;
  readonly mediaType: CapturedScreenshot['mediaType'];
  readonly data: Uint8Array;
}

interface ScreenshotRecord extends CapturedScreenshot {
  readonly id: string;
  readonly displayId?: string;
  readonly expiresAt: number;
  readonly timer: ReturnType<typeof setTimeout>;
  confirmed: boolean;
  edits: ScreenshotEdits;
}

export interface ScreenshotServiceOptions {
  readonly capture: (displayId?: string) => Promise<CapturedScreenshot>;
  readonly edit: (
    screenshot: CapturedScreenshot,
    edits: ScreenshotEdits,
  ) => Promise<Pick<CapturedScreenshot, 'bytes' | 'width' | 'height'>>;
  readonly ttlMs?: number;
  readonly maxScreenshots?: number;
  readonly now?: () => number;
}

export class ScreenshotService {
  private readonly records = new Map<string, ScreenshotRecord>();
  private readonly ttlMs: number;
  private readonly maxScreenshots: number;
  private readonly now: () => number;
  private capturesInFlight = 0;

  constructor(private readonly options: ScreenshotServiceOptions) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.maxScreenshots = options.maxScreenshots ?? 5;
    this.now = options.now ?? Date.now;
  }

  async preview(displayId?: string): Promise<ScreenshotPreviewHandle> {
    if (this.records.size + this.capturesInFlight >= this.maxScreenshots) {
      throw new Error(`A request may contain at most ${this.maxScreenshots === 5 ? 'five' : this.maxScreenshots} screenshots.`);
    }

    this.capturesInFlight += 1;
    try {
      const screenshot = await this.options.capture(displayId);
      validateScreenshot(screenshot);
      const id = randomUUID();
      const expiresAt = this.now() + this.ttlMs;
      const timer = setTimeout(() => this.discard(id), this.ttlMs);
      this.records.set(id, {
        ...screenshot,
        id,
        displayId,
        expiresAt,
        timer,
        confirmed: false,
        edits: {},
      });
      return {
        id,
        displayId,
        mediaType: screenshot.mediaType,
        bytes: screenshot.bytes,
        width: screenshot.width,
        height: screenshot.height,
        expiresAt,
      };
    } finally {
      this.capturesInFlight -= 1;
    }
  }

  async confirm(id: string, edits: ScreenshotEdits): Promise<ConfirmedScreenshot | undefined> {
    const record = this.get(id);
    if (edits.remove) {
      this.discard(id);
      return undefined;
    }
    validateEdits(edits, record.width, record.height);
    const edited = await this.options.edit(record, edits);
    validateScreenshot({ ...edited, mediaType: record.mediaType });
    if (edited.bytes !== record.bytes) record.bytes.fill(0);
    Object.assign(record, edited, { confirmed: true, edits });
    return { id, width: edited.width, height: edited.height, edits };
  }

  discard(id: string): boolean {
    const record = this.records.get(id);
    if (!record) return false;
    clearTimeout(record.timer);
    record.bytes.fill(0);
    this.records.delete(id);
    return true;
  }

  async withConfirmed<T>(
    ids: readonly string[],
    send: (attachments: readonly ScreenshotAttachment[]) => Promise<T>,
  ): Promise<T> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length > 5) throw new Error('A request may contain at most five screenshots.');
    const records = uniqueIds.map((id) => this.get(id));
    if (records.some((record) => !record.confirmed)) {
      throw new Error('Screenshot is not confirmed.');
    }
    const result = await send(records.map((record) => ({
      id: record.id,
      mediaType: record.mediaType,
      data: record.bytes,
    })));
    for (const record of records) this.discard(record.id);
    return result;
  }

  dispose(): void {
    for (const id of [...this.records.keys()]) this.discard(id);
  }

  private get(id: string): ScreenshotRecord {
    const record = this.records.get(id);
    if (!record) throw new Error('Screenshot preview not found or expired.');
    return record;
  }
}

function validateScreenshot(screenshot: CapturedScreenshot): void {
  if (!screenshot.bytes.length || !Number.isInteger(screenshot.width) || screenshot.width <= 0
    || !Number.isInteger(screenshot.height) || screenshot.height <= 0) {
    screenshot.bytes.fill(0);
    throw new Error('Invalid screenshot.');
  }
}

function validateEdits(edits: ScreenshotEdits, width: number, height: number): void {
  const cropWidth = edits.crop?.width ?? width;
  const cropHeight = edits.crop?.height ?? height;
  if (edits.crop) validateRectangle(edits.crop, width, height);
  for (const redaction of edits.redactions ?? []) validateRectangle(redaction, cropWidth, cropHeight);
}

function validateRectangle(rectangle: ScreenshotRectangle, width: number, height: number): void {
  const values = [rectangle.x, rectangle.y, rectangle.width, rectangle.height];
  if (values.some((value) => !Number.isInteger(value)) || rectangle.x < 0 || rectangle.y < 0
    || rectangle.width <= 0 || rectangle.height <= 0
    || rectangle.x + rectangle.width > width || rectangle.y + rectangle.height > height) {
    throw new Error('Screenshot edit is outside the image bounds.');
  }
}

interface ElectronDisplayCaptureDependencies {
  readonly desktopCapturer: {
    getSources(options: { types: ['screen']; thumbnailSize: { width: number; height: number } }): Promise<readonly {
      readonly display_id: string;
      readonly thumbnail: {
        isEmpty(): boolean;
        getSize(): { width: number; height: number };
        toPNG(): Buffer;
      };
    }[]>;
  };
  readonly screen: {
    getAllDisplays(): readonly { readonly size: { width: number; height: number }; readonly scaleFactor: number }[];
  };
}

export async function captureElectronDisplay(
  dependencies: ElectronDisplayCaptureDependencies,
  displayId?: string,
): Promise<CapturedScreenshot> {
  const thumbnailSize = dependencies.screen.getAllDisplays().reduce(
    (maximum, display) => ({
      width: Math.max(maximum.width, Math.ceil(display.size.width * display.scaleFactor)),
      height: Math.max(maximum.height, Math.ceil(display.size.height * display.scaleFactor)),
    }),
    { width: 1, height: 1 },
  );
  const sources = await dependencies.desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  const source = displayId ? sources.find((candidate) => candidate.display_id === displayId) : sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('Display is not available.');
  const size = source.thumbnail.getSize();
  return { bytes: source.thumbnail.toPNG(), width: size.width, height: size.height, mediaType: 'image/png' };
}

interface NativeImageEditor {
  readonly createFromBuffer: (bytes: Buffer) => {
    crop(rectangle: ScreenshotRectangle): NativeImageBitmap;
  };
  readonly createFromBitmap: (bytes: Buffer, options: { width: number; height: number; scaleFactor: number }) => {
    toPNG(): Buffer;
  };
}

interface NativeImageBitmap {
  getSize(): { width: number; height: number };
  toBitmap(): Buffer;
}

export async function editScreenshotWithNativeImage(
  nativeImage: NativeImageEditor,
  screenshot: CapturedScreenshot,
  edits: ScreenshotEdits,
): Promise<Pick<CapturedScreenshot, 'bytes' | 'width' | 'height'>> {
  const original = nativeImage.createFromBuffer(screenshot.bytes);
  const crop = edits.crop ?? { x: 0, y: 0, width: screenshot.width, height: screenshot.height };
  const image = original.crop(crop);
  const size = image.getSize();
  const bitmap = image.toBitmap();
  try {
    for (const redaction of edits.redactions ?? []) redactBgra(bitmap, size.width, redaction);
    return {
      bytes: nativeImage.createFromBitmap(bitmap, { ...size, scaleFactor: 1 }).toPNG(),
      ...size,
    };
  } finally {
    bitmap.fill(0);
  }
}

function redactBgra(bitmap: Buffer, width: number, rectangle: ScreenshotRectangle): void {
  for (let y = rectangle.y; y < rectangle.y + rectangle.height; y += 1) {
    for (let x = rectangle.x; x < rectangle.x + rectangle.width; x += 1) {
      const offset = (y * width + x) * 4;
      bitmap[offset] = 0;
      bitmap[offset + 1] = 0;
      bitmap[offset + 2] = 0;
      bitmap[offset + 3] = 255;
    }
  }
}
