# 两仓库迁移与发布

客户端从 `Mike666wq/open-webui-client@621b666b674da5118ae2b1e28e19efce0eef6ba4` 导入 `apps/client/`。
原仓库的 Git 历史和旧 APK 保留；迁移不删除原仓库。

## 开发入口

- 网页：根目录 npm ci / npm run dev。
- 客户端：cd apps/client，然后 npm ci / npm test / npm run build。
- GitHub：frontend.yml 统一选择任务，android.yml 和 client-quality.yml 是内部可复用工作流。
- 旧诊断工作流归档在 apps/client/docs/legacy-workflows，不是当前可运行的 Actions；对应诊断脚本仍保留。

## 签名迁移

签名迁移已完成，frontend 已通过原签名校验并发布 v0.2.33。一次性迁移入口已从旧仓库删除。
记录：[迁移工作流第 3 次运行](https://github.com/Mike666wq/open-webui-client/actions/runs/39759453405/attempts/3)。
原有两个签名 Secret 通过 frontend 公钥加密写入，没有打印原值或生成新密钥。

请删除旧 client 的 FRONTEND_SECRETS_MIGRATION_TOKEN；若该 Token 专用于迁移，也在个人设置撤销。
原签名 Secret 暂保留作为恢复来源，正式打包使用 frontend 中的签名配置。

## 版本与产物

网页 package.json 版本是官方兼容基线，客户端 apps/client/package.json 是独立应用版本。
每次正式 APK 自动递增客户端 patch，versionCode = 200000 + frontend 工作流 run_number；重跑复用原版本与 source pin。
应用标识仍为 local.openwebui.client。迁移基线 v0.2.32/versionCode 100026，所以新序列不会倒退。
网页 ZIP 仍使用 frontend-<SHA12> 标签；APK 使用 v<客户端版本> 标签，两者都发布在本仓库。
backend 必须过滤 frontend-*，不能使用 /releases/latest 获取网页，因为最新 Release 可能是 APK。
版本更新只提交 apps/client 下五个版本文件与 frontend.lock.json，不修改网页版本。

## 验收

检查 Actions 的网页/Android 门禁、APK 签名身份和前端锁一致性；真机使用新 APK 覆盖安装原版，确认数据保留。
后端同步定时可能延迟，可以手动运行 Sync verified frontend and build；正式部署仍需独立安排。

## 排队与重试

main 发布串行处理。若构建期间继续推送导致旧来源被标记 superseded，应在 frontend Actions 对最新 main 手动 Run workflow，
不要反复重跑已过期的旧 source。后端定时同步可能延迟，也可手动运行 Sync verified frontend and build；
rebuild 默认关闭，只有明确需要重新验证相同产品时才打开。
