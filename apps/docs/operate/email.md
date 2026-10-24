# Email (SMTP)

Subspace sends email for:

- verifying a new account's address;
- verifying a changed address;
- telling the old address when the email is changed.

```ini
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false        # true for port 465 (implicit TLS); 587 uses STARTTLS
SMTP_USER=postmaster@subspace.click
SMTP_PASS=...
SMTP_FROM=Subspace Frequency <no-reply@subspace.click>
```

How it behaves:

- **SMTP configured:** new accounts start unverified and get a link. A notice bar asks them to verify, with a Resend button limited to 3 per 10 minutes.
- **No SMTP in production:** nothing is sent and accounts are created verified, since nobody could finish a verification.
- **Development:** emails are logged by the API and kept in the Redis list `dev:outbox`.

Links point at the origin the person was using, as long as it is one of yours (`PUBLIC_ORIGIN` or `WEBAUTHN_ORIGINS`); a forged request origin is ignored. Set `EMAIL_LINK_BASE` to fix it to one address.

Tokens are stored hashed, work once, expire after 24 hours, and stop working if the address changes again.

For deliverability, set SPF, DKIM and DMARC records for the sending domain with your mail provider.
