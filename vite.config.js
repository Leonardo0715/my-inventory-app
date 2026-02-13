import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // �̶��˿ڣ�����˿ڱ仯���� localStorage�������������ݡ�
    port: 5173,
    strictPort: true,
  },
})
