#!/bin/sh
# Creates the versioned `businesses_v1` index and points the `businesses`
# alias at it. Idempotent.
#
# Why an alias: when the mapping must change, search-service builds
# `businesses_v2` in the background, then swaps the alias atomically — zero
# downtime, and the old index stays around for instant rollback.
set -eu
ES="${ELASTICSEARCH_URL:-http://elasticsearch:9200}"
INDEX="businesses_v1"
ALIAS="businesses"

status=$(curl -s -o /dev/null -w '%{http_code}' "$ES/$INDEX")
if [ "$status" = "404" ]; then
  code=$(curl -s -o /tmp/resp -w '%{http_code}' -X PUT "$ES/$INDEX" \
    -H 'Content-Type: application/json' --data-binary @/mappings/businesses.v1.json)
  if [ "$code" != "200" ]; then
    echo "✘ failed to create $INDEX (HTTP $code):"; cat /tmp/resp; exit 1
  fi
  echo "✔ created index $INDEX"
else
  echo "✔ index $INDEX already exists"
fi

alias_status=$(curl -s -o /dev/null -w '%{http_code}' "$ES/_alias/$ALIAS")
if [ "$alias_status" = "404" ]; then
  curl -sf -X POST "$ES/_aliases" -H 'Content-Type: application/json' \
    -d "{\"actions\":[{\"add\":{\"index\":\"$INDEX\",\"alias\":\"$ALIAS\",\"is_write_index\":true}}]}" > /dev/null
  echo "✔ alias $ALIAS → $INDEX"
else
  echo "✔ alias $ALIAS already exists"
fi
