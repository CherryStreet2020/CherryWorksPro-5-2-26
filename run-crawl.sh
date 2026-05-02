#!/bin/bash
cd /home/runner/workspace
node crawl-standalone.js > crawl-output.log 2>&1
cp crawl-results.txt /tmp/crawl-done-marker 2>/dev/null
echo "CRAWL_COMPLETE" >> crawl-output.log
