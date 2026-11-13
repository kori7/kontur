# Offline extension to the approved inspection prototype

Historical plan for the first offline extension. The current overall scope,
status and roadmap are defined in [plan_to_do.md](../../plan_to_do.md):
four equipment groups, video AR, 3D test stands and trained defect recognition.

User-approved update: local enterprise server and Wi-Fi clients; no Internet needed at runtime.

1. Move organizer materials into `data/reference/organizer`, assign stable English ids, retain original names and verify all SHA256 hashes. **Completed: 84 files, 181198500 bytes.**
2. Read defect guide, vibration/temperature schemas and supplied passports. Preserve independent sources, original timestamps and uncertainty; do not silently join unrelated channels or attach documents to the synthetic pump.
3. Prepare pinned llama.cpp Windows CUDA runtime and Qwen3-VL 4B Q4_K_M + Q8 projector. Verify hashes and real local image inference on organizer examples. Download only during preparation.
4. Replace the cloud vision adapter with a loopback-only local model endpoint, no API key, proxy, redirect or remote fallback. Validate structured observations and show local model failures explicitly.
5. Add source photo/document library and historical telemetry replay to the app. Clearly distinguish organizer examples from synthetic scenarios. Pairing independent photos and time series is a demonstration, not a recorded joint inspection.
6. Serve built app over LAN; provide local HTTPS certificate generation for phone camera access, without changing system trust or firewall automatically.
7. Verify API/engine/UI, real model inference, reference-data provenance and absence of outbound application requests. Update docs/deck based on measured results and clearly list unverified phone/hardware coverage.

No commits, deployment, equipment actuation or automatic network/security policy changes are part of this task.
