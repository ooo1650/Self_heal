#!/bin/sh
# NR custom integration — Docker container metrics via Docker Stats API.
# Uses python3 for all math (avoids sh integer overflow on nanosecond CPU values).
# Persists previous CPU readings in /tmp to compute accurate inter-run deltas.

SOCKET="/var/run/docker.sock"
CONTAINERS="ims-backend ims-postgres ims-frontend"
STATE_DIR="/tmp/nr_container_state"
mkdir -p "$STATE_DIR"

# Fetch stats + inspect for all containers in parallel
for name in $CONTAINERS; do
  curl -sf --unix-socket "$SOCKET" \
    "http://localhost/containers/$name/stats?stream=false" \
    > "$STATE_DIR/${name}.stats" 2>/dev/null &
  curl -sf --unix-socket "$SOCKET" \
    "http://localhost/containers/$name/json" \
    > "$STATE_DIR/${name}.inspect" 2>/dev/null &
done
wait

# Python handles all parsing, math, and state persistence
python3 - "$STATE_DIR" $CONTAINERS << 'PYEOF'
import sys, os, json, time

state_dir = sys.argv[1]
containers = sys.argv[2:]

metrics = []
events  = []

for name in containers:
    stats_file   = f"{state_dir}/{name}.stats"
    inspect_file = f"{state_dir}/{name}.inspect"
    prev_cpu_file = f"{state_dir}/{name}.cpu_prev.json"
    start_file    = f"{state_dir}/{name}.started"
    count_file    = f"{state_dir}/{name}.count"

    # Load stats and inspect
    try:
        with open(stats_file) as f: stats = json.load(f)
        with open(inspect_file) as f: inspect = json.load(f)
    except Exception:
        continue

    container_state = inspect.get("State", {}).get("Status", "unknown")

    # ── Memory ──────────────────────────────────────────────────────────────
    mem_stats = stats.get("memory_stats", {})
    mem_usage = mem_stats.get("usage", 0)
    mem_limit = mem_stats.get("limit", 1)
    mem_mb       = round(mem_usage / 1048576, 1)
    mem_limit_mb = round(mem_limit / 1048576, 1)
    mem_pct      = round(mem_usage / mem_limit * 100, 1) if mem_limit > 0 else 0

    # ── CPU (persisted delta between runs) ───────────────────────────────────
    cpu_stats  = stats.get("cpu_stats", {})
    cpu_now    = cpu_stats.get("cpu_usage", {}).get("total_usage", 0)
    sys_now    = cpu_stats.get("system_cpu_usage", 0)
    num_cpu    = cpu_stats.get("online_cpus", 1)
    nano_cpus  = inspect.get("HostConfig", {}).get("NanoCpus", 0)

    cpu_pct = 0.0
    try:
        with open(prev_cpu_file) as f:
            prev = json.load(f)
        cpu_delta = cpu_now - prev["cpu"]
        sys_delta = sys_now - prev["sys"]
        if sys_delta > 0 and cpu_delta >= 0:
            if nano_cpus > 0:
                # % of container CPU limit: (cpu_delta/sys_delta) * (num_cpu / limit_cores) * 100
                limit_cores = nano_cpus / 1e9
                cpu_pct = round(min((cpu_delta / sys_delta) * (num_cpu / limit_cores) * 100, 100), 2)
            else:
                # No limit — % of all host cores, capped at 100
                cpu_pct = round(min((cpu_delta / sys_delta) * num_cpu * 100, 100), 2)
    except Exception:
        pass  # first run or state missing — report 0

    # Save current readings for next run
    with open(prev_cpu_file, "w") as f:
        json.dump({"cpu": cpu_now, "sys": sys_now, "ts": time.time()}, f)

    # ── Restart tracking ─────────────────────────────────────────────────────
    current_started = inspect.get("State", {}).get("StartedAt", "")
    prev_started    = ""
    try:
        with open(start_file) as f: prev_started = f.read().strip()
    except Exception:
        pass

    count = 0
    try:
        with open(count_file) as f: count = int(f.read().strip())
    except Exception:
        pass

    restart_detected = False
    if current_started and prev_started and current_started != prev_started:
        count += 1
        restart_detected = True
        with open(count_file, "w") as f: f.write(str(count))
    elif current_started and not prev_started:
        with open(count_file, "w") as f: f.write("0")

    if current_started:
        with open(start_file, "w") as f: f.write(current_started)

    if restart_detected:
        events.append({
            "summary": f"Container {name} restarted",
            "category": "ContainerRestart",
            "containerName": name,
            "cumulativeRestarts": count
        })

    metrics.append({
        "event_type":         "DockerStatsSample",
        "containerName":      name,
        "containerState":     container_state,
        "memoryUsageMB":      mem_mb,
        "memoryLimitMB":      mem_limit_mb,
        "memoryUsagePct":     mem_pct,
        "memoryLimitPct":     100,
        "cpuPercent":         cpu_pct,
        "cpuLimit":           100,
        "cumulativeRestarts": count
    })

payload = json.dumps({
    "name": "com.custom.docker-stats",
    "protocol_version": "3",
    "integration_version": "3.0.0",
    "data": [{"metrics": metrics, "inventory": {}, "events": events}]
})
print(payload)
PYEOF
