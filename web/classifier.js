// 图片分类核心：CLIP 零样本分类。
// 原理：把图片和若干类别描述都变成 512 维向量，图片向量离哪个描述最近，就归到哪一类。
// 文本向量已预先算好（text_embeddings.json），这里只需运行视觉模型。
//
// T 是 transformers.js 库本身（浏览器从 CDN 导入，Node 测试从 npm 包导入），
// 这样同一份代码在两边都能用。

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const LOGIT_SCALE = 100;        // CLIP 训练时学到的温度系数，用来把相似度放大后做 softmax
const MIN_CONFIDENCE = 0.35;    // 最高类别的概率低于这个值时，归入“其他”

// source：'local' 表示从网站自带的 models/ 目录加载（推荐，国内也能用）；
//         或者一个远程地址，如 'https://huggingface.co/'
export async function createClassifier(T, embeddings, { source = 'local', localPath = './models/', onProgress } = {}) {
  if (source === 'local') {
    T.env.allowLocalModels = true;
    T.env.allowRemoteModels = false;
    T.env.localModelPath = localPath;
  } else {
    T.env.allowLocalModels = false;
    T.env.allowRemoteModels = true;
    T.env.remoteHost = source;
  }

  const processor = await T.AutoProcessor.from_pretrained(MODEL_ID);
  const visionModel = await T.CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, {
    dtype: 'q8',                         // 8 位量化版本，约 89MB
    progress_callback: onProgress,
  });

  const { categories, categoryIndex, vectors } = embeddings;
  const otherIdx = categories.indexOf('其他');

  // image：图片 URL（浏览器里可以是 blob: URL）或本地路径（Node）
  return async function classify(image) {
    const raw = await T.RawImage.read(image);
    const inputs = await processor(raw);
    const { image_embeds } = await visionModel(inputs);
    const img = Array.from(image_embeds.data);
    const norm = Math.hypot(...img);

    // 与每条描述的余弦相似度 → softmax 概率
    const logits = vectors.map(v => LOGIT_SCALE * v.reduce((s, x, i) => s + x * img[i], 0) / norm);
    const max = Math.max(...logits);
    const exps = logits.map(l => Math.exp(l - max));
    const sum = exps.reduce((a, b) => a + b, 0);

    // 同一类别下所有描述的概率相加
    const scores = categories.map(() => 0);
    exps.forEach((e, i) => { scores[categoryIndex[i]] += e / sum; });

    let best = scores.indexOf(Math.max(...scores));
    if (scores[best] < MIN_CONFIDENCE && otherIdx >= 0) best = otherIdx;

    return {
      category: categories[best],
      confidence: scores[best],
      scores: Object.fromEntries(categories.map((c, i) => [c, scores[i]])),
    };
  };
}
