#!/usr/bin/env bash
set -euo pipefail

INTEGRATION="govee-color"
BASE_URL="https://raw.githubusercontent.com/brs98/ricekit-community/main/integrations/${INTEGRATION}"
DEST="${HOME}/.config/ricekit/custom-integrations/${INTEGRATION}"

command -v ricekit >/dev/null 2>&1 || { echo "Error: ricekit not found. Install it first."; exit 1; }

if [ -d "${DEST}" ]; then
  echo "Updating existing ${INTEGRATION} integration..."
else
  echo "Installing ${INTEGRATION} integration..."
fi

cleanup() { [ -d "${DEST}" ] && rm -rf "${DEST}"; }

mkdir -p "${DEST}/body"

curl -sfL "${BASE_URL}/integration.toml" -o "${DEST}/integration.toml" \
  || { echo "Error: Failed to download integration.toml"; cleanup; exit 1; }
curl -sfL "${BASE_URL}/body/payload.json.tmpl" -o "${DEST}/body/payload.json.tmpl" \
  || { echo "Error: Failed to download payload template"; cleanup; exit 1; }

echo ""
echo "Installed to ${DEST}"
echo ""
echo "Next steps:"
echo "  1. Get a Govee API key from the Govee Home app:"
echo "     Settings → About Us → Apply for API Key"
echo ""
echo "  2. Find your device MAC and SKU:"
echo "     curl -H 'Govee-API-Key: YOUR_KEY' https://openapi.api.govee.com/router/api/v1/user/devices | python3 -m json.tool"
echo ""
echo "  3. Store the secrets:"
echo "     ricekit secrets set ${INTEGRATION} api_key"
echo "     ricekit secrets set ${INTEGRATION} device"
echo "     ricekit secrets set ${INTEGRATION} model"
echo ""
echo "  4. Enable the integration:"
echo "     ricekit integration enable ${INTEGRATION}"
echo ""
echo "Done!"
