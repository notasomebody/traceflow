# 为迹汇贡献代码

感谢你帮助迹汇变得更好。提交代码前，请先搜索现有 Issue，较大的改动建议先创建功能讨论。

## 开发环境

- Java 21
- Node.js 22 或更高版本
- Rust stable
- Windows 构建需要 Visual Studio C++ Build Tools

后端验证：

```powershell
cd backend
./mvnw.cmd test
```

前端验证：

```powershell
cd frontend
npm ci
npm run lint
npm run build
```

## 分支与合并

- 功能分支使用 `feature/简短名称`
- 修复分支使用 `fix/简短名称`
- 通过 Pull Request 合并到 `main`
- PR 中说明修改内容、验证方式和隐私影响

## 数据安全要求

- 不得提交真实账号、密码、令牌、Cookie 或浏览器会话。
- 不得提交公司内网地址、内部页面选择器、项目映射和真实工作内容。
- 新连接器默认只采集元数据，正文采集必须由用户主动授权。
- 凭据必须进入操作系统凭据库，不得写入 SQLite、日志或分享码。
- 日志和诊断包必须在生成前完成敏感字段清理。

提交贡献即表示你同意按 Apache License 2.0 许可该贡献。
