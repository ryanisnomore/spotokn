#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="spotify-tokener"
NODE_ENV="production"


echo "🔧 Setting up $NAME..."

echo "📂 Base directory: $DIR/src/app.ts"

## Check if the script is run as root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Please run as root."
    exit 1
fi


echo "🧾 Creating systemd service..."

SERVICE_FILE="/etc/systemd/system/$NAME.service"

sudo bash -c "cat > $SERVICE_FILE" <<EOL
[Unit]
Description=$NAME Discord Bot
After=network.target

[Service]
Type=simple
ExecStart=/root/.bun/bin/bun --env-file=./.env $DIR/src/app.ts
WorkingDirectory=$DIR
RestartSec=5
User=$(whoami)
Environment=NODE_ENV=$NODE_ENV

[Install]
WantedBy=multi-user.target
EOL

echo "🔄 Reloading systemd daemon..."
sudo systemctl daemon-reexec
sudo systemctl daemon-reload

echo "✅ Enabling and starting $NAME service..."
sudo systemctl enable $NAME
sudo systemctl start $NAME

echo "✅ All done! Use the following to manage the $NAME service:"
echo "  • systemctl status $NAME"
echo "  • journalctl -u $NAME -f"
