# TokenBird — iPhone / iPad

通用 SwiftUI / WKWebView 客户端，最低支持 **iOS / iPadOS 15.4**（含运行 15.8 的 iPad Air 2）。同一个 App 支持
iPhone、iPad、横竖屏与 iPad 分屏；中国大陆系统显示名称为“词元鸟”。

WebUI、画布和 draw.io 随 App 打包，通过仅绑定 `127.0.0.1` 的临时 HTTP 服务加载。
首次启动填写 TokenBird 桌面端或无头服务的 WebSocket 地址和服务器 token。
地址和 token 保存在本机 Keychain，不写入 URL、构建产物或配置文件。
公网使用 `wss://`；局域网开发可使用 `ws://192.168.1.20:9100`。

## 构建

在仓库根目录运行，先安装依赖 `bun install --frozen-lockfile`。

```bash
# Windows / Linux / macOS：构建 WebUI、准备 App 图标和打包资源
bun run ios:prepare

# macOS + 完整 Xcode（建议 Xcode 16 或更新版本）
bun run ios:build:simulator   # 模拟器 .app.zip，适用于 iPhone/iPad 模拟器
bun run ios:build             # 通用真机 .app.zip 和 .ipa，未签名
bun run build:all ios         # 同一真机构建，汇总 SHA256
```

安装 Xcode 后执行 `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
和 `sudo xcodebuild -runFirstLaunch`；通过 Xcode 安装 iOS 模拟器运行时。
也可以在资源准备后直接打开 `apps/ios/TokenBird.xcodeproj`，选择 `TokenBird` scheme。
直接使用 Xcode 时请同步 target 的版本和 build number；脚本构建会读取根 `package.json`
版本，build number 默认为 `1`，可设置 `IOS_BUILD_NUMBER`（1–9999）；每次提交新发布时递增。

输出统一位于 `dist/ios/`：

| 命令 | 产物 |
| --- | --- |
| `ios:build:simulator` | `TokenBird-<version>-ios-simulator.app.zip` |
| `ios:build` | `TokenBird-<version>-ios-device.app.zip` 和 `TokenBird-<version>-ios-device-unsigned.ipa` |
| `ios:archive` | `TokenBird-<version>-ios-archive.xcarchive.zip` |
| `ios:archive -- --export` | 归档和 `TokenBird-<version>-ios.ipa` |

**未签名真机 App 不能直接安装到 iPhone/iPad。** 可在 Windows 使用 Sideloadly 等侧载工具
对未签名 IPA 进行本地 Apple 账号签名，再安装到已信任电脑的设备；Apple 账号在侧载工具中登录。
模拟器包可解压后通过
`xcrun simctl install booted /path/to/TokenBird.app` 安装，然后执行
`xcrun simctl launch booted top.goldgom.tokenbird`。切换到一个 iPhone 模拟器和一个
iPad 模拟器分别检查连接、聊天、键盘、旋转、文件选择、导出和分屏。

## 签名归档 / IPA

Mac 上需要已配置的 Apple 开发者团队、签名证书与对应 provisioning profile。
以下变量只用于本机构建；不要提交证书和私钥。

```bash
export IOS_DEVELOPMENT_TEAM=YOUR_TEAM_ID
# 可选：团队中已注册的 App ID，默认 top.goldgom.tokenbird
export IOS_BUNDLE_IDENTIFIER=your.registered.bundle.identifier
export IOS_BUILD_NUMBER=1
bun run ios:archive

# 从 Xcode 导出的 ExportOptions.plist（App Store Connect / ad hoc / development 等）
export IOS_EXPORT_OPTIONS_PLIST=/absolute/path/ExportOptions.plist
bun run ios:archive -- --export
```

仅当需要 Xcode 联网管理 profiles 时设置 `IOS_ALLOW_PROVISIONING_UPDATES=1`。
`bun run build:all ios --release` 使用相同的签名归档流程。
脚本不会提交到 App Store Connect，也不会自动发布到 TestFlight。

`.github/workflows/ios.yml` 在 macOS 上编译通用模拟器包与未签名真机包，并上传产物。
CI 的无签名编译不需要 Apple 团队凭据。

## 当前平台范围

- Agent、Super Agent、文件与工作区操作在所连接的服务端运行。
- 不打包本地 Bun/Claude/Codex 进程；Android 的本机执行、ADB 和原生设备权限能力不适用于此版本。
- 文件选择使用 WKWebView 系统选择器，下载通过系统分享面板导出；iPad 使用原生 sheet。
- App 在后台时可能被 iOS 暂停；任务继续在远端运行，返回前台后 WebSocket 自动重连。
- 需要浏览器回调的模型提供商 OAuth 建议先在桌面端/服务端完成授权；本版未接入 iOS OAuth callback/deep link。
- 原生编译、真机安装和模拟器交互检查必须在 macOS/Xcode 环境执行。
