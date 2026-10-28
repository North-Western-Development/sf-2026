#!/usr/bin/env bash
# SSH: keys only, no root, only the admin logins. Run after the admin logins are tested.
set -euo pipefail
cat > /etc/ssh/sshd_config.d/00-subspace-hardening.conf <<'EOF'
# First match wins: this file is read before any provider defaults.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
AllowUsers deploy april
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
PermitTunnel no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
sshd -t
systemctl reload ssh
# Root keeps no SSH keys; the provider's web console still works for emergencies.
rm -f /root/.ssh/authorized_keys
echo "ssh locked down"
