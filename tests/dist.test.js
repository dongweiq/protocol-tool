"use strict";
// 成品回归测试：打包后的单文件网页必须能通过语法检查（防止多个源码文件拼到一个 <script> 后出现同名声明冲突）
// 历史教训：v0.2 时 parser.js 与 codegen.js 都声明了顶层 const TYPE_SIZE，单文件在浏览器里会整页报错，而模块级测试发现不了。
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

execSync("python3 build.py", { cwd: path.join(__dirname, ".."), stdio: "pipe" });
const html = fs.readFileSync(path.join(__dirname, "..", "dist", "protocol-tool.html"), "utf-8");
let failed = 0;
function check(name, cond) { if (cond) console.log("  ✓ " + name); else { failed++; console.log("  ✗ " + name); } }

check("构建占位符已全部替换", !/__PARSER__|__CODEGEN__|__ENCODER__|__IMPORTER__|__XLSX__|__VALIDATE__|__CONFIG__/.test(html));
const m = html.match(/<script>([\s\S]*)<\/script>/);
check("能提取出内联脚本", !!m);
const tmp = "/tmp/protocol-tool-dist-check.js";
fs.writeFileSync(tmp, m[1]);
try { execSync(`node --check ${tmp}`, { stdio: "pipe" }); check("内联脚本语法检查通过（无同名声明冲突）", true); }
catch (e) { check("内联脚本语法检查通过（无同名声明冲突）：" + e.stderr.toString().split("\n")[0], false); }
check("页面包含 v0.4 全部功能块", ["btnCsvImport", "btnXlsxImport", "xlsxFile", "btnBuild", "btnSendSerial", "btnSendBle", "sendCmd"].every(id => html.includes(id)));

console.log(failed ? `\n结果：${failed} 失败` : "\n全部 dist 测试通过");
process.exit(failed ? 1 : 0);
