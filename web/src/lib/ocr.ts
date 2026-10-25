/**
 * Client-side OCR and broadcast score bug parser for delay calibration.
 * Works completely offline/LAN-only using local Tesseract WASM assets.
 */

export interface ParsedScoreBug {
  period?: number | undefined;
  clock?: string | undefined;
  rawText: string;
}

/**
 * Normalizes text and strips common accents for consistent matching.
 */
function clean(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // é -> e, è -> e
    .toLowerCase();
}

/**
 * Extracts the game period and clock from OCR text of sports broadcasts
 * (Sportsnet, TSN, RDS, TVA Sports, Amazon Prime, CBC, ESPN, TNT).
 */
export function parseScoreBug(rawText: string): ParsedScoreBug {
  const normalized = clean(rawText);
  let clock: string | undefined;
  let period: number | undefined;

  // 1. Clock matching: find "MM:SS" or "M:SS" or "M:SS.S"
  // Avoid false positives like ratios "5:4" or times with seconds >= 60
  const clockMatches = [...normalized.matchAll(/\b(\d{1,2}):(\d{2})(?:\.(\d))?\b/g)];
  for (const m of clockMatches) {
    const mins = Number(m[1]);
    const secs = Number(m[2]);
    const tenths = m[3];
    if (secs < 60 && mins <= 120) {
      clock = tenths !== undefined ? `${mins}:${m[2]}.${tenths}` : `${mins}:${m[2]}`;
      break;
    }
  }

  // Fallback: if colon was recognized as dot in a 20-min period clock (e.g. "9.41")
  if (!clock) {
    const dotMatches = [...normalized.matchAll(/\b([0-1]?\d)\.(\d{2})\b/g)];
    for (const m of dotMatches) {
      const mins = Number(m[1]);
      const secs = Number(m[2]);
      if (secs < 60 && mins <= 20) {
        clock = `${mins}:${m[2]}`;
        break;
      }
    }
  }

  // 2. Period matching:
  // Explicit periods 1st, 2nd, 3rd take precedence over ambiguous 2-letter codes like "ot"
  if (/\b(1st|1re|1ere|1er|p1|per\s*1|period\s*1)\b/.test(normalized)) {
    period = 1;
  } else if (/\b(2nd|2e|2eme|2ere|p2|per\s*2|period\s*2)\b/.test(normalized)) {
    period = 2;
  } else if (/\b(3rd|3e|3eme|3ere|p3|per\s*3|period\s*3)\b/.test(normalized)) {
    period = 3;
  } else if (/\b(overtime|prol|prolongation|ot1|ot2)\b/.test(normalized) || /\b(OT|PR)\b/.test(rawText)) {
    period = 4;
  } else {
    const standalone = /\b(?:period|per|p)?\s*([1-3])\s*(?:st|nd|rd|e|er|eme)?\b/.exec(normalized);
    if (standalone?.[1]) {
      period = Number(standalone[1]);
    }
  }

  return { period, clock, rawText };
}

/**
 * Preprocesses an image on an offscreen canvas to optimize OCR contrast and performance.
 * Downscales large camera photos to max 1600px width/height and applies contrast stretch.
 */
export async function preprocessImage(file: File | Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const maxDim = 1600;
  let { width, height } = bmp;

  if (width > maxDim || height > maxDim) {
    if (width > height) {
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    } else {
      width = Math.round((width * maxDim) / height);
      height = maxDim;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not initialize 2D canvas context");

  ctx.drawImage(bmp, 0, 0, width, height);

  // High contrast grayscale filter to help text detection against ice/rink
  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] ?? 0;
    const g = d[i + 1] ?? 0;
    const b = d[i + 2] ?? 0;
    // Luminance
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // S-curve contrast boost
    const contrast = lum > 140 ? Math.min(255, lum * 1.2) : Math.max(0, lum * 0.8);
    d[i] = contrast;
    d[i + 1] = contrast;
    d[i + 2] = contrast;
  }
  ctx.putImageData(imgData, 0, 0);

  return canvas;
}

export interface ScanResult {
  period?: number | undefined;
  clock?: string | undefined;
  rawText: string;
  elapsedMs: number;
}

/**
 * Runs client-side OCR on a captured TV screen image using local WASM worker.
 * Measures execution time from the shutter snapshot anchor to eliminate processing delay.
 */
export async function scanTvClock(
  file: File,
  snapAnchor: number,
  onProgress?: (progress: number) => void,
): Promise<ScanResult> {
  const { createWorker, PSM } = await import("tesseract.js");

  const worker = await createWorker("eng", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/",
    langPath: "/ocr/",
    gzip: true,
    logger: (m: { status: string; progress?: number }) => {
      if (m.progress !== undefined && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  try {
    // PSM.SPARSE_TEXT ('11') is optimal for TV score bugs floating on a broadcast screen
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      tessedit_char_whitelist: "0123456789:.-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    });

    // Pass 1: Recognize raw photo directly with sparse text mode
    let res = await worker.recognize(file);
    let parsed = parseScoreBug(res.data.text);

    // Pass 2: If clock was missed, try contrast-enhanced canvas
    if (!parsed.clock) {
      const canvas = await preprocessImage(file);
      res = await worker.recognize(canvas);
      parsed = parseScoreBug(res.data.text);
    }

    // Pass 3: If still missed, try single-block mode on canvas
    if (!parsed.clock) {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      const canvas = await preprocessImage(file);
      res = await worker.recognize(canvas);
      parsed = parseScoreBug(res.data.text);
    }

    const elapsedMs = Math.round(performance.now() - snapAnchor);

    return {
      period: parsed.period,
      clock: parsed.clock,
      rawText: res.data.text,
      elapsedMs,
    };
  } finally {
    await worker.terminate();
  }
}
