import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css' // 导入全局样式（Tailwind CSS）
import 'reactflow/dist/style.css' // React Flow 基础样式
import App from './App.tsx' // 导入主应用组件

/**
 * 应用入口文件
 * 负责将 React 应用渲染到 DOM 中
 */

// 获取 DOM 中的 root 元素（在 index.html 中定义）
const rootElement = document.getElementById('root')

// 确保 root 元素存在
if (!rootElement) {
  throw new Error('Root element not found in index.html')
}

// 创建 React 根节点并渲染应用
// StrictMode 用于检测潜在问题并提供警告
createRoot(rootElement).render(
  <StrictMode>
    <App /> {/* 渲染主应用组件 */}
  </StrictMode>,
)
