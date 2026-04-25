# Better DeepSeek

为 [chat.deepseek.com](https://chat.deepseek.com) 增强体验的 Chrome 扩展。

## 功能

### 智能体（Agents）

- **智能体管理** — 创建、编辑、删除自定义智能体，每个智能体拥有独立的系统提示词
- **工作区隔离** — 每个智能体拥有隔离的对话历史，互不干扰
- **文件附件** — 为智能体附加文件，每次对话自动带上
- **自动注入** — 进入智能体后自动填入系统提示词并发送

### 开关记忆

DeepSeek 网页会自动启用智能搜索和快速模式。扩展可以记住你的偏好并在页面加载时恢复：

- **保持搜索开关** — 记住智能搜索的开关状态
- **保持对话模式** — 记住快速模式/专家模式的选择

### 数据管理

- **导出/导入** — 通过扩展弹窗一键导出或导入所有数据（智能体、文件、提示词、会话映射）
- **设置面板** — 点击扩展图标打开设置页面，控制各项功能的开关

### 其他

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
