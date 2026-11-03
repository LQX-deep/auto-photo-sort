// 网页界面逻辑：加载模型 → 选文件夹 → 识别预览 → 复制整理 / 撤销
import * as T from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
import exifr from 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.esm.mjs';
import { createClassifier } from './classifier.js';

const OUTPUT_DIR = '整理后';
const LOG_FILE = '整理记录.json';
const IMAGE_EXT = /\.(jpe?g|png|webp|bmp|gif)$/i;

// 支持 File System Access API（Chrome / Edge）时直接写入文件夹，否则退化为打包下载 zip
const canWriteFolder = 'showDirectoryPicker' in window;

const $ = id => document.getElementById(id);
let classify = null;
let categories = [];
let rootHandle = null;   // 用户选中的文件夹（直接写入模式）
let items = [];          // { file, url, category, confidence, date }

// ---------- 工具函数 ----------
function setStatus(el, text, kind = '') {
  el.textContent = text;
  el.className = 'status ' + kind;
}

async function getShotDate(file) {
  // 优先用照片 EXIF 里的拍摄时间，没有就用文件修改时间
  try {
    const exif = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate']);
    const d = exif?.DateTimeOriginal || exif?.CreateDate;
    if (d instanceof Date && !isNaN(d)) return d;
  } catch { /* 没有 EXIF 或解析失败 */ }
  return new Date(file.lastModified);
}

function targetDirParts(item) {
  const y = item.date.getFullYear();
  const m = String(item.date.getMonth() + 1).padStart(2, '0');
  return [`${y}年`, `${m}月`, item.category];
}

function splitName(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ''];
}

// ---------- ① 加载模型 ----------
$('loadBtn').onclick = async () => {
  $('loadBtn').disabled = true;
  const prog = $('loadProg');
  prog.hidden = false;
  setStatus($('loadStatus'), '正在下载模型…');
  try {
    const embeddings = await (await fetch('text_embeddings.json')).json();
    categories = embeddings.categories;
    classify = await createClassifier(T, embeddings, {
      source: $('mirror').value,
      onProgress: p => {
        if (p.status === 'progress' && p.file?.endsWith('.onnx')) {
          prog.value = p.progress;
          setStatus($('loadStatus'), `正在下载模型… ${p.progress.toFixed(0)}%`);
        }
      },
    });
    prog.hidden = true;
    setStatus($('loadStatus'), '✓ 模型已就绪', 'ok');
    $('pickBtn').disabled = false;
  } catch (e) {
    console.error(e);
    setStatus($('loadStatus'), '模型加载失败：' + e.message + '（可以换一个下载源再试）', 'err');
    $('loadBtn').disabled = false;
  }
};

$('modeHint').textContent = canWriteFolder
  ? '整理结果会直接写入该文件夹下的「整理后」目录'
  : '当前浏览器不支持直接写入文件夹，整理结果将打包成 zip 下载（推荐用 Chrome 或 Edge）';

// ---------- ② 选择文件夹并识别 ----------
$('pickBtn').onclick = async () => {
  if (!canWriteFolder) return $('fallbackInput').click();
  try {
    rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch { return; }      // 用户取消
  const files = [];
  for await (const entry of rootHandle.values()) {
    // 只看第一层的图片文件，不进入子文件夹（包括「整理后」）
    if (entry.kind === 'file' && IMAGE_EXT.test(entry.name)) files.push(await entry.getFile());
  }
  await scan(files);
};

$('fallbackInput').onchange = async e => {
  // webkitdirectory 会带上子文件夹里的文件，这里只保留第一层
  const files = [...e.target.files].filter(f =>
    IMAGE_EXT.test(f.name) && (f.webkitRelativePath || f.name).split('/').length <= 2);
  await scan(files);
  e.target.value = '';
};

async function scan(files) {
  items.forEach(it => URL.revokeObjectURL(it.url));
  items = [];
  $('previewCard').hidden = true;
  $('undoBtn').hidden = true;
  setStatus($('applyStatus'), '');
  if (!files.length) return setStatus($('scanStatus'), '这个文件夹里没有找到图片。', 'warn');

  $('pickBtn').disabled = true;
  const prog = $('scanProg');
  prog.hidden = false;
  prog.max = files.length;
  const t0 = performance.now();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    setStatus($('scanStatus'), `正在识别 ${i + 1}/${files.length}：${file.name}`);
    const url = URL.createObjectURL(file);
    let result;
    try {
      result = await classify(url);
    } catch (e) {
      console.warn('识别失败', file.name, e);
      result = { category: '其他', confidence: 0 };
    }
    items.push({ file, url, category: result.category, confidence: result.confidence, date: await getShotDate(file) });
    prog.value = i + 1;
  }

  prog.hidden = true;
  $('pickBtn').disabled = false;
  const sec = ((performance.now() - t0) / 1000).toFixed(1);
  setStatus($('scanStatus'), `✓ 识别完成：${files.length} 张，用时 ${sec} 秒`, 'ok');
  renderPreview();
  if (rootHandle) $('undoBtn').hidden = !(await readLog()).length;
}

// ---------- ③ 预览 ----------
function renderPreview() {
  const tbody = $('tbody');
  tbody.innerHTML = '';
  for (const item of items) {
    const tr = document.createElement('tr');
    const opts = categories.map(c => `<option${c === item.category ? ' selected' : ''}>${c}</option>`).join('');
    tr.innerHTML = `
      <td><img loading="lazy" alt=""></td>
      <td></td>
      <td><select>${opts}</select></td>
      <td class="${item.confidence < 0.5 ? 'conf-low' : ''}">${(item.confidence * 100).toFixed(0)}%</td>
      <td class="path"></td>`;
    tr.querySelector('img').src = item.url;
    tr.children[1].textContent = item.file.name;        // 用 textContent 防止文件名里有 HTML
    const pathCell = tr.querySelector('.path');
    const updatePath = () => { pathCell.textContent = [OUTPUT_DIR, ...targetDirParts(item), item.file.name].join('/'); };
    updatePath();
    tr.querySelector('select').onchange = e => { item.category = e.target.value; updatePath(); renderSummary(); };
    tbody.appendChild(tr);
  }
  renderSummary();
  $('previewCard').hidden = false;
  $('applyBtn').disabled = false;
}

function renderSummary() {
  const count = {};
  items.forEach(it => { count[it.category] = (count[it.category] || 0) + 1; });
  $('summary').innerHTML = '';
  for (const c of categories) {
    if (!count[c]) continue;
    const s = document.createElement('span');
    s.className = 'chip';
    s.textContent = `${c} ${count[c]}`;
    $('summary').appendChild(s);
  }
}

// ---------- 整理：直接写入文件夹 ----------
async function getDir(parent, parts, create) {
  let dir = parent;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return dir;
}

async function exists(dir, name) {
  try { return await (await dir.getFileHandle(name)).getFile(); } catch { return null; }
}

async function readLog() {
  try {
    const out = await rootHandle.getDirectoryHandle(OUTPUT_DIR);
    const f = await (await out.getFileHandle(LOG_FILE)).getFile();
    return JSON.parse(await f.text());
  } catch { return []; }
}

async function writeLog(log) {
  const out = await rootHandle.getDirectoryHandle(OUTPUT_DIR, { create: true });
  const w = await (await out.getFileHandle(LOG_FILE, { create: true })).createWritable();
  await w.write(JSON.stringify(log, null, 2));
  await w.close();
}

async function applyToFolder() {
  // 再次确认写权限（有的浏览器刷新后会收回）
  if ((await rootHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
    throw new Error('没有获得文件夹写入权限');
  }
  const out = await rootHandle.getDirectoryHandle(OUTPUT_DIR, { create: true });
  const created = [];
  let skipped = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    setStatus($('applyStatus'), `正在复制 ${i + 1}/${items.length}…`);
    const parts = targetDirParts(item);
    const dir = await getDir(out, parts, true);

    // 同名同大小视为已经整理过，跳过；同名不同文件则加序号，绝不覆盖
    let name = item.file.name;
    const [base, ext] = splitName(name);
    let n = 1, old;
    while ((old = await exists(dir, name))) {
      if (old.size === item.file.size) { name = null; break; }
      name = `${base}(${n++})${ext}`;
    }
    if (!name) { skipped++; continue; }

    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(item.file);
    await w.close();
    created.push([...parts, name].join('/'));
  }

  if (created.length) {    // 一张都没复制时不写记录，免得撤销时撤了个空
    const log = await readLog();
    log.push({ time: new Date().toISOString(), files: created });
    await writeLog(log);
  }
  return { created: created.length, skipped };
}

// ---------- 整理：打包下载（不支持写入文件夹的浏览器） ----------
async function downloadZip() {
  const zip = new JSZip();
  const used = new Set();
  for (const item of items) {
    const dir = [OUTPUT_DIR, ...targetDirParts(item)].join('/');
    let name = item.file.name;
    const [base, ext] = splitName(name);
    for (let n = 1; used.has(`${dir}/${name}`); n++) name = `${base}(${n})${ext}`;
    used.add(`${dir}/${name}`);
    zip.file(`${dir}/${name}`, item.file);
  }
  setStatus($('applyStatus'), '正在打包…');
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${OUTPUT_DIR}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

$('applyBtn').onclick = async () => {
  $('applyBtn').disabled = true;
  try {
    if (rootHandle) {
      const { created, skipped } = await applyToFolder();
      setStatus($('applyStatus'),
        `✓ 整理完成：复制了 ${created} 张` + (skipped ? `，跳过 ${skipped} 张已整理过的` : '') +
        `。结果在所选文件夹的「${OUTPUT_DIR}」目录里，原图没有改动。`, 'ok');
      $('undoBtn').hidden = false;
    } else {
      await downloadZip();
      setStatus($('applyStatus'), `✓ 已生成 ${OUTPUT_DIR}.zip，请在浏览器下载列表里查看。`, 'ok');
    }
  } catch (e) {
    console.error(e);
    setStatus($('applyStatus'), '整理失败：' + e.message, 'err');
  }
  $('applyBtn').disabled = false;
};

// ---------- 撤销：只删除记录里本工具复制出来的文件 ----------
$('undoBtn').onclick = async () => {
  const log = await readLog();
  const last = log.pop();
  if (!last) return setStatus($('applyStatus'), '没有可撤销的记录。', 'warn');
  if (!confirm(`将删除上次（${new Date(last.time).toLocaleString()}）复制到「${OUTPUT_DIR}」里的 ${last.files.length} 个文件，原图不受影响。确定吗？`)) {
    return;
  }
  const out = await rootHandle.getDirectoryHandle(OUTPUT_DIR);
  let removed = 0;
  for (const path of last.files) {
    const parts = path.split('/');
    const name = parts.pop();
    try {
      const dir = await getDir(out, parts, false);
      await dir.removeEntry(name);
      removed++;
      // 顺手删掉空文件夹：从最深一层往上，非空时 removeEntry 会报错，直接停下
      for (let k = parts.length; k > 0; k--) {
        try { await (await getDir(out, parts.slice(0, k - 1), false)).removeEntry(parts[k - 1]); }
        catch { break; }
      }
    } catch { /* 文件已被用户手动删除或移动，忽略 */ }
  }
  await writeLog(log);
  $('undoBtn').hidden = !log.length;
  setStatus($('applyStatus'), `✓ 已撤销：删除了 ${removed} 个复制出来的文件。`, 'ok');
};
