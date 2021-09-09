#!/bin/bash
cd "$(dirname "$0")"
THIS_DIR=$(pwd)
tail -f $THIS_DIR/logs/*.log
