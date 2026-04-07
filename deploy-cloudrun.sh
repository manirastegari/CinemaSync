#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# CinemaSync — Deploy to Google Cloud Run (Free Tier)
# ─────────────────────────────────────────────────────────────────────────────
# Prerequisites:
#   1. Install gcloud CLI: https://cloud.google.com/sdk/docs/install
#   2. Run: gcloud auth login
#   3. Run this script: bash deploy-cloudrun.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

PROJECT_ID="cinemasync-app"
REGION="us-central1"         # Free tier eligible region
SERVICE_NAME="cinemasync"

echo ""
echo "  ✦ CinemaSync → Google Cloud Run Deployment"
echo ""

# Step 1: Create project (skip if exists)
echo "→ Creating project '$PROJECT_ID'..."
gcloud projects create "$PROJECT_ID" --name="CinemaSync" 2>/dev/null || echo "  (project already exists)"

# Step 2: Set active project
gcloud config set project "$PROJECT_ID"

# Step 3: Enable required APIs
echo "→ Enabling APIs..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

# Step 4: Check if billing is linked (required for Cloud Run)
BILLING=$(gcloud billing projects describe "$PROJECT_ID" --format="value(billingEnabled)" 2>/dev/null || echo "false")
if [ "$BILLING" != "True" ]; then
  echo ""
  echo "⚠  Billing must be enabled (you won't be charged — Cloud Run free tier covers this app)."
  echo "   Go to: https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID"
  echo "   Link a billing account, then re-run this script."
  echo ""
  exit 1
fi

# Step 5: Deploy from source (builds Docker image via Cloud Build, deploys to Cloud Run)
echo "→ Building & deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --port 3000 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 3600 \
  --session-affinity \
  --min-instances 0 \
  --max-instances 1 \
  --set-env-vars "NODE_ENV=production,JWT_SECRET=cinemasync-secret-2024"

echo ""
echo "  ✦ Deployed! Your app URL:"
gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format="value(status.url)"
echo ""
