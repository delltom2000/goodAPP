# 结构与维护

项目无后端、无 npm 依赖。`dist/` 即网页源码与可运行目录。

| 文件 | 职责 |
| --- | --- |
| `dist/index.html` / `style.css` | 工作台布局和响应式样式 |
| `dist/app.js` | 初版 UI、种子题及本地存储状态 |
| `dist/exam-engine.js` | 不依赖 DOM 的组卷、文本归一化与判分 |
| `dist/upgrade.js` | 扩展题库加载、题库分页、练习会话和路由 |
| `android/app/src/main/java/com/jianjin/ielts/MainActivity.java` | 离线 WebView、导航限制及系统 TTS 桥接 |

脚本加载顺序为 `app.js` → `exam-engine.js` → `upgrade.js`。后者覆盖初版同名函数；维护时应检查实际生效函数。未来可合并为模块化实现，但目前保持原型兼容结构。

## 状态

`localStorage` 的 `jianjin-ielts-v1` 保存目标、作答历史、已学知识、试卷题号、草稿和结果摘要。题库本身从 JSON 加载，不写入 localStorage。

`quiz` 仅保存当前内存会话，包含题目、题号、选择/文本、已提交答案和截止时间。`#practice` 是作答路由；其他页面照常渲染并显示继续入口。计时基于绝对截止时间，切页不暂停。后台到时交卷不会抢占用户当前页面。

当前没有登录、数据库、服务端持久化、跨设备同步或未交卷会话恢复。浏览器存储容量不足时会提示保存失败；正式规模使用应迁移 IndexedDB 或受控后端。

## 测试

在 `apps/studyen` 执行：

```sh
node scripts/test-engine.cjs
node scripts/test-navigation.cjs
```

前者覆盖题库结构、答案格式、100 套组卷、全科 85 项配比与异常处理；后者覆盖七个页面切换、未提交输入保留、重开练习确认、后台交卷与安卓返回逻辑。

UI 仍需实际浏览器验证；安卓壳须在真机检查。构建时自动复制网页资源，避免手工维护两份前端代码。

## 后续方向

先完善内容审核、真实听力资源和四科标准流程，再增加用户账户、同步 API、录音/转写与经校准的写作口语评分。不要在前端放入模型服务或云端 API 私钥。
