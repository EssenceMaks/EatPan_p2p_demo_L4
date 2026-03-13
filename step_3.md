# Step 3 — L2 Backbone + L4→L2 Integration

> **Дата**: 13.03.2026  
> **Версія**: v0.10.0  
> **Репо Backend**: [github.com/EssenceMaks/EatPan_L2_Backbone](https://github.com/EssenceMaks/EatPan_L2_Backbone) (private)

---

## Що зроблено

### 1. L2 Backbone (Django) — `B_EatPan/`
- Django project: `config/`, 10 apps (sync, chat, users, recipes, storage, timeline, tracker, shopping, economy, analytics)
- **SyncableModel** (`apps/sync/mixins.py`): UUID pk, vector_clock, version, GSN, sync_status, node_origin, soft delete
- ChatRoom + ChatMessage models — наслідують SyncableModel
- REST API:
  - `GET /api/v1/chat/rooms/` — список кімнат
  - `GET /api/v1/chat/history/<room>/` — історія повідомлень
  - `POST /api/v1/chat/sync/` — прийом батчу (LWW merge, GSN)
- Docker Compose: PostgreSQL 16 Alpine + Valkey 8 Alpine

### 2. Рішення про технології
| Рішення | Причина |
|---------|---------|
| **Valkey** замість Redis | Redis 8+ = RSALv2/SSPL, Valkey = BSD 3-Clause (Linux Foundation) |
| **psycopg3** замість psycopg2 | psycopg2 на Windows = UnicodeDecodeError через системну libpq |
| `BigAutoField` default | Django не підтримує UUIDField як DEFAULT_AUTO_FIELD, UUID задається в SyncableModel |
| `PageNumberPagination` | CursorPagination вимагав explicit ordering, спрощуємо |

### 3. L4→L2 Integration
- `backbone.mjs` — BackboneClient класс (loadHistory, enqueueSync, batch кожні 5с)
- `p2p.mjs` — UUID + vectorClock на кожному повідомленні, backboneClient?.enqueueSync()
- `main.cjs` — BackboneClient init, chat-history IPC, backbone-status
- `preload.cjs` — onChatHistory, backboneStatus(), backboneFlush()
- `index.html` — L2 badge в titlebar (green/grey), historical messages

### 4. GitHub Repos
- `EssenceMaks/EatPan_L2_Backbone` — private, B_EatPan pushed
- `EssenceMaks/EatPan_F_EatPan` — private, for frontend

---

## Конфігурація

```bash
# Docker (B_EatPan/)
docker compose up -d postgres valkey

# Backbone API
docker run -d --name eatpan_backbone \
  --network b_eatpan_default -p 8000:8000 \
  -e DJANGO_SETTINGS_MODULE=config.settings.local \
  -e POSTGRES_HOST=eatpan_postgres \
  -e POSTGRES_DB=eatpan \
  -e POSTGRES_USER=eatpan \
  -e POSTGRES_PASSWORD=eatpan123 \
  eatpan_backbone
```

### Верифікація
```
POST /api/v1/chat/sync/ → {saved:1, skipped:0, conflicts:0}
GET /api/v1/chat/history/ → [{id, text, gsn:1, sync_status:"synced"}]
```
