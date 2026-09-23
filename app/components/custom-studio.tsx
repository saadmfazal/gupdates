'use client';

import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowUpRight,
  Check,
  Crosshair,
  Image as ImageIcon,
  Move,
  RotateCcw,
  ScanLine,
  Upload,
} from 'lucide-react';
import {Slider} from '@/components/ui/slider';
import Link from './link';
import {SelectField} from './store';

type FitMode = 'fit' | 'fill';

type Artwork = {
  original: string;
  isolated: string;
  filename: string;
  width: number;
  height: number;
  autoMode: FitMode;
  detection: string;
};

// Calibrated against the visible top rim in hero-puck.webp. The same values
// drive both the rendered mask and inverse drag math so artwork can move far
// outside the face while the sidewall always remains protected.
const FACE_X = 44.29;
const FACE_Y = 42.61;
const FACE_SIZE = 79.5;
const FACE_ROTATION = -38.72;
const FACE_SQUASH = 0.467;

function cropCanvas(source: HTMLCanvasElement, bounds: {left: number; top: number; right: number; bottom: number}) {
  const subjectWidth = Math.max(1, bounds.right - bounds.left + 1);
  const subjectHeight = Math.max(1, bounds.bottom - bounds.top + 1);
  const padding = Math.max(3, Math.round(Math.max(subjectWidth, subjectHeight) * 0.025));
  const left = Math.max(0, bounds.left - padding);
  const top = Math.max(0, bounds.top - padding);
  const width = Math.min(source.width - left, subjectWidth + padding * 2);
  const height = Math.min(source.height - top, subjectHeight + padding * 2);
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  output.getContext('2d')?.drawImage(source, left, top, width, height, 0, 0, width, height);
  return output.toDataURL('image/png');
}

function alphaBounds(pixels: Uint8ClampedArray, width: number, height: number) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let transparent = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha < 20) transparent += 1;
      if (alpha <= 20) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return {left, top, right, bottom, transparent};
}

function analyseArtwork(image: HTMLImageElement, source: string, filename: string): Artwork {
  const maximumEdge = 1200;
  const reduction = Math.min(1, maximumEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * reduction));
  const height = Math.max(1, Math.round(image.naturalHeight * reduction));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) {
    return {original: source, isolated: '', filename, width, height, autoMode: 'fill', detection: 'FULL-FACE ARTWORK DETECTED'};
  }
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const firstBounds = alphaBounds(pixels, width, height);
  const transparencyRatio = firstBounds.transparent / (width * height);

  if (transparencyRatio > 0.008 && firstBounds.right >= firstBounds.left) {
    return {
      original: source,
      isolated: cropCanvas(canvas, firstBounds),
      filename,
      width,
      height,
      autoMode: 'fit',
      detection: 'TRANSPARENT LOGO DETECTED / TRIMMED TO ARTWORK',
    };
  }

  const edgeSamples: number[][] = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 90));
  const sample = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    edgeSamples.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
  };
  for (let x = 0; x < width; x += step) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    sample(0, y);
    sample(width - 1, y);
  }
  const background = edgeSamples
    .reduce((sum, color) => [sum[0] + color[0], sum[1] + color[1], sum[2] + color[2]], [0, 0, 0])
    .map(value => value / edgeSamples.length);
  const spread = Math.sqrt(
    edgeSamples.reduce(
      (total, color) => total + color.reduce((sum, channel, i) => sum + (channel - background[i]) ** 2, 0),
      0,
    ) / (edgeSamples.length * 3),
  );
  const luminance = background[0] * 0.2126 + background[1] * 0.7152 + background[2] * 0.0722;

  if (spread < 22 && luminance > 218) {
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;
    const threshold = Math.max(30, 18 + spread * 2.35);
    const thresholdSquared = threshold * threshold;
    const add = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const pixelIndex = y * width + x;
      if (visited[pixelIndex]) return;
      visited[pixelIndex] = 1;
      const dataIndex = pixelIndex * 4;
      const distance = (pixels[dataIndex] - background[0]) ** 2
        + (pixels[dataIndex + 1] - background[1]) ** 2
        + (pixels[dataIndex + 2] - background[2]) ** 2;
      if (distance > thresholdSquared) return;
      queue[tail] = pixelIndex;
      tail += 1;
    };
    for (let x = 0; x < width; x += 1) {
      add(x, 0);
      add(x, height - 1);
    }
    for (let y = 0; y < height; y += 1) {
      add(0, y);
      add(width - 1, y);
    }
    while (head < tail) {
      const pixelIndex = queue[head];
      head += 1;
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      pixels[pixelIndex * 4 + 3] = 0;
      add(x - 1, y);
      add(x + 1, y);
      add(x, y - 1);
      add(x, y + 1);
    }
    const cleanedBounds = alphaBounds(pixels, width, height);
    const removedRatio = cleanedBounds.transparent / (width * height);
    if (removedRatio > 0.035 && removedRatio < 0.94 && cleanedBounds.right >= cleanedBounds.left) {
      context.putImageData(imageData, 0, 0);
      return {
        original: source,
        isolated: cropCanvas(canvas, cleanedBounds),
        filename,
        width,
        height,
        autoMode: 'fit',
        detection: 'LOGO DETECTED / BACKGROUND CLEANED',
      };
    }
  }

  return {original: source, isolated: '', filename, width, height, autoMode: 'fill', detection: 'FULL-FACE ARTWORK DETECTED / CIRCULAR CROP'};
}

export function CustomStudio() {
  const [name, setName] = useState('YOUR TEAM');
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [fitMode, setFitMode] = useState<FitMode>('fit');
  const [scale, setScale] = useState(78);
  const [rotation, setRotation] = useState(0);
  const [qty, setQty] = useState('100');
  const [sides, setSides] = useState('One side');
  const [error, setError] = useState('');
  const [angle, setAngle] = useState(0);
  const [position, setPosition] = useState({x: 0, y: 0});
  const [dragging, setDragging] = useState(false);
  const [revision, setRevision] = useState(0);
  const model = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const drag = useRef({x: 0, y: 0, px: 0, py: 0, size: 1});
  const activePointer = useRef<number | null>(null);
  const uploadId = useRef(0);

  const activeArtwork = artwork ? (removeBackground && artwork.isolated ? artwork.isolated : artwork.original) : '';

  function place(x: number, y: number) {
    // The mask, not the artwork position, protects the physical puck. Keep a
    // useful drag range at every scale so Full Face remains movable at 100%.
    const limit = 35;
    setPosition({x: Math.max(-limit, Math.min(limit, x)), y: Math.max(-limit, Math.min(limit, y))});
  }

  function chooseMode(mode: FitMode) {
    setFitMode(mode);
    const nextScale = mode === 'fill' ? 100 : 78;
    setScale(nextScale);
    setPosition({x: 0, y: 0});
  }

  function autoFit() {
    const mode = artwork?.autoMode || 'fit';
    setFitMode(mode);
    setRemoveBackground(Boolean(artwork?.isolated));
    setScale(mode === 'fill' ? 100 : 78);
    setRotation(0);
    setPosition({x: 0, y: 0});
  }

  function upload(file?: File) {
    if (!file) return;
    const id = ++uploadId.current;
    setError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Choose a PNG, JPG or WebP image under 5 MB for the preview.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError('That file could not be opened. Please choose another image.');
    reader.onload = () => {
      const source = String(reader.result);
      const image = new window.Image();
      image.onerror = () => {
        if (id === uploadId.current) setError('That image could not be read. Try a different PNG, JPG or WebP.');
      };
      image.onload = () => {
        if (id !== uploadId.current) return;
        try {
          const nextArtwork = analyseArtwork(image, source, file.name);
          setArtwork(nextArtwork);
          setRemoveBackground(Boolean(nextArtwork.isolated));
          setFitMode(nextArtwork.autoMode);
          setScale(nextArtwork.autoMode === 'fill' ? 100 : 78);
          setRotation(0);
          setPosition({x: 0, y: 0});
          setRevision(value => value + 1);
        } catch {
          setError('That artwork could not be prepared. Try a different image.');
        }
      };
      image.src = source;
    };
    reader.readAsDataURL(file);
  }

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointer.current = event.pointerId;
    setDragging(true);
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      px: position.x,
      py: position.y,
      size: face.current?.offsetWidth || model.current?.offsetWidth || 1,
    };
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (activePointer.current !== event.pointerId) return;
    event.preventDefault();
    const start = drag.current;
    const radians = (angle + FACE_ROTATION) * Math.PI / 180;
    const screenX = event.clientX - start.x;
    const screenY = event.clientY - start.y;
    const localX = screenX * Math.cos(radians) + screenY * Math.sin(radians);
    const localY = (-screenX * Math.sin(radians) + screenY * Math.cos(radians)) / FACE_SQUASH;
    place(start.px + localX / start.size * 100, start.py + localY / start.size * 100);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    setDragging(false);
  }

  function removeArtwork() {
    uploadId.current += 1;
    setArtwork(null);
    setFitMode('fit');
    setScale(78);
    setRotation(0);
    setPosition({x: 0, y: 0});
    setRevision(value => value + 1);
  }

  const request = '/contact?' + new URLSearchParams({
    type: 'Custom pucks',
    quantity: qty,
    details: `Team / design: ${name}\nPrint request: ${sides}\nArtwork layout: ${fitMode === 'fill' ? 'Full circular face / edge-to-edge' : 'Logo fitted inside circular face'}\nArtwork scale: ${scale}%\nArtwork rotation: ${rotation} degrees\nArtwork position: ${position.x.toFixed(1)}% horizontal, ${position.y.toFixed(1)}% vertical${artwork ? `\nPreview file: ${artwork.filename}\nArtwork detection: ${artwork.detection}` : ''}\nI will attach production artwork (AI, CDR or EPS) to my email.`,
  }).toString();

  const printStyle = {
    '--art-x': `${position.x}%`,
    '--art-y': `${position.y}%`,
    '--art-scale': scale / 100,
    '--art-rotation': `${rotation}deg`,
  } as CSSProperties;

  const modelStyle = {
    '--view-angle': `${angle}deg`,
    '--face-x': `${FACE_X}%`,
    '--face-y': `${FACE_Y}%`,
    '--face-size': `${FACE_SIZE}%`,
    '--face-rotation': `${FACE_ROTATION}deg`,
    '--face-squash': FACE_SQUASH,
  } as CSSProperties;

  return <section className="custom-studio print-lab" id="studio">
    <div className="studio-preview">
      <div className="studio-top"><span className="eyebrow">APEX / PRINT LAB</span><span>TRUE TOP-FACE MASK</span></div>
      <div className={`studio-viewport ${dragging ? 'is-dragging' : ''}`}>
        <span className="studio-reticle" aria-hidden="true"/>
        <div className="studio-model" ref={model} style={modelStyle}>
          <img className="blank-puck" src="/assets/hero-puck.webp" alt="Apex rubber puck with your custom design preview" width="1000" height="1000" draggable="false"/>
          <div
            className={`print-face ${fitMode === 'fill' ? 'fill-face' : 'fit-logo'}`}
            ref={face}
            style={printStyle}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            role="group"
            tabIndex={0}
            aria-label="Circular puck print area. Drag the artwork or use arrow keys to position it. Hold Shift with an arrow key for a larger move."
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault();
              const step = event.shiftKey ? 2 : 0.5;
              place(position.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), position.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0));
            }}
          >
            <div className="artwork-transform" key={revision}>
              {activeArtwork
                ? <img src={activeArtwork} alt="Your uploaded artwork on the circular puck face" draggable="false"/>
                : <span>{name || 'YOUR TEAM'}</span>}
            </div>
            <span className="print-texture" aria-hidden="true"/>
            <span className="print-curvature" aria-hidden="true"/>
          </div>
          <span className="face-guide" aria-hidden="true"><i/><b>FULL PRINT FACE</b></span>
        </div>
        <span className="studio-surface-label">BLACK RUBBER / CIRCULAR PRINT FACE</span>
      </div>
      <div className="preview-toolbar">
        <span><Move size={15}/> Drag directly on the puck</span>
        <div>
          <button onClick={() => setPosition({x: 0, y: 0})}><Crosshair size={16}/> Center</button>
          <button onClick={autoFit}><ScanLine size={16}/> Auto-fit</button>
        </div>
      </div>
      <div className="studio-angle">
        <label id="studio-angle-label">Puck angle</label>
        <Slider aria-labelledby="studio-angle-label" value={[angle]} min={-25} max={25} step={1} onValueChange={value => setAngle(value[0])}/>
        <button aria-label="Reset puck angle" onClick={() => setAngle(0)}><RotateCcw size={16}/></button>
      </div>
      <div className="preview-caption">
        <span className="studio-feedback" role="status">{artwork ? <><Check size={15}/> {artwork.detection} / TOP-FACE CLIP ACTIVE</> : 'UPLOAD ARTWORK — ONLY THE EXACT TOP FACE CAN PRINT.'}</span>
        <p>Scale and move artwork beyond the puck freely. The calibrated top-face mask keeps everything outside the printable surface hidden.</p>
      </div>
    </div>

    <div className="studio-controls">
      <p className="eyebrow">01 / YOUR IDENTITY</p>
      <h2>OWN THE<br/>SURFACE.</h2>
      <div className="field"><label htmlFor="team-name">Team or design name</label><input id="team-name" maxLength={26} value={name} onChange={event => setName(event.target.value)}/></div>
      <label className={`upload-field ${artwork ? 'has-art' : ''}`}>
        <Upload size={24}/>
        <strong>{artwork?.filename || 'Drop your logo into the game.'}</strong>
        <span>PNG, JPG or WebP · automatic detection · up to 5 MB</span>
        <input aria-label="Upload your team logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {upload(event.target.files?.[0]); event.target.value = '';}}/>
      </label>
      {artwork && <div className="artwork-status">
        <ImageIcon size={18}/><div><strong>{artwork.detection}</strong><span>{artwork.width} × {artwork.height}px preview analysed</span></div>
      </div>}
      {artwork?.isolated && <button className={`background-toggle ${removeBackground ? 'active' : ''}`} onClick={() => setRemoveBackground(value => !value)} aria-pressed={removeBackground}>
        <span>{removeBackground ? 'Background removed' : 'Original background'}</span><b>{removeBackground ? 'ON' : 'OFF'}</b>
      </button>}
      {artwork && <button className="plain-link" onClick={removeArtwork}>Remove preview image</button>}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="field artwork-layout">
        <label id="artwork-layout-label">Artwork layout <span>{fitMode === 'fill' ? 'EDGE TO EDGE' : 'LOGO FIT'}</span></label>
        <div className="fit-switch" role="radiogroup" aria-labelledby="artwork-layout-label">
          <button role="radio" aria-checked={fitMode === 'fit'} className={fitMode === 'fit' ? 'active' : ''} onClick={() => chooseMode('fit')}><strong>FIT LOGO</strong><span>Keep the full mark visible</span></button>
          <button role="radio" aria-checked={fitMode === 'fill'} className={fitMode === 'fill' ? 'active' : ''} onClick={() => chooseMode('fill')}><strong>FULL FACE</strong><span>Extend beyond the top-face crop</span></button>
        </div>
      </div>

      <div className="studio-adjustments">
        <div className="field studio-scale">
          <label id="scale-label">Artwork size <span>{scale}%</span></label>
          <Slider aria-labelledby="scale-label" value={[scale]} onValueChange={value => setScale(value[0])} min={fitMode === 'fill' ? 100 : 40} max={180} step={1}/>
        </div>
        <div className="field studio-scale">
          <label id="rotation-label">Artwork rotation <span>{rotation}°</span></label>
          <Slider aria-labelledby="rotation-label" value={[rotation]} onValueChange={value => setRotation(value[0])} min={-180} max={180} step={1}/>
        </div>
      </div>

      <div className="placement-readout"><span>POSITION</span><b>X {position.x.toFixed(1)} / Y {position.y.toFixed(1)}</b><button onClick={autoFit}>RESET ALL</button></div>

      <div className="studio-order-fields">
        <p className="eyebrow">02 / YOUR NEXT ORDER</p>
        <div className="form-two">
          <div className="field"><label htmlFor="custom-quantity">Pucks needed</label><input id="custom-quantity" type="number" min="1" max="1000000" value={qty} onChange={event => setQty(event.target.value)} onBlur={() => setQty(String(Math.max(1, Math.min(1000000, Number(qty) || 1))))}/></div>
          <SelectField id="print-sides" label="Print request" value={sides} onChange={setSides} options={['One side', 'Both sides', 'Help me decide'].map(value => ({value, label: value}))}/>
        </div>
      </div>
      <Link className="btn full" href={request}>Build my quote request <ArrowUpRight size={18}/></Link>
      <p className="fine-print">Apex confirms pricing, minimums and delivery dates. Production requires AI, CDR or EPS artwork, attached to your email.</p>
    </div>
  </section>;
}
