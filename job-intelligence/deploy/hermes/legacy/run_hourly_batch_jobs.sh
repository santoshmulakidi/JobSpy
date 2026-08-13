#!/usr/bin/env bash
export PYTHONPATH=/home/ubuntu/JobSpy:${PYTHONPATH:-}
exec /home/ubuntu/jobspy-env/bin/python /home/ubuntu/.hermes/scripts/hourly_batch_jobs.py
