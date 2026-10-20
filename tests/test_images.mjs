import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {parseHTML} from './vendor/linkedom.mjs';
import {createImage, imageSource, imageURL, prepareImages} from '../codex_webui/static/image-view.js';

const {document}=parseHTML('<html><body></body></html>');
globalThis.document=document;
for (const source of ['https://example.com/a.png','/static/plot.svg','/api/files?path=x.png','data:image/png;base64,AA==','blob:example']) {
  assert.equal(imageURL(source),source);
}
for (const path of ['images/训练.png','/outside/a b.png','C:\\images\\plot.png','images/a%20b#?.png']) {
  const expected=`/api/files?path=${encodeURIComponent(path)}`;
  assert.equal(imageSource({type:'localImage',path}),expected);
  assert.equal(imageSource({type:'imageView',path}),expected);
  assert.equal(imageSource({type:'imageGeneration',savedPath:path}),expected);
}
assert.equal(imageURL('file:///outside/a%20b.png',{encodedPath:true}),'/api/files?path=%2Foutside%2Fa%20b.png');
assert.equal(imageURL('sandbox:/outside/a.png'),'/api/files?path=%2Foutside%2Fa.png');
assert.equal(imageSource({type:'imageGeneration',result:'AA=='}),'data:image/png;base64,AA==');
assert.equal(imageSource({type:'imageGeneration',path:'/outside/a.png',result:'AA=='}),'/api/files?path=%2Foutside%2Fa.png');
assert.equal(imageSource({type:'imageGeneration',path:'/old.png',savedPath:'/new.png'}),'/api/files?path=%2Fnew.png');
assert.match(imageURL('javascript:alert(1)'),/^\/api\/files\?path=/);

// Exercise the real Markdown adapter, then the same image component used by RPC items.
const root=fileURLToPath(new URL('../codex_webui/static/',import.meta.url));
const context={performance};context.self=context;
context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(root+file.replace('/static/',''),'utf8'),context));
vm.createContext(context);
vm.runInContext(fs.readFileSync(root+'render-worker.js','utf8'),context);
let html;
context.postMessage=result=>{assert.equal(result.error,undefined);html=result.html;};
context.onmessage({data:{id:1,text:'![图](<images/a b.png>)\n\n![文件](file:///outside/a.png)'}});
const template=document.createElement('template');template.innerHTML=html;
assert.equal(template.content.querySelector('[src]'),null);
prepareImages(template.content);
const markdownImage=template.content.querySelector('img');
const toolImage=createImage({type:'imageView',path:'images/a b.png'},'图');
const userImage=createImage({type:'localImage',path:'images/a b.png'},'图');
for(const image of [markdownImage,toolImage,userImage]) {
  assert.equal(image.className,'content-image');
  assert.equal(image.getAttribute('src'),'/api/files?path=images%2Fa%20b.png');
  assert.equal(image.getAttribute('loading'),'lazy');
  assert.equal(image.getAttribute('decoding'),'async');
  assert.equal(image.getAttribute('referrerpolicy'),'no-referrer');
  assert.equal(image.hasAttribute('data-image-source'),false);
}
assert.equal(template.content.querySelectorAll('img')[1].getAttribute('src'),'/api/files?path=%2Foutside%2Fa.png');
const previous=[...template.content.querySelectorAll('img')].map(image=>image.outerHTML);
prepareImages(template.content);
assert.deepEqual([...template.content.querySelectorAll('img')].map(image=>image.outerHTML),previous,'repeated preparation must not change decoded sources');
console.log('Image tests passed: shared Markdown/tool/attachment elements, path encoding, inert parser output, generated images and idempotent preparation');
