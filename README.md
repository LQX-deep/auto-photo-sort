# AI 照片整理

按「年 / 月 / 类别」整理照片，类别有：人像、风景、作业文档、其他。

本仓库分两个版本：

| 版本 | 位置 | 识别方式 | 适合 |
|---|---|---|---|
| 网页版 | `web/` | 本地 AI 模型（CLIP），在浏览器里运行 | 推广给别人用；不用安装，兼容 Windows 智能应用控制（SAC） |
| 桌面版 | 待补充源码 | 百度 AI 图像识别（个人额度） | 自己用 |

## 网页版

### 特点

- **不需要密钥、没有额度限制**：模型在用户浏览器里运行，照片不上传到任何服务器。
- **安全**：只处理第一层的图片文件；原图不动，结果**复制**到「整理后」目录；同名不覆盖；每次整理都写入 `整理后/整理记录.json`，可以一键撤销。
- **先预览后整理**：识别完先列出每张图的分类和目标路径，可以手动改分类，确认后才写文件。
- Chrome / Edge 直接写入所选文件夹；其他浏览器退化为打包下载 zip。

### 本地运行

```bash
# 1. 下载模型文件到 web/models/（约 89MB，只需一次）
node tools/download_model.mjs
#    国内网络：HF_ENDPOINT=https://hf-mirror.com node tools/download_model.mjs

# 2. 启动本地服务器（任选一种）
cd web
python -m http.server 8000
#  或 npx serve .

# 3. 用 Chrome / Edge 打开 http://localhost:8000
```

> 不能直接双击 `index.html` 打开（`file://` 下浏览器不允许加载模块和模型），必须通过 http 服务器访问。

### 部署成网站

`web/` 是纯静态文件（含 `models/`），放到任何静态托管上都行，不需要后端：

- **GitHub Pages**：单文件上限 100MB，模型 89MB 可以放下（上传时 GitHub 会提示文件偏大，可忽略）。
- **学校服务器 / 阿里云 OSS 静态网站托管等**：国内访问更快。
- 注意：Cloudflare Pages 单文件上限 25MB，放不下模型。

必须用 **https** 访问（localhost 除外），否则浏览器不允许写入文件夹。

### 文件说明

```
web/
  index.html            页面
  app.js                界面逻辑：选文件夹、预览、复制整理、撤销
  classifier.js         分类核心：CLIP 零样本分类
  categories.json       类别及其英文描述（想改分类就改这里）
  text_embeddings.json  由 categories.json 预先算好的文本向量
  models/               模型文件（由 tools/download_model.mjs 下载）
tools/
  download_model.mjs        下载模型
  gen_text_embeddings.mjs   修改 categories.json 后重新生成文本向量
  test_classify.mjs         用一个文件夹的图片测试分类效果
```

### 分类原理

CLIP 是 OpenAI 训练的图文模型，能把图片和文字映射到同一个 512 维向量空间。
对于每个类别，预先写几条英文描述（如 "a phone screenshot"），把它们变成向量；
识别时把图片也变成向量，计算它和每条描述的余弦相似度，经 softmax 后按类别求和，
概率最高的就是结果。如果最高概率低于 35%，就归入「其他」。

这种方法叫**零样本分类**：不需要准备训练数据，改几句描述就能增加或调整类别。

### 修改分类

1. 编辑 `web/categories.json`：增删类别，或者调整描述。描述用英文效果最好。
2. 重新生成文本向量，再测试效果：

```bash
npm i @huggingface/transformers@3.0.2
node tools/gen_text_embeddings.mjs
node tools/test_classify.mjs 你的图片文件夹
```

## 桌面版（Python + 百度 AI）

注意事项：

- **密钥不要写在代码里**：放进 `config.json`（已在 `.gitignore` 中），程序启动时读取。打包进 exe 的密钥可以被轻易解出来。
- **Python 版本**：Python 3.14 太新，很多 AI 库还没有对应的安装包。建议另装 Python 3.12，并在虚拟环境里运行：
  `py -3.12 -m venv .venv` → `.venv\Scripts\activate` → `pip install -r requirements.txt`
- 自己用的话直接 `python AI.py` 运行，不打包 exe，就不会被智能应用控制拦截。
