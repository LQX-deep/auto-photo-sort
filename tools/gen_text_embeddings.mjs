// 预先计算类别描述的文本向量，生成 web/text_embeddings.json。
// 这样网页端只需下载视觉模型（约 89MB），不用再下载文本模型。
// 用法（需要 Node.js 18+）：
//   npm i @huggingface/transformers@3.0.2
//   node tools/gen_text_embeddings.mjs
// 国内网络可先设置镜像：HF_ENDPOINT=https://hf-mirror.com node tools/gen_text_embeddings.mjs
import { AutoTokenizer, CLIPTextModelWithProjection, env } from '@huggingface/transformers';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
if (process.env.HF_ENDPOINT) env.remoteHost = process.env.HF_ENDPOINT.replace(/\/?$/, '/');

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const { categories } = JSON.parse(readFileSync(join(webDir, 'categories.json'), 'utf8'));

const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
const textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'q8' });

const prompts = [];
const categoryIndex = [];
categories.forEach((c, i) => c.prompts.forEach(p => { prompts.push(p); categoryIndex.push(i); }));

const inputs = tokenizer(prompts, { padding: true, truncation: true });
const { text_embeds } = await textModel(inputs);
const [n, dim] = text_embeds.dims;
const data = text_embeds.data;

const vectors = [];
for (let i = 0; i < n; i++) {
  const v = Array.from(data.slice(i * dim, (i + 1) * dim));
  const norm = Math.hypot(...v);
  vectors.push(v.map(x => +(x / norm).toFixed(5)));   // 归一化，保留 5 位小数减小文件体积
}

writeFileSync(join(webDir, 'text_embeddings.json'), JSON.stringify({
  model: MODEL_ID,
  categories: categories.map(c => c.name),
  prompts, categoryIndex, vectors,
}));
console.log(`已生成 ${n} 条文本向量（维度 ${dim}）→ web/text_embeddings.json`);
