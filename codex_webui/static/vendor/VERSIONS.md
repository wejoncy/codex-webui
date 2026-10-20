# Vendored browser assets

All assets are served locally. No public CDN is contacted by the UI.

| Dependency | Version/source | License |
| --- | --- | --- |
| KaTeX + mhchem + WOFF2 fonts | 0.16.7, cdnjs distribution | MIT |
| MathJax SVG + TeX extensions | 3.2.2, cdnjs distribution | Apache-2.0 |
| DOMPurify | 3.4.17, official dist/purify.min.js | Apache-2.0 OR MPL-2.0 |
| markdown-it | Standalone core extracted from official demo build | MIT |

## Source revisions

- markdown-it demo: `ab73d91204428f992af327fd2c785869c990108a`
- DOMPurify: `cde95990b2190338cfd7c00b768f3d81d3219d61`
- cdnjs: `43079fba877a38c51a977bf5bf059b4ed8502da9`

## Markdown core extraction

The official markdown-it demo repository (https://github.com/markdown-it/markdown-it.github.io)
contains a self-contained ES module in index.html. The vendored core preserves its
bundled parser and dependencies, removes the browser module-preload polyfill,
stops before the demo's Highlight.js/UI modules, and exports its `Cr` constructor
as `self.markdownit`. The resulting bundle is tested by tests/test_render.cjs.
The exact source revision is recorded above; do not apply this extraction to an
unreviewed future build, whose symbol names or boundaries may differ.

KaTeX files come from `ajax/libs/KaTeX/0.16.7`, MathJax from
`ajax/libs/mathjax/3.2.2/es5` in https://github.com/cdnjs/cdnjs.
Unused KaTeX integrations/font formats and alternate MathJax entry bundles are
omitted. KaTeX runs in the Worker. MathJax and its safe extension are loaded only
for formulas that KaTeX cannot parse. The MathJax directory includes the optional
TeX extension loader paths, served from this same directory.

SHA256SUMS.json records the SHA-256 of every distributed dependency file except
itself. Preserve the license notices when updating or redistributing assets.
