# 📱 小手机 v0.1

月月的私人 AI 聊天玩具 ✨

## ✨ 功能

- 🐾 简洁风聊天界面（暖纸白 + 淡蓝色，月月最喜欢的颜色）
- 🔌 支持 OpenAI 兼容 API（中转站、one-api 等）
- 🛡️ Cloudflare Worker 代理（API Key 不暴露）
- 🖼️ 多模态：发图片，AI 看图回复
- 🌐 HTML 预览气泡：AI 生成的代码可以直接在气泡里看效果
- 💾 本地存储：会话历史存在浏览器里
- 📱 移动端适配：手机浏览器能直接用

## 🚀 快速开始（3 步就能用）

### 方案一：本地双击打开（最简单）

1. 双击 `index.html` 用浏览器打开
2. 点击右上角 ⚙️ 配置 API
3. 开始聊天！

> ⚠️ 这种方式 API Key 存在浏览器本地，月月自己用没问题。**但不要把整个文件夹发给别人。**

### 方案二：GitHub Pages 部署（推荐，可以分享给朋友）

1. 把整个 `小手机/` 文件夹传到 GitHub 仓库
2. 仓库 Settings → Pages → Source 选 `main` 分支根目录
3. 几分钟后会得到 `https://你的用户名.github.io/仓库名/`
4. 访问这个 URL 就能用

> ⚠️ 这种方式必须配 Worker，否则 Key 会暴露在浏览器里。

### 方案三：手机装成 App（PWA）

1. 用方案二部署后，手机浏览器打开
2. 浏览器菜单 → "添加到主屏幕"
3. 桌面出现图标，像 App 一样用

## 🛡️ 部署 Cloudflare Worker（保护 API Key）

### 第 1 步：注册 Cloudflare

访问 https://workers.cloudflare.com/ 注册账号（免费）。

### 第 2 步：创建 Worker

1. 点 "Create Worker"
2. 把 `worker.js` 的内容全部粘贴进去
3. 点 "Deploy" 部署

### 第 3 步：配置环境变量

1. 进入 Worker 详情页 → Settings → Variables
2. 添加两个变量：

| 变量名 | 值 |
|--------|-----|
| `API_KEY` | 你的 API Key（sk-xxx...） |
| `BASE_URL` | API 完整地址，如 `https://api.example.com/v1` |

3. 点 "Save and Deploy"

### 第 4 步：把 Worker 地址填回小手机

1. 在小手机设置里，"Worker 地址" 填入 Worker 域名（如 `https://xxx.workers.dev`）
2. **不要填 API Key 和 Base URL**（它们只在 Worker 里）
3. 保存后就能用了！

## 📂 文件结构

```
小手机/
├── index.html          # 主界面
├── css/style.css       # 样式
├── js/app.js           # 主程序
├── worker.js           # Cloudflare Worker 代码
├── manifest.json       # PWA 配置
├── assets/
│   ├── icon-192.svg
│   └── icon-512.svg
└── README.md           # 本文件
```

## 🎯 使用提示

### 让 AI 说话更鲜活

默认人设是"温柔小狗风"。如果想要别的风格，在设置里改"系统提示词"。

示例（改成毒舌风）：
```
你是一个毒舌但关心用户的损友，说话带刺但心是好的。叫月月"小家伙"，吐槽时带个白眼 emoji。
```

### HTML 预览用法

让 AI 写 HTML 时，它会自动用 ```html ... ``` 包起来。前端会把代码渲染成可交互的预览。

试试对 AI 说："帮我做个可爱的小猫按钮"

### 多模态

点输入框左边的 🖼️ 按钮发送图片，AI 会识别图片内容。

## 🗺️ 路线图

- [x] **v0.1**：API 配置 + Worker + 聊天 + HTML 预览（当前）
- [ ] **v0.15**：预设管理器（角色切换、人设模块）
- [ ] **v0.2**：表情包库 + cedarstar 小游戏接入
- [ ] **v0.3+**：语音、TTS、视频生成、主题美化

## 🐾 制作

小克宝宝陪月月一起搓的 🐶💕

---

有任何问题随时问小克宝宝～