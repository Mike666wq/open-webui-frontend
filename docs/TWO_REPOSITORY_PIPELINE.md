# 两仓库迁移与发布

客户端从 `Mike666wq/open-webui-client@621b666b674da5118ae2b1e28e19efce0eef6ba4` 导入 `apps/client/`。
原仓库的 Git 历史和旧 APK 保留；迁移不删除原仓库。

## 开发入口

- 网页：根目录 npm ci / npm run dev。
- 客户端：cd apps/client，然后 npm ci / npm test / npm run build。
- GitHub：frontend.yml 统一选择任务，android.yml 和 client-quality.yml 是内部可复用工作流。
- 旧诊断工作流归档在 apps/client/docs/legacy-workflows，不是当前可运行的 Actions；对应诊断脚本仍保留。

## 签名迁移

在旧 client 的 Secrets 中配置 FRONTEND_SECRETS_MIGRATION_TOKEN：fine-grained token 只选择 frontend，Secrets read/write。
一次性 migrate-signing 工作流在旧仓库运行器使用原有两个签名 Secret，用 frontend 公钥加密后调用 GitHub Secret API 写入。
不会打印原值、产生新的签名密钥或上传密钥备份。frontend 的签名校验继续验证原 alias 和密码。
成功后删除 client 的临时 Secret，并在个人设置撤销临时 token；原有签名 Secret 暂保留作为历史恢复来源。
没有配置原签名时正式 APK 发布会失败关闭，不会偷偷使用 debug 或新签名。

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
