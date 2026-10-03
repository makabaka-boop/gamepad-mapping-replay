# Gamepad Action Mapper

一个 TypeScript 游戏手柄逻辑动作映射示例：把最多 4 个浏览器 `Gamepad` 槽位的按钮和方向轴映射为命名动作，支持组合键、轴中心校准、死区、释放迟滞、事件录制、规范化导出和无设备单步回放。

## 快速开始

```bash
npm install
npm run dev      # 启动页面
npm test         # 运行测试
npm run build    # 类型检查并构建
```

## 配置结构

```json
{
  "axes": {
    "0:0": { "center": 0, "deadzone": 0.14, "releaseHysteresis": 0.06 }
  },
  "actions": [
    {
      "name": "jump",
      "bindings": [
        { "inputs": [{ "device": 0, "kind": "button", "index": 0 }] }
      ]
    },
    {
      "name": "runJump",
      "bindings": [
        {
          "priority": 10,
          "inputs": [
            { "device": 0, "kind": "button", "index": 0 },
            { "device": 0, "kind": "button", "index": 2 }
          ]
        }
      ]
    },
    {
      "name": "moveRight",
      "bindings": [
        { "device": 0, "kind": "axis", "index": 0, "direction": "positive" }
      ]
    }
  ]
}
```

- `device`：浏览器手柄槽位，范围 `0..3`。
- `priority`：数值越大优先级越高。组合键默认还会优先于较短绑定；相同输入竞争时只产生一个逻辑动作。
- `deadzone`：进入激活区的阈值。
- `releaseHysteresis`：激活后降低释放阈值，防止轴在临界值抖动时反复 down/up。该值必须小于死区。
- 运行时轴中心校准属于具体设备会话；断开、失焦或同索引出现另一设备时不会继承。

## 安全释放与设备会话

`GamepadActionPoller` 每次 `poll()` 从可注入的 `GamepadProvider` 读取快照，并在同一批次中解析：

1. 先根据断开事件、快照缺失或 `gamepadconnected` 事件关闭旧设备会话。
2. 旧设备占用的逻辑动作生成 `up`，再在需要时生成新设备的 `down`。
3. 页面 `blur` 后暂停读取真实输入并释放全部逻辑按下状态；重新聚焦后重新建立会话。
4. 只有逻辑选择结果变化才返回事件，未变化的轮询不产生日志。

## 录制与回放

录制日志为版本化、相对时间戳格式：

```json
{
  "version": 1,
  "entries": [
    { "type": "generation", "generation": 1, "reason": "recording", "t": 0, "config": {} },
    { "type": "action", "generation": 1, "t": 16, "action": "jump", "phase": "down" },
    { "type": "action", "generation": 1, "t": 82, "action": "jump", "phase": "up" }
  ]
}
```

- 开始录制会开启新日志代次。
- 应用配置会释放当前动作，并立即写入新的 `generation` 标记和规范化配置。
- `EventLogReplayer` 只依赖导出的 JSON；`step()` 可单步所有事件，`stepAction()` 可跳过代次标记单步动作。

## 主要模块

- `src/poller.ts`：轮询、设备会话、组合键竞争、安全释放和事件代次。
- `src/config.ts`：配置规范化、校验、轴阈值工具。
- `src/calibration.ts`：单设备轴中心校准会话。
- `src/recorder.ts`：运行时事件转换为规范化日志。
- `src/replayer.ts`：无真实手柄的单步回放。
- `src/browserProvider.ts`：浏览器 `navigator.getGamepads()` 和窗口事件适配器。
- `test/poller.test.ts`：轴抖动、组合键、断开重连、同索引替换、失焦及批次一致性测试。
