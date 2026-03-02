// 快速检查 Firestore 三个文档的数据状态
// 用法: node check-backup.mjs
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { createInterface } from 'readline';

const firebaseConfig = {
  apiKey: "AIzaSyC0Mr8lOWSfJwmBq1ueLzXXCbSV0xWeklc",
  authDomain: "orynda-fe115-d25be.firebaseapp.com",
  projectId: "orynda-fe115-d25be",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function main() {
  const email = await ask('输入邮箱: ');
  const password = await ask('输入密码: ');
  rl.close();

  try {
    await signInWithEmailAndPassword(auth, email.trim(), password.trim());
    console.log('\n✅ 登录成功\n');
  } catch (e) {
    console.error('❌ 登录失败:', e.message);
    process.exit(1);
  }

  const appId = 'inventory-app';
  const docs = ['main', 'backup', 'backup_safe'];

  for (const name of docs) {
    console.log(`\n===== ${name} =====`);
    const ref = doc(db, 'inventory_apps', appId, 'shared', name);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      console.log('  ❌ 文档不存在');
      continue;
    }
    const d = snap.data();
    const items = d.items || [];
    const offItems = d.offlineInventoryItems || [];
    const offLogs = d.offlineInventoryLogs || [];
    const recipients = d.offlineRecipientDirectory || [];
    const approvals = d.deleteApprovals || [];
    console.log(`  ✅ 文档存在`);
    console.log(`  SKU (items):     ${items.length}`);
    console.log(`  线下库存品项:     ${offItems.length}`);
    console.log(`  出库日志:         ${offLogs.length}`);
    console.log(`  客户目录:         ${recipients.length}`);
    console.log(`  审批队列:         ${approvals.length}`);
    if (d.lastUpdated) console.log(`  最后更新:         ${d.lastUpdated}`);
    if (d._backup_meta) {
      const m = d._backup_meta;
      console.log(`  备份元数据:       时间=${m.timestamp || '?'} 用户=${m.userEmail || '?'} SKU=${m.skuCount ?? '?'}`);
    }
    // 列出 SKU 名称概要
    if (items.length > 0) {
      console.log(`  SKU 列表: ${items.map(s => s.name || s.id).join(', ')}`);
    }
  }
  process.exit(0);
}
main();
