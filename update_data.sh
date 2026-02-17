#!/bin/bash

echo "🚀 开始更新 Antigravity 应用数据..."
echo "📅 $(date)"

# 检查 node 是否安装
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js。请先安装 Node.js"
    exit 1
fi

# 运行采集脚本
node scripts/fetch-data.js

if [ $? -eq 0 ]; then
    echo "✅ 数据更新成功！刷新网页即可查看。"
else
    echo "❌ 数据更新失败，请检查上方错误信息。"
fi
