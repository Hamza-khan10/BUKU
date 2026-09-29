#!/usr/bin/env bash
# Prints a valid Kafka KRaft CLUSTER_ID: a UUID as 22-char URL-safe base64.
python3 -c "import uuid,base64; print(base64.urlsafe_b64encode(uuid.uuid4().bytes).rstrip(b'=').decode())"
