import { useEffect, useState, type FormEvent } from 'react';

import type { ScreenshotEdits, ScreenshotRectangle } from '../../../main/capture/screenshot-service';

export interface ScreenshotPreviewValue {
  readonly id: string;
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface ScreenshotPreviewProps {
  readonly preview: ScreenshotPreviewValue;
  readonly onConfirm: (id: string, edits: ScreenshotEdits) => void;
  readonly onRemove: (id: string) => void;
}

export function ScreenshotPreview({ preview, onConfirm, onRemove }: ScreenshotPreviewProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0, width: preview.width, height: preview.height });
  const [redactions, setRedactions] = useState<ScreenshotRectangle[]>([]);
  const [src, setSrc] = useState('');

  useEffect(() => {
    const image = createScreenshotObjectUrl(preview.bytes, preview.mediaType);
    setSrc(image.src);
    return image.dispose;
  }, [preview.bytes, preview.mediaType]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onConfirm(preview.id, { crop, ...(redactions.length ? { redactions } : {}) });
  };

  return <figure aria-labelledby={`screenshot-${preview.id}-caption`}>
    <img src={src} alt="Screenshot preview" width={preview.width} height={preview.height} />
    <figcaption id={`screenshot-${preview.id}-caption`}>Review screenshot before sending</figcaption>
    <form onSubmit={submit}>
      <fieldset>
        <legend>Crop</legend>
        <NumberField label="Crop left" value={crop.x} onChange={(x) => setCrop({ ...crop, x })} />
        <NumberField label="Crop top" value={crop.y} onChange={(y) => setCrop({ ...crop, y })} />
        <NumberField label="Crop width" value={crop.width} onChange={(width) => setCrop({ ...crop, width })} />
        <NumberField label="Crop height" value={crop.height} onChange={(height) => setCrop({ ...crop, height })} />
      </fieldset>
      {redactions.map((redaction, index) => <fieldset key={index}>
        <legend>Redaction {index + 1}</legend>
        <NumberField label="Redaction left" value={redaction.x} onChange={(x) => setRedactions(redactions.map((value, item) => item === index ? { ...value, x } : value))} />
        <NumberField label="Redaction top" value={redaction.y} onChange={(y) => setRedactions(redactions.map((value, item) => item === index ? { ...value, y } : value))} />
        <NumberField label="Redaction width" value={redaction.width} onChange={(width) => setRedactions(redactions.map((value, item) => item === index ? { ...value, width } : value))} />
        <NumberField label="Redaction height" value={redaction.height} onChange={(height) => setRedactions(redactions.map((value, item) => item === index ? { ...value, height } : value))} />
      </fieldset>)}
      <button type="button" onClick={() => setRedactions([...redactions, { x: 0, y: 0, width: 1, height: 1 }])}>Add redaction</button>
      <button type="submit">Confirm screenshot</button>
      <button type="button" onClick={() => onRemove(preview.id)}>Remove screenshot</button>
    </form>
  </figure>;
}

export function createScreenshotObjectUrl(
  bytes: Uint8Array,
  mediaType: ScreenshotPreviewValue['mediaType'],
  urls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL,
): { readonly src: string; readonly dispose: () => void } {
  let src: string;
  try {
    src = urls.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mediaType }));
  } finally {
    bytes.fill(0);
  }
  return { src, dispose: () => urls.revokeObjectURL(src) };
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label>{label}<input
    aria-label={label}
    type="number"
    min="0"
    step="1"
    required
    value={value}
    onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
  /></label>;
}
