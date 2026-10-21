import { build } from 'esbuild';

const banner = `// ==UserScript==
// @name         实验室安全平台自动学习
// @namespace    local.sysaq
// @version      0.1.0
// @description  自动翻页、按学习进度切换下一章节
// @match        https://sysaq.ustc.edu.cn/lab-study-front/examTask/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==`;

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['chrome110'],
  outfile: 'dist/sysaq-auto-study.user.js',
  banner: { js: banner },
  loader: { '.css': 'text' },
  legalComments: 'none',
  logLevel: 'info',
});
