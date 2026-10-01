#!/bin/sh
# Creates the local S3 buckets (RustFS locally; DigitalOcean Spaces in prod).
# Idempotent.
#
#   buku-media-dev      PUBLIC pictures: cleaned business photos, logos, employee photos (CDN in prod)
#   buku-private-dev    PRIVATE: original uploads (`incoming/`, deleted after cleaning or within
#                       a day) and private pictures (customer profile pictures). Never behind a CDN.
#   buku-documents-dev  verification documents — PRIVATE, admin-only access
#   buku-backups-dev    database backups — PRIVATE
#
# Every bucket is private. Browsers never get bucket credentials: uploads use
# short-lived presigned PUT URLs issued by the API after authorization checks.
set -eu
EP="--endpoint-url ${S3_ENDPOINT:-http://s3:9000}"

for i in $(seq 1 30); do
  aws $EP s3api list-buckets > /dev/null 2>&1 && break
  echo "waiting for object storage ($i/30)..."; sleep 2
done

for bucket in buku-media-dev buku-private-dev buku-documents-dev buku-backups-dev; do
  if aws $EP s3api head-bucket --bucket "$bucket" > /dev/null 2>&1; then
    echo "✔ bucket $bucket exists"
  else
    aws $EP s3api create-bucket --bucket "$bucket" > /dev/null
    echo "✔ created bucket $bucket"
  fi
  aws $EP s3api put-bucket-versioning --bucket "$bucket" --versioning-configuration Status=Enabled > /dev/null 2>&1 \
    || echo "  (versioning not supported by this S3 emulator; enabled in production)"
done

# Browser uploads (presigned PUT) come from the web app origin only.
CORS='{
  "CORSRules": [{
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "MaxAgeSeconds": 3600
  }]
}'
for bucket in buku-private-dev buku-documents-dev; do
  aws $EP s3api put-bucket-cors --bucket "$bucket" --cors-configuration "$CORS" > /dev/null 2>&1 \
    && echo "✔ CORS on $bucket" || echo "  (CORS not supported by this S3 emulator)"
done

# Originals that were uploaded but never completed (or whose cleaning failed
# before deletion) expire on their own: no clean-up job needed.
LIFECYCLE='{
  "Rules": [{
    "ID": "expire-incoming-originals",
    "Status": "Enabled",
    "Filter": { "Prefix": "incoming/" },
    "Expiration": { "Days": 1 }
  }]
}'
aws $EP s3api put-bucket-lifecycle-configuration --bucket buku-private-dev --lifecycle-configuration "$LIFECYCLE" > /dev/null 2>&1 \
  && echo "✔ incoming/ originals expire after 1 day (buku-private-dev)" \
  || echo "  (lifecycle rules not supported by this S3 emulator; configured in production)"
