/**
 * server/lib/label-ocr.js
 *
 * A phone photo of a nutrition table, in: parsed numbers out.
 *
 * Two things make this reliable, and both are measured rather than assumed:
 *   1. Normalise the image first. Tesseract on a raw phone photo turned "g"
 *      into "9" and read 20 g protein as 209 (2026-11-18). Grayscale, 2x,
 *      unsharp and a deskew make the same photo read "Protein 20 g" exactly.
 *      ImageMagick 6 ships `convert`, 7 ships `magick`; use whichever exists.
 *   2. Ask twice. psm 6 assumes one uniform block; a crumpled pack often
 *      needs psm 4 (variable sizes). The read with more rows wins.
 *
 * The units-and-limits guard lives in matsiktet.js next to the parser, so a
 * damaged read fails loudly instead of storing a ten-fold error.
 */
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { parseLabelText } from './matsiktet.js';

/** Run a binary, resolve stdout; reject with a status-tagged error. */
export function run(cmd, args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      return reject(Object.assign(new Error(`${cmd} is not installed on this server`), { status: 503 }));
    }
    const out = [];
    let err = '';
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', (e) => {
      const missing = e?.code === 'ENOENT';
      reject(Object.assign(
        new Error(missing ? `${cmd} is not installed on this server` : `${cmd} failed`),
        { status: missing ? 503 : 500 },
      ));
    });
    child.on('close', (code) => {
      if (code === 0) return resolve(Buffer.concat(out).toString('utf8'));
      reject(Object.assign(new Error(`${cmd} failed (${String(err).slice(0, 120)})`), { status: 500 }));
    });
  });
}

const NORMALISE = ['-colorspace', 'Gray', '-resize', '200%', '-unsharp', '0x1', '-deskew', '40%'];

/** The photo as an OCR-friendly PNG, plus the temp dir to remove afterwards. */
export async function preprocessPhoto(buffer) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-ocr-'));
  const src = path.join(dir, 'in');
  const out = path.join(dir, 'out.png');
  await fs.writeFile(src, buffer);
  for (const cmd of ['magick', 'convert']) {
    try {
      await run(cmd, [src, ...NORMALISE, out]);
      return { dir, file: out, preprocessed: true, tool: cmd };
    } catch (err) {
      if (err?.status === 503) continue;
      break;
    }
  }
  // No usable ImageMagick: read the raw file rather than fail the scan.
  return { dir, file: src, preprocessed: false, tool: null };
}

export function ocrFile(file, psm = '6') {
  return run('tesseract', [file, 'stdout', '-l', 'swe', '--psm', psm]);
}

/** The whole pipeline: buffer in, { found, text, name, nutrition }. */
export async function readLabel(buffer) {
  const work = await preprocessPhoto(buffer);
  try {
    let text = await ocrFile(work.file, '6');
    let parsed = parseLabelText(text);
    if (Object.keys(parsed.nutrition).length === 0) {
      const second = await ocrFile(work.file, '4');
      const parsed2 = parseLabelText(second);
      if (Object.keys(parsed2.nutrition).length > Object.keys(parsed.nutrition).length) {
        text = second;
        parsed = parsed2;
      }
    }
    return {
      found: Object.keys(parsed.nutrition).length > 0,
      text,
      name: parsed.name,
      nutrition: parsed.nutrition,
      preprocessed: work.preprocessed,
      tool: work.tool,
    };
  } finally {
    fs.rm(work.dir, { recursive: true, force: true }).catch(() => {});
  }
}
