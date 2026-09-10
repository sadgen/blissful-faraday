// 人像识别服务：YOLOv8n（COCO，12.8MB ONNX）+ ffmpeg 像素预处理
// - 图片：整图 letterbox 到 640×640，单次检测
// - 视频：ffmpeg 按 10%~90% 均匀抽 5 帧，任一帧检出 person 即判人像
// - 输出格式：[1, 84, 8400]（4 box cx,cy,w,h + 80 类分数，均为 640 输入像素尺度）
// - 结果写入账号目录 .media-meta.json：media: { 文件名: { p: 0|1, s: 分数, ts } }
//   无记录 = 未识别；模型/运行时不可用时功能静默停用（只打日志，不影响画廊）
// - 三态语义：p=1 人像 / p=0 非人像 / 无记录 未识别

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = path.join(__dirname, 'models');
const MODEL_PATH = path.join(MODEL_DIR, 'yolov8n.onnx');
export const THUMBNAILS_DIR = path.join(__dirname, '..', '.thumbnails');
const FFMPEG = 'ffmpeg';
const FFPROBE = 'ffprobe';

const CONF_THRESHOLD = 0.3;  // person 类置信度阈值（ultralytics 默认 0.25）
const NMS_IOU = 0.45;
const VIDEO_FRAMES = 5;      // 视频均匀抽帧数
const QUEUE_CONCURRENCY = 2; // 识别并发（不影响画廊服务响应）
const MEDIA_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.mp4', '.webm']);
const VIDEO_EXTS = new Set(['.mp4', '.webm']);

let ort = null;
let session = null;
let inputW = 640, inputH = 640;
let ready = false;
let initPromise = null;
let rootDir = null;

const metaCache = new Map(); // dir -> { mtimeMs, media }
const pendingKeys = new Set();
const pendingJobs = new Map(); // key -> job
let queue = [];
let active = 0;
const stats = { queued: 0, done: 0, failed: 0, skipped: 0, person: 0, noperson: 0 };

// ─── 初始化 ───────────────────────────────────────────────────────────────

export async function init() {
  if (ready) return true;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      if (!fs.existsSync(MODEL_PATH)) throw new Error(`模型文件缺失: ${MODEL_PATH}`);
      ort = (await import('onnxruntime-node')).default ?? (await import('onnxruntime-node'));
      // 显式线程数：LXC 里 onnxruntime 按宿主机核数设亲和性会失败（Invalid argument）
      session = await ort.InferenceSession.create(MODEL_PATH, {
        graphOptimizationLevel: 'all',
        intraOpNumThreads: 4,
        interOpNumThreads: 1,
        executionMode: 'sequential',
      });
      const dims = (session.inputMetadata && session.inputMetadata[0] && session.inputMetadata[0].dimensions) || [];
      inputH = Number.isFinite(dims[2]) && dims[2] > 0 ? dims[2] : 640;
      inputW = Number.isFinite(dims[3]) && dims[3] > 0 ? dims[3] : 640;
      ready = true;
      console.log(`[Person] 人像识别就绪（YOLOv8n 输入 ${inputW}x${inputH}，4 推理线程）`);
    } catch (err) {
      console.warn('[Person] 人像识别不可用（不影响画廊其它功能）:', err.message);
      ready = false;
      initPromise = null; // 允许下次重试
    }
    return ready;
  })();
  return initPromise;
}

// ─── ffmpeg 像素提取（letterbox：等比缩放 + 114 灰边，与训练预处理一致）────

function ffmpegFrameRaw(src, seekSec) {
  return new Promise((resolve) => {
    const need = inputW * inputH * 3;
    const args = ['-hide_banner', '-loglevel', 'error'];
    if (seekSec > 0) args.push('-ss', String(seekSec));
    args.push('-i', src, '-frames:v', '1',
      '-vf', `scale=${inputW}:${inputH}:force_original_aspect_ratio=decrease,pad=${inputW}:${inputH}:(ow-iw)/2:(oh-ih)/2:color=0x727272`,
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1');
    const proc = spawn(FFMPEG, args);
    const chunks = [];
    let size = 0;
    let errTxt = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve(null); }, 30000);
    proc.stdout.on('data', (c) => {
      chunks.push(c);
      size += c.length;
      if (size >= need) { proc.kill(); } // 只要一帧够量的像素
    });
    proc.stderr.on('data', (c) => { if (errTxt.length < 400) errTxt += c.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); console.warn('[Person] ffmpeg 启动失败:', e.message); resolve(null); });
    proc.on('close', () => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      if (buf.length >= need) resolve(buf.subarray(0, need));
      else {
        console.warn('[Person] 帧数据不足:', path.basename(src), buf.length, '/', need, errTxt ? errTxt.trim() : '(无stderr)');
        resolve(null);
      }
    });
  });
}

function probeDuration(src) {
  return new Promise((resolve) => {
    const proc = spawn(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]);
    let out = '';
    const timer = setTimeout(() => { proc.kill(); resolve(0); }, 15000);
    proc.stdout.on('data', (c) => { out += c.toString(); });
    proc.on('error', () => { clearTimeout(timer); resolve(0); });
    proc.on('close', () => { clearTimeout(timer); resolve(parseFloat(out) || 0); });
  });
}

// ─── YOLOv8 推理与解码 ────────────────────────────────────────────────────

// RGB HWC rawvideo (rgb24) 像素 → NCHW float32 (0~1) → 检出的 person 框与最高分
function detectPersons(px) {
  if (!ready || !session) return Promise.resolve(null);
  const plane = inputW * inputH;
  const data = new Float32Array(plane * 3);
  // ffmpeg rawvideo rgb24 是 HWC 交叉排列 (R,G,B,R,G,B...)，转 NCHW (全R, 全G, 全B)
  for (let i = 0; i < plane; i++) {
    const idx = i * 3;
    data[i] = px[idx] / 255;
    data[plane + i] = px[idx + 1] / 255;
    data[plane * 2 + i] = px[idx + 2] / 255;
  }
  const tensor = new ort.Tensor('float32', data, [1, 3, inputH, inputW]);
  const feed = {};
  feed[session.inputNames[0]] = tensor;
  return session.run(feed).then((out) => {
    const output = out[session.outputNames[0]];
    if (!output) { console.warn('[Person] 模型无输出:', session.outputNames); return null; }
    // [1, 84, N]：行 0-3 为 cx,cy,w,h；行 4 为 person（COCO 类 0）
    const d = output.data;
    const dims = output.dims; // [1, 84, N]
    const n = dims[2];        // 8400
    let maxScore = 0;
    const chOff = 4 * n;      // 第 4 行（person 类别）的起始偏移
    for (let i = 0; i < n; i++) {
      const score = d[chOff + i];
      if (score > maxScore) maxScore = score;
    }
    return { maxScore: Math.round(maxScore * 100) / 100 };
  }).catch((err) => {
    console.warn('[Person] 推理失败(一次):', err.message);
    return null;
  });
}

function iou(a, b) { return 0; }

async function classifyImage(abs) {
  const px = await ffmpegFrameRaw(abs, 0);
  if (!px) return null;
  const det = await detectPersons(px);
  if (!det) return null;
  const s = det.maxScore || 0;
  return { p: s >= CONF_THRESHOLD ? 1 : 0, s: Math.round(s * 100) / 100, ts: Date.now() };
}

async function classifyVideo(abs) {
  const dur = await probeDuration(abs);
  let best = 0;
  // 读到有效时长：按 10%~90% 均匀采样；
  // 无时长（浏览器 MediaRecorder 录制的流式 webm 没有 duration 头部）：按固定秒数间隔采样
  const timePoints = (dur && isFinite(dur) && dur > 0)
    ? Array.from({ length: VIDEO_FRAMES }, (_, i) => Math.max(0, dur * ((i + 0.5) / VIDEO_FRAMES) - 0.1))
    : [0, 0.8, 1.6, 2.4, 3.2];

  for (const t of timePoints) {
    const px = await ffmpegFrameRaw(abs, t);
    if (!px) continue;
    const det = await detectPersons(px);
    if (!det) continue;
    if (det.maxScore && det.maxScore > best) best = det.maxScore;
    if (best >= CONF_THRESHOLD) break; // 已确认人像，提前收工
  }
  return { p: best >= CONF_THRESHOLD ? 1 : 0, s: Math.round(best * 100) / 100, ts: Date.now() };
}

// ─── meta 存储（逐账号 .media-meta.json）─────────────────────────────────

const metaPathOf = (dir) => path.join(dir, '.media-meta.json');

function loadMeta(dir) {
  try {
    const st = fs.statSync(metaPathOf(dir));
    const c = metaCache.get(dir);
    if (c && c.mtimeMs === st.mtimeMs) return c.media;
    const d = JSON.parse(fs.readFileSync(metaPathOf(dir), 'utf8'));
    const media = d && d.media && typeof d.media === 'object' ? d.media : {};
    metaCache.set(dir, { mtimeMs: st.mtimeMs, media });
    return media;
  } catch {
    const c = metaCache.get(dir);
    return c ? c.media : {};
  }
}

function saveMetaRecord(dir, file, rec) {
  let media = {};
  try {
    const d = JSON.parse(fs.readFileSync(metaPathOf(dir), 'utf8'));
    if (d && d.media && typeof d.media === 'object') media = d.media;
  } catch {}
  media[file] = rec;
  try {
    const tmp = `${metaPathOf(dir)}.${process.pid}x${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, updatedAt: Date.now(), media }));
    fs.renameSync(tmp, metaPathOf(dir));
  } catch (err) {
    console.warn('[Person] meta 写入失败:', err.message);
    return;
  }
  try {
    const st = fs.statSync(metaPathOf(dir));
    metaCache.set(dir, { mtimeMs: st.mtimeMs, media });
  } catch {}
}

// ─── 视频缩略图（集中存放于项目根目录 .thumbnails/，绝对不写入相册目录）──────

export function getThumbnailPath(collection, name) {
  const hash = crypto.createHash('sha1').update(`${collection}/${name}`).digest('hex');
  return path.join(THUMBNAILS_DIR, `${hash}.jpg`);
}

export function generateVideoThumbnail(videoAbs, collection, name) {
  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(THUMBNAILS_DIR)) fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
      const target = getThumbnailPath(collection, name);
      if (fs.existsSync(target) && fs.statSync(target).size > 400) {
        return resolve(target);
      }
      const tmp = `${target}.${process.pid}x${Math.random().toString(36).slice(2, 6)}.tmp`;
      const isWebm = videoAbs.endsWith('.webm');
      const args = ['-hide_banner', '-loglevel', 'error'];
      if (!isWebm) args.push('-ss', '0.1');
      args.push('-i', videoAbs, '-frames:v', '1', '-vf', 'scale=360:-1', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '4', tmp);

      const proc = spawn(FFMPEG, args);
      const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve(null); }, 15000);
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 400) {
          try { fs.renameSync(tmp, target); resolve(target); }
          catch { resolve(null); }
        } else {
          try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
          resolve(null);
        }
      });
      proc.on('error', () => { clearTimeout(timer); resolve(null); });
    } catch {
      resolve(null);
    }
  });
}

// ─── 识别队列 ─────────────────────────────────────────────────────────────

async function runJob(job) {
  try {
    await init();
    if (!ready) return;
    const abs = path.join(job.dir, job.file);
    if (!fs.existsSync(abs)) return;
    const isVid = job.type === 'video';
    // 若为视频，在做人像检测的同时顺手生成首帧缩略图
    if (isVid) {
      generateVideoThumbnail(abs, path.basename(job.dir), job.file).catch(() => {});
    }
    const rec = isVid ? await classifyVideo(abs) : await classifyImage(abs);
    if (rec) {
      saveMetaRecord(job.dir, job.file, rec);
      if (rec.p === 1) stats.person++; else stats.noperson++;
    }
  } catch (err) {
    stats.failed++;
    console.warn('[Person] 识别失败:', job.file, err.message);
  }
}

function processQueue() {
  while (active < QUEUE_CONCURRENCY && queue.length) {
    const key = queue.shift();
    const job = pendingJobs.get(key) || null;
    pendingKeys.delete(key);
    pendingJobs.delete(key);
    if (!job) continue;
    active++;
    runJob(job).catch(() => {}).finally(() => {
      active--;
      stats.done++;
      if (stats.done % 200 === 0) logProgress();
      processQueue();
    });
  }
}

function logProgress() {
  console.log(`[Person] 队列 进度: 完成 ${stats.done} · 人像 ${stats.person} · 非人像 ${stats.noperson} · 失败 ${stats.failed} · 排队 ${queue.length}`);
}

// 入队识别（已有结果的不重复识别；type: 'image' | 'video'）
export function enqueue(dir, file, type) {
  if (!file || typeof file !== 'string' || file.startsWith('.')) return;
  const key = `${dir}\u0000${file}`;
  if (pendingKeys.has(key)) return;
  if (loadMeta(dir)[file]) { stats.skipped++; return; }
  pendingKeys.add(key);
  pendingJobs.set(key, { dir, file, type });
  queue.push(key);
  stats.queued++;
  processQueue();
}

// 存量补齐：扫描账号目录下所有未识别的媒体文件入队
export async function backfill(dir) {
  await init();
  if (!ready) return { ok: false, reason: 'not-ready' };
  let enqueued = 0, total = 0;
  let accounts;
  try {
    accounts = fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'));
  } catch { return { ok: false, reason: 'root-missing' }; }
  for (const acc of accounts) {
    const abs = path.join(dir, acc.name);
    let files;
    try { files = fs.readdirSync(abs); } catch { continue; }
    for (const f of files) {
      if (f.startsWith('.')) continue;
      if (!MEDIA_EXTS.has(path.extname(f).toLowerCase())) continue;
      total++;
      if (loadMeta(abs)[f]) continue;
      enqueue(abs, f, VIDEO_EXTS.has(path.extname(f).toLowerCase()) ? 'video' : 'image');
      enqueued++;
    }
  }
  console.log(`[Person] 存量补齐开始：共 ${total} 个媒体文件，入队 ${enqueued} 个未识别`);
  logProgress();
  return { ok: true, total, enqueued };
}

// 启动入口：init + 延迟触发存量补齐（等服务稳定后开始，不抢启动资源）
export function start(root) {
  rootDir = root;
  setTimeout(() => {
    init().then((ok) => {
      if (ok && rootDir) backfill(rootDir);
    });
  }, 10000);
}

export function loadMetaFor(dir) {
  return loadMeta(dir);
}

// 人工纠偏：翻转单个文件的人像判定状态（p=1 ↔ p=0）
export function togglePerson(dir, file) {
  if (!file || typeof file !== 'string' || file.startsWith('.')) return null;
  const current = loadMeta(dir);
  const existing = current[file];
  const oldP = existing ? existing.p : null;
  const newP = oldP === 1 ? 0 : 1;
  const rec = {
    p: newP,
    s: newP === 1 ? (existing?.s && existing.s >= CONF_THRESHOLD ? existing.s : 1.0) : 0,
    manual: true,
    ts: Date.now(),
  };
  saveMetaRecord(dir, file, rec);
  return { file, ...rec, oldP };
}

// 供独立测试脚本使用
export { classifyImage, classifyVideo };

export function getStats() {
  return { ready, ...stats, pending: queue.length + active };
}
