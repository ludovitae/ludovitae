"""`uv run gol-serve` — HTTPS server for LAN use.

Binding to a non-loopback address auto-generates a self-signed cert into
data/tls/ on first run and serves HTTPS. Loopback binds stay plain HTTP
(dev: `uv run uvicorn gol.main:app`). See ARCHITECTURE.md security posture.
"""

from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import os
import socket
from pathlib import Path

import uvicorn

from gol import config

LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}
CERT_DAYS = 825


def _is_loopback(host: str) -> bool:
    if host in LOOPBACK_HOSTS:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def ensure_self_signed(tls_dir: Path) -> tuple[Path, Path]:
    """Generate key/cert into data/tls/ on first run; reuse afterwards."""
    cert_path = tls_dir / "cert.pem"
    key_path = tls_dir / "key.pem"
    if cert_path.exists() and key_path.exists():
        return cert_path, key_path

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    key = ec.generate_private_key(ec.SECP256R1())
    hostname = socket.gethostname()
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, hostname)])
    san: list[x509.GeneralName] = [
        x509.DNSName(hostname),
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
    ]
    try:
        lan_ip = socket.gethostbyname(hostname)
        san.append(x509.IPAddress(ipaddress.ip_address(lan_ip)))
    except (OSError, ValueError):
        pass

    now = dt.datetime.now(dt.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=CERT_DAYS))
        .add_extension(x509.SubjectAlternativeName(san), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )

    key_path.touch(mode=0o600)
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    os.chmod(key_path, 0o600)
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    print(f"generated self-signed TLS cert in {cert_path.parent} (trust it in your browser)")
    return cert_path, key_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the Game of Life API over HTTPS")
    parser.add_argument("--host", default="0.0.0.0", help="bind address (default 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8443, help="port (default 8443)")
    args = parser.parse_args()

    if _is_loopback(args.host):
        # Plain HTTP is allowed only on loopback (ARCHITECTURE.md).
        uvicorn.run("gol.main:app", host=args.host, port=args.port)
        return

    cert_path, key_path = ensure_self_signed(config.tls_dir())
    uvicorn.run(
        "gol.main:app",
        host=args.host,
        port=args.port,
        ssl_certfile=str(cert_path),
        ssl_keyfile=str(key_path),
    )


if __name__ == "__main__":
    main()
