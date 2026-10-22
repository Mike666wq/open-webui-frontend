# 当前 Android 构建入口

客户端已迁入 frontend/apps/client。统一入口是 frontend 仓库的 frontend.yml，内部调用 android.yml 与 client-quality.yml。
完整操作见 [两仓库流程](../../../docs/TWO_REPOSITORY_PIPELINE.md)。
签名沿用旧密钥，应用标识不变，versionCode 从 200000 + frontend run_number 继续递增。
网页变化直接复用当前工作流验证的 ZIP；原生变化使用已签入的前端锁。旧 frontend-sync 不再参与 Android 构建。
历史诊断工作流保存在 legacy-workflows/，不自动执行。
