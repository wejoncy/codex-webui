export const examples = {
  math: String.raw`## 让公式回到它该有的样子

从行内公式 $e^{i\pi}+1=0$，到一段完整的推导。支持美元符号和 \(\LaTeX\) 分隔符，也支持独立公式、矩阵与多行对齐。

### 一个经典的积分

设 $I=\int_{-\infty}^{+\infty}e^{-x^2}\,dx$。把两个相同的积分相乘，再换到极坐标：

$$
\begin{aligned}
I^2 &= \int_{-\infty}^{+\infty}\int_{-\infty}^{+\infty} e^{-(x^2+y^2)}\,dx\,dy \\
&= \int_0^{2\pi}\int_0^{\infty}e^{-r^2}\,r\,dr\,d\theta \\
&= 2\pi\left[-\frac{1}{2}e^{-r^2}\right]_0^{\infty}=\pi
\end{aligned}
$$

因此，$\boxed{I=\sqrt{\pi}}$。一个二维的视角，让一维的问题变得简单。

### 从矩阵到注意力

\[
\mathbf{A}=\begin{bmatrix}1 & 2 & 3 \\ 4 & 5 & 6 \\ 7 & 8 & 9\end{bmatrix}
\qquad
\operatorname{Attention}(Q,K,V)=\operatorname{softmax}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right)V
\]

### 分段函数与概率

$$
f(x)=\begin{cases}x^2,&x\geq 0\\-x,&x<0\end{cases}
\qquad
P(A\mid B)=\frac{P(B\mid A)P(A)}{P(B)}
$$

> 公式可以选中复制，宽公式可以横向滚动。代码里的 ${'`$price`'} 会保持原样；日常价格 $20 和 $30 也不会误识别为公式。

| 写法 | 用途 | 示例 |
| --- | --- | --- |
| ${'`$ ... $`'} 或 ${'`\\( ... \\)`'} | 行内公式 | $a^2+b^2=c^2$ |
| ${'`$$ ... $$`'} 或 ${'`\\[ ... \\]`'} | 独立公式 | $\sum_{k=1}^{n}k=\frac{n(n+1)}{2}$ |
| ${'`math`'} / ${'`latex`'} 代码块 | 整段 LaTeX | $\nabla\cdot\mathbf{E}=\rho/\varepsilon_0$ |
`,
  image: String.raw`## 一张图，也可以把事情讲清楚

Markdown 图片、本地工作区中的图片，以及粘贴上传的截图，都可以直接显示。点击图片查看原图，使用滚轮或按钮缩放。

![一个平静的工作台：山峦、日光与数据曲线](/static/landscape.svg)

### 图像与公式，放在一起

一条简单的曲线 $y=\sin(x)\,e^{-0.12x}$，也可以是探索的起点。让 Codex 解读图表、提取信息，或者用 Python 生成新的可视化。

![衰减正弦曲线](/static/plot.svg)

> 图片采用懒加载和异步解码。透明背景会在预览器中显示棋盘格，长图和宽图保持原始比例。

支持浏览器可解码的 PNG、JPEG、WebP、GIF、SVG、AVIF 等格式。本地图片的访问范围限定在配置的工作目录内。
`,
  code: '## 思路清楚，代码也一样\n\n代码高亮、表格和公式，可以自然地出现在同一条回复中。\n\n```python\nimport numpy as np\n\ndef softmax(x: np.ndarray) -> np.ndarray:\n    # 减去最大值，避免指数溢出\n    shifted = x - np.max(x, axis=-1, keepdims=True)\n    weights = np.exp(shifted)\n    return weights / weights.sum(axis=-1, keepdims=True)\n```\n\n对应的数学表达为：\n\n$$\\sigma(z)_i=\\frac{e^{z_i-\\max(z)}}{\\sum_{j=1}^{K} e^{z_j-\\max(z)}}$$\n\n### 选一个合适的工具\n\n| 内容 | 渲染方式 | 体验 |\n| --- | --- | --- |\n| 常见数学公式 | KaTeX | 快速、可复制、支持无障碍阅读 |\n| 扩展 LaTeX | MathJax 按需加载 | 补充兼容复杂表达式 |\n| Markdown 与代码 | 后台解析 | 流式更新不阻塞输入 |\n| 图片 | 原生解码 | 懒加载、点击放大 |\n| 历史对话 | 分页与跳过屏外布局 | 减少长对话的渲染开销 |\n\n> 所有前端依赖都随项目提供，无需访问公共 CDN。',
};
examples.stress = Array.from({length: 160}, (_, i) => String.raw`## 第 ${i+1} 段 · 在长文里保持专注

重复的公式命中缓存，屏幕外的段落按需布局。所有内容仍保留在文档里，支持浏览器搜索与复制。

$$\int_{-\infty}^{\infty} e^{-x^2}\,dx=\sqrt{\pi}\qquad \sum_{k=1}^n k=\frac{n(n+1)}{2}$$

行内公式 $E=mc^2$ 与 $\nabla f(x)$，以及一段常规文字，共同组成真实阅读场景。
`).join('\n');
