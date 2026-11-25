# 协议解析工具（Protocol Tool）

配置驱动的串口 / 蓝牙私有协议解析工具，面向硬件团队的联调场景。

## 它解决什么问题

每家硬件公司的串口、蓝牙协议都是自定的：帧格式不同，每个字节的含义不同。
App、固件、测试三边往往各写一遍解析代码，协议一改就对不上，联调大量时间花在扯皮上。

这个工具的思路是：**不统一协议内容，只统一描述协议的方法。**
协议只在一份配置文件里定义一次，其余的都从它生成：

- 实时解析：原始帧按配置拆成带单位的字段，校验失败、帧头错误当场标出
- 一处配置，多处生成：同一份配置生成 **JS / Python / C 三端解析代码** 和一份 **Markdown 协议文档**，改协议后重新生成，三端永远一致（已做三端一致性自动化验证）
- 协议库：调好的配置起名字、写版本备注保存，团队成员一键切换到同一份协议
- 录制 / 回放：联调过程全程录制，回去重放复现问题
- 模拟设备：没有硬件在手边时，按配置自动生成数据帧跑通全流程

数据只在本地浏览器处理，不经过任何服务器，适合私有协议。

## 快速开始

不需要安装、不需要服务器：

1. 用电脑版 Chrome 打开 `dist/protocol-tool.html`（单文件，含全部功能）
2. 页面会自动解析一帧演示数据；点“开始模拟设备发送”可以看实时解析
3. 在第 5 块粘贴或修改协议配置（JSON），点“应用配置”立即生效
4. 在第 6 块生成你需要的代码或文档，下载使用
5. 真机调试：点“连接串口”或“连接蓝牙 BLE”（需要 Chrome 授权选择设备）

## 配置格式

见 [docs/config-format-v1.md](docs/config-format-v1.md)。
字段模型借鉴 cantools 的 signal 定义（大小端、倍率、偏移、单位、枚举、位定义），
按命令字分支借鉴 Kaitai Struct 的 switch-on 思路，引擎为原创实现。

示例配置：[examples/robot-status.json](examples/robot-status.json)

## 开发与测试

```bash
# 解析引擎测试（6 个用例）
node tests/parser.test.js

# 代码生成三端一致性测试（JS / Python / C 解析同一帧结果一致）
node tests/codegen.test.js

# 重新打包单文件网页版
python3 build.py   # 产物在 dist/protocol-tool.html
```

## 目录结构

- `src/parser.js` 协议解析引擎（浏览器与 Node 通用）
- `src/codegen.js` 代码与文档生成器（JS / Python / C / Markdown）
- `web/template.html` 网页界面模板
- `examples/` 示例协议配置
- `tests/` 自动化测试
- `dist/` 打包好的单文件成品

## 版本

- v0.2 团队版：一处配置生成三端代码 + 协议文档；协议库（多配置保存 / 切换 / 版本备注）
- v0.1 自用版：配置驱动解析、模拟发送、录制回放、Web Serial / Web Bluetooth 连接

## License

MIT
