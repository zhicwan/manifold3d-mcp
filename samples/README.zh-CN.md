# Manifold 3D 示例

[English](README.md) | [简体中文](README.zh-CN.md) · [返回项目](../README.zh-CN.md)

这里收录可运行、检查和修改的参数化 3D 模型。每个文件都是独立的 Manifold
沙箱 TypeScript 脚本，将一个 `Manifold` 赋值给 `result`；这个对象可以包含
多个分离的零件。脚本通过 `samples/tsconfig.json` 进行类型检查，并可作为
内联 `code` 在两种插件中运行。

文件名前的数字表示难度，数字越小越简单。可先浏览 01–04 学习 API，
再尝试中等难度的 05 手机支架。90 系列则是规模较大的参考设计。

## 难度与内容

| 文件                                                             | 展示内容                           | 使用的 API                                                                                                                            |
| ---------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [01-hello-cube.ts](01-hello-cube.ts)                             | 最小可用沙箱脚本                   | `Manifold.cube`, `scale`                                                                                                              |
| [02-revolve-vase.ts](02-revolve-vase.ts)                         | 将二维轮廓旋转为三维实体           | `CrossSection.ofPolygons`, `Manifold.revolve`                                                                                         |
| [03-levelset-gyroid.ts](03-levelset-gyroid.ts)                   | 由有符号距离场（SDF）构造隐式曲面  | `Manifold.levelSet`                                                                                                                   |
| [04-warp-and-refine.ts](04-warp-and-refine.ts)                   | 对细分网格进行平滑变形             | `Manifold.sphere`, `refine`, `warp`                                                                                                   |
| [05-phone-stand.ts](05-phone-stand.ts)                           | 中等难度手机支架，走线槽宽度可调   | `CrossSection.square`, `offset`, `ofPolygons`, `extrude`, `Manifold.union`, `subtract`                                                |
| [90-dsa-keycap-set-108.ts](90-dsa-keycap-set-108.ts)             | 完整 ANSI 108 键 DSA 键帽套装      | `Manifold.cube`, `cylinder`, `sphere`, `extrude`, `hull`, `union`, `subtract`, `translate`, `rotate`, `CrossSection.square`, `offset` |
| [91-instax-mini-fridge-frame.ts](91-instax-mini-fridge-frame.ts) | 两件式磁吸冰箱相框                 | `Manifold.cube`, `cylinder`, `extrude`, `subtract`, `translate`, `rotate`, `add`, `CrossSection.square`, `ofPolygons`, `offset`       |
| [92-k2-terrain.ts](92-k2-terrain.ts)                             | 使用 `Mesh` 构建高度图地形         | `new Mesh`, `Manifold.ofMesh`                                                                                                         |
| [97-gecko-rock-terraces.ts](97-gecko-rock-terraces.ts)           | 带楼梯与拱形平台的四件式守宫躲避屋 | `Manifold.hull`, `difference`, `union`, `compose`, `decompose`, `CrossSection.ofPolygons`, `offset`, `extrude`                        |

## 守宫岩石阶台

`97-gecko-rock-terraces.ts` 保留组装后直立的设计：170 × 120 × 65 mm 的空心
躲避屋，带 55 mm 拱形门洞与后部角落的六个通风口；两段 50 mm 宽的楼梯；
以及位于 Z = 100 mm 的 100 × 100 mm 平台。完整组件占用
170 × 291.7 × 100 mm。

输出包含四个分离的连通部件：躲避屋、下层楼梯、上层楼梯，以及带拱形支撑的
平台。安排打印盘前应将它们拆分为独立对象。躲避屋屋顶朝下、两段楼梯踏面朝上、
平台顶面朝下打印；各零件都能放入 256 mm 的打印空间。屋顶接缝预留
0.15 mm 胶合间隙。实际打印件与饲养环境仍需评估胶粘剂相容性、完全固化、
边缘处理、稳定性、材料遮光性与通风情况。
这些检查针对几何设计，不是承载、动物安全或气流测试。

## 运行示例

按照[使用指南](../docs/usage.zh-CN.md#安装)安装插件，然后下载示例或使用
本地仓库副本。

**原生 Canvas：** 让助手读取示例，将内容作为内联 `code` 先传给
`manifold_validate_script`，再传给 `manifold_execute_script`。
Canvas 不接受 `filePath`。

**MCP：** 内联 `code` 同样最简单，让助手先调用 `validate_script`，再调用
`execute_script`。如果希望直接加载文件，必须使用**绝对路径**，并在启动
MCP 服务器前，通过其 `MANIFOLD_MCP_SCRIPT_ROOTS` 环境变量显式授权目录：

```sh
MANIFOLD_MCP_SCRIPT_ROOTS="/absolute/path/to/manifold3d-mcp/samples" \
  node /absolute/path/to/manifold.mjs
```

以上示例启动的是独立 MCP 发布文件。对于已安装的插件，通过宿主的服务器
环境配置或启动环境设置同一变量，然后重启服务器。Copilot 在插件目录中
启动服务器；Claude 可能保留项目目录。不要因为助手能读取文件，就假设你的
仓库目录已获得授权。完整规则见[本地文件访问](../docs/usage.zh-CN.md#使用本地文件)。

授权后的 MCP 工具调用示例：

```json
{
  "name": "validate_script",
  "arguments": {
    "filePath": "/absolute/path/to/manifold3d-mcp/samples/01-hello-cube.ts"
  }
}
```

校验通过后再执行，检查预览与渲染截图，然后选择 **Export → Export STL**。
请自行核对尺寸、打印设置和用途安全；几何校验不是安全认证。

## 添加新示例

1. 创建 `samples/NN-my-sample.ts`，选择对应难度段内下一个可用编号。
2. 文件开头添加注释块，包含标题、一句话说明，以及 `// APIs:` 行。
3. 将最终 Manifold 赋值给 `result`，不要使用 import/export。
4. 运行 `npx tsc -p samples/tsconfig.json --noEmit` 进行类型检查。
5. 使用对应插件的内联 `code` 工具校验；或使用 MCP `validate_script`，
   传入位于显式授权目录内的绝对 `filePath`。
