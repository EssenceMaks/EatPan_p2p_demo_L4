# Step 4 Phase 1 — L3 Cluster Node

> **Дата**: 13.03.2026  
> **Версія**: v0.11.0

---

## Що зроблено

### 1. ClusterNode (`cluster.mjs`) — L3 логіка
- Message buffer з **UUID dedup** (Map<UUID, msg>)
- **Routing table** (Map<PeerId, {name, lastSeen, route, role}>)
- **Batch sync** до L2 кожні 10с (POST /api/v1/chat/sync/, max 50 msgs)
- getStats() для dashboard: uptime, buffer, synced, received, peers, backbone status
- Graceful shutdown з flush

### 2. ModeController (`mode-switch.mjs`) — L4 ↔ L3
- `checkDocker()` — виконує `docker --version`, повертає {available, version}
- `upgradeToL3(peerId, name)` — створює ClusterNode, починає буферизацію
- `downgradeToL4()` — flush + destroy ClusterNode
- Forwards: `onGossipMessage()`, `updatePeer()`, `removePeer()`

### 3. Relay Upgraded (`relay.mjs`) — Dual Role
- **Circuit Relay Server** (як раніше: NAT traversal, 128 слотів)
- **L3 Cluster Node** (при `BACKBONE_URL` env):
  - Підписується на GossipSub `eatpan-chat`
  - Буферизує повідомлення → batch sync до L2
  - Logs stats кожні 60с
- Запуск: `BACKBONE_URL=http://backbone:8000 node relay.mjs`

### 4. Electron Integration
| Файл | Зміни |
|------|-------|
| `main.cjs` | ModeController init, 7 IPC handlers, event forwarding |
| `preload.cjs` | 6 L3 IPC bridges |
| `index.html` | «⬆ Upgrade to L3» кнопка, L3 Dashboard panel |

### 5. Django Analytics API
- `GET /api/v1/analytics/summary/` — counters
- `GET /api/v1/analytics/nodes/` — node list  
- `GET /api/v1/analytics/sync-queue/` — queue status
- `GET /api/v1/analytics/health/` — PostgreSQL health

### 6. Bug Fix — Message Duplication
- **Причина**: relay echo — GossipSub relay отримує повідомлення і перенаправляє назад через інший шлях (circuit relay vs TCP)
- **Фікс**: `sentMessageIds` Set в p2p.mjs — UUID відправлених msg зберігаються, incoming з тим же ID ігноруються
- Set обмежений 200 записами (щоб не текла пам'ять)

---

## Файлова структура (нова)

```
P4_Terminal/
├── p2p.mjs           ← P2P backend (+ sentMessageIds dedup)
├── backbone.mjs      ← L2 API client
├── cluster.mjs       ← [NEW] L3 Cluster logic
├── mode-switch.mjs   ← [NEW] L4↔L3 mode controller
├── relay.mjs         ← [UPDATED] Dual relay + L3
├── main.cjs          ← Electron main (+ ModeController)
├── preload.cjs       ← IPC bridge (+ 6 L3 methods)
└── renderer/
    └── index.html    ← UI (+ L3 button + dashboard)

B_EatPan/
├── apps/analytics/   ← [NEW] Dashboard API
│   ├── views.py      # 4 endpoints
│   ├── urls.py       # URL routing
│   └── apps.py
└── config/urls.py    ← [UPDATED] + analytics route
```

---

## Наступні кроки (Phase 2-4)

| Phase | Що | Статус |
|-------|-----|--------|
| Phase 2 | P2_Dashboard/ — Electron L2 monitor | TODO |
| Phase 3 | P1_Admin/ — L1 backup + full control | TODO |
| Phase 4 | Cross-platform builds (.dmg, .AppImage) | TODO |
