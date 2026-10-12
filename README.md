# 🚀 Grok Automation (grok.com 批量自动化扩展)

[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](https://github.com/nullpointer2026/grok-automation/releases/tag/v1.1.0)
[![Manifest](https://img.shields.io/badge/manifest-v3-green.svg)](manifest.json)
[![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge-brightgreen.svg)]()

专为 **[grok.com](https://grok.com/)** 打造的生产级批量自动化与媒体生成 Chrome 侧边栏（Side Panel）扩展工具。

---

## ✨ 核心特性

- **多模式任务队列**：
  - 🎥 **文生视频 (Text-to-Video)**：批量输入提示词，队列自动执行生成。
  - 🖼️ **图生视频 (Image-to-Video)** 与批量图片生成。
- **Chrome 原生侧边栏 (Side Panel)**：
  - 基于 Manifest V3 SidePanel API，无需频繁切换标签页，与主页面分屏并行操作。
  - 包含【控制面板】、【高级设置】、【运行日志】三大功能区。
- **全流程自动化**：
  - 自动填充 Prompt 提示词 -> 自动触发提交 -> 状态监听 -> 自动保存下载。
  - 具备错误重试机制与失败任务日志导出。

---

## 📦 安装与加载方式

1. **下载 Release 扩展包**：
   - 前往 [Releases v1.1.0](https://github.com/nullpointer2026/grok-automation/releases/tag/v1.1.0) 下载 GrokAutomation_v1.1.0.zip。
   - 解压至本地任意常用文件夹（如 D:\Tools\GrokAutomation）。

2. **在浏览器中加载扩展**：
   - 打开 Chrome / Edge 浏览器，访问 chrome://extensions/；
   - 开启页面右上角的 **「开发者模式」**；
   - 点击左上角的 **「加载已解压的扩展程序」**；
   - 选中包含 manifest.json 的 GrokAutomation 文件夹即可完成安装。

3. **使用流程**：
   - 打开 [https://grok.com/](https://grok.com/) 并登录您的账号；
   - 点击浏览器扩展栏的 **Grok Automation** 图标即可打开右侧操作侧边栏。

---

## 📄 许可说明
本项目遵循开源协议，仅供自动化学习与效率提升研究使用。
