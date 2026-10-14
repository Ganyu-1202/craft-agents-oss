# 聊天图片压缩与历史上下文

单张上传图片的上限为 2 MB（2 × 1024 × 1024 字节，按 Base64 编码前的文件大小计算）。超过上限的图片在客户端上传前自动压缩，服务端保存时再次校验；SFTP 上传在完成暂存后执行同样的校验。转换格式时同步更新 MIME、文件扩展名和发送给模型的图片数据。

“上传前压缩图像”设置控制额外的 100 KB 压缩目标。即使关闭该设置，2 MB 上限仍然生效。压缩保持长宽比，能通过 PNG 压缩达标时保留透明背景，需要 JPEG 时将透明区域铺为白色。无法解码或压缩的超限图片会阻止本次消息发送并保留草稿。

Pi 和 Codex 兼容后端会根据当前模型及 compact 预算调整发送给模型的历史图片：

- 保留最近两条用户消息里的上传图片，以及最近两条含图片的工具结果。
- 达到 compact 预算的 65%，或历史图片超过 4 MB / 8 张时，将更早的图片缩小到最长边 768 像素、约 96 KB 以内。
- 达到预算的 85%，或历史图片超过 8 MB / 16 张时，进一步缩小到 384 像素，并尝试把更早的图片替换为文字描述。
- 文字描述由当前支持视觉的模型生成，保留可辨识文字、数字、对象和布局，并标明不确定信息。每次上下文处理最多生成两份新描述，compact 最多生成三份；单次描述调用最多等待 20 秒，失败后一分钟内避免重复尝试。生成描述会产生模型调用费用。
- 描述失败时优先保留缩略图；已经耗尽 compact 预算时，使用带来源关联和缺失说明的文字记录。手动、自动和溢出恢复 compact 都会保留图片记录，已有描述会被复用。

历史图片降级只修改本次模型请求的上下文，原始附件和 SDK 历史记录保留。文字描述会省略部分细节，需要精确读取小字、尺寸或坐标时，应重新读取原图。原生 Claude 和原生 Codex 的历史 compact 仍由各自 SDK 管理；所有后端的上传路径均受 2 MB 上限约束。

验证命令：

```powershell
bun test ./packages/pi-agent-server/src/context-images.test.ts ./packages/pi-agent-server/src/restricted-resources.test.ts ./packages/pi-agent-server/src/session-settings.test.ts
bun test ./packages/server-core/src/handlers/rpc/files.images.isolated.ts
bun test ./packages/server-core/src/services/image-utils.test.ts
bun run scripts/test-image-upload.ts
bun run scripts/test-packaged-image-context.ts
```
