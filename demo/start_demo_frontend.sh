#!/bin/bash
set -e
cd "$(dirname "$0")"
THIS_DIR=$(pwd)
if which python3 2>/dev/null ; then
    SERVE_CMD="python3 -m http.server"
elif which python2 2>/dev/null ; then
    SERVE_CMD="python2 -m SimpleHTTPServer"
else
    echo "python3 or python2 required for serving frontend"
    exit 1
fi
if test -f "$THIS_DIR/run/frontend.pid" ; then
    echo "Killing existing frontend instance"
    kill $(cat $THIS_DIR/run/frontend.pid) 2>/dev/null || true
fi

cd ../packages/fastbtc-ui
make
cd build
echo "Starting server"
$SERVE_CMD 2>$THIS_DIR/logs/frontend-error.log >$THIS_DIR/logs/frontend.log &
PID=$!
echo $PID > $THIS_DIR/run/frontend.pid
sleep 2
tail $THIS_DIR/logs/frontend*.log || true
echo "Logs at $THIS_DIR/logs/frontend.log"
echo "Serving build in http://localhost:8000 ..."
