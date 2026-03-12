# Step 2 — Internet P2P (Circuit Relay)

> **Дата**: 12.03.2026  
> **Версія**: v0.6.0

---

## Що зроблено

### 1. Relay Server (`relay.mjs`)
- Standalone Node.js скрипт — relay ноди для NAT traversal
- TCP:9090 + WebSocket:9091
- `circuitRelayServer()` — 128 слотів, 10хв/реєстрація, 16MB/ліміт
- GossipSub — relay бере участь у pub/sub mesh
- Запуск: `node relay.mjs` або `npm run relay`

### 2. P2P Client (`p2p.mjs`) — оновлений
| Компонент | Для чого |
|-----------|----------|
| `@libp2p/tcp` | Прямі TCP з'єднання (LAN) |
| `@libp2p/websockets` | WebSocket з'єднання (через relay) |
| `@libp2p/circuit-relay-v2` | Транспорт через relay (NAT traversal) |
| `@libp2p/bootstrap` | Підключення до відомих relay нод |
| `@libp2p/mdns` | Local network discovery (збережено!) |

### 3. RELAY_ADDRS env var
- Адреси relay нод передаються через `RELAY_ADDRS` env var
- Формат: `/ip4/<IP>/tcp/<PORT>/p2p/<PEER_ID>`
- Без RELAY_ADDRS → тільки mDNS (локальна мережа)

### 4. UI оновлення
- Тип з'єднання біля кожного піра: 🏠 (local) / 🌐 (relay)
- Сайдбар footer: кількість relay з'єднань
- Версія: v0.6.0

---

## Нові зависимості

```
@libp2p/circuit-relay-v2@1.0.25
@libp2p/websockets@8.1.1
@libp2p/bootstrap@10.1.1
@libp2p/utils@6.1.1
```

---

## Вирішені проблеми

| Проблема | Рішення |
|----------|---------|
| `@libp2p/utils` версія не має `peer-job-queue` | Оновлено до 6.1.1 |
| `identify` capability mismatch з circuit-relay | Downgrade relay до 1.0.25 (сумісний з identify 1.0.x) |
| `/p2p-circuit` listen fails без relay | Видалено з listen — relay транспорт сам знаходить relay |

---

## Як тестувати

### Локально (одна мережа)
```bash
# Термінал 1 — запустити relay
node relay.mjs
# Запам'ятай multiaddr з логів relay

# Термінал 2 — клієнт з relay
$env:RELAY_ADDRS = '<multiaddr>'; node launch.cjs
```

### Через інтернет
1. На **цьому ПК**: `node relay.mjs` (+ port forwarding 9090)
2. На **другому ПК**: `RELAY_ADDRS=/ip4/<публічний_IP>/tcp/9090/p2p/<PEER_ID>` в env
