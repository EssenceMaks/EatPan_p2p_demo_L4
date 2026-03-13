# Step 7 — Private & Group Chat (Rooms + Contacts)

> **Дата**: 13.03.2026  
> **Версія**: v0.12.0  
> **Додаток**: P4_Terminal/

---

## Що зроблено

### 1. RoomManager (`rooms.mjs`) — [NEW]
- **3 типи кімнат**: Global broadcast, DM (1-на-1), Group
- **Topic naming**:
  - `eatpan-chat` → Global (завжди підписаний)
  - `eatpan-dm-{peerA}-{peerB}` → DM (детерміністичний, sorted peer IDs)
  - `eatpan-room-{uuid}` → Group (UUID topic)
- Persist: `rooms.json` в `userData` directory
- API: `getOrCreateDM()`, `createGroup()`, `joinGroup()`, `leaveRoom()`, `listRooms()`
- Unread counter + lastMessage tracking для sidebar preview

### 2. ContactList (`contacts.mjs`) — [NEW]
- Збережені контакти з custom name
- `addContact()`, `removeContact()`, `rename()`, `getDisplayName()`
- `lastSeen` auto-update при peer discovery
- Persist: `contacts.json` в `userData`

### 3. Multi-Topic GossipSub (`p2p.mjs`) — [UPDATED]
- `subscribedTopics: Set` — відстежує всі підписки
- `joinTopic(topic)` / `leaveTopic(topic)` — підписка/відписка
- `sendChat(text, topic)` — тепер приймає target topic (default: global)
- `sendInvite(roomTopic, roomName, targetPeerId)` — надсилає запрошення
- `room_topic` додано до кожного повідомлення
- Message handler маршрутизує по topic

### 4. IPC (main.cjs + preload.cjs) — [UPDATED]
| Handler | Функція |
|---------|---------|
| `get-rooms` | Список всіх кімнат |
| `create-dm` | Створити DM + joinTopic |
| `create-group` | Створити групу + відправити invites |
| `join-group` | Приєднатися до групи |
| `leave-room` | Вийти з кімнати + leaveTopic |
| `reset-unread` | Скинути лічильник непрочитаних |
| `get-contacts` | Список контактів |
| `save-contact` | Зберегти контакт |
| `remove-contact` | Видалити контакт |
| `rename-contact` | Перейменувати контакт |
| `send-message` | Тепер приймає `(text, topic)` |

### 5. UI Redesign (`index.html`) — [UPDATED]
- **Sidebar**: Room list (Global, DMs, Groups) з unread badges
- **Room items**: icon + name + preview + unread badge
- **Chat header**: ім'я активної кімнати + тип
- **Peer click → DM**: клік на онлайн пір створює DM кімнату
- **"+" New Room**: модальне вікно для створення групи
- **Context menu**: right-click на room → Leave
- **Room invites**: auto-join при отриманні запрошення через GossipSub
- **Message routing**: `messagesByRoom: Map` — повідомлення зберігаються по кімнатах

### 6. Bug Fix — EPIPE Broken Pipe
- **Причина**: `console.log()` в `backbone.mjs:_syncBatch` ламав stdout pipe
- **Фікс**: `process.on('uncaughtException')` в main.cjs — EPIPE ігноруються
- backbone.mjs: console.log/warn обгорнуті в `try-catch`

### 7. Backbone room_topic fix
- `enqueueSync()` тепер використовує `msg.room_topic` замість дефолтного `eatpan-chat`
- DM та group повідомлення синкаються з правильним topic

---

## Файлова структура

```
P4_Terminal/
├── p2p.mjs           ← P2P backend (+ multi-topic GossipSub)
├── backbone.mjs      ← L2 API client (+ EPIPE fix, room_topic)
├── cluster.mjs       ← L3 Cluster logic
├── mode-switch.mjs   ← L4↔L3 mode controller
├── rooms.mjs         ← [NEW] Room Manager (DM + Group)
├── contacts.mjs      ← [NEW] Contact List
├── relay.mjs         ← Dual relay + L3
├── main.cjs          ← Electron main (+ 12 room/contact IPC)
├── preload.cjs       ← IPC bridge (+ 12 room/contact bridges)
└── renderer/
    └── index.html    ← UI (room sidebar + chat header + modals)
```

---

## Git

```
Commit: f49e41d
Branch: main
Repo: EatPan_p2p_demo_L4
```
