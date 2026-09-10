# Manifold 3D — 面向 3D 打印的 AI 建模

[English](README.md) | [简体中文](README.zh-CN.md)

[![许可证：Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
![Node.js >= 24](https://img.shields.io/badge/Node.js-%E2%89%A5%2024-green)
[![向 DeepWiki 提问](https://deepwiki.com/badge.svg)](https://deepwiki.com/zhicwan/manifold3d-mcp)

**描述零件，在 3D 预览中调整，再导出 STL 交给切片软件。**

Manifold 3D 让你在 GitHub Copilot 和 Claude Code 中进行 AI 3D 建模。助手编写
参数化 TypeScript 代码、校验几何模型，并打开交互式预览。它适合代码驱动的参数化
CAD 与 3D 打印设计，从手机支架、收纳件到键帽和地形模型。

## 从描述到模型

[![Copilot Canvas 中的参数化手机支架，展示倾斜靠背和加宽至 22 mm 的走线槽](docs/assets/phone-stand-canvas.png)](docs/usage.zh-CN.md#示例加宽走线槽)

_Copilot Canvas 中的手机支架，走线槽已加宽至 22 mm。
[对比 14 mm 与 22 mm 走线槽，并复现模型](docs/usage.zh-CN.md#示例加宽走线槽)。_

[查看参数化手机支架源码](samples/05-phone-stand.ts)。

先让助手生成一个带走线槽的手机支架。在 Copilot 原生 Canvas 中选中走线槽，
要求加宽，同时保持支架底部尺寸不变。检查修改后的模型，再选择
**Export → Export STL**。

MCP 插件使用同一建模引擎，在浏览器 Viewer 中预览，并通过标注反馈修改意见。
[查看完整使用流程](docs/usage.zh-CN.md)。

## 安装

需要 **Node.js 24 或更高版本**，以及下列宿主之一。插件已包含运行时与 Viewer，
无需另外执行 npm 安装。

| 选择体验                        | 插件                 | 宿主                                     |
| ------------------------------- | -------------------- | ---------------------------------------- |
| 原生 Canvas，选中位置后带入对话 | `manifold-extension` | 支持 Canvas 的 Copilot CLI / Copilot app |
| MCP 工具与浏览器 Viewer         | `manifold`           | Copilot CLI 或 Claude Code               |

**Copilot — 原生 Canvas**

```sh
copilot plugin marketplace add zhicwan/manifold3d-mcp
copilot plugin install manifold-extension@manifold3d-mcp
```

如果希望使用 MCP/浏览器体验，添加同一 marketplace 后改为安装：

```sh
copilot plugin install manifold@manifold3d-mcp
```

**Claude Code — MCP/浏览器**（在 Claude Code 内执行）

```text
/plugin marketplace add zhicwan/manifold3d-mcp
/plugin install manifold@manifold3d-mcp
```

两种插件可以独立安装。原生 Canvas 需要兼容的 Copilot 宿主，不属于 MCP 插件。
[独立 MCP、更新与迁移说明](docs/usage.zh-CN.md#安装)见使用指南。

## 试试第一条提示词

```text
使用 Manifold 设计一个参数化手机支架，单位为毫米：宽 80 mm、深 85 mm，
底板厚 6 mm，靠背相对竖直方向倾斜 20 度，前部中央留一个 14 mm 宽的
走线槽。将关键尺寸写成命名参数。校验脚本、预览模型，并检查渲染视图后
再向我展示结果。
```

接着试试：“把走线槽加宽到 22 mm，其他部分保持不变。”

先说明尺寸与配合要求，每次提出一个明确的修改目标。你不必自己编写 TypeScript，
但模型始终保留为可检查、可编辑的代码。

## 示例与常见问题

- [浏览示例](samples/README.zh-CN.md)：立方体、旋转花瓶、gyroid 曲面、
  键帽套装、磁吸相框等。
- [阅读使用指南](docs/usage.zh-CN.md)：安装、本地脚本、标注、Viewer 快捷键
  与 STL 导出。

**这是 Manifold 库本身吗？**

不是。本项目在底层几何库
[manifold-3d](https://github.com/elalish/manifold) 之上提供助手工具、校验和 Viewer。

**这是传统 CAD 编辑器，或独立的 AI 模型吗？**

都不是。你现有的助手负责生成代码；Viewer 用来检查几何模型、指出修改位置，
不是基于草图与约束的 CAD 编辑器。

**支持哪些导出格式？能直接打印吗？**

Viewer 导出 **STL**，不支持 STEP 或 3MF。校验针对脚本与几何模型，并不保证
制造或使用安全。打印前仍需检查尺寸、间隙、壁厚、材料和切片设置。

## 参与贡献

开发环境与检查命令见 [CONTRIBUTING.md](CONTRIBUTING.md)，
仓库维护规则见 [AGENTS.md](AGENTS.md)，Canvas 技术集成见
[Extension README](apps/copilot-extension/README.md)。这些开发文档保持英文。

## 许可证与上游

[Apache License 2.0](LICENSE) — Copyright 2026 Zhicheng Wang.

上游归属信息见 [NOTICE](NOTICE)。

本项目使用并改编了 [elalish/manifold](https://github.com/elalish/manifold)
（Apache-2.0）的部分内容：

- `packages/modeling/src/sandbox/garbage-collector.ts`
- `skills/shared/references/` 下的文档
