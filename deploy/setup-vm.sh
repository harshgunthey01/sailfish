#!/usr/bin/env bash
# Sailfish one-time VM setup for a DigitalOcean Droplet (Ubuntu 22.04/24.04).
# Run as root on a fresh droplet:  curl -fsSL <raw-url> | bash   (or scp + bash)
set -euo pipefail

echo "==> Sailfish VM bootstrap"

# 1) Swap (good hygiene on small VMs; harmless elsewhere).
if [ ! -f /swapfile ]; then
  echo "==> creating 1G swapfile"
  fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10
  grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
else
  echo "==> swapfile already present"
fi

# 2) Docker + compose plugin
if ! command -v docker >/dev/null 2>&1; then
  echo "==> installing docker"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
else
  echo "==> docker already installed"
fi

# 3) Optional: basic firewall (uncomment and set your trusted IP)
# ufw allow 22/tcp
# ufw allow 8080/tcp
# ufw --force enable

echo
echo "==> Done. Next:"
echo "    git clone <your-repo> sailfish && cd sailfish"
echo "    docker compose up -d --build"
echo "    open http://<droplet-ip>:8080  -> setup wizard"
