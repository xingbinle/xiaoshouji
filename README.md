# 📱 小手机

一个轻量级 AI 聊天 PWA，支持 OpenAI 兼容 API。

## ✨ 功能

- 💬 简洁聊天界面
- 🔌 OpenAI 兼容 API（中转站、one-api 等）
- 🛡️ Cloudflare Worker 代理（API Key 不暴露）
- 🖼️ 多模态图片识别
- 🌐 HTML 代码实时预览
- 💾 本地存储会话历史
- 📱 移动端 + PWA 支持

## 🚀 快速开始

### 本地使用

1. 双击 `index.html` 打开
2. 右上角 ⚙️ 配置 API
3. 开始聊天

### 部署 Worker（保护 API Key）

1. 注册 [Cloudflare Workers](https://workers.cloudflare.com/)
2. 创建 Worker，粘贴 `worker.js` 内容
3. Settings → Variables 添加 `API_KEY` 和 `BASE_URL`
4. 把 Worker 地址填回小手机设置

## 📂 文件结构

```
├── index.html          # 主界面
├── css/style.css       # 样式
├── js/app.js           # 主程序
├── worker.js           # Cloudflare Worker
├── manifest.json       # PWA 配置
└── assets/             # 图标
```

## 🛠 技术栈

纯前端 HTML/CSS/JS，无框架依赖。设计系统：暖纸白 + 淡蓝，移动端优先。

## 🐾

Made with 💕 by Kiki
