# 技能系统说明文档

本系统旨在提供一个灵活、数据驱动的技能配置和执行框架。通过分离技能定义、效果和目标，可以轻松地创建新技能或修改现有技能，而无需更改核心服务器代码。

## 核心文件

技能系统主要由以下三个JSON文件驱动：

1.  `items.json`: 定义游戏中的所有物品，包括卡牌。卡牌通过 `skills` 数组关联一个或多个技能ID。
2.  `skills.json`: 定义技能的基本属性，包括触发时机、目标类型和具体效果。
3.  `skill_effects.json`: 定义可重用的技能效果及其参数。

---

## 配置流程

### 1. 定义技能效果 (`skill_effects.json`)

这是最基础的步骤。一个“效果”是技能执行的具体逻辑，例如“数值增益”或“吸取”。

-   `id`: 效果的唯一标识符。
-   `name`: 效果的名称。
-   `description`: 效果的简要描述。
-   `parameters`: 一个对象，用于解释 `num_1` 到 `num_4` 这四个通用参数在此效果中的具体作用。

**示例：**
```json
{
  "id": 1,
  "name": "数值增益",
  "description": "为目标卡牌提供数值增益。",
  "parameters": {
    "num_1": "数值增长量",
    "num_2": "作用方向数量 (1-4，0或4代表全部方向)",
    "num_3": "未使用",
    "num_4": "未使用"
  }
}
```

### 2. 创建技能 (`skills.json`)

一个“技能”将一个“效果”与触发条件、目标和具体参数相结合。

-   `id`: 技能的唯一标识符 (30000+)。
-   `name`: 技能的名称，如“鼓舞”。
-   `description`: 技能的详细描述，可以使用 `{num_1}` 等占位符。
-   `priority`: 技能执行的优先级（数字越小，优先级越高）。
-   `skillType`: 技能类型。
    -   `adjudicating` (裁定技能): 当拥有此技能的卡牌被翻面时，该技能将被移除。
    -   `locking` (锁定技能): 即使卡牌被翻面，该技能也不会被移除。
-   `trigger`: 技能的触发时机。当前支持：
    -   `onPlay`: 放置卡牌时触发。
    -   `onCapture`: 翻转敌方卡牌时触发。
    -   `onTurnEnd`: 回合结束时触发。
-   `targetType`: 技能的目标类型。当前支持：
    -   `self`: 技能拥有者自身。
    -   `adjacent_allies`: 所有相邻的我方卡牌。
    -   `adjacent_enemies`: 所有相邻的敌方卡牌。
    -   `random_enemy_on_board`: 棋盘上随机一个敌方单位。
    -   `all_enemies_on_board`: 棋盘上所有敌方单位。
    -   *(未来可扩展 `random_ally_hand`, `random_enemy_hand` 等)*
-   `effectId`: 关联到 `skill_effects.json` 中的效果 `id`。
-   `num_1`, `num_2`, `num_3`, `num_4`: 为该技能具体配置的参数值，其作用由关联的 `effect` 决定。

**示例：**
```json
{
  "id": 30001,
  "name": "鼓舞",
  "description": "放置时，使所有相邻的我方卡牌的四个方向数值都增加{num_1}。",
  "priority": 10,
  "skillType": "locking",
  "trigger": "onPlay",
  "targetType": "adjacent_allies",
  "effectId": 1,
  "num_1": 1,
  "num_2": 4,
  "num_3": 0,
  "num_4": 0
}
```
在这个例子中，“鼓舞”技能会在放置时(`onPlay`)触发，目标是相邻的我方卡牌(`adjacent_allies`)，应用ID为1的效果(`数值增益`)，增长量(`num_1`)为1，作用于所有4个方向(`num_2`)。

### 3. 将技能赋予卡牌 (`items.json`)

最后，在 `items.json` 中，将技能ID添加到卡牌的 `skills` 数组中。

**示例：**
```json
{
  "id": 20007,
  "type": "card",
  "name": "光明骑士",
  "attributes": {
    "skills": [30001]
  }
}
```

---

## 效果逻辑详解

-   **数值增益/减益 (ID: 1, 2)**:
    -   `num_1`: 变化的数值量。
    -   `num_2`: 作用范围。如果为 `0` 或 `4`，则影响目标卡牌的全部四个方向。否则，仅影响与技能释放者接触的方向。例如，如果技能来自上方卡牌，则只影响目标卡牌的 `up` 方向。
-   **远程翻转 (ID: 3)**:
    -   此技能会遍历由 `targetType` 指定的所有潜在目标。
    -   对每个潜在目标进行一次标准的对线数值比较。
    -   在所有比较胜出的目标中，**随机选择一个**进行翻转。如果没有任何目标比较胜出，则技能不发动。
-   **吸取 (ID: 4)**:
    -   此技能在 `onCapture` 时触发。
    -   它会找到被翻转卡牌数值**最高**的一个方向，并从中偷取 `num_1` 点数值。
    -   然后将偷取到的数值增加到技能拥有者卡牌数值**最低**的一个方向上。

---

## 扩展系统

### 添加新技能

要添加一个全新的技能，例如“**放置时，随机削弱场上一名敌人**”，流程如下：

1.  **检查效果是否存在**：我们需要一个“数值减益”的效果，查看 `skill_effects.json`，发现 `id` 为 `2` 的效果符合要求，可以直接重用。

2.  **创建新技能**：在 `skills.json` 中添加一个新的技能条目。
    -   `id`: 设定一个新的唯一ID，如 `30005`。
    -   `name`: "恐吓"。
    -   `description`: "放置时，随机使场上一名敌人的所有方向数值-{num_1}。"
    -   `priority`: 设定一个优先级，如 `11`。
    -   `skillType`: `adjudicating`。
    -   `trigger`: `onPlay` (放置时触发)。
    -   `targetType`: `random_enemy_on_board` (随机一个场上敌人)。这个目标类型在 `getTargets` 函数中已经实现。
    -   `effectId`: `2` (数值减益)。
    -   `num_1`: `1` (削弱1点)。
    -   `num_2`: `4` (作用于所有方向)。

    最终的技能定义如下：
    ```json
    {
      "id": 30005,
      "name": "恐吓",
      "description": "放置时，随机使场上一名敌人的所有方向数值-{num_1}。",
      "priority": 11,
      "skillType": "adjudicating",
      "trigger": "onPlay",
      "targetType": "random_enemy_on_board",
      "effectId": 2,
      "num_1": 1,
      "num_2": 4,
      "num_3": 0,
      "num_4": 0
    }
    ```

3.  **赋予卡牌**：将新的技能ID `30005` 添加到 `items.json` 中相应卡牌的 `skills` 数组。

通过遵循以上步骤，可以快速、安全地扩展游戏中的技能种类。
