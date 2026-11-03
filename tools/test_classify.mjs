// 用本机图片测试分类效果，调整 web/categories.json 里的描述后可以用它验证。
// 用法：
//   npm i @huggingface/transformers@3.0.2
//   node tools/test_classify.mjs 图片文件夹路径
import * as T from '@huggingface/transformers';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClassifier } from '../web/classifier.js';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const dir = process.argv[2];
if (!dir) { console.log('用法：node tools/test_classify.mjs 图片文件夹路径'); process.exit(1); }

const embeddings = JSON.parse(readFileSync(join(webDir, 'text_embeddings.json'), 'utf8'));
const classify = await createClassifier(T, embeddings, { localPath: join(webDir, 'models') + '/' });

for (const f of readdirSync(dir).filter(n => /\.(jpe?g|png|webp|bmp|gif)$/i.test(n))) {
  const r = await classify(join(dir, f));
  const detail = Object.entries(r.scores).map(([k, v]) => `${k}:${(v * 100).toFixed(0)}%`).join(' ');
  console.log(`${f.padEnd(28)} → ${r.category.padEnd(5)} (${detail})`);
}
