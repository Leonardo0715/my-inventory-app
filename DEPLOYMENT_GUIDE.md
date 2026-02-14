# 📚 项目部署与配置完整指南

## 🚀 快速开始（3分钟）

### 1. 配置 Firebase 环境变量

#### A. 获取 Firebase 配置信息

1. 访问 [Firebase Console](https://console.firebase.google.com/)
2. 选择您的项目（若无项目，需要先创建一个）
3. 点击左侧 **"Project Settings"**（齿轮图标）
4. 在 "Your apps" 部分找您的 **Web 应用**，如果没有点 **"Add app"** → 选择 **Web**
5. 复制显示的配置对象，应该如下所示：

```javascript
const firebaseConfig = {
  apiKey: "AIzaS...",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef..."
};
```

#### B. 填写 .env.local 文件

在项目根目录创建 `.env.local` 文件（没有 .env 的情况下）：

```plaintext
VITE_FIREBASE_API_KEY=AIzaS...
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef...
VITE_APP_ID=inventory-app
```

### 2. 检查 Firebase 配置

在 Firebase Console 中验证：

- ☑️ **Firestore Database** 已创建
  - 如未创建：Firestore Database → 点击 **"Create database"**
  
- ☑️ **Authentication - Anonymous** 已启用
  - Authentication → Sign-in method → 启用 **"Anonymous"**

### 3. 配置 Firestore 安全规则

在 Firebase Console 中：

1. 打开 **Firestore Database**
2. 点击上方 **"RULES"** 标签
3. 点击 **"Edit Rules"**
4. 粘贴以下规则：

**（开发模式 - 允许所有读写）**
```plaintext
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

或 **（生产模式 - 仅认证用户可访问）**
```plaintext
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /inventory_apps/{appId}/shared/{document} {
      allow read, write: if request.auth != null;
    }
  }
}
```

5. 点击 **"Publish"** 发布规则

### 4. 启动应用

```bash
# 安装依赖（第一次）
npm install

# 启动开发服务器
npm run dev
```

打开浏览器访问 [http://localhost:5173](http://localhost:5173)

---

## ✅ 验证多人同步

### 测试步骤

1. **打开两个浏览器标签**
   - 标签 1：http://localhost:5173
   - 标签 2：http://localhost:5173

2. **在标签 1 中修改数据**
   - 修改库存数量
   - 添加采购单

3. **观察标签 2**
   - 应在 1-2 秒内自动更新
   - 右上角显示 "✅ 云端同步已启用（多人共享）"

4. **检查浏览器控制台日志**（F12 → Console）
   - 应看到 "✅ 云端数据同步成功" 消息

---

## 🔍 故障排除

### 问题 1：数据无法同步

**症状：** 修改数据后，其他浏览器标签无法看到更新

**解决方案：**

```javascript
// 在浏览器控制台（F12）执行以下命令检查配置
console.log({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN
})
```

如果任何值为 `undefined`，检查 `.env.local` 文件是否正确。

### 问题 2：Firestore 权限错误

**症状：** 控制台出现 `Permission denied` 错误

**解决方案：**

1. 确认 Firestore 安全规则已更新为允许读写
2. 确认 Authentication 中的 "Anonymous" 已启用
3. 刷新页面重试

### 问题 3：应用加载速度慢

**症状：** 应用长时间显示 "加载记忆数据..."

**原因：** Firebase 初始化延迟

**解决方案：**

- 检查网络连接
- 检查 Firebase 项目是否响应正常
- 查看浏览器控制台是否有其他错误

---

## 📊 架构说明

### 数据流向

```
User Input (修改库存/采购单)
    ↓
React State (内存状态)
    ↓
localStorage（300ms防抖）← 本地备份
    ↓
Firestore（1000ms防抖）← 云端同步
    ↓
Real-time Listener（onSnapshot）
    ↓
All Connected Clients（所有连接客户端）
```

### 同步状态指示

- ✅ **云端同步已启用** - 连接正常，数据实时同步
- ⏳ **正在同步中** - 数据正在上传到云端
- ⚠️ **云端连接异常** - 使用本地数据，连接恢复后自动同步

---

## 🛡️ 安全注意事项

### ⚠️ 开发模式规则风险

开发模式规则（允许所有读写）仅在本地开发时使用。

**生产部署前：**
1. 更新为生产安全规则
2. 添加数据验证和访问控制
3. 定期备份 Firestore 数据

### 敏感信息保护

- API Key 等敏感信息已通过 `.env.local` 隐藏
- 浏览器环境仍能访问配置（客户端应用属性）
- 依赖 Firestore 安全规则进行数据保护

---

## 📦 生产部署

### 构建应用

```bash
npm run build
```

输出在 `dist/` 目录下

### 部署选项

#### 选项 1：Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

#### 选项 2：其他平台

- Vercel
- Netlify
- GitHub Pages
- 自己的服务器

---

## 📞 获取帮助

查看以下资源：

- [Firebase 文档](https://firebase.google.com/docs)
- [Firestore 安全规则指南](https://firebase.google.com/docs/firestore/security/start)
- [项目 GitHub Issues](https://github.com/your-repo)
