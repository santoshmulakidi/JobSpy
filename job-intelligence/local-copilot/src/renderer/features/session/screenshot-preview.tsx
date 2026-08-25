import { useState, type FormEvent } from 'react';

import type { ScreenshotEdits } from '../../../main/capture/screenshot-service';

export interface ScreenshotPreviewValue {
  readonly id: string;
  readonly dataUrl: string;
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
  const [redaction, setRedaction] = useState({ x: 0, y: 0, width: 1, height: 1 });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onConfirm(preview.id, { crop, redactions: [redaction] });
  };

  return <figure aria-labelledby={`screenshot-${preview.id}-caption`}>
    <img src={preview.dataUrl} alt="Screenshot preview" width={preview.width} height={preview.height} />
    <figcaption id={`screenshot-${preview.id}-caption`}>Review screenshot before sending</figcaption>
    <form onSubmit={submit}>
      <fieldset>
        <legend>Crop</legend>
        <NumberField label="Crop left" value={crop.x} onChange={(x) => setCrop({ ...crop, x })} />
        <NumberField label="Crop top" value={crop.y} onChange={(y) => setCrop({ ...crop, y })} />
        <NumberField label="Crop width" value={crop.width} onChange={(width) => setCrop({ ...crop, width })} />
        <NumberField label="Crop height" value={crop.height} onChange={(height) => setCrop({ ...crop, height })} />
      </fieldset>
      <fieldset>
        <legend>Redaction</legend>
        <NumberField label="Redaction left" value={redaction.x} onChange={(x) => setRedaction({ ...redaction, x })} />
        <NumberField label="Redaction top" value={redaction.y} onChange={(y) => setRedaction({ ...redaction, y })} />
        <NumberField label="Redaction width" value={redaction.width} onChange={(width) => setRedaction({ ...redaction, width })} />
        <NumberField label="Redaction height" value={redaction.height} onChange={(height) => setRedaction({ ...redaction, height })} />
      </fieldset>
      <button type="submit">Confirm screenshot</button>
      <button type="button" onClick={() => onRemove(preview.id)}>Remove screenshot</button>
    </form>
  </figure>;
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
