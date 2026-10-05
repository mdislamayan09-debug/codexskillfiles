#!/bin/sh
# Serve dist/ on a private port for the duration of one capture run, then stop the server.
# usage: OUT=dir [CANVAS=1] sh scripts/capture.sh "<query>" shot,shot frames WxH
PORT=${PORT:-4180}
python3 -m http.server "$PORT" --directory dist --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!
sleep 1
node scripts/shoot.mjs "http://127.0.0.1:$PORT/?$1" "$2" "$3" "$4"
STATUS=$?
kill $SRV 2>/dev/null
exit $STATUS
