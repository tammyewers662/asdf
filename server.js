const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 3000;
const dbPath = './users.json';
const itemsDbPath = './items.json';
const skillsDbPath = './skills.json';
const skillEffectsDbPath = './skill_effects.json';
const globalsDbPath = './globals.json';

// 技能效果定义
let skillEffectDefinitions = {};
try {
    if (fs.existsSync(skillEffectsDbPath)) {
        const data = fs.readFileSync(skillEffectsDbPath, 'utf8');
        skillEffectDefinitions = JSON.parse(data).skill_effects.reduce((acc, effect) => {
            acc[effect.id] = effect;
            return acc;
        }, {});
    } else {
        console.error('技能效果定义文件 skill_effects.json 未找到。');
    }
} catch (err) {
    console.error('读取技能效果定义文件时出错:', err);
}

// 全局配置
let globals = {};
try {
    if (fs.existsSync(globalsDbPath)) {
        const data = fs.readFileSync(globalsDbPath, 'utf8');
        globals = JSON.parse(data).globals.reduce((acc, global) => {
            acc[global.id] = global;
            return acc;
        }, {});
    } else {
        console.error('全局配置文件 globals.json 未找到。');
    }
} catch (err) {
    console.error('读取全局配置文件时出错:', err);
}

// 技能定义
let skillDefinitions = {};
try {
    if (fs.existsSync(skillsDbPath)) {
        const data = fs.readFileSync(skillsDbPath, 'utf8');
        skillDefinitions = JSON.parse(data).skills.reduce((acc, skill) => {
            acc[skill.id] = skill;
            return acc;
        }, {});
    } else {
        console.error('技能定义文件 skills.json 未找到。');
    }
} catch (err) {
    console.error('读取技能定义文件时出错:', err);
}

// 游戏物品定义
let itemDefinitions = {};
try {
    if (fs.existsSync(itemsDbPath)) {
        const data = fs.readFileSync(itemsDbPath, 'utf8');
        itemDefinitions = JSON.parse(data).items.reduce((acc, item) => {
            acc[item.id] = item;
            return acc;
        }, {});
    } else {
        console.error('物品定义文件 items.json 未找到。');
    }
} catch (err) {
    console.error('读取物品定义文件时出错:', err);
}

// 用户数据存储
let users = [];
try {
    if (fs.existsSync(dbPath)) {
        const data = fs.readFileSync(dbPath, 'utf8');
        users = JSON.parse(data);
    } else {
        fs.writeFileSync(dbPath, '[]', 'utf8');
    }
} catch (err) {
    console.error('读取或创建数据库文件时出错:', err);
    users = [];
}

// 游戏房间数据（内存存储）
let rooms = {}; // 使用对象存储，以房间ID为键
let waitingPlayer = null;

app.use(cors());
app.use(bodyParser.json());

function saveUsers() {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(users, null, 2), 'utf8');
    } catch (err) {
        console.error('写入数据库文件时出错:', err);
    }
}

app.get('/', (req, res) => {
    console.log('客户端已连接到服务器。');
    res.status(200).json({ success: true, message: '服务器正在运行。' });
});

app.get('/game_data', (req, res) => {
    try {
        // 将所有定义文件组合成一个对象发送给客户端
        res.status(200).json({
            success: true,
            items: itemDefinitions,
            skills: skillDefinitions,
            skillEffects: skillEffectDefinitions,
            globals: globals
        });
    } catch (error) {
        res.status(500).json({ success: false, message: '获取游戏数据时出错。' });
    }
});

app.post('/register', (req, res) => {
    const { account, password } = req.body;
    if (!account || !password) return res.status(400).json({ success: false, message: '账号和密码是必需的。' });
    if (users.find(user => user.account === account)) return res.status(400).json({ success: false, message: '账号已存在。' });
    
    const defaultSettings = globals[1] || { defaultCards: [], defaultDeck: [] };
    const newUser = {
        account,
        password,
        inventory: {
            gold: 100,
            diamond: 10,
            cards: defaultSettings.defaultCards, // 玩家拥有的所有卡牌
            deck: defaultSettings.defaultDeck    // 玩家当前的出战卡组
        }
    };
    users.push(newUser);
    saveUsers();
    console.log('新用户已注册。用户总数:', users.length);
    res.status(200).json({ success: true, message: '注册成功。' });
});

app.post('/login', (req, res) => {
    const { account, password } = req.body;
    if (!account || !password) return res.status(400).json({ success: false, message: '账号和密码是必需的。' });
    
    const user = users.find(user => user.account === account && user.password === password);
    if (user) {
        user.token = uuidv4(); // 生成并保存token
        saveUsers();
        res.status(200).json({ 
            success: true, 
            message: '登录成功。', 
            token: user.token, 
            account: user.account,
            inventory: user.inventory // 返回背包信息
        });
    } else {
        res.status(401).json({ success: false, message: '无效的账号或密码。' });
    }
});

app.post('/login_with_token', (req, res) => {
    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ success: false, message: 'Token是必需的。' });
    }

    try {
        const data = fs.readFileSync(dbPath, 'utf8');
        const usersFromFile = JSON.parse(data);
        const user = usersFromFile.find(u => u.token === token);
        if (user) {
            // 验证成功，返回用户信息
            res.status(200).json({ success: true, message: '自动登录成功。', account: user.account });
        } else {
            // token无效
            res.status(401).json({ success: false, message: '无效的Token。' });
        }
    } catch (err) {
        console.error('读取数据库文件时出错:', err);
        res.status(500).json({ success: false, message: '服务器内部错误。' });
    }
});

/**
 * @brief 根据玩家的出战卡组生成手牌。
 * @param {string} account - 玩家账号。
 * @returns {Array} 包含卡组中所有卡牌的数组，如果玩家卡组为空则返回空数组。
 */
function generateHand(account) {
    const user = users.find(u => u.account === account);
    if (!user || !user.inventory || !user.inventory.deck || user.inventory.deck.length === 0) {
        console.error(`玩家 ${account} 的出战卡组为空，无法开始游戏。`);
        return []; // 卡组不合规
    }

    // 直接使用玩家的出战卡组作为手牌
    const selectedIds = user.inventory.deck;

    const hand = selectedIds.map(cardId => {
        const cardDef = itemDefinitions[cardId];
        if (!cardDef) {
            console.error(`未找到ID为 ${cardId} 的卡牌定义。`);
            return null;
        }
        return {
            ...cardDef.attributes,
            id: uuidv4(), // 为每张卡牌实例添加唯一ID
            defId: cardId // 保留定义ID
        };
    }).filter(Boolean); // 过滤掉未找到的卡牌

    return hand;
}

/**
 * @route POST /match
 * @brief 玩家匹配路由。
 */
app.post('/match', (req, res) => {
    const { playerInfo } = req.body;
    if (!playerInfo) {
        return res.status(400).json({ success: false, message: '玩家信息不存在。' });
    }

    // 寻找一个未满的房间
    let roomToJoin = Object.values(rooms).find(r => r.players.length < 2);

    if (roomToJoin) {
        // 加入现有房间
        roomToJoin.players.push(playerInfo);
        const player1Account = roomToJoin.players[0].account;
        const player2Account = roomToJoin.players[1].account;
        roomToJoin.hands = {
            [player1Account]: generateHand(player1Account),
            [player2Account]: generateHand(player2Account),
        };
        // 随机决定先手玩家
        roomToJoin.turn = roomToJoin.players[Math.floor(Math.random() * roomToJoin.players.length)].account;
        console.log(`玩家 ${playerInfo.account} 加入房间 ${roomToJoin.id}。房间已满，开始游戏。先手玩家是: ${roomToJoin.turn}`);
        res.status(200).json({ success: true, roomInfo: roomToJoin });
    } else {
        // 创建新房间
        const roomId = uuidv4();
        const newRoom = {
            id: roomId,
            players: [playerInfo],
            hands: {}, // 等待第二个玩家加入
            board: Array(9).fill(null), // 9个格子，初始为空
            turn: null, // 当前回合的玩家
            events: [] // 用于记录本回合发生的事件
        };
        rooms[roomId] = newRoom;
        console.log(`没有空余房间，为玩家 ${playerInfo.account} 创建新房间 ${roomId}。`);
        res.status(200).json({ success: true, roomInfo: newRoom });
    }
});

/**
 * @route GET /room_status/:roomId
 * @brief 客户端轮询房间状态。
 */
app.get('/room_status/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = rooms[roomId];
    if (room) {
        res.status(200).json({ success: true, roomInfo: room });
    } else {
        res.status(404).json({ success: false, message: '房间不存在。' });
    }
});

/**
 * @route POST /play
 * @brief 玩家放置卡牌路由。
 */
app.post('/play', (req, res) => {
    try {
        const { roomId, player, card, gridIndex } = req.body;
        if (!roomId || !player || !card || card.id === undefined || gridIndex === undefined) {
            return res.status(400).json({ success: false, message: '缺少必要的游戏数据。' });
        }

        const room = rooms[roomId];
        if (!room) {
            return res.status(404).json({ success: false, message: '房间不存在。' });
        }

        // 检查是否是当前玩家的回合
        if (room.turn !== player.account) {
            return res.status(403).json({ success: false, message: '现在不是你的回合。' });
        }

        if (room.board[gridIndex]) {
            return res.status(400).json({ success: false, message: '该位置已被占据。' });
        }

        // 从手牌中移除打出的牌
        const playerHand = room.hands[player.account];
        const cardIndex = playerHand.findIndex(c => c.id === card.id);
        if (cardIndex > -1) {
            playerHand.splice(cardIndex, 1);
        } else {
            return res.status(400).json({ success: false, message: '玩家没有这张手牌。' });
        }

        // 放置卡牌
        room.board[gridIndex] = { player, card };
        console.log(`玩家 ${player.account} 在房间 ${roomId} 的格子 ${gridIndex} 放置了卡牌。`);

        // 1. 触发“放置后释放”技能
        triggerSkills(room, player, 'onPlay', { placedIndex: gridIndex });

        // 2. 应用战斗逻辑，其中可能触发“翻转敌卡时释放”技能
        applyBattleLogic(room, player, gridIndex);

        // 3. 触发“回合结束时释放”技能
        triggerSkills(room, player, 'onTurnEnd');

        // 4. 切换回合
        const nextPlayerIndex = room.players.findIndex(p => p.account !== player.account);
        if (nextPlayerIndex !== -1) {
            room.turn = room.players[nextPlayerIndex].account;
            console.log(`回合结束，轮到玩家 ${room.turn}。`);
        }

        // 5. 发送响应并清空当回合事件
        res.status(200).json({ success: true, roomInfo: room });
        room.events = [];
    } catch (error) {
        console.error('!!! SERVER CRASH IN /play ROUTE !!!', error);
        res.status(500).json({
            success: false,
            message: '服务器在处理出牌时发生内部错误。',
            error: error.toString(),
            stack: error.stack // 将详细的错误堆栈发送给客户端
        });
    }
});

/**
 * @brief 应用战斗逻辑，翻转卡牌。
 * @param {Array} board 棋盘数组。
 * @param {Object} currentPlayer 当前玩家。
 * @param {number} placedIndex 放置的索引。
 */
function applyBattleLogic(room, currentPlayer, placedIndex) {
    const board = room.board;
    const placedCard = board[placedIndex].card;

    // 检查放置的卡牌是否能攻击
    if (placedCard.canAttack !== 1) {
        console.log(`卡牌 ${itemDefinitions[placedCard.defId].name} (ID: ${placedCard.id}) 不能攻击。`);
        return;
    }

    // 如果卡牌拥有“射击”技能(ID: 30003)，则跳过常规的邻近战斗逻辑
    if (placedCard.skills && placedCard.skills.includes(30003)) {
        console.log(`卡牌 ${itemDefinitions[placedCard.defId].name} 拥有射击技能，跳过常规战斗。`);
        return;
    }

    const directions = [
        { offset: -3, dir: 'up', oppositeDir: 'down' },   // 上
        { offset: 3,  dir: 'down', oppositeDir: 'up' },     // 下
        { offset: -1, dir: 'left', oppositeDir: 'right' },  // 左
        { offset: 1,  dir: 'right', oppositeDir: 'left' }   // 右
    ];

    for (const d of directions) {
        const neighborIndex = placedIndex + d.offset;

        // 边界检查
        if (neighborIndex < 0 || neighborIndex >= 9) continue;
        // 左右换行检查
        if ((d.dir === 'left' && placedIndex % 3 === 0) || (d.dir === 'right' && placedIndex % 3 === 2)) continue;

        const neighborCell = board[neighborIndex];
        if (neighborCell && neighborCell.player.account !== currentPlayer.account) {
            if (placedCard[d.dir] > neighborCell.card[d.oppositeDir]) {
                console.log(`卡牌在 ${neighborIndex} 被翻转!`);
                const originalOwner = neighborCell.player;
                neighborCell.player = { ...currentPlayer }; // 翻转！

                // 新增逻辑：移除被翻转卡牌的“裁定技能”
                const flippedCard = neighborCell.card;
                if (flippedCard.skills && flippedCard.skills.length > 0) {
                    const initialSkillCount = flippedCard.skills.length;
                    flippedCard.skills = flippedCard.skills.filter(skillId => {
                        const skillDef = skillDefinitions[skillId];
                        // 如果技能未定义或类型不是 'adjudicating'，则保留
                        return !skillDef || skillDef.skillType !== 'adjudicating';
                    });
                    if (flippedCard.skills.length < initialSkillCount) {
                        console.log(`卡牌 ${itemDefinitions[flippedCard.defId].name} 的裁定技能已被移除。`);
                    }
                }

                // 触发“翻转敌卡时释放”技能
                triggerSkills(room, currentPlayer, 'onCapture', {
                    capturingCard: placedCard,
                    capturedCard: neighborCell.card,
                    originalOwner: originalOwner,
                    capturingCardIndex: placedIndex // 修复：传递触发技能的卡牌的索引
                });
            }
        }
    }
}

/**
 * @brief 触发指定类型的技能。
 * @param {Object} room 房间对象。
 * @param {Object} currentPlayer 当前玩家。
 * @param {string} triggerType 触发类型 ('onPlay', 'onCapture', 'onTurnEnd')。
 * @param {Object} context 技能上下文，包含额外信息。
 */
function triggerSkills(room, currentPlayer, triggerType, context = {}) {
    console.log(`--- 开始结算 ${triggerType} 类技能 ---`);
    const board = room.board;
    let skillsToProcess = [];

    if (triggerType === 'onPlay') {
        const placedCard = board[context.placedIndex].card;
        if (placedCard.skills) {
            placedCard.skills.forEach(skillId => {
                skillsToProcess.push({ skillId, card: placedCard, cardIndex: context.placedIndex });
            });
        }
    } else if (triggerType === 'onCapture') {
        const capturingCard = context.capturingCard;
        if (capturingCard.skills) {
            capturingCard.skills.forEach(skillId => {
                // 修复：将卡牌索引也添加到处理队列中
                skillsToProcess.push({ skillId, card: capturingCard, cardIndex: context.capturingCardIndex, context });
            });
        }
    } else if (triggerType === 'onTurnEnd') {
        board.forEach((cell, index) => {
            if (cell && cell.player.account === currentPlayer.account && cell.card.skills) {
                cell.card.skills.forEach(skillId => {
                    skillsToProcess.push({ skillId, card: cell.card, cardIndex: index });
                });
            }
        });
    }

    // 过滤并排序
    const sortedSkills = skillsToProcess
        .map(item => ({ ...item, def: skillDefinitions[item.skillId] }))
        .filter(item => item.def && item.def.trigger === triggerType)
        .sort((a, b) => a.def.priority - b.def.priority);

    if (sortedSkills.length === 0) {
        console.log(`没有 ${triggerType} 类技能需要结算。`);
        return;
    }

    // 依次执行技能
    sortedSkills.forEach(({ def, card, cardIndex, context }) => {
        console.log(`卡牌 ${itemDefinitions[card.defId].name} 触发技能【${def.name}】(优先级: ${def.priority})！`);
        applySingleSkillEffect(room, currentPlayer, def, card, cardIndex, context);
    });
    console.log(`--- ${triggerType} 类技能结算完毕 ---`);
}

/**
 * @brief 根据目标类型获取技能目标。
 * @param {Object} room - 房间对象。
 * @param {Object} currentPlayer - 当前玩家。
 * @param {string} targetType - 目标类型。
 * @param {number} ownerCardIndex - 技能拥有者卡牌在棋盘上的索引。
 * @returns {Array} 目标对象数组，每个对象包含 card 和 index。
 */
function getTargets(room, currentPlayer, targetType, ownerCardIndex) {
    const board = room.board;
    const targets = [];
    const directions = [
        { offset: -3, dir: 'up', oppositeDir: 'down' },
        { offset: 3,  dir: 'down', oppositeDir: 'up' },
        { offset: -1, dir: 'left', oppositeDir: 'right' },
        { offset: 1,  dir: 'right', oppositeDir: 'left' }
    ];

    switch (targetType) {
        case 'self':
            if (board[ownerCardIndex]) {
                targets.push({ card: board[ownerCardIndex].card, index: ownerCardIndex, direction: null });
            }
            break;
        case 'adjacent_allies':
        case 'adjacent_enemies':
            for (const d of directions) {
                const neighborIndex = ownerCardIndex + d.offset;
                if (neighborIndex < 0 || neighborIndex >= 9) continue;
                if ((d.dir === 'left' && ownerCardIndex % 3 === 0) || (d.dir === 'right' && ownerCardIndex % 3 === 2)) continue;
                
                const neighborCell = board[neighborIndex];
                if (neighborCell) {
                    const isAlly = neighborCell.player.account === currentPlayer.account;
                    if ((targetType === 'adjacent_allies' && isAlly) || (targetType === 'adjacent_enemies' && !isAlly)) {
                        targets.push({ card: neighborCell.card, index: neighborIndex, direction: d });
                    }
                }
            }
            break;
        case 'random_enemy_on_board':
            const enemyCards = [];
            board.forEach((cell, index) => {
                if (cell && cell.player.account !== currentPlayer.account) {
                    enemyCards.push({ card: cell.card, index: index, direction: null });
                }
            });
            if (enemyCards.length > 0) {
                const randomIndex = Math.floor(Math.random() * enemyCards.length);
                targets.push(enemyCards[randomIndex]);
            }
            break;
        case 'all_enemies_on_board':
            board.forEach((cell, index) => {
                if (cell && cell.player.account !== currentPlayer.account) {
                    targets.push({ card: cell.card, index: index, direction: null });
                }
            });
            break;
        // TODO: 实现其他目标类型，如 'random_ally_hand', 'random_enemy_hand' 等
    }
    return targets;
}

/**
 * @brief 应用单个技能的具体效果。
 * @param {Object} room 房间对象。
 * @param {Object} currentPlayer 当前玩家。
 * @param {Object} skillDef 技能定义。
 * @param {Object} skillOwnerCard 技能拥有者卡牌。
 * @param {number} ownerCardIndex 技能拥有者卡牌在棋盘上的索引。
 * @param {Object} context 技能上下文。
 */
function applySingleSkillEffect(room, currentPlayer, skillDef, skillOwnerCard, ownerCardIndex, context) {
    let targets = getTargets(room, currentPlayer, skillDef.targetType, ownerCardIndex);

    // 特殊处理 "远程翻转" 技能
    if (skillDef.effectId === 3) {
        const potentialTargets = [];
        targets.forEach(target => {
            const { card: targetCard, index: targetIndex } = target;
            const ownerRow = Math.floor(ownerCardIndex / 3);
            const ownerCol = ownerCardIndex % 3;
            const targetRow = Math.floor(targetIndex / 3);
            const targetCol = targetIndex % 3;

            let comparisonDir = null;
            if (targetRow > ownerRow) { comparisonDir = { owner: 'down', target: 'up' }; }
            else if (targetRow < ownerRow) { comparisonDir = { owner: 'up', target: 'down' }; }
            else if (targetCol > ownerCol) { comparisonDir = { owner: 'right', target: 'left' }; }
            else if (targetCol < ownerCol) { comparisonDir = { owner: 'left', target: 'right' }; }

            if (comparisonDir && skillOwnerCard[comparisonDir.owner] > targetCard[comparisonDir.target]) {
                potentialTargets.push(target);
            }
        });

        // 从所有可以成功翻转的目标中随机选一个
        if (potentialTargets.length > 0) {
            const randomIndex = Math.floor(Math.random() * potentialTargets.length);
            targets = [potentialTargets[randomIndex]]; // 将目标列表缩减为这一个
        } else {
            targets = []; // 没有可以攻击的目标
        }
    }

    targets.forEach(target => {
        const { card: targetCard, index: targetIndex, direction } = target;
        const originalValues = { ...targetCard }; // 记录原始值

        switch (skillDef.effectId) {
            case 1: // 数值增益
                const directionsToBuff = (skillDef.num_2 === 0 || skillDef.num_2 === 4) ? ['up', 'down', 'left', 'right'] : [direction.oppositeDir];
                directionsToBuff.forEach(dir => {
                    targetCard[dir] = Math.min(20, targetCard[dir] + skillDef.num_1);
                });
                console.log(`【数值增益】效果：位置 ${targetIndex} 的卡牌 ${directionsToBuff.join(',')} 方向数值+${skillDef.num_1}`);
                break;

            case 2: // 数值减益
                const directionsToDebuff = (skillDef.num_2 === 0 || skillDef.num_2 === 4) ? ['up', 'down', 'left', 'right'] : [direction.oppositeDir];
                directionsToDebuff.forEach(dir => {
                    targetCard[dir] = Math.max(0, targetCard[dir] - skillDef.num_1);
                });
                console.log(`【数值减益】效果：位置 ${targetIndex} 的卡牌 ${directionsToDebuff.join(',')} 方向数值-${skillDef.num_1}`);
                break;

            case 3: // 远程翻转 (实际翻转逻辑)
                // 此时的 target 已经是经过筛选的唯一目标
                const originalOwner = room.board[targetIndex].player;
                room.board[targetIndex].player = { ...currentPlayer }; // 翻转！
                console.log(`【远程翻转】效果：位置 ${ownerCardIndex} 的卡牌翻转了位置 ${targetIndex} 的卡牌！`);
                
                // 新增逻辑：移除被翻转卡牌的“裁定技能”
                if (targetCard.skills && targetCard.skills.length > 0) {
                    const initialSkillCount = targetCard.skills.length;
                    targetCard.skills = targetCard.skills.filter(skillId => {
                        const skillDef = skillDefinitions[skillId];
                        // 如果技能未定义或类型不是 'adjudicating'，则保留
                        return !skillDef || skillDef.skillType !== 'adjudicating';
                    });
                    if (targetCard.skills.length < initialSkillCount) {
                        console.log(`卡牌 ${itemDefinitions[targetCard.defId].name} 的裁定技能已被移除。`);
                    }
                }

                // 记录翻转事件
                room.events.push({
                    type: 'card_flipped',
                    skillId: skillDef.id,
                    sourceCardId: skillOwnerCard.id,
                    targetCardId: targetCard.id,
                    newOwner: currentPlayer.account
                });
                break;

            case 4: // 吸取
                const capturedCard = context.capturedCard;
                const capturedValues = ['up', 'down', 'left', 'right'].map(dir => ({ dir, val: capturedCard[dir] }));
                capturedValues.sort((a, b) => b.val - a.val);
                const highestDirCaptured = capturedValues[0].dir;

                const ownerValues = ['up', 'down', 'left', 'right'].map(dir => ({ dir, val: skillOwnerCard[dir] }));
                ownerValues.sort((a, b) => a.val - b.val);
                const lowestDirOwner = ownerValues[0].dir;

                if (capturedCard[highestDirCaptured] > 0) {
                    const stealAmount = Math.min(capturedCard[highestDirCaptured], skillDef.num_1);
                    capturedCard[highestDirCaptured] -= stealAmount;
                    skillOwnerCard[lowestDirOwner] += stealAmount;
                    console.log(`【吸取】效果：从被翻转卡牌的 ${highestDirCaptured} 偷取${stealAmount}点，加到自身 ${lowestDirOwner}`);
                }
                break;
        }

        // 只为非翻转效果记录数值变化事件
        if (skillDef.effectId !== 3) {
            room.events.push({
                type: 'skill_effect',
                skillId: skillDef.id,
                sourceCardId: skillOwnerCard.id,
                targetCardId: targetCard.id,
                changes: {
                    up: targetCard.up - originalValues.up,
                    down: targetCard.down - originalValues.down,
                    left: targetCard.left - originalValues.left,
                    right: targetCard.right - originalValues.right,
                }
            });
        }
    });
}


app.listen(port, () => {
    console.log(`服务器正在监听 http://localhost:${port}`);
});
