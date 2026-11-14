#!/usr/bin/env bash
# Запуск КОНТУР в локальной сети по HTTPS: камера и AR требуют защищённого контекста.
# Телефон в той же сети Wi-Fi открывает https://<IP>:8443 после установки корневого
# сертификата, который раздаётся по http://<IP>:8080.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERTS="$ROOT/certs"
SHARE="$CERTS/public"
HTTPS_PORT="${HTTPS_PORT:-8443}"
CERT_PORT="${CERT_PORT:-8080}"
PYTHON="${PYTHON:-python3}"
if [ -x "$ROOT/.venv/bin/python" ]; then PYTHON="$ROOT/.venv/bin/python"; fi

lan_ip() {
  local ip=""
  for interface in en0 en1 en2 en3; do
    ip="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
    [ -n "$ip" ] && { printf '%s' "$ip"; return 0; }
  done
  ip="$(ifconfig 2>/dev/null | awk '/inet 192\.168\.|inet 10\.|inet 172\.(1[6-9]|2[0-9]|3[01])\./ {print $2; exit}')"
  [ -n "$ip" ] || { echo "Не удалось определить адрес в локальной сети." >&2; return 1; }
  printf '%s' "$ip"
}

IP="${LAN_IP:-$(lan_ip)}"
HOST_NAME="$(scutil --get LocalHostName 2>/dev/null || hostname -s)"

# Корневой сертификат живёт долго: его ставят на телефон один раз.
if [ ! -f "$CERTS/ca.crt" ]; then
  mkdir -p "$CERTS"
  openssl req -x509 -newkey rsa:2048 -sha256 -days 820 -nodes \
    -keyout "$CERTS/ca.key" -out "$CERTS/ca.crt" \
    -subj "/CN=KONTUR local development CA/O=KONTUR demo" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
  echo "Создан корневой сертификат certs/ca.crt"
fi

# Сертификат сервера перевыпускается при смене адреса в сети.
SAN="IP:$IP,IP:127.0.0.1,DNS:localhost,DNS:$HOST_NAME.local,DNS:$HOST_NAME"
if [ ! -f "$CERTS/server.crt" ] || ! openssl x509 -in "$CERTS/server.crt" -noout -text | grep -q "IP Address:$IP"; then
  openssl req -newkey rsa:2048 -sha256 -nodes \
    -keyout "$CERTS/server.key" -out "$CERTS/server.csr" \
    -subj "/CN=$IP/O=KONTUR demo" 2>/dev/null
  printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' "$SAN" > "$CERTS/server.ext"
  openssl x509 -req -in "$CERTS/server.csr" -CA "$CERTS/ca.crt" -CAkey "$CERTS/ca.key" \
    -CAcreateserial -out "$CERTS/server.crt" -days 395 -sha256 \
    -extfile "$CERTS/server.ext" 2>/dev/null
  rm -f "$CERTS/server.csr" "$CERTS/server.ext"
  echo "Выпущен сертификат сервера для $IP"
fi

# Страница установки сертификата отдаётся по обычному HTTP: иначе телефон
# не доверяет соединению, по которому пришёл бы сам сертификат.
mkdir -p "$SHARE"
cp "$CERTS/ca.crt" "$SHARE/kontur-ca.crt"
cat > "$SHARE/index.html" <<HTML
<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>КОНТУР · доступ с телефона</title>
<style>body{margin:0;padding:24px;font-family:system-ui;background:#152b23;color:#f2f6f3;line-height:1.7}
a{color:#fff}.card{max-width:34rem;margin:0 auto;background:#1d3d31;border:1px solid #789982;border-radius:10px;padding:20px 22px}
.step{margin:14px 0}code{background:#0f231c;padding:2px 6px;border-radius:4px;font-size:90%}
.go{display:inline-block;margin-top:10px;background:#fff;color:#214e37;padding:11px 16px;border-radius:6px;text-decoration:none;font-weight:600}</style></head>
<body><div class="card"><h1>КОНТУР · приложение в локальной сети</h1>
<p>Камере и AR нужен защищённый адрес. Один раз установите сертификат этого компьютера, затем откройте приложение по HTTPS.</p>
<div class="step"><b>1.</b> <a href="/kontur-ca.crt">Скачать сертификат</a></div>
<div class="step"><b>2. iPhone:</b> «Настройки» → «Профиль загружен» → «Установить». Затем «Настройки» → «Основные» → «Об этом устройстве» → «Доверие сертификатам» → включить <code>KONTUR local development CA</code>.</div>
<div class="step"><b>2. Android:</b> «Настройки» → «Безопасность» → «Шифрование и учётные данные» → «Установить сертификат» → «Сертификат ЦС» → выбрать скачанный файл.</div>
<div class="step"><b>3.</b> Откройте приложение:</div>
<a class="go" href="https://$IP:$HTTPS_PORT/">https://$IP:$HTTPS_PORT/</a>
<p style="margin-top:18px;font-size:90%;opacity:.85">AR-стенд: <code>https://$IP:$HTTPS_PORT/ar.html</code> · печатный маркер Hiro: <code>https://$IP:$HTTPS_PORT/stand.html</code></p>
</div></body></html>
HTML

cleanup() { [ -n "${HELPER:-}" ] && kill "$HELPER" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

"$PYTHON" -m http.server "$CERT_PORT" --bind 0.0.0.0 --directory "$SHARE" >/dev/null 2>&1 &
HELPER=$!

cat <<INFO

  КОНТУР в сети Wi-Fi
  -------------------
  Телефон:   http://$IP:$CERT_PORT/      ← начните отсюда: сертификат и ссылки
  Приложение: https://$IP:$HTTPS_PORT/
  AR-стенд:   https://$IP:$HTTPS_PORT/ar.html
  Остановка:  Ctrl+C

INFO

exec "$PYTHON" -X utf8 -m uvicorn app.main:create_app --factory \
  --app-dir "$ROOT/services/api" --host 0.0.0.0 --port "$HTTPS_PORT" \
  --ssl-keyfile "$CERTS/server.key" --ssl-certfile "$CERTS/server.crt"
