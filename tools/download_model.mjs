// 把网页版需要的模型文件下载到 web/models/ 下，由网站自己提供，
// 这样用户访问时不依赖 huggingface.co（国内经常打不开）。
// 用法（需要 Node.js 18+）：
//   node tools/download_model.mjs
// 国内网络可设置镜像：HF_ENDPOINT=https://hf-mirror.com node tools/download_model.mjs
//   （PowerShell：$env:HF_ENDPOINT="https://hf-mirror.com"; node tools/download_model.mjs）
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const FILES = ['config.json', 'preprocessor_config.json', 'onnx/vision_model_quantized.onnx'];
const host = (process.env.HF_ENDPOINT || 'https://huggingface.co').replace(/\/$/, '');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'models', MODEL_ID);

for (const f of FILES) {
  const dest = join(outDir, f);
  if (existsSync(dest) && statSync(dest).size > 0) { console.log('已存在，跳过', f); continue; }
  const url = `${host}/${MODEL_ID}/resolve/main/${f}`;
  console.log('下载', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`  完成 ${(statSync(dest).size / 1e6).toFixed(1)}MB`);
}
console.log('模型已保存到', outDir);
