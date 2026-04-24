# Better DeepSeek

为 [chat.deepseek.com](https://chat.deepseek.com) 添加「智能体（Agents）」功能的 Chrome 扩展。

## 功能

- **智能体管理** — 创建、编辑、删除自定义智能体，每个智能体拥有独立的系统提示词
- **独立工作区** — 每个智能体拥有隔离的对话历史，互不干扰
- **文件附件** — 为智能体附加文件，每次对话自动带上
- **自动注入** — 进入智能体后自动填入系统提示词并发送
- **中英双语** — 自动根据浏览器语言切换界面

## 安装

```bash
npm install
npm run build
```

然后在 Chrome 中加载 `dist/` 目录作为未打包的扩展。

## 开发

```bash
npm run dev    # 开发服务器
npm run build  # 构建
npm run lint   # 代码检查
```

## 技术栈

- React 19 + TypeScript
- Vite + @crxjs/vite-plugin（Manifest V3）
- Tailwind CSS
- Chrome Extensions API
