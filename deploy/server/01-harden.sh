#!/usr/bin/env bash
# Base hardening for a fresh Debian 13 host (run as root, once; safe to re-run).
#   ADMIN_KEYS_DEPLOY / ADMIN_KEYS_APRIL: public keys for the two admin logins.
# Root logins and passwords over SSH are turned off by 02-ssh-lockdown.sh, only after the
# admin logins have been tested.
set -euo pipefail

: "${ADMIN_KEYS_DEPLOY:?}" "${ADMIN_KEYS_APRIL:?}"

# ---- Admin accounts: key-only, no password, sudo without one --------------------------
for spec in "deploy:$ADMIN_KEYS_DEPLOY" "april:$ADMIN_KEYS_APRIL"; do
  user="${spec%%:*}"; key="${spec#*:}"
  id "$user" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$user"
  passwd -l "$user" >/dev/null
  install -d -m 700 -o "$user" -g "$user" "/home/$user/.ssh"
  printf '%s\n' "$key" > "/home/$user/.ssh/authorized_keys"
  chown "$user:$user" "/home/$user/.ssh/authorized_keys"; chmod 600 "/home/$user/.ssh/authorized_keys"
  echo "$user ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$user"; chmod 440 "/etc/sudoers.d/90-$user"
done
visudo -c >/dev/null

# ---- Firewall (nftables): deny inbound except what Subspace needs ----------------------
cat > /etc/nftables.conf <<'EOF'
#!/usr/sbin/nft -f
flush ruleset
table inet filter {
  chain input {
    type filter hook input priority 0; policy drop;
    iif lo accept
    ct state established,related accept
    ct state invalid drop
    meta l4proto { icmp, ipv6-icmp } accept
    tcp dport 22 ct state new limit rate 30/minute accept
    tcp dport { 80, 443 } accept
    # LiveKit: ICE over TCP, single-port UDP media, TURN (UDP and TLS), TURN relay range.
    tcp dport { 7881, 5349 } accept
    udp dport { 7882, 3478 } accept
    udp dport 30000-40000 accept
  }
  chain forward { type filter hook forward priority 0; policy drop; }
  chain output { type filter hook output priority 0; policy accept; }
}
EOF
systemctl enable --now nftables >/dev/null
nft -f /etc/nftables.conf

# ---- fail2ban for SSH -------------------------------------------------------------------
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[DEFAULT]
banaction = nftables-multiport
backend = systemd
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
EOF
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban

# ---- Automatic security updates (reboot at 04:30 when a kernel needs it) ----------------
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat > /etc/apt/apt.conf.d/52subspace-unattended <<'EOF'
Unattended-Upgrade::Origins-Pattern {
  "origin=Debian,codename=${distro_codename},label=Debian";
  "origin=Debian,codename=${distro_codename}-security,label=Debian-Security";
  "origin=Debian,codename=${distro_codename}-updates";
  "origin=nodesource";
};
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF
systemctl enable --now unattended-upgrades >/dev/null

# ---- Kernel and network hardening -------------------------------------------------------
cat > /etc/sysctl.d/90-subspace.conf <<'EOF'
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.tcp_syncookies = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.yama.ptrace_scope = 1
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
# LiveKit and the gateway hold many sockets.
net.core.rmem_max = 5000000
net.core.wmem_max = 5000000
fs.file-max = 1048576
EOF
sysctl --system >/dev/null

timedatectl set-timezone UTC
systemctl enable --now systemd-timesyncd >/dev/null 2>&1 || true
echo "hardening done"
