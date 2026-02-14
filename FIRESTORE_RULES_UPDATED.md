# 🔧 Firestore 安全规则 - 更新版本

如果数据仍然无法同步，**请尝试以下规则**（比之前更宽松）：

## 方案 A：完全开放（仅用于开发测试）

⚠️ **重要：** 此规则允许任何人读写所有数据，仅用于开发！

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

## 方案 B：允许认证用户访问（生产推荐）

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

## 方案 C：允许匿名用户访问（当前应用使用）

```plaintext
rules_version = '2';
service cloud.firestore {  
  match /databases/{database}/documents {
    match /inventory_apps/{appId}/shared/{document} {
      allow read, write: if request.auth.uid != null;
    }
  }
}
```

---

## 更新方式

1. 打开 [Firebase Console](https://console.firebase.google.com/)
2. 选择项目 **"orynda-fe115"**
3. 点击 **"Firestore Database"**
4. 점击 **"Rules"** 标签
5. 点击 **"Edit Rules"**
6. 清空现有内容
7. **粘贴上面某个方案的规则代码**
8. 点击 **"Publish"** 发布

---

## 诊断步骤

如果规则更新后仍然无法同步，请在浏览器 **F12 → Console** 中执行以下命令：

```javascript
// 检查是否有 Firebase 初始化错误
console.log(import.meta.env.VITE_FIREBASE_PROJECT_ID);
// 应该输出: orynda-fe115

// 检查是否有 onSnapshot 订阅错误
// （观察 Console 中是否有红色错误）
```

---

## 常见错误和解决方案

| 错误 | 原因 | 解决方案 |
|-----|------|----------|
| `Permission denied` | 安全规则拒绝访问 | 更新安全规则（使用方案 A 或 B） |
| `PERMISSION_DENIED` | 缺少认证或权限不足 | 确保 Anonymous Auth 已启用 |
| `UNAUTHENTICATED` | 用户未认证 | 等待 1-2 秒让匿名认证完成 |
| 静默失败（无错误，但无数据） | 路径或权限配置问题 | 检查 Firestore 实例中是否有 `inventory_apps` 集合 |

---

## 快速测试

1. 打开浏览器 F12 → Console
2. 修改一个输入框（如库存数量）
3. 立即查看 Console 是否有错误消息
4. 如有错误，复制错误信息进行诊断
